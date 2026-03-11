"""
DNS Control — User Schemas
"""

from pydantic import BaseModel
from datetime import datetime


class CreateUserRequest(BaseModel):
    username: str
    password: str
    must_change_password: bool = True


class UpdateUserRequest(BaseModel):
    is_active: bool | None = None
    username: str | None = None


class AdminChangePasswordRequest(BaseModel):
    password: str


class UserListResponse(BaseModel):
    id: str
    username: str
    is_active: bool
    must_change_password: bool
    created_at: datetime
    updated_at: datetime | None
    last_login_at: datetime | None
