"""
DNS Control — Diagnostics Service
System status, health checks, service management.
All collection is best-effort: no single failure crashes the endpoint.
Supports controlled privileged execution for diagnostic commands.

Multi-instance aware: detects unbound01, unbound02 individually.
nftables status based on loaded ruleset, not systemd service.
FRR/OSPF treated as optional.

Status taxonomy:
  ok                  → Command succeeded (INFO)
  inactive            → Service loaded but not active (INFO/WARNING)
  permission_limited  → Expected privilege limitation (WARNING, never ERROR)
  service_not_running → Specific daemon not started (WARNING)
  misconfigured       → Configuration issue detected (WARNING)
  dependency_error    → Binary/package not found (WARNING)
  timeout_error       → Command exceeded time limit (ERROR)
  runtime_error       → Unexpected runtime failure (ERROR)
  error               → Generic failure (ERROR)
"""

import json
import platform
import logging
from app.executors.command_runner import run_command, get_privilege_status

logger = logging.getLogger("dns-control.diagnostics")

# ── Privilege metadata per executable ──
_PRIVILEGED_COMMANDS = {
    "unbound-control": {
        "requires_root": True,
        "expected_in_unprivileged_mode": True,
        "remediation": "Ajustar permissão do socket ou usar execução controlada",
    },
    "nft": {
        "requires_root": True,
        "expected_in_unprivileged_mode": True,
        "remediation": "Executar diagnóstico via sudo restrito",
    },
    "vtysh": {
        "requires_root": True,
        "expected_in_unprivileged_mode": True,
        "remediation": "Ajustar grupo/permissão do backend ou usar wrapper privilegiado",
    },
    "journalctl": {
        "requires_root": False,
        "expected_in_unprivileged_mode": True,
        "remediation": "Adicionar usuário ao grupo systemd-journal ou usar wrapper controlado",
    },
}

_PERMISSION_PATTERNS = [
    "permission denied",
    "operation not permitted",
    "must be root",
    "insufficient permissions",
    "access denied",
]

_DEPENDENCY_PATTERNS = [
    "not found",
    "no such file",
    "command not found",
]

_FRR_NOT_RUNNING_PATTERNS = [
    "is not running",
    "not running",
    "failed to connect to any daemons",
    "instance not found",
    "is not configured",
    "no ospf process",
]

_TIMEOUT_PATTERNS = [
    "timeout",
    "timed out",
    "expirou",
]

_MISCONFIGURED_PATTERNS = [
    "syntax error",
    "parse error",
    "invalid configuration",
    "configuration error",
    "bad config",
    "could not load",
]


def _safe_read_file(path: str, default: str = "") -> str:
    try:
        with open(path, "r") as f:
            return f.read().strip()
    except (FileNotFoundError, PermissionError, OSError, IOError):
        return default


def _safe_run(executable: str, args: list[str], timeout: int = 5, use_privilege: bool = False) -> dict:
    try:
        return run_command(executable, args, timeout=timeout, use_privilege=use_privilege)
    except Exception as e:
        logger.debug(f"Command {executable} failed: {e}")
        return {"exit_code": -1, "stdout": "", "stderr": str(e), "duration_ms": 0}


