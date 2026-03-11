"""
DNS Control — NAT / nftables Routes
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.metrics_service import get_nat_summary, get_nat_backends, get_nat_sticky, get_nat_ruleset

router = APIRouter()


@router.get("/summary")
def nat_summary(_: User = Depends(get_current_user)):
    return get_nat_summary()


@router.get("/backends")
def nat_backends(_: User = Depends(get_current_user)):
    return get_nat_backends()


@router.get("/sticky")
def nat_sticky(_: User = Depends(get_current_user)):
    return get_nat_sticky()


@router.get("/ruleset")
def nat_ruleset(_: User = Depends(get_current_user)):
    return get_nat_ruleset()
