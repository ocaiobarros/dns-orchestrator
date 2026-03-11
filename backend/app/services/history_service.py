"""
DNS Control — History Service
"""

from sqlalchemy.orm import Session
from app.models.apply_job import ApplyJob


def get_recent_jobs(db: Session, limit: int = 50) -> list[ApplyJob]:
    return db.query(ApplyJob).order_by(ApplyJob.created_at.desc()).limit(limit).all()


def get_job_by_id(db: Session, job_id: str) -> ApplyJob | None:
    return db.query(ApplyJob).filter(ApplyJob.id == job_id).first()
