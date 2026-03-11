"""
DNS Control — OSPF / FRR Routes
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.metrics_service import get_ospf_summary, get_ospf_neighbors, get_ospf_routes, get_ospf_running_config

router = APIRouter()


@router.get("/summary")
def ospf_summary(_: User = Depends(get_current_user)):
    return get_ospf_summary()


@router.get("/neighbors")
def ospf_neighbors(_: User = Depends(get_current_user)):
    return get_ospf_neighbors()


@router.get("/routes")
def ospf_routes(_: User = Depends(get_current_user)):
    return get_ospf_routes()


@router.get("/running-config")
def ospf_running_config(_: User = Depends(get_current_user)):
    return get_ospf_running_config()
