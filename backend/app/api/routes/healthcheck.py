"""
DNS Control — Health Check Routes
Per-instance DNS health probing via dig.
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.deploy_service import get_deploy_state
from app.services.healthcheck_service import check_all_instances, check_vip_health, check_instance_health

router = APIRouter()


@router.get("")
def healthcheck_all(_: User = Depends(get_current_user)):
    """Check all Unbound instances + VIP."""
    result = check_all_instances()
    operation_mode = str(get_deploy_state().get("operationMode") or "").lower()
    if operation_mode != "simple":
        vip = check_vip_health()
        result["vip"] = vip
    return result


@router.get("/vip")
def healthcheck_vip(_: User = Depends(get_current_user)):
    """Check VIP Anycast address only."""
    if str(get_deploy_state().get("operationMode") or "").lower() == "simple":
        return {"skipped": True, "reason": "not_applicable_in_simple_mode"}
    return check_vip_health()


@router.get("/instance/{bind_ip}")
def healthcheck_instance(bind_ip: str, port: int = 53, _: User = Depends(get_current_user)):
    """Check a specific instance by bind IP."""
    return check_instance_health(bind_ip=bind_ip, port=port)
