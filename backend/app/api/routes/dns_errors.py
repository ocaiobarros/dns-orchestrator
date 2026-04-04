"""
DNS Control — DNS Error Metrics API Routes
Exposes DNS error/failure data from log parsing, unbound-control, and dnstap.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.dns_error_collector_service import (
    collect_dns_errors_from_logs,
    get_dns_error_stats_from_unbound,
    get_dns_error_summary,
)

router = APIRouter()


@router.get("/summary")
def dns_error_summary(
    minutes: int = Query(60, ge=1, le=1440),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """
    DNS error summary from persisted events.
    Returns rcode counts, top failing domains/clients/instances, and timeline.
    Falls back to unbound-control aggregate stats if no events are persisted.
    """
    summary = get_dns_error_summary(db, minutes=minutes)
    if summary["total_errors"] == 0:
        # Fallback: try unbound-control aggregate stats
        fallback = get_dns_error_stats_from_unbound()
        if fallback["total_errors"] > 0:
            summary.update({
                "rcode_counts": fallback["rcode_counts"],
                "total_errors": fallback["total_errors"],
                "total_queries": fallback.get("total_queries", 0),
                "error_rate_pct": fallback.get("error_rate_pct", 0),
                "source": fallback["source"],
                "fidelity": fallback["fidelity"],
            })
    return summary


@router.get("/live")
def dns_errors_live(
    since: int = Query(60, ge=10, le=600),
    _: User = Depends(get_current_user),
):
    """
    Live DNS error collection from journalctl.
    Parses unbound logs in real-time for SERVFAIL, NXDOMAIN, timeouts.
    """
    return collect_dns_errors_from_logs(since_seconds=since)


@router.get("/stats")
def dns_error_stats(
    _: User = Depends(get_current_user),
):
    """
    Aggregate error stats from unbound-control.
    Lower fidelity but always available.
    """
    return get_dns_error_stats_from_unbound()


@router.get("/dnstap/status")
def dnstap_status(_: User = Depends(get_current_user)):
    """Check dnstap collector status."""
    from backend.collector.dnstap_collector import check_dnstap_status
    try:
        return check_dnstap_status()
    except Exception:
        # Import from different path in production
        try:
            sys_path = "/opt/dns-control/collector"
            import sys
            if sys_path not in sys.path:
                sys.path.insert(0, sys_path)
            from dnstap_collector import check_dnstap_status as _check
            return _check()
        except Exception:
            return {
                "enabled": False,
                "status": "not_configured",
                "fidelity": "unavailable",
                "message": "dnstap collector module not available",
            }


@router.get("/dnstap/events")
def dnstap_events(
    limit: int = Query(100, ge=1, le=500),
    _: User = Depends(get_current_user),
):
    """Get recent dnstap events."""
    try:
        from backend.collector.dnstap_collector import get_dnstap_events
        return get_dnstap_events(limit=limit)
    except Exception:
        try:
            import sys
            sys_path = "/opt/dns-control/collector"
            if sys_path not in sys.path:
                sys.path.insert(0, sys_path)
            from dnstap_collector import get_dnstap_events as _get
            return _get(limit=limit)
        except Exception:
            return []


@router.get("/dnstap/summary")
def dnstap_summary(_: User = Depends(get_current_user)):
    """Get dnstap aggregated summary."""
    try:
        from backend.collector.dnstap_collector import get_dnstap_summary
        return get_dnstap_summary()
    except Exception:
        try:
            import sys
            sys_path = "/opt/dns-control/collector"
            if sys_path not in sys.path:
                sys.path.insert(0, sys_path)
            from dnstap_collector import get_dnstap_summary as _get
            return _get()
        except Exception:
            return {"status": "not_configured", "source": "dnstap", "fidelity": "unavailable"}
