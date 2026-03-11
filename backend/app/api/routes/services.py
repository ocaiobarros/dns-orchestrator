"""
DNS Control — Services Routes
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.diagnostics_service import get_services_status, get_service_detail, restart_service
from app.core.logging import log_event

router = APIRouter()


@router.get("")
def list_services(_: User = Depends(get_current_user)):
    return get_services_status()


@router.get("/{name}")
def service_detail(name: str, _: User = Depends(get_current_user)):
    return get_service_detail(name)


@router.post("/{name}/restart")
def service_restart(name: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = restart_service(name)
    log_event(db, "system", "info", f"Serviço '{name}' reiniciado por '{user.username}'")
    return result


@router.get("/{name}/logs")
def service_logs(name: str, lines: int = 100, _: User = Depends(get_current_user)):
    from app.services.command_service import run_whitelisted_command
    result = run_whitelisted_command("journalctl", {"unit": name, "lines": str(lines)})
    return result