def _classify_result(exit_code: int, stdout: str, stderr: str, executable: str) -> dict:
    combined_lower = ((stdout or "") + " " + (stderr or "")).lower()

    priv_meta = _PRIVILEGED_COMMANDS.get(executable, {})
    privileged = bool(priv_meta)
    requires_root = priv_meta.get("requires_root", False)
    expected_unpriv = priv_meta.get("expected_in_unprivileged_mode", False)
    default_remediation = priv_meta.get("remediation", "")

    base_fields = {
        "privileged": privileged,
        "requires_root": requires_root,
        "expected_in_unprivileged_mode": expected_unpriv,
    }

    if exit_code == 0:
        return {
            "status": "ok",
            "summary": "Comando executado com sucesso",
            "remediation": "",
            **base_fields,
        }

    if ("inactive (dead)" in combined_lower
        or ("active: inactive" in combined_lower and executable == "systemctl")
        or (exit_code == 3 and "inactive" in combined_lower)):
        return {
            "status": "inactive",
            "summary": "Serviço inativo",
            "remediation": "Validar se este serviço deve estar ativo neste host",
            "privileged": False,
            "requires_root": False,
            "expected_in_unprivileged_mode": False,
        }

    if executable == "vtysh":
        combined_has_permission = any(kw in combined_lower for kw in ("permission denied", "must be root"))
        combined_has_not_running = any(kw in combined_lower for kw in _FRR_NOT_RUNNING_PATTERNS)

        if combined_has_not_running and not combined_has_permission:
            daemon_name = ""
            for line in (stderr or "").split("\n"):
                line_lower = line.strip().lower()
                if "is not running" in line_lower or "not running" in line_lower:
                    daemon_name = line.strip().split(" ")[0] if line.strip() else ""
                    break
            return {
                "status": "service_not_running",
                "summary": f"Daemon {daemon_name} não está em execução" if daemon_name else "Daemon FRR necessário não está ativo",
                "remediation": "FRR/OSPF é opcional conforme a topologia. Verificar se deve estar habilitado neste host.",
                **base_fields,
                "expected_in_unprivileged_mode": False,
            }

    is_permission = any(kw in combined_lower for kw in _PERMISSION_PATTERNS)
    if not is_permission and ("no journal files were opened" in combined_lower
        or ("users in groups" in combined_lower and "can see all messages" in combined_lower)):
        is_permission = True
    if is_permission and executable == "vtysh" and "failed to connect to any daemons" in combined_lower:
        if not any(kw in combined_lower for kw in ("permission denied", "must be root")):
            is_permission = False

    if is_permission:
        summary = "Sem permissão para executar este comando"
        remediation = default_remediation or "Verificar permissões do usuário de serviço"

        if "unbound" in executable:
            summary = "Sem acesso ao socket do unbound-control"
            remediation = "Ajustar permissão do socket ou usar execução controlada"
        elif executable == "nft":
            summary = "Leitura de nftables requer privilégio administrativo"
            remediation = "Executar diagnóstico via sudo restrito"
        elif executable == "vtysh":
            summary = "Acesso ao FRR exige permissão adicional"
            remediation = "Ajustar grupo/permissão do backend ou usar wrapper privilegiado"
        elif executable == "journalctl":
            summary = "Usuário do backend sem acesso ao journal"
            remediation = "Adicionar o usuário ao grupo systemd-journal ou usar wrapper controlado"

        return {
            "status": "permission_limited",
            "summary": summary,
            "remediation": remediation,
            "privileged": True,
            "requires_root": requires_root or (executable in ("nft", "vtysh")),
            "expected_in_unprivileged_mode": True,
        }

    if any(kw in combined_lower for kw in _MISCONFIGURED_PATTERNS):
        first_stderr = (stderr or "").strip().split("\n")[0][:120] if stderr else ""
        return {
            "status": "misconfigured",
            "summary": first_stderr if first_stderr else "Problema de configuração detectado",
            "remediation": "Verificar a configuração do serviço e corrigir a sintaxe",
            **base_fields,
        }

    stderr_lower = (stderr or "").lower()
    if any(kw in stderr_lower for kw in _DEPENDENCY_PATTERNS):
        return {
            "status": "dependency_error",
            "summary": "Comando ou dependência não encontrada",
            "remediation": f"Verificar se {executable} está instalado e no PATH",
            **base_fields,
        }

    if any(kw in combined_lower for kw in _TIMEOUT_PATTERNS):
        return {
            "status": "timeout_error",
            "summary": "Comando excedeu tempo limite",
            "remediation": "Verificar se o serviço está responsivo",
            **base_fields,
        }

    first_stderr = (stderr or "").strip().split("\n")[0][:120] if stderr else ""
    summary = first_stderr if first_stderr else "Comando retornou erro"

    return {
        "status": "error",
        "summary": summary,
        "remediation": "Verificar logs do serviço para mais detalhes",
        **base_fields,
    }


