"""
DNS Control — Health Check Routes
Per-instance DNS health probing via dig.
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.deploy_service import get_deploy_state
from app.services.healthcheck_service import (
    check_all_instances,
    check_vip_health,
    check_instance_health,
    resolve_forward_addresses_from_state,
)

router = APIRouter()


@router.get("")
def healthcheck_all(_: User = Depends(get_current_user)):
    """Check all Unbound instances + VIP/Frontend.

    In Simple mode, instance probes go through the Frontend DNS (the operational
    path) instead of direct dig against backends, which would be refused by
    Unbound ACLs and produce false negatives.
    """
    state = get_deploy_state()
    operation_mode = str(state.get("operationMode") or "").lower()
    frontend_ip = str(state.get("frontendDnsIp") or "").strip() or None
    result = check_all_instances(operation_mode=operation_mode, frontend_ip=frontend_ip)
    if operation_mode == "simple":
        if frontend_ip:
            fe = check_instance_health(bind_ip=frontend_ip, name="frontend-dns")
            result["vip"] = {
                "bind_ip": frontend_ip,
                "healthy": bool(fe.get("healthy")),
                "latency_ms": fe.get("latency_ms"),
                "role": "frontend_dns",
            }
    else:
        vip = check_vip_health()
        result["vip"] = vip

    # Expose configured upstream forwarders so the NOC topology map can render
    # the real operational path (e.g. 1.1.1.1, 8.8.8.8) instead of an artificial
    # "N/A" upstream node when probes don't capture a resolved upstream IP.
    result["forward_addresses"] = resolve_forward_addresses_from_state(state)
    result["forward_first"] = bool(state.get("forwardFirst"))
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
