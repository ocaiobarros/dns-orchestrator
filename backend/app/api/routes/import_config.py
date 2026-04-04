"""
DNS Control — Import API Routes
Read-only infrastructure adoption + service mode management.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user, require_admin
from app.models.user import User
from app.services.import_service import execute_import, get_imported_vips, clear_import
from app.services.service_mode import get_service_mode, MODE_IMPORTED

router = APIRouter()


@router.get("/import-host")
def import_host_config(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """
    Legacy endpoint — simplified host state read.
    For full import with persistence, use POST /import.
    """
    from app.services.import_service import (
        _read_cmd, _discover_unbound_instances, _discover_dns_listeners,
    )
    import platform, json

    config = {"hostname": platform.node() or ""}
    instances = _discover_unbound_instances()
    config["instances"] = instances
    config["instanceCount"] = len(instances)

    # Network state (JSON)
    r = _read_cmd("ip", ["-j", "addr", "show"], timeout=10)
    try:
        ifaces = json.loads(r["stdout"])
        config["network"] = {
            "interfaces": [
                {
                    "name": iface.get("ifname"),
                    "state": iface.get("operstate"),
                    "addresses": [
                        {"family": a.get("family"), "address": a.get("local"), "prefixlen": a.get("prefixlen")}
                        for a in iface.get("addr_info", [])
                    ],
                }
                for iface in ifaces
            ],
        }
    except (json.JSONDecodeError, KeyError):
        config["network"] = {"interfaces": []}

    # Listeners
    config["network"]["listeners"] = [l["ip"] for l in _discover_dns_listeners()]

    return config


@router.post("/import")
def run_import(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """
    Execute read-only infrastructure import.
    Discovers nftables, interfaces, routes, unbound instances.
    Persists to DB and sets service_mode=imported.

    STRICTLY READ-ONLY: no files written, no services touched.
    """
    result = execute_import(db)
    return result


@router.delete("/import")
def remove_import(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """
    Clear imported state and return to managed mode.
    Does NOT touch host files or services — only clears DB state.
    """
    result = clear_import(db)
    return result


@router.get("/service-mode")
def get_mode(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Return current service mode (managed | imported | observed)."""
    mode = get_service_mode(db)

    # Include import metadata if imported
    extra = {}
    if mode == MODE_IMPORTED:
        from app.models.log_entry import Setting
        ts_row = db.query(Setting).filter(Setting.key == "import_timestamp").first()
        extra["import_timestamp"] = ts_row.value if ts_row else None
        extra["imported_vips"] = get_imported_vips(db)
    elif mode == MODE_OBSERVED:
        # Include runtime inventory summary
        try:
            from app.services.runtime_inventory_service import get_full_inventory
            inv = get_full_inventory()
            extra["inventory_summary"] = {
                "instances": inv["instance_count"],
                "vips": inv["vip_count"],
                "dnat_rules": inv["dnat_rule_count"],
                "listeners": inv["listener_count"],
            }
        except Exception:
            extra["inventory_summary"] = None

    return {"service_mode": mode, **extra}


class ServiceModeRequest(BaseModel):
    mode: str


@router.post("/service-mode")
def set_mode(body: ServiceModeRequest, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Set the service mode (managed | imported | observed)."""
    if body.mode not in (MODE_MANAGED, MODE_IMPORTED, MODE_OBSERVED):
        raise HTTPException(400, f"Invalid mode: {body.mode}. Valid: managed, imported, observed")
    new_mode = set_service_mode(db, body.mode)
    return {"mode": new_mode}
