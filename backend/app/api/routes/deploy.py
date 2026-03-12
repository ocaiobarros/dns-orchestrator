"""
DNS Control — Deploy Routes
Full deployment lifecycle: apply, rollback, state, backups.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.apply_job import ApplyJob
from app.models.config_profile import ConfigProfile
from app.services.deploy_service import execute_deploy, execute_rollback, get_deploy_state, list_backups

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


@router.post("/apply")
def deploy_apply(body: DeployRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Execute full deployment pipeline."""
    # Get payload from profile or inline config
    if body.config:
        payload = body.config
    elif body.profile_id:
        profile = db.query(ConfigProfile).filter(ConfigProfile.id == body.profile_id).first()
        if not profile:
            raise HTTPException(status_code=404, detail="Perfil não encontrado")
        payload = json.loads(profile.payload_json)
    else:
        raise HTTPException(status_code=400, detail="config ou profile_id necessário")

    result = execute_deploy(
        payload=payload,
        scope=body.scope,
        dry_run=body.dry_run,
        operator=user.username,
    )

    # Persist to DB
    from datetime import datetime, timezone
    job = ApplyJob(
        id=result["id"],
        profile_id=body.profile_id,
        job_type=body.scope if not body.dry_run else "dry-run",
        status=result["status"],
        started_at=result["steps"][0]["startedAt"] if result["steps"] else None,
        finished_at=result["steps"][-1]["finishedAt"] if result["steps"] else None,
        stdout_log=json.dumps(result["steps"]),
        stderr_log=json.dumps(result.get("healthResult", [])),
        exit_code=0 if result.get("success") else 1,
        created_by=user.username,
    )
    db.add(job)
    db.commit()

    return result


@router.post("/rollback")
def deploy_rollback(body: RollbackRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Rollback to a previous backup snapshot."""
    result = execute_rollback(backup_id=body.backup_id, operator=user.username)
    if not result["success"] and "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    # Persist rollback as a job
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
    """Get current deployment state (version, last apply, drift)."""
    return get_deploy_state()


@router.get("/backups")
def deploy_backups(_: User = Depends(get_current_user)):
    """List available backup snapshots for rollback."""
    return list_backups()
