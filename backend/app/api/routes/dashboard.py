"""
DNS Control — Dashboard Routes
"""

import logging
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from app.api.deps import get_current_user
from app.models.user import User
from app.services.diagnostics_service import get_dashboard_summary
from app.services.unbound_stats_service import get_instance_real_stats
from app.services.healthcheck_service import check_all_instances, check_instance_health
from app.services.deploy_service import get_deploy_state
from app.services.vip_diagnostics_service import run_vip_diagnostics, export_vip_audit

logger = logging.getLogger("dns-control.dashboard")
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
    """Per-instance health.

    In Simple mode, the operational path is Frontend DNS → DNAT → backend, so
    direct probes against backends would be ACL-refused. Health is therefore
    derived from listener bind state + Frontend DNS availability.
    """
    state = get_deploy_state()
    operation_mode = str(state.get("operationMode") or "").lower()
    frontend_ip = str(state.get("frontendDnsIp") or "").strip() or None
    result = check_all_instances(operation_mode=operation_mode, frontend_ip=frontend_ip)
    if operation_mode == "simple" and frontend_ip:
        fe = check_instance_health(bind_ip=frontend_ip, name="frontend-dns")
        result["vip"] = {
            "bind_ip": frontend_ip,
            "healthy": bool(fe.get("healthy")),
            "latency_ms": fe.get("latency_ms"),
            "role": "frontend_dns",
        }
    return result


@router.get("/vip-diagnostics")
def vip_diagnostics(
    _: User = Depends(get_current_user),
    debug: bool = Query(False, description="Include debug info (matched rules/chains)"),
):
    """Service VIP health: DNS resolution, local bind, DNAT, route, traffic, cross-validation.

    Always returns 200; on internal failure returns a structured error payload so the UI
    can render a degraded state instead of a hard 500.
    """
    try:
        return run_vip_diagnostics(debug=debug)
    except Exception as e:
        logger.exception("vip-diagnostics failed; returning structured error payload")
        return JSONResponse(
            status_code=200,
            content={
                "vip_diagnostics": [],
                "root_recursion": {
                    "trace": {"status": "unknown", "error": "diagnostics engine error"},
                    "root_query": {"status": "unknown", "error": "diagnostics engine error"},
                },
                "source_timestamps": {},
                "summary": {
                    "total_vips": 0,
                    "healthy_vips": 0,
                    "all_healthy": False,
                    "degraded": True,
                    "has_parse_errors": True,
                    "has_counter_mismatch": False,
                    "root_recursion_ok": False,
                    "trace_ok": False,
                    "engine_error": True,
                    "error_message": str(e)[:300],
                },
            },
        )


@router.get("/vip-diagnostics/export")
def vip_diagnostics_export(_: User = Depends(get_current_user)):
    """Audit export: full VIP diagnostic data in structured JSON."""
    try:
        data = export_vip_audit(debug=True)
    except Exception as e:
        logger.exception("vip-diagnostics export failed")
        return JSONResponse(content={
            "export_version": "1.0",
            "data": [],
            "engine_error": True,
            "error_message": str(e)[:300],
        })
    return JSONResponse(content={
        "export_version": "1.0",
        "data": data,
    })
