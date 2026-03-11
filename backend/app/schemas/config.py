"""
DNS Control — Config & Apply Schemas
"""

from pydantic import BaseModel
from typing import Any
from datetime import datetime


class ConfigProfileCreate(BaseModel):
    name: str
    description: str = ""
    payload: dict[str, Any]


class ConfigProfileResponse(BaseModel):
    id: str
    name: str
    description: str
    payload: dict[str, Any]
    created_by: str | None
    created_at: datetime
    updated_at: datetime | None


class ConfigValidationResult(BaseModel):
    valid: bool
    errors: list[dict[str, str]]


class GeneratedFilePreview(BaseModel):
    path: str
    content: str
    permissions: str
    owner: str
    changed: bool
    backup_path: str | None = None


class ApplyRequest(BaseModel):
    profile_id: str
    scope: str = "full"  # full, dns, network, frr, nftables
    dry_run: bool = False
    comment: str = ""


class ApplyStepResult(BaseModel):
    order: int
    name: str
    status: str
    output: str
    duration_ms: int
    command: str | None = None


class ApplyJobResponse(BaseModel):
    id: str
    profile_id: str | None
    revision_id: str | None
    job_type: str
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    exit_code: int | None
    steps: list[ApplyStepResult] = []
    created_by: str | None
    created_at: datetime


class ConfigDiffResponse(BaseModel):
    path: str
    old_content: str
    new_content: str
