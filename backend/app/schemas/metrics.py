"""
DNS Control — Metrics Schemas
"""

from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class DnsMetricsResponse(BaseModel):
    timestamp: datetime
    queries_per_second: float
    cache_hit_ratio: float
    latency_avg_ms: float
    latency_p95_ms: float
    total_queries: int
    servfail_count: int
    nxdomain_count: int


class DnsInstanceResponse(BaseModel):
    name: str
    bind_ip: str
    port: int
    status: str
    queries_total: int
    cache_entries: int
    uptime: str


class DnsTopDomainResponse(BaseModel):
    domain: str
    query_count: int
    query_type: str


class NatCounterItem(BaseModel):
    name: str
    chain: str = ""
    packets: int = 0
    bytes: int = 0


class NatSummaryResponse(BaseModel):
    ruleset_loaded: bool
    counters: list[NatCounterItem] = []


class NatStickyResponse(BaseModel):
    client_ip: str
    backend_ip: str
    backend_port: int
    expires: str
    packets: int


class OspfNeighborResponse(BaseModel):
    neighbor_id: str
    address: str
    interface: str
    state: str
    dead_time: str
    area: str


class OspfRouteResponse(BaseModel):
    network: str
    next_hop: str
    interface: str
    cost: int
    area: str
    route_type: str


class DashboardSummary(BaseModel):
    total_queries: int
    cache_hit_ratio: float
    active_services: int
    total_services: int
    ospf_neighbors_up: int
    ospf_neighbors_total: int
    nat_active_connections: int
    uptime: str
    unbound_instances: int
    alerts: list[dict] = []
    # System info fields
    hostname: str = ""
    os: str = ""
    kernel: str = ""
    unbound_version: str = ""
    frr_version: str = ""
    nftables_version: str = ""
    primary_interface: str = ""
    vip_anycast: str = ""
    config_version: str = ""
    last_apply_at: Optional[str] = None
