"""
DNS Control v2 — Metrics API Routes
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.metrics_collector_service import get_latest_metrics, get_metric_history
from app.services.prometheus_service import generate_prometheus_output
from fastapi.responses import PlainTextResponse

router = APIRouter()


@router.get("/dns")
def dns_metrics(
    instance_id: str | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return get_latest_metrics(db, instance_id=instance_id)


@router.get("/dns/history")
def dns_metric_history(
    instance_id: str = Query(...),
    metric_name: str = Query("dns_queries_total"),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return get_metric_history(db, instance_id, metric_name, limit)


@router.get("/system")
def system_metrics(_: User = Depends(get_current_user)):
    """System-level metrics from OS commands."""
    from app.executors.command_runner import run_command
    import json

    mem = run_command("free", ["-b", "--output=total,used,free,available"], timeout=5)
    disk = run_command("df", ["-B1", "/"], timeout=5)
    uptime = run_command("uptime", ["-p"], timeout=5)

    return {
        "memory_raw": mem["stdout"],
        "disk_raw": disk["stdout"],
        "uptime": uptime["stdout"].strip(),
    }


@router.get("/network")
def network_metrics(_: User = Depends(get_current_user)):
    """Network-level metrics."""
    from app.executors.command_runner import run_command

    listening = run_command("ss", ["-tlnp"], timeout=5)
    connections = run_command("ss", ["-tnp"], timeout=5)

    return {
        "listening": listening["stdout"],
        "connections_count": len(connections["stdout"].strip().split("\n")) - 1 if connections["stdout"] else 0,
    }
