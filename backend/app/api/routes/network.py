"""
DNS Control — Network Routes
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.diagnostics_service import get_network_interfaces, get_routes, check_reachability

router = APIRouter()


@router.get("/interfaces")
def interfaces(_: User = Depends(get_current_user)):
    return get_network_interfaces()


@router.get("/routes")
def routes(_: User = Depends(get_current_user)):
    return get_routes()


@router.get("/reachability")
def reachability(_: User = Depends(get_current_user)):
    return check_reachability()
