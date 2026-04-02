"""
DNS Control — Service Mode Guard
Manages `service_mode` setting (managed | imported).

When service_mode=imported:
  - All mutating endpoints (apply, deploy, rollback) are BLOCKED
  - The system operates in read-only observation mode
  - No files are written, no services restarted, no sysctl applied
  - Deploy state is not modified

This guard ensures that servers adopted via Import cannot be accidentally
mutated by the orchestration engine.
"""

import logging
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.log_entry import Setting

logger = logging.getLogger("dns-control.service-mode")

# Valid modes
MODE_MANAGED = "managed"      # Full control — deploy/apply allowed
MODE_IMPORTED = "imported"    # Read-only observation — mutations blocked


def get_service_mode(db: Session) -> str:
    """Return the current service mode from the settings table."""
    row = db.query(Setting).filter(Setting.key == "service_mode").first()
    return row.value if row and row.value in (MODE_MANAGED, MODE_IMPORTED) else MODE_MANAGED


def set_service_mode(db: Session, mode: str) -> str:
    """Set the service mode. Returns the new mode."""
    if mode not in (MODE_MANAGED, MODE_IMPORTED):
        raise ValueError(f"Invalid service mode: {mode}")

    row = db.query(Setting).filter(Setting.key == "service_mode").first()
    if row:
        row.value = mode
    else:
        db.add(Setting(key="service_mode", value=mode))
    db.commit()
    logger.info(f"Service mode changed to: {mode}")
    return mode


def require_managed_mode(db: Session) -> None:
    """
    Guard: raises HTTP 423 Locked if the system is in imported mode.
    Call this at the top of any mutating endpoint.
    """
    mode = get_service_mode(db)
    if mode == MODE_IMPORTED:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=(
                "Operação bloqueada — sistema em modo IMPORT (somente leitura). "
                "Desative o modo Import nas Configurações antes de aplicar alterações."
            ),
        )
