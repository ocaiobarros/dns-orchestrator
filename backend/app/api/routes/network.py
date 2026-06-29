"""
DNS Control — Network Routes
Extended with DNS listener detection.
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.diagnostics_service import get_network_interfaces, get_routes, check_reachability, get_dns_listeners
from app.services import upstream_probe_service, infra_probe_service


router = APIRouter()


@router.get("/interfaces")
def interfaces(_: User = Depends(get_current_user)):
    return get_network_interfaces()


@router.get("/routes")
def routes(_: User = Depends(get_current_user)):
    return get_routes()


@router.get("/reachability")
def reachability(_: User = Depends(get_current_user)):
    return check_reachability()


@router.get("/listeners")
def listeners(_: User = Depends(get_current_user)):
    """Detect all IPs listening on port 53 with DNS resolution test."""
    return get_dns_listeners()


@router.get("/upstreams")
def upstreams(
    include_retired: bool = False,
    _: User = Depends(get_current_user),
):
    """Live upstream probe state: current PoP, rtt, alive, history per upstream.

    Read-only. Updated by the upstream_probe_worker (~30s cadence).
    """
    return upstream_probe_service.get_state_snapshot(include_retired=include_retired)


@router.get("/cdns")
def cdns(_: User = Depends(get_current_user)):
    """Live CDN/authoritative map for iterative-mode resolvers.

    Aggregates `unbound-control dump_infra` from all local instances and
    groups by provider (Akamai, Cloudflare, Google, AWS, Fastly, TLDs, roots).
    Read-only. Updated by the infra_probe_worker (~60s cadence).
    """
    return infra_probe_service.get_cdn_snapshot()
