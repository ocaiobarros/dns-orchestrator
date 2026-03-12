"""
DNS Control — Troubleshooting Routes
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.command_service import run_whitelisted_command, get_available_commands
from app.services.diagnostics_service import run_health_check
from app.core.logging import log_command_event
from app.schemas.diagnostics import RunCommandRequest

router = APIRouter()


@router.get("/commands")
def list_commands(_: User = Depends(get_current_user)):
    return get_available_commands()


@router.post("/run")
def run_command(body: RunCommandRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = run_whitelisted_command(body.command_id, body.args)
    log_command_event(db, body.command_id, user.username, result.get("exit_code", -1), result.get("duration_ms", 0))
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
            "results": [],
            "error": str(e),
        }
