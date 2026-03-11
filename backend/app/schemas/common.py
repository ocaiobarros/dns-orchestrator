"""
DNS Control — Common Schemas
"""

from pydantic import BaseModel
from typing import Any, Generic, TypeVar
from datetime import datetime

T = TypeVar("T")


class ApiResponse(BaseModel):
    success: bool
    data: Any = None
    error: str | None = None
    timestamp: datetime


class PaginatedResponse(BaseModel):
    items: list[Any]
    total: int
    page: int
    page_size: int
    has_more: bool


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    timestamp: datetime


class LogEntryResponse(BaseModel):
    id: str
    source: str
    level: str
    message: str
    context: dict | None = None
    created_at: datetime


class SettingResponse(BaseModel):
    key: str
    value: str | None


class UpdateSettingsRequest(BaseModel):
    settings: dict[str, str]
