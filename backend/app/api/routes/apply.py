"""
DNS Control — Apply Routes
"""

import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.apply_job import ApplyJob
from app.models.config_profile import ConfigProfile
from app.services.apply_service import execute_apply
from app.schemas.config import ApplyRequest

router = APIRouter()


def _run_apply(scope: str, dry_run: bool, body: ApplyRequest, db: Session, user: User):
    profile = db.query(ConfigProfile).filter(ConfigProfile.id == body.profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil não encontrado")

    job = ApplyJob(
        profile_id=profile.id,
        job_type=scope if not dry_run else "dry-run",
        status="running",
        started_at=datetime.now(timezone.utc),
        created_by=user.username,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    payload = json.loads(profile.payload_json)
    result = execute_apply(payload, scope=scope, dry_run=dry_run)

    job.status = "success" if result["success"] else "failed"
    job.finished_at = datetime.now(timezone.utc)
    job.stdout_log = result.get("stdout", "")
    job.stderr_log = result.get("stderr", "")
    job.exit_code = result.get("exit_code", 0)
    db.commit()

    return {
        "id": job.id, "status": job.status, "job_type": job.job_type,
        "steps": result.get("steps", []),
        "started_at": job.started_at.isoformat(),
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


@router.post("/dry-run")
def dry_run(body: ApplyRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _run_apply(body.scope, True, body, db, user)


@router.post("/full")
def apply_full(body: ApplyRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _run_apply("full", False, body, db, user)


@router.post("/dns")
def apply_dns(body: ApplyRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _run_apply("dns", body.dry_run, body, db, user)


@router.post("/network")
def apply_network(body: ApplyRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _run_apply("network", body.dry_run, body, db, user)


@router.post("/frr")
def apply_frr(body: ApplyRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _run_apply("frr", body.dry_run, body, db, user)


@router.post("/nftables")
def apply_nftables(body: ApplyRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _run_apply("nftables", body.dry_run, body, db, user)


@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    jobs = db.query(ApplyJob).order_by(ApplyJob.created_at.desc()).limit(50).all()
    return [
        {
            "id": j.id, "profile_id": j.profile_id, "job_type": j.job_type,
            "status": j.status, "exit_code": j.exit_code,
            "created_by": j.created_by,
            "started_at": j.started_at.isoformat() if j.started_at else None,
            "finished_at": j.finished_at.isoformat() if j.finished_at else None,
        }
        for j in jobs
    ]


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    job = db.query(ApplyJob).filter(ApplyJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado")
    return {
        "id": job.id, "profile_id": job.profile_id, "job_type": job.job_type,
        "status": job.status, "exit_code": job.exit_code,
        "stdout_log": job.stdout_log, "stderr_log": job.stderr_log,
        "created_by": job.created_by,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }
