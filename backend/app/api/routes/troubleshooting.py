"""
DNS Control — Troubleshooting Routes
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.command_service import run_whitelisted_command, get_available_commands
from app.services.diagnostics_service import run_health_check, _classify_result
from app.executors.command_runner import get_privilege_status
from app.executors.command_catalog import COMMAND_CATALOG
from app.core.logging import log_command_event
from app.schemas.diagnostics import RunCommandRequest

router = APIRouter()


@router.get("/commands")
def list_commands(_: User = Depends(get_current_user)):
    return get_available_commands()


@router.post("/run")
def run_command_route(body: RunCommandRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = run_whitelisted_command(body.command_id, body.args)

    # Classify the result to determine semantic severity for logging
    cmd_def = COMMAND_CATALOG.get(body.command_id)
    diagnostic_status = None
    requires_privilege = False
    executed_privileged = result.get("executed_privileged", False)

    if cmd_def:
        requires_privilege = cmd_def.requires_privilege
        classification = _classify_result(
            result.get("exit_code", -1),
            result.get("stdout", ""),
            result.get("stderr", ""),
            cmd_def.executable,
        )
        diagnostic_status = classification["status"]

    log_command_event(
        db,
        body.command_id,
        user.username,
        result.get("exit_code", -1),
        result.get("duration_ms", 0),
        diagnostic_status=diagnostic_status,
        requires_privilege=requires_privilege,
        executed_privileged=executed_privileged,
    )
    return result


@router.get("/health-check")
def health_check(_: User = Depends(get_current_user)):
    """Run all diagnostic commands best-effort. Always returns 200."""
    try:
        return run_health_check()
    except Exception as e:
        import logging
        logging.getLogger("dns-control").exception(f"Health check batch error: {e}")
        return {
            "success": False,
            "started_at": "",
            "finished_at": "",
            "total": 0,
            "passed": 0,
            "failed": 0,
            "permission_limited": 0,
            "inactive": 0,
            "service_not_running": 0,
            "misconfigured": 0,
            "dependency_error": 0,
            "privilege_status": get_privilege_status(),
            "results": [],
            "error": str(e),
        }


@router.get("/privilege-status")
def privilege_status(_: User = Depends(get_current_user)):
    """Return current backend privilege environment info."""
    return get_privilege_status()
