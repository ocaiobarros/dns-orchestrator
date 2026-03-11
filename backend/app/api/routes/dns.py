"""
DNS Control — DNS Routes
"""

from fastapi import APIRouter, Depends, Query
from app.api.deps import get_current_user
from app.models.user import User
from app.services.metrics_service import get_dns_metrics, get_dns_instances, get_top_domains, get_rcode_breakdown

router = APIRouter()


@router.get("/summary")
def dns_summary(_: User = Depends(get_current_user)):
    return get_dns_metrics(hours=1)


@router.get("/metrics")
def dns_metrics(hours: int = Query(6, ge=1, le=72), instance: str | None = None, _: User = Depends(get_current_user)):
    return get_dns_metrics(hours=hours, instance=instance)


@router.get("/instances")
def dns_instances(_: User = Depends(get_current_user)):
    return get_dns_instances()


@router.get("/top-domains")
def top_domains(limit: int = Query(20, ge=1, le=100), _: User = Depends(get_current_user)):
    return get_top_domains(limit)


@router.get("/rcode-breakdown")
def rcode_breakdown(_: User = Depends(get_current_user)):
    return get_rcode_breakdown()
