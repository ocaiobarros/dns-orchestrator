"""
DNS Control — Network Routes
Extended with DNS listener detection.
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.diagnostics_service import get_network_interfaces, get_routes, check_reachability, get_dns_listeners

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


@router.get("/listeners")
def listeners(_: User = Depends(get_current_user)):
    """Detect all IPs listening on port 53 with DNS resolution test."""
    return get_dns_listeners()