# ── Dashboard ──

def get_dashboard_summary() -> dict:
    try:
        services = get_services_status()
    except Exception:
        services = []

    active = sum(1 for s in services if s.get("active"))

    try:
        sys_info = _get_system_info()
    except Exception as e:
        logger.exception(f"_get_system_info failed: {e}")
        sys_info = {
            "hostname": "", "os": "", "kernel": "",
            "unbound_version": "", "frr_version": "", "nftables_version": "",
            "primary_interface": "", "vip_anycast": "",
            "config_version": "", "last_apply_at": None,
        }

    # Collect per-instance DNS metrics
    dns_metrics = _collect_dns_metrics_multi()

    # nftables state from ruleset, not service
    nft_state = _get_nftables_state()

    return {
        "total_queries": dns_metrics.get("total_queries", 0),
        "cache_hit_ratio": dns_metrics.get("cache_hit_ratio", 0.0),
        "latency_ms": dns_metrics.get("latency_ms", 0.0),
        "dns_metrics_available": dns_metrics.get("available", False),
        "dns_metrics_status": dns_metrics.get("status", "unknown"),
        "per_instance": dns_metrics.get("per_instance", []),
        "active_services": active,
        "total_services": len(services),
        "nftables_active": nft_state.get("active", False),
        "nftables_tables": nft_state.get("tables", []),
        "nftables_status": nft_state.get("status", "unknown"),
        "ospf_neighbors_up": 0,
        "ospf_neighbors_total": 0,
        "nat_active_connections": 0,
        "uptime": _get_uptime(),
        "unbound_instances": sum(1 for s in services if "unbound" in s.get("name", "") and s.get("active")),
        "alerts": [],
        "hostname": sys_info.get("hostname", ""),
        "os": sys_info.get("os", ""),
        "kernel": sys_info.get("kernel", ""),
        "unbound_version": sys_info.get("unbound_version", ""),
        "frr_version": sys_info.get("frr_version", ""),
        "nftables_version": sys_info.get("nftables_version", ""),
        "primary_interface": sys_info.get("primary_interface", ""),
        "vip_anycast": sys_info.get("vip_anycast", ""),
        "vip_anycast_available": sys_info.get("vip_anycast_available", False),
        "vip_anycast_status": sys_info.get("vip_anycast_status", "unknown"),
        "config_version": sys_info.get("config_version", ""),
        "config_version_available": sys_info.get("config_version_available", False),
        "config_version_status": sys_info.get("config_version_status", "unknown"),
        "last_apply_at": sys_info.get("last_apply_at") or "",
        "last_apply_available": sys_info.get("last_apply_available", False),
        "last_apply_status": sys_info.get("last_apply_status", "unknown"),
    }


def _get_nftables_state() -> dict:
    """Check nftables state via ruleset, not service status.
    Falls back to systemctl is-active if nft list tables fails (permission).
    """
    r = _safe_run("nft", ["list", "tables"], timeout=5, use_privilege=True)
    if r["exit_code"] == 0:
        tables = [l.strip() for l in r["stdout"].split("\n") if l.strip()]
        return {"active": len(tables) > 0, "tables": tables, "status": "active" if tables else "empty"}

    # Fallback: check systemctl is-active (works for oneshot+RemainAfterExit=yes)
    r2 = _safe_run("systemctl", ["is-active", "nftables"], timeout=5, use_privilege=True)
    if r2["exit_code"] == 0 and r2["stdout"].strip() == "active":
        return {"active": True, "tables": [], "status": "active"}

    logger.warning("nftables state: nft list tables exit=%s stderr=%s; systemctl is-active exit=%s stdout=%s",
                   r["exit_code"], r.get("stderr", "")[:200],
                   r2["exit_code"], r2["stdout"].strip())
    return {"active": False, "tables": [], "status": "unavailable"}


