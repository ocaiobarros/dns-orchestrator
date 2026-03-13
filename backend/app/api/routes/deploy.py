"""
DNS Control — Deploy Routes
Full deployment lifecycle: dry-run, apply, rollback, state, backups, history.
"""

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.apply_job import ApplyJob
from app.models.config_profile import ConfigProfile
from app.services.deploy_service import execute_deploy, execute_rollback, get_deploy_state, get_live_deploy_state, list_backups

router = APIRouter()


class DeployRequest(BaseModel):
    profile_id: str | None = None
    config: dict | None = None
    scope: str = "full"
    dry_run: bool = False
    comment: str = ""


class RollbackRequest(BaseModel):
    backup_id: str
    reason: str = ""


def _resolve_payload(body: DeployRequest, db: Session) -> dict:
    """Resolve payload from inline config or profile_id."""
    if body.config:
        return body.config
    if body.profile_id:
        profile = db.query(ConfigProfile).filter(ConfigProfile.id == body.profile_id).first()
        if not profile:
            raise HTTPException(status_code=404, detail="Perfil não encontrado")
        return json.loads(profile.payload_json)
    raise HTTPException(status_code=400, detail="config ou profile_id necessário")


def _parse_dt(value):
    """Convert ISO string or datetime to Python datetime for SQLite."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


def _persist_job(db: Session, result: dict, body: DeployRequest, user: User) -> dict | None:
    """Persist deploy/dry-run job to DB. Returns error dict on failure, None on success."""
    try:
        now = datetime.now(timezone.utc)
        raw_start = result["steps"][0]["startedAt"] if result.get("steps") else None
        raw_finish = result["steps"][-1]["finishedAt"] if result.get("steps") else None
        job = ApplyJob(
            id=result["id"],
            profile_id=body.profile_id,
            job_type=body.scope if not result.get("dryRun") else "dry-run",
            status=result["status"],
            started_at=_parse_dt(raw_start) or now,
            finished_at=_parse_dt(raw_finish) or now,
            stdout_log=json.dumps(result["steps"]),
            stderr_log=json.dumps(result.get("healthResult", [])),
            exit_code=0 if result.get("success") else 1,
            created_by=user.username,
        )
        db.add(job)
        db.commit()
        return None
    except Exception as exc:
        db.rollback()
        return {"failed_step": "persist_job", "error": str(exc)}


@router.post("/dry-run")
def deploy_dry_run(body: DeployRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Execute dry-run: validate, generate, check — no changes applied."""
    payload = _resolve_payload(body, db)
    result = execute_deploy(
        payload=payload,
        scope=body.scope,
        dry_run=True,
        operator=user.username,
    )
    persist_err = _persist_job(db, result, body, user)
    if persist_err:
        result["persist_warning"] = persist_err
    return result


@router.post("/apply")
def deploy_apply(body: DeployRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Execute full deployment pipeline."""
    payload = _resolve_payload(body, db)
    result = execute_deploy(
        payload=payload,
        scope=body.scope,
        dry_run=body.dry_run,
        operator=user.username,
    )
    persist_err = _persist_job(db, result, body, user)
    if persist_err:
        result["persist_warning"] = persist_err
    return result


@router.post("/rollback")
def deploy_rollback(body: RollbackRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Rollback to a previous backup snapshot."""
    result = execute_rollback(backup_id=body.backup_id, operator=user.username)
    if not result["success"] and "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    from datetime import datetime, timezone
    job = ApplyJob(
        job_type="rollback",
        status="success" if result["success"] else "failed",
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
        stdout_log=json.dumps(result["steps"]),
        stderr_log=body.reason,
        exit_code=0 if result["success"] else 1,
        created_by=user.username,
    )
    db.add(job)
    db.commit()

    return result


@router.get("/state")
def deploy_state(_: User = Depends(get_current_user)):
    """Get current deployment state including live pipeline progress."""
    return get_live_deploy_state()


@router.get("/backups")
def deploy_backups(_: User = Depends(get_current_user)):
    """List available backup snapshots for rollback."""
    return list_backups()


@router.get("/history")
def deploy_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Deployment history with pagination."""
    total = db.query(ApplyJob).count()
    jobs = (
        db.query(ApplyJob)
        .order_by(ApplyJob.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [
            {
                "id": j.id,
                "profile_id": j.profile_id,
                "job_type": j.job_type,
                "status": j.status,
                "exit_code": j.exit_code,
                "created_by": j.created_by,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "finished_at": j.finished_at.isoformat() if j.finished_at else None,
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
            for j in jobs
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (page * page_size) < total,
    }


@router.get("/history/{job_id}")
def deploy_history_detail(job_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Get detailed deploy job by ID."""
    job = db.query(ApplyJob).filter(ApplyJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado")

    steps = []
    health_result = []
    try:
        steps = json.loads(job.stdout_log) if job.stdout_log else []
    except (json.JSONDecodeError, TypeError):
        pass
    try:
        health_result = json.loads(job.stderr_log) if job.stderr_log else []
    except (json.JSONDecodeError, TypeError):
        pass

    return {
        "id": job.id,
        "profile_id": job.profile_id,
        "job_type": job.job_type,
        "status": job.status,
        "exit_code": job.exit_code,
        "created_by": job.created_by,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "steps": steps,
        "healthResult": health_result,
    }
