"""
DNS Control — Dashboard Routes
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.diagnostics_service import get_dashboard_summary
from app.services.unbound_stats_service import get_instance_real_stats
from app.services.healthcheck_service import check_all_instances
from app.services.external_dns_service import run_external_dns_probes

router = APIRouter()


@router.get("/summary")
def dashboard_summary(_: User = Depends(get_current_user)):
    return get_dashboard_summary()


@router.get("/instance-stats")
def instance_stats(_: User = Depends(get_current_user)):
    """Real per-instance stats from unbound-control stats_noreset."""
    return get_instance_real_stats()


@router.get("/instance-health")
def instance_health(_: User = Depends(get_current_user)):
    """Per-instance health check via dig against all bind IPs."""
    return check_all_instances()


@router.get("/external-dns")
def external_dns_probes(_: User = Depends(get_current_user)):
    """External DNS reachability, hijack detection, and root recursion tests."""
    return run_external_dns_probes()