def _get_system_info() -> dict:
    hostname = ""
    kernel = ""
    os_name = ""
    unbound_version = ""
    frr_version = ""
    nftables_version = ""
    primary_interface = ""
    vip_anycast = ""
    config_version = ""
    last_apply_at = None

    try:
        hostname = platform.node() or ""
        kernel = platform.release() or ""
    except Exception:
        pass

    try:
        content = _safe_read_file("/etc/os-release")
        for line in content.split("\n"):
            if line.startswith("PRETTY_NAME="):
                os_name = line.split("=", 1)[1].strip().strip('"')
                break
    except Exception:
        pass

    try:
        r = _safe_run("dpkg", ["-s", "unbound"], timeout=5)
        if r["exit_code"] == 0:
            for line in r["stdout"].split("\n"):
                if line.startswith("Version:"):
                    unbound_version = "Unbound " + line.split(":", 1)[1].strip()
                    break
        if not unbound_version:
            # Try per-instance unbound-control status
            r2 = _safe_run("unbound-control", ["-s", "127.0.0.11@8953", "-c", "/etc/unbound/unbound01.conf", "status"], timeout=5, use_privilege=True)
            if r2["exit_code"] == 0:
                for line in r2["stdout"].split("\n"):
                    if "version" in line.lower():
                        unbound_version = line.strip()
                        break
    except Exception:
        pass

    try:
        r = _safe_run("vtysh", ["-c", "show version"], timeout=5, use_privilege=True)
        if r["exit_code"] == 0:
            for line in r["stdout"].split("\n"):
                if "FRRouting" in line or "frr" in line.lower():
                    frr_version = line.strip()
                    break
    except Exception:
        pass

    try:
        r = _safe_run("nft", ["--version"], timeout=5)
        if r["exit_code"] == 0:
            nftables_version = r["stdout"].strip().split("\n")[0]
    except Exception:
        pass

    try:
        r = _safe_run("ip", ["route", "show", "default"], timeout=5)
        if r["exit_code"] == 0 and "dev" in r["stdout"]:
            parts = r["stdout"].split()
            idx = parts.index("dev")
            primary_interface = parts[idx + 1]
    except Exception:
        pass

    vip_anycast_available = False
    try:
        r = _safe_run("ip", ["-j", "addr", "show"], timeout=5)
        if r["exit_code"] == 0 and r["stdout"].strip():
            all_ifaces = json.loads(r["stdout"])
            vip_candidates = []
            for iface in all_ifaces:
                ifname = iface.get("ifname", "")
                if ifname in ("lo", "lo0") or ifname.startswith("dummy") or ifname.startswith("lo"):
                    for addr in iface.get("addr_info", []):
                        if addr.get("family") == "inet" and addr.get("local") != "127.0.0.1":
                            vip_candidates.append(addr["local"])
            if vip_candidates:
                vip_anycast = ", ".join(vip_candidates)
                vip_anycast_available = True
    except Exception:
        pass

    for path in ["/etc/dns-control/version", "/opt/dns-control/VERSION", "/opt/dns-control/package.json"]:
        try:
            content = _safe_read_file(path)
            if not content:
                continue
            if path.endswith("package.json"):
                config_version = json.loads(content).get("version", "")
            else:
                config_version = content
            if config_version:
                break
        except (FileNotFoundError, PermissionError, OSError, json.JSONDecodeError):
            continue

    try:
        from app.core.database import get_db
        db = next(get_db())
        row = db.execute(
            "SELECT timestamp FROM apply_history ORDER BY timestamp DESC LIMIT 1"
        ).fetchone()
        if row:
            last_apply_at = row[0]
    except Exception:
        pass

    config_version_available = bool(config_version and config_version != "0.0.0")
    last_apply_available = last_apply_at is not None

    return {
        "hostname": hostname,
        "os": os_name,
        "kernel": kernel,
        "unbound_version": unbound_version,
        "frr_version": frr_version,
        "nftables_version": nftables_version,
        "primary_interface": primary_interface,
        "vip_anycast": vip_anycast if vip_anycast else "",
        "vip_anycast_available": vip_anycast_available,
        "vip_anycast_status": "configured" if vip_anycast_available else "not_configured",
        "config_version": config_version if config_version_available else "",
        "config_version_available": config_version_available,
        "config_version_status": "available" if config_version_available else "not_configured",
        "last_apply_at": last_apply_at,
        "last_apply_available": last_apply_available,
        "last_apply_status": "available" if last_apply_available else "no_history",
    }


