"""
DNS Control — Service Mode Guard
Manages `service_mode` setting (managed | imported | observed).

When service_mode=managed:
  - Full control — deploy/apply allowed
  - Wizard generates infrastructure

When service_mode=imported:
  - All mutating endpoints (apply, deploy, rollback) are BLOCKED
  - The system operates in read-only observation mode
  - No files are written, no services restarted, no sysctl applied

When service_mode=observed:
  - Like imported: mutations are BLOCKED
  - Infrastructure is discovered from runtime (systemctl, nft, ip addr)
  - dns_instances are auto-populated from running services
  - Dashboard uses runtime inventory instead of deploy-state.json
  - No dependency on wizard-generated naming conventions
"""

import logging
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.log_entry import Setting

logger = logging.getLogger("dns-control.service-mode")

# Valid modes
MODE_MANAGED = "managed"      # Full control — deploy/apply allowed
MODE_IMPORTED = "imported"    # Read-only observation — mutations blocked
MODE_OBSERVED = "observed"    # Runtime discovery — no deploy artifacts needed

ALL_MODES = (MODE_MANAGED, MODE_IMPORTED, MODE_OBSERVED)


def get_service_mode(db: Session) -> str:
    """Return the current service mode from the settings table."""
    row = db.query(Setting).filter(Setting.key == "service_mode").first()
    return row.value if row and row.value in ALL_MODES else MODE_MANAGED


def set_service_mode(db: Session, mode: str) -> str:
    """Set the service mode. Returns the new mode."""
    if mode not in ALL_MODES:
        raise ValueError(f"Invalid service mode: {mode}")

    row = db.query(Setting).filter(Setting.key == "service_mode").first()
    if row:
        row.value = mode
    else:
        db.add(Setting(key="service_mode", value=mode))
    db.commit()
    logger.info(f"Service mode changed to: {mode}")

    # If switching to observed mode, trigger an immediate inventory sync
    if mode == MODE_OBSERVED:
        try:
            from app.services.runtime_inventory_service import sync_instances_to_db
            result = sync_instances_to_db(db)
            logger.info(f"Observed mode: initial sync completed — {result}")
        except Exception as e:
            logger.warning(f"Observed mode: initial sync failed — {e}")

    return mode


def is_observed_mode(db: Session) -> bool:
    """Check if the system is in observed mode."""
    return get_service_mode(db) == MODE_OBSERVED


def is_readonly_mode(db: Session) -> bool:
    """Check if the system is in any read-only mode (imported or observed)."""
    return get_service_mode(db) in (MODE_IMPORTED, MODE_OBSERVED)


def require_managed_mode(db: Session) -> None:
    """
    Guard: raises HTTP 423 Locked if the system is in imported or observed mode.
    Call this at the top of any mutating endpoint.
    """
    mode = get_service_mode(db)
    if mode in (MODE_IMPORTED, MODE_OBSERVED):
        mode_label = "IMPORT" if mode == MODE_IMPORTED else "OBSERVAÇÃO"
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=(
                f"Operação bloqueada — sistema em modo {mode_label} (somente leitura). "
                "Altere o modo nas Configurações antes de aplicar alterações."
            ),
        )
