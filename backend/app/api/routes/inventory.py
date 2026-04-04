"""
DNS Control — Runtime Inventory API Routes
Exposes runtime discovery endpoints for observed mode.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.runtime_inventory_service import (
    get_full_inventory, discover_unbound_instances,
    discover_vips, discover_dnat_rules, discover_sticky_sets,
    discover_dns_listeners, sync_instances_to_db,
)
from app.services.service_mode import get_service_mode

router = APIRouter()


@router.get("/full")
def runtime_inventory_full(_: User = Depends(get_current_user)):
    """Full runtime inventory snapshot."""
    return get_full_inventory()


@router.get("/instances")
def runtime_instances(_: User = Depends(get_current_user)):
    """Discovered unbound instances from systemd + config parsing."""
    return discover_unbound_instances()


@router.get("/vips")
def runtime_vips(_: User = Depends(get_current_user)):
    """Discovered VIPs from loopback interfaces."""
    return discover_vips()


@router.get("/dnat")
def runtime_dnat(_: User = Depends(get_current_user)):
    """Discovered DNAT rules from nftables (name-agnostic)."""
    return discover_dnat_rules()


@router.get("/sticky")
def runtime_sticky(_: User = Depends(get_current_user)):
    """Discovered sticky/dynamic sets from nftables."""
    return discover_sticky_sets()


@router.get("/listeners")
def runtime_listeners(_: User = Depends(get_current_user)):
    """Discovered DNS listeners on port 53."""
    return discover_dns_listeners()


@router.post("/sync")
def runtime_sync(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Manually trigger sync of discovered instances to dns_instances table."""
    result = sync_instances_to_db(db)
    return result


@router.get("/mode")
def get_operation_mode(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Get current operation mode."""
    mode = get_service_mode(db)
    return {"mode": mode}