# ── Services ──

def get_services_status() -> list[dict]:
    """
    Detect real running services:
    - unbound01, unbound02 as separate entities
    - nginx (reverse proxy)
    - frr (optional)
    - nftables state from ruleset, not service
    - networking / ifupdown2
    """
    # Discover unbound instances dynamically
    unbound_instances = _discover_unbound_services()
    service_names = unbound_instances + ["nginx", "frr", "networking"]

    results = []
    for name in service_names:
        try:
            result = _safe_run("systemctl", ["status", name], timeout=5, use_privilege=True)
            stdout = result["stdout"]
            active = "Active: active" in stdout
            pid = None
            uptime = ""
            memory = ""
            cpu = ""

            for line in stdout.split("\n"):
                line_s = line.strip()
                if "Main PID:" in line_s:
                    try:
                        pid = int(line_s.split("Main PID:")[1].strip().split()[0])
                    except (ValueError, IndexError):
                        pass
                # Parse memory — handle both "Memory: 28.5M" and "Memory: 28.5M (peak: 30.0M)"
                if line_s.startswith("Memory:") or "Memory:" in line_s:
                    try:
                        mem_part = line_s.split("Memory:")[1].strip()
                        # Take first token (e.g. "28.5M" from "28.5M (peak: 30.0M)")
                        memory = mem_part.split()[0] if mem_part else ""
                    except (IndexError, ValueError):
                        pass
                # Parse CPU — handle "CPU: 1.234s" or "CPU: 1min 2.345s"
                if line_s.startswith("CPU:") or "CPU:" in line_s:
                    try:
                        cpu_part = line_s.split("CPU:")[1].strip()
                        cpu = cpu_part.split()[0] if cpu_part else ""
                    except (IndexError, ValueError):
                        pass
                if "Active: active" in line_s and "since" in line_s:
                    parts = line_s.split(";")
                    if len(parts) > 1:
                        uptime = parts[-1].strip()
        except Exception:
            active = False
            pid = None
            uptime = ""
            memory = ""
            cpu = ""

        # Check enabled state via is-enabled
        enabled = False
        try:
            en_result = _safe_run("systemctl", ["is-enabled", name], timeout=3)
            enabled = en_result["stdout"].strip() in ("enabled", "static", "alias")
        except Exception:
            pass

        # Determine display name
        display = name
        if name == "nginx":
            display = "nginx (reverse proxy)"
        elif name == "networking":
            display = "networking (ifupdown2)"

        results.append({
            "name": name,
            "display_name": display,
            "active": active,
            "status": "running" if active else "stopped",
            "enabled": enabled,
            "pid": pid,
            "uptime": uptime,
            "memory": memory,
            "cpu": cpu,
        })

    # Add nftables as special entry based on ruleset
    nft_state = _get_nftables_state()
    # Also check is-enabled for nftables
    nft_enabled = False
    try:
        en_r = _safe_run("systemctl", ["is-enabled", "nftables"], timeout=3)
        nft_enabled = en_r["stdout"].strip() in ("enabled", "static", "alias")
    except Exception:
        pass

    results.append({
        "name": "nftables",
        "display_name": "nftables (firewall)",
        "active": nft_state["active"],
        "status": "active" if nft_state["active"] else "no ruleset",
        "enabled": nft_enabled,
        "pid": None,
        "uptime": "",
        "memory": "",
        "cpu": "",
        "tables": nft_state.get("tables", []),
        "nftables_status": nft_state["status"],
    })

    return results


