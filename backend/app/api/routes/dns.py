"""
DNS Control — DNS Routes
"""

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.metrics_service import get_dns_metrics, get_dns_instances, get_top_domains, get_rcode_breakdown

router = APIRouter()
logger = logging.getLogger("dns-control.dns")


@router.get("/summary")
def dns_summary(_: User = Depends(get_current_user)):
    return get_dns_metrics(hours=1)


@router.get("/metrics")
def dns_metrics(
    hours: int = Query(6, ge=1, le=72),
    instance: str | None = None,
    qtype: str | None = None,
    range: str | None = Query(None, pattern="^(1h|6h|12h|24h|48h|72h)$"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    logger.info("DNS metrics request: instance=%s qtype=%s range=%s hours=%s", instance, qtype, range, hours)
    return get_dns_metrics(hours=hours, instance=instance, qtype=qtype, range_value=range, db=db)


@router.get("/instances")
def dns_instances(_: User = Depends(get_current_user)):
    return get_dns_instances()


@router.get("/top-domains")
def top_domains(limit: int = Query(20, ge=1, le=100), _: User = Depends(get_current_user)):
    return get_top_domains(limit)


@router.get("/rcode-breakdown")
def rcode_breakdown(_: User = Depends(get_current_user)):
    return get_rcode_breakdown()
