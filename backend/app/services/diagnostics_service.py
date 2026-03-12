"""
DNS Control — Diagnostics Service
System status, health checks, service management.
All collection is best-effort: no single failure crashes the endpoint.
Supports controlled privileged execution for diagnostic commands.
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
    "failed to connect to any daemons",
    "access denied",
]

_DEPENDENCY_PATTERNS = [
    "not found",
    "no such file",
    "command not found",
]

_TIMEOUT_PATTERNS = [
    "timeout",
    "timed out",
    "expirou",
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

    if exit_code == 0:
        return {
            "status": "ok",
            "summary": "Comando executado com sucesso",
            "remediation": "",
            "privileged": privileged,
            "requires_root": requires_root,
            "expected_in_unprivileged_mode": expected_unpriv,
        }

    # Inactive service
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

    # Permission error
    is_permission = any(kw in combined_lower for kw in _PERMISSION_PATTERNS)
    if not is_permission and ("no journal files were opened" in combined_lower
        or ("users in groups" in combined_lower and "can see all messages" in combined_lower)):
        is_permission = True

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
            "status": "permission_error",
            "summary": summary,
            "remediation": remediation,
            "privileged": True,
            "requires_root": requires_root or (executable in ("nft", "vtysh")),
            "expected_in_unprivileged_mode": True,
        }

    # Dependency error
    stderr_lower = (stderr or "").lower()
    if any(kw in stderr_lower for kw in _DEPENDENCY_PATTERNS):
        return {
            "status": "dependency_error",
            "summary": "Comando ou dependência não encontrada",
            "remediation": f"Verificar se {executable} está instalado e no PATH",
            "privileged": privileged,
            "requires_root": requires_root,
            "expected_in_unprivileged_mode": expected_unpriv,
        }

    # Timeout
    if any(kw in combined_lower for kw in _TIMEOUT_PATTERNS):
        return {
            "status": "timeout_error",
            "summary": "Comando excedeu tempo limite",
            "remediation": "Verificar se o serviço está responsivo",
            "privileged": privileged,
            "requires_root": requires_root,
            "expected_in_unprivileged_mode": expected_unpriv,
        }

    # Generic error
    first_stderr = (stderr or "").strip().split("\n")[0][:120] if stderr else ""
    summary = first_stderr if first_stderr else "Comando retornou erro"

    return {
        "status": "error",
        "summary": summary,
        "remediation": "Verificar logs do serviço para mais detalhes",
        "privileged": privileged,
        "requires_root": requires_root,
        "expected_in_unprivileged_mode": expected_unpriv,
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

    # Collect real DNS metrics via privileged unbound-control
    dns_metrics = _collect_dns_metrics()

    return {
        "total_queries": dns_metrics.get("total_queries", 0),
        "cache_hit_ratio": dns_metrics.get("cache_hit_ratio", 0.0),
        "latency_ms": dns_metrics.get("latency_ms", 0.0),
        "dns_metrics_available": dns_metrics.get("available", False),
        "dns_metrics_status": dns_metrics.get("status", "unknown"),
        "active_services": active,
        "total_services": len(services),
        "ospf_neighbors_up": 0,
        "ospf_neighbors_total": 0,
        "nat_active_connections": 0,
        "uptime": _get_uptime(),
        "unbound_instances": sum(1 for s in services if "unbound" in s.get("name", "")),
        "alerts": [],
        "hostname": sys_info.get("hostname", ""),
        "os": sys_info.get("os", ""),
        "kernel": sys_info.get("kernel", ""),
        "unbound_version": sys_info.get("unbound_version", ""),
        "frr_version": sys_info.get("frr_version", ""),
        "nftables_version": sys_info.get("nftables_version", ""),
        "primary_interface": sys_info.get("primary_interface", ""),
        "vip_anycast": sys_info.get("vip_anycast", "not configured"),
        "config_version": sys_info.get("config_version", ""),
        "last_apply_at": sys_info.get("last_apply_at") or "",
    }


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
        r = _safe_run("unbound", ["-V"], timeout=5)
        if r["exit_code"] == 0:
            unbound_version = r["stdout"].split("\n")[0].strip()
        else:
            r2 = _safe_run("unbound-control", ["status"], timeout=5, use_privilege=True)
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

    try:
        r = _safe_run("ip", ["-j", "addr", "show", "lo"], timeout=5)
        if r["exit_code"] == 0 and r["stdout"].strip():
            lo_data = json.loads(r["stdout"])
            for iface in lo_data:
                for addr in iface.get("addr_info", []):
                    if addr.get("family") == "inet" and addr.get("local") != "127.0.0.1":
                        vip_anycast = addr["local"]
                        break
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

    return {
        "hostname": hostname,
        "os": os_name,
        "kernel": kernel,
        "unbound_version": unbound_version,
        "frr_version": frr_version,
        "nftables_version": nftables_version,
        "primary_interface": primary_interface,
        "vip_anycast": vip_anycast,
        "config_version": config_version,
        "last_apply_at": last_apply_at,
    }


# ── Services ──

def get_services_status() -> list[dict]:
    service_names = ["unbound", "frr", "nftables", "systemd-resolved"]
    results = []
    for name in service_names:
        try:
            result = _safe_run("systemctl", ["is-active", name], timeout=5)
            active = result["stdout"].strip() == "active"
        except Exception:
            active = False
        results.append({
            "name": name,
            "display_name": name.capitalize(),
            "active": active,
            "status": "running" if active else "stopped",
            "enabled": True,
            "pid": None, "uptime": "", "memory": "", "cpu": "",
        })
    return results


def get_service_detail(name: str) -> dict:
    result = _safe_run("systemctl", ["status", name], timeout=10)
    return {"name": name, "status_output": result["stdout"], "active": result["exit_code"] == 0}


def restart_service(name: str) -> dict:
    allowed = ["unbound", "frr", "nftables"]
    if name not in allowed and not name.startswith("unbound"):
        return {"success": False, "error": "Serviço não permitido"}
    result = _safe_run("systemctl", ["restart", name], timeout=30)
    return {"success": result["exit_code"] == 0, "output": result["stdout"], "stderr": result["stderr"]}


# ── Network ──

def get_network_interfaces() -> list[dict]:
    result = _safe_run("ip", ["-j", "addr", "show"], timeout=10)
    try:
        interfaces = json.loads(result["stdout"])
        return [
            {
                "name": iface.get("ifname", ""),
                "status": iface.get("operstate", "UNKNOWN"),
                "ipv4": next((a["local"] + "/" + str(a["prefixlen"]) for a in iface.get("addr_info", []) if a["family"] == "inet"), ""),
                "ipv6": next((a["local"] for a in iface.get("addr_info", []) if a["family"] == "inet6" and not a["local"].startswith("fe80")), ""),
                "mac": iface.get("address", ""),
                "mtu": iface.get("mtu", 1500),
            }
            for iface in interfaces
        ]
    except (json.JSONDecodeError, KeyError, StopIteration):
        return []


def get_routes() -> list[dict]:
    result = _safe_run("ip", ["-j", "route", "show"], timeout=10)
    try:
        routes = json.loads(result["stdout"])
        return [
            {
                "destination": r.get("dst", "default"),
                "gateway": r.get("gateway", ""),
                "interface": r.get("dev", ""),
                "protocol": r.get("protocol", ""),
                "metric": r.get("metric", 0),
            }
            for r in routes
        ]
    except (json.JSONDecodeError, KeyError):
        return []


def check_reachability() -> list[dict]:
    targets = ["8.8.8.8", "1.1.1.1", "127.0.0.1"]
    results = []
    for target in targets:
        r = _safe_run("ping", ["-c", "1", "-W", "2", target], timeout=5)
        results.append({
            "target": target,
            "reachable": r["exit_code"] == 0,
            "latency_ms": 0,
            "output": r["stdout"][:200],
        })
    return results


# ── Health Check (batch) ──

def run_health_check() -> dict:
    """
    Run ALL catalog commands best-effort.
    Privileged commands use sudo when available.
    Returns consolidated summary + per-item results + privilege environment info.
    """
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
            })

    finished_at = datetime.now(timezone.utc).isoformat()
    passed = sum(1 for r in results if r["status"] == "ok")
    failed = sum(1 for r in results if r["status"] in ("error", "runtime_error", "timeout_error", "dependency_error"))
    permission_limited = sum(1 for r in results if r["status"] == "permission_error")
    inactive = sum(1 for r in results if r["status"] == "inactive")

    return {
        "success": True,
        "started_at": started_at,
        "finished_at": finished_at,
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "permission_limited": permission_limited,
        "inactive": inactive,
        "privilege_status": priv_status,
        "results": results,
    }


def _get_uptime() -> str:
    try:
        result = _safe_run("uptime", ["-p"], timeout=5)
        return result["stdout"].strip() if result["exit_code"] == 0 else "unknown"
    except Exception:
        return "unknown"


def _collect_dns_metrics() -> dict:
    """Collect real DNS metrics from unbound-control stats_noreset via privileged execution."""
    try:
        r = _safe_run("unbound-control", ["stats_noreset"], timeout=10, use_privilege=True)
        if r["exit_code"] != 0:
            # Determine if it's a permission issue
            combined = ((r.get("stdout", "") or "") + " " + (r.get("stderr", "") or "")).lower()
            if any(kw in combined for kw in _PERMISSION_PATTERNS):
                return {"available": False, "status": "privilege_limited", "total_queries": 0, "cache_hit_ratio": 0.0, "latency_ms": 0.0}
            return {"available": False, "status": "error", "total_queries": 0, "cache_hit_ratio": 0.0, "latency_ms": 0.0}

        stats = {}
        for line in r["stdout"].split("\n"):
            if "=" in line:
                key, val = line.split("=", 1)
                try:
                    stats[key.strip()] = float(val.strip())
                except ValueError:
                    stats[key.strip()] = val.strip()

        total_queries = int(stats.get("total.num.queries", 0))
        cache_hits = float(stats.get("total.num.cachehits", 0))
        cache_hit_ratio = (cache_hits / total_queries * 100) if total_queries > 0 else 0.0
        latency_ms = float(stats.get("total.recursion.time.avg", 0)) * 1000

        return {
            "available": True,
            "status": "ok",
            "total_queries": total_queries,
            "cache_hit_ratio": round(cache_hit_ratio, 1),
            "latency_ms": round(latency_ms, 2),
        }
    except Exception as e:
        logger.debug(f"DNS metrics collection failed: {e}")
        return {"available": False, "status": "error", "total_queries": 0, "cache_hit_ratio": 0.0, "latency_ms": 0.0}