def _discover_unbound_services() -> list[str]:
    """Discover unbound instance service names from systemd (including inactive/loaded)."""
    result = _safe_run("systemctl", ["list-units", "--type=service", "--all", "--no-pager", "--plain"], timeout=5)
    instances = []
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            if "unbound" in line and ".service" in line:
                name = line.split()[0].replace(".service", "")
                if name != "unbound":  # Skip default service
                    instances.append(name)
    return instances if instances else ["unbound01", "unbound02"]


def get_service_detail(name: str) -> dict:
    result = _safe_run("systemctl", ["status", name], timeout=10, use_privilege=True)
    return {"name": name, "status_output": result["stdout"], "active": result["exit_code"] == 0}


def restart_service(name: str) -> dict:
    allowed = ["frr", "nftables"]
    if name not in allowed and not name.startswith("unbound"):
        return {"success": False, "error": "Serviço não permitido"}
    result = _safe_run("systemctl", ["restart", name], timeout=30)
    return {"success": result["exit_code"] == 0, "output": result["stdout"], "stderr": result["stderr"]}


# ── Network ──

def get_network_interfaces() -> list[dict]:
    """Return all interfaces with ALL their IPs (multiple per interface)."""
    result = _safe_run("ip", ["-j", "addr", "show"], timeout=10)
    try:
        interfaces = json.loads(result["stdout"])
        parsed = []
        for iface in interfaces:
            ipv4_list = []
            ipv6_list = []
            for a in iface.get("addr_info", []):
                addr_str = a.get("local", "") + "/" + str(a.get("prefixlen", ""))
                if a.get("family") == "inet":
                    ipv4_list.append(addr_str)
                elif a.get("family") == "inet6":
                    ipv6_list.append(addr_str)

            parsed.append({
                "name": iface.get("ifname", ""),
                "status": iface.get("operstate", "UNKNOWN"),
                "state": iface.get("operstate", "UNKNOWN"),
                "type": _classify_interface_type(iface.get("ifname", ""), iface.get("link_type", "")),
                "ipv4": ipv4_list[0] if ipv4_list else "",
                "ipv4Addresses": ipv4_list,
                "ipv6": ipv6_list[0] if ipv6_list else "",
                "ipv6Addresses": ipv6_list,
                "mac": iface.get("address", ""),
                "mtu": iface.get("mtu", 1500),
                "flags": iface.get("flags", []),
            })
        return parsed
    except (json.JSONDecodeError, KeyError, StopIteration):
        return []


def _classify_interface_type(name: str, link_type: str) -> str:
    if name == "lo":
        return "loopback"
    if name.startswith("dummy"):
        return "dummy"
    if "." in name or name.startswith("vlan"):
        return "vlan"
    if name.startswith("br") or name.startswith("bridge"):
        return "bridge"
    return "physical"


def get_routes() -> list[dict]:
    result = _safe_run("ip", ["-j", "route", "show"], timeout=10)
    try:
        routes = json.loads(result["stdout"])
        return [
            {
                "destination": r.get("dst", "default"),
                "gateway": r.get("gateway", ""),
                "via": r.get("gateway", ""),
                "interface": r.get("dev", ""),
                "device": r.get("dev", ""),
                "protocol": r.get("protocol", ""),
                "metric": r.get("metric", 0),
                "scope": r.get("scope", ""),
            }
            for r in routes
        ]
    except (json.JSONDecodeError, KeyError):
        return []


