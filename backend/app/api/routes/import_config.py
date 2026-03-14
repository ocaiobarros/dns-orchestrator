"""
DNS Control — Import Running Config
Reads the current host state and returns a WizardConfig-compatible payload.
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.executors.command_runner import run_command
import json
import re
import platform

router = APIRouter()


@router.get("/import-host")
def import_host_config(_: User = Depends(get_current_user)):
    """
    Read the current host production state and return a wizard-compatible config.
    Sources: systemd units, unbound configs, ip addr, nft list ruleset, FRR config.
    """
    config = {}

    # Hostname / host topology
    config["hostname"] = platform.node() or ""

    # Discover unbound instances
    instances = _read_unbound_instances()
    config["instances"] = instances
    config["instanceCount"] = len(instances)

    # Network state
    config["network"] = _read_network_state()

    # nftables state
    config["nftables"] = _read_nftables_state()

    # FRR state
    config["frr"] = _read_frr_state()

    # Egress mode detection
    config["egressDeliveryMode"] = _detect_egress_mode(instances)

    return config


def _read_unbound_instances() -> list[dict]:
    """Parse all unbound instance configs."""
    # Find instance service units
    r = run_command("systemctl", ["list-units", "--type=service", "--no-pager", "--plain"], timeout=10)
    names = []
    if r["exit_code"] == 0:
        for line in r["stdout"].split("\n"):
            if "unbound" in line and ".service" in line:
                name = line.split()[0].replace(".service", "")
                if name != "unbound":
                    names.append(name)

    if not names:
        names = ["unbound01", "unbound02"]

    instances = []
    for name in names:
        conf = run_command("cat", [f"/etc/unbound/unbound.conf.d/{name}.conf"], timeout=5)
        if conf["exit_code"] != 0:
            continue

        inst = {
            "name": name,
            "bindIp": "",
            "bindIpv6": "",
            "controlInterface": "127.0.0.1",
            "controlPort": 8953,
            "egressIpv4": "",
            "egressIpv6": "",
            "interfaces": [],
            "accessControl": [],
        }

        for line in conf["stdout"].split("\n"):
            s = line.strip()
            if s.startswith("interface:") and not s.startswith("interface-automatic"):
                ip = s.split(":", 1)[1].strip()
                inst["interfaces"].append(ip)
                if not inst["bindIp"]:
                    inst["bindIp"] = ip
            elif s.startswith("control-interface:"):
                inst["controlInterface"] = s.split(":", 1)[1].strip()
            elif s.startswith("control-port:"):
                try:
                    inst["controlPort"] = int(s.split(":", 1)[1].strip())
                except ValueError:
                    pass
            elif s.startswith("outgoing-interface:"):
                ip = s.split(":", 1)[1].strip()
                if ip and not ip.startswith("#"):
                    inst["egressIpv4"] = ip
            elif s.startswith("access-control:"):
                parts = s.split(":", 1)[1].strip().split()
                if len(parts) >= 2:
                    inst["accessControl"].append({"network": parts[0], "action": parts[1]})

        instances.append(inst)

    return instances


def _read_network_state() -> dict:
    """Read interfaces, IPs, listeners."""
    result = {}

    # Interfaces
    r = run_command("ip", ["-j", "addr", "show"], timeout=10)
    try:
        ifaces = json.loads(r["stdout"])
        result["interfaces"] = []
        for iface in ifaces:
            ips = []
            for a in iface.get("addr_info", []):
                ips.append({"family": a.get("family"), "address": a.get("local"), "prefixlen": a.get("prefixlen")})
            result["interfaces"].append({
                "name": iface.get("ifname"),
                "state": iface.get("operstate"),
                "addresses": ips,
            })
    except (json.JSONDecodeError, KeyError):
        result["interfaces"] = []

    # Listeners on port 53
    r = run_command("ss", ["-tulnp"], timeout=5)
    listeners = []
    if r["exit_code"] == 0:
        for line in r["stdout"].split("\n"):
            if ":53 " in line or ":53\t" in line:
                parts = line.split()
                for part in parts:
                    if ":53" in part:
                        ip = part.rsplit(":", 1)[0]
                        if ip not in ("*", "0.0.0.0", "[::"):
                            listeners.append(ip)
    result["listeners"] = list(set(listeners))

    return result


def _read_nftables_state() -> dict:
    r = run_command("nft", ["list", "ruleset"], timeout=10, use_privilege=True)
    return {
        "loaded": r["exit_code"] == 0,
        "ruleset": r["stdout"][:10000] if r["exit_code"] == 0 else "",
    }


def _read_frr_state() -> dict:
    r = run_command("vtysh", ["-c", "show running-config"], timeout=10, use_privilege=True)
    return {
        "active": r["exit_code"] == 0,
        "config": r["stdout"][:10000] if r["exit_code"] == 0 else "",
    }


def _detect_egress_mode(instances: list[dict]) -> str:
    """Detect if egress IPs are local (host-owned) or border-routed."""
    r = run_command("ip", ["-j", "addr", "show"], timeout=5)
    local_ips = set()
    try:
        ifaces = json.loads(r["stdout"])
        for iface in ifaces:
            for a in iface.get("addr_info", []):
                local_ips.add(a.get("local", ""))
    except (json.JSONDecodeError, KeyError):
        pass

    for inst in instances:
        egress = inst.get("egressIpv4", "")
        if egress and egress not in local_ips:
            return "border-routed"

    return "host-owned"
