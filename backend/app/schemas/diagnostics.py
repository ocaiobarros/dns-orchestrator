"""
DNS Control — Diagnostics Schemas
"""

from pydantic import BaseModel
from datetime import datetime


class CommandDefinition(BaseModel):
    id: str
    name: str
    description: str
    category: str
    dangerous: bool = False


class CommandResult(BaseModel):
    command_id: str
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timestamp: datetime


class RunCommandRequest(BaseModel):
    command_id: str
    args: dict[str, str] = {}


class ServiceStatusResponse(BaseModel):
    name: str
    display_name: str
    active: bool
    enabled: bool
    pid: int | None = None
    uptime: str = ""
    memory: str = ""
    cpu: str = ""


class NetworkInterfaceResponse(BaseModel):
    name: str
    status: str
    ipv4: str
    ipv6: str = ""
    mac: str = ""
    mtu: int = 1500
    rx_bytes: int = 0
    tx_bytes: int = 0


class RouteResponse(BaseModel):
    destination: str
    gateway: str
    interface: str
    protocol: str
    metric: int = 0


class HealthCheckResult(BaseModel):
    check: str
    status: str
    message: str
    duration_ms: int