def get_dns_listeners() -> list[dict]:
    """Detect which IPs are listening on port 53 and test DNS resolution."""
    listeners = []

    # Get listening sockets
    r = _safe_run("ss", ["-tulnp"], timeout=5)
    if r["exit_code"] != 0:
        return listeners

    port53_ips = set()
    for line in r["stdout"].split("\n"):
        if ":53 " in line or ":53\t" in line:
            # Extract IP from the local address column
            parts = line.split()
            for part in parts:
                if ":53" in part:
                    ip = part.rsplit(":", 1)[0]
                    if ip.startswith("["):
                        ip = ip[1:-1]
                    if ip == "*" or ip == "0.0.0.0":
                        continue
                    port53_ips.add(ip)

    # Test each listener
    for ip in sorted(port53_ips):
        dig_result = _safe_run("dig", [f"@{ip}", "google.com", "+short", "+time=2", "+tries=1"], timeout=5)
        healthy = dig_result["exit_code"] == 0 and len(dig_result["stdout"].strip()) > 0
        listeners.append({
            "ip": ip,
            "port": 53,
            "listening": True,
            "resolving": healthy,
            "resolved_ip": dig_result["stdout"].strip().split("\n")[0] if healthy else "",
            "error": dig_result["stderr"].strip()[:100] if not healthy else None,
        })

    return listeners


def check_reachability() -> list[dict]:
    """Check reachability of key targets including DNS listeners."""
    targets = [
        {"target": "8.8.8.8", "label": "Google DNS"},
        {"target": "1.1.1.1", "label": "Cloudflare DNS"},
        {"target": "127.0.0.1", "label": "Localhost"},
        {"target": "100.127.255.101", "label": "Listener unbound01"},
        {"target": "100.127.255.102", "label": "Listener unbound02"},
        {"target": "191.243.128.205", "label": "Egress IP 205"},
        {"target": "191.243.128.206", "label": "Egress IP 206"},
    ]
    results = []
    for t in targets:
        r = _safe_run("ping", ["-c", "1", "-W", "2", t["target"]], timeout=5)
        latency_ms = None
        if r["exit_code"] == 0:
            import re
            m = re.search(r'time=(\d+\.?\d*)', r["stdout"])
            if m:
                latency_ms = round(float(m.group(1)), 1)
        results.append({
            "target": t["target"],
            "label": t["label"],
            "reachable": r["exit_code"] == 0,
            "latencyMs": latency_ms,
            "output": r["stdout"][:200],
        })
    return results


# ── Health Check (batch) ──

