"""
DNS Control — Dashboard Routes
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.diagnostics_service import get_dashboard_summary

router = APIRouter()


@router.get("/summary")
def dashboard_summary(_: User = Depends(get_current_user)):
    return get_dashboard_summary()
