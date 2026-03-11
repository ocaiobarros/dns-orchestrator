"""
DNS Control — Apply Job Model
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from app.core.database import Base


class ApplyJob(Base):
    __tablename__ = "apply_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    profile_id = Column(String, ForeignKey("config_profiles.id", ondelete="SET NULL"), nullable=True)
    revision_id = Column(String, ForeignKey("config_revisions.id", ondelete="SET NULL"), nullable=True)
    job_type = Column(String(50), nullable=False)  # full, dns, network, frr, nftables, dry-run
    status = Column(String(20), nullable=False, default="pending")  # pending, running, success, failed, dry-run
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    stdout_log = Column(Text, default="")
    stderr_log = Column(Text, default="")
    exit_code = Column(Integer, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