def run_health_check() -> dict:
    from datetime import datetime, timezone
    from app.executors.command_catalog import COMMAND_CATALOG

    started_at = datetime.now(timezone.utc).isoformat()
    results = []
    priv_status = get_privilege_status()

    for cmd_def in COMMAND_CATALOG.values():
        try:
            use_priv = cmd_def.requires_privilege
            r = _safe_run(
                cmd_def.executable,
                list(cmd_def.base_args),
                timeout=min(cmd_def.timeout, 15),
                use_privilege=use_priv,
            )
            exit_code = r.get("exit_code", -1)
            stdout = r.get("stdout", "")
            stderr = r.get("stderr", "")
            duration_ms = r.get("duration_ms", 0)
            success = exit_code == 0
            executed_privileged = r.get("executed_privileged", False)

            classification = _classify_result(exit_code, stdout, stderr, cmd_def.executable)

            results.append({
                "commandId": cmd_def.id,
                "command_id": cmd_def.id,
                "label": cmd_def.name,
                "category": cmd_def.category,
                "exitCode": exit_code,
                "exit_code": exit_code,
                "stdout": stdout[:5000],
                "stderr": stderr[:2000],
                "durationMs": duration_ms,
                "duration_ms": duration_ms,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "success": success,
                "status": classification["status"],
                "summary": classification["summary"],
                "remediation": classification["remediation"],
                "privileged": classification["privileged"],
                "requires_root": classification["requires_root"],
                "expected_in_unprivileged_mode": classification["expected_in_unprivileged_mode"],
                "executed_privileged": executed_privileged,
                "requires_privilege": cmd_def.requires_privilege,
                "event_type": "diagnostic",
                "severity": _status_to_event_severity(classification["status"]),
                "expected": classification["expected_in_unprivileged_mode"],
                "remediation_hint": cmd_def.remediation_hint or classification["remediation"],
            })
        except Exception as e:
            logger.exception(f"Health check failed for {cmd_def.id}: {e}")
            results.append({
                "commandId": cmd_def.id,
                "command_id": cmd_def.id,
                "label": cmd_def.name,
                "category": cmd_def.category,
                "exitCode": -1,
                "exit_code": -1,
                "stdout": "",
                "stderr": str(e)[:500],
                "durationMs": 0,
                "duration_ms": 0,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "success": False,
                "status": "runtime_error",
                "summary": f"Exceção interna: {str(e)[:100]}",
                "remediation": "Verificar logs do backend para stack trace completo",
                "privileged": False,
                "requires_root": False,
                "expected_in_unprivileged_mode": False,
                "executed_privileged": False,
                "requires_privilege": cmd_def.requires_privilege,
                "event_type": "diagnostic",
                "severity": "critical",
                "expected": False,
                "remediation_hint": "Verificar logs do backend",
            })

    finished_at = datetime.now(timezone.utc).isoformat()
    passed = sum(1 for r in results if r["status"] == "ok")
    failed = sum(1 for r in results if r["status"] in ("error", "runtime_error", "timeout_error"))
    permission_limited = sum(1 for r in results if r["status"] == "permission_limited")
    inactive = sum(1 for r in results if r["status"] == "inactive")
    service_not_running = sum(1 for r in results if r["status"] == "service_not_running")
    misconfigured = sum(1 for r in results if r["status"] == "misconfigured")
    dependency_error = sum(1 for r in results if r["status"] == "dependency_error")

    return {
        "success": True,
        "started_at": started_at,
        "finished_at": finished_at,
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "permission_limited": permission_limited,
        "inactive": inactive,
        "service_not_running": service_not_running,
        "misconfigured": misconfigured,
        "dependency_error": dependency_error,
        "privilege_status": priv_status,
        "results": results,
    }


def _status_to_event_severity(status: str) -> str:
    if status == "ok":
        return "info"
    if status in ("permission_limited", "inactive", "service_not_running", "misconfigured", "dependency_error"):
        return "warning"
    return "critical"


def _get_uptime() -> str:
    try:
        result = _safe_run("uptime", ["-p"], timeout=5)
        return result["stdout"].strip() if result["exit_code"] == 0 else "unknown"
    except Exception:
        return "unknown"


def _collect_dns_metrics_multi() -> dict:
    """Collect real DNS metrics from all Unbound instances via per-instance unbound-control."""
    from app.services.unbound_stats_service import get_instance_real_stats

    try:
        stats = get_instance_real_stats()

        live_stats = [s for s in stats if s.get("source") == "live"]
        if not live_stats:
            return {"available": False, "status": "error", "total_queries": 0, "cache_hit_ratio": 0.0, "latency_ms": 0.0, "per_instance": stats}

        total_queries = sum(s["totalQueries"] for s in live_stats)
        total_hits = sum(s["cacheHits"] for s in live_stats)
        total_misses = sum(s["cacheMisses"] for s in live_stats)
        cache_hit_ratio = (total_hits / (total_hits + total_misses) * 100) if (total_hits + total_misses) > 0 else 0.0
        avg_latency = sum(s["avgLatencyMs"] for s in live_stats) / len(live_stats) if live_stats else 0.0

        return {
            "available": True,
            "status": "ok",
            "total_queries": total_queries,
            "cache_hit_ratio": round(cache_hit_ratio, 1),
            "latency_ms": round(avg_latency, 2),
            "per_instance": stats,
        }
    except Exception as e:
        logger.debug(f"DNS metrics collection failed: {e}")
        return {"available": False, "status": "error", "total_queries": 0, "cache_hit_ratio": 0.0, "latency_ms": 0.0, "per_instance": []}
