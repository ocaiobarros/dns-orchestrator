"""
DNS Control — Auth Schemas
"""

from pydantic import BaseModel
from datetime import datetime


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    expires_at: datetime
    must_change_password: bool
    user: "UserResponse"


class UserResponse(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool
    must_change_password: bool
    created_at: datetime
    updated_at: datetime | None
    last_login_at: datetime | None


class SessionInfoResponse(BaseModel):
    user: UserResponse
    session_id: str
    expires_at: datetime
    session_timeout_minutes: int
    session_warning_seconds: int


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ForceChangePasswordRequest(BaseModel):
    new_password: str


class RefreshResponse(BaseModel):
    expires_at: datetime
