#!/usr/bin/env python3
"""
DNS Control — Telemetry Collector
Collects real-time DNS metrics from unbound-control, nftables counters,
and query logs. Outputs structured JSON consumed by the API/frontend.

Runs as a systemd timer every 10 seconds.
Supports two modes: recursive_simple and recursive_interception.
"""

import json
import os
import re
import subprocess
import sys
import time
from collections import Counter, deque
from datetime import datetime, timezone
from pathlib import Path

# ── Configuration ──

CONFIG_PATH = os.environ.get("COLLECTOR_CONFIG", "/opt/dns-control/collector/config.json")
OUTPUT_DIR = Path(os.environ.get("COLLECTOR_OUTPUT_DIR", "/var/lib/dns-control/telemetry"))
STATE_FILE = OUTPUT_DIR / ".collector_state.json"
MAX_RECENT_QUERIES = 200
MAX_TOP_ENTRIES = 20
HISTORY_FILE = OUTPUT_DIR / ".query_history.json"
METRICS_HISTORY_FILE = OUTPUT_DIR / "history.json"
MAX_HISTORY_POINTS = 300


def load_config() -> dict:
    """Load collector config, with auto-detection fallback."""
    defaults = {
        "mode": "auto",
        "frontend_ip": "",
        "instances": [],
        "query_log_enabled": True,
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH) as f:
                cfg = json.load(f)
            defaults.update(cfg)
        except Exception:
            pass
    return defaults


def detect_mode() -> str:
    """Auto-detect DNS service mode from deploy-state.json or runtime inspection."""
    for path in [
        "/var/lib/dns-control/deploy-state.json",
        "/opt/dns-control/deploy-state.json",
    ]:
        try:
            with open(path) as f:
                state = json.load(f)
            mode = state.get("operationMode", "")
            if mode == "simple":
                return "recursive_simple"
            elif mode == "interception":
                return "recursive_interception"
        except (FileNotFoundError, json.JSONDecodeError):
            continue

    # Fallback: detect from runtime — if nftables has DNAT rules, it's interception
    code, stdout, _ = run_cmd(["sudo", "nft", "list", "ruleset"], timeout=10)
    if code == 0 and "dnat to" in stdout.lower():
        return "recursive_interception"

    return "recursive_simple"


def detect_frontend_ip() -> str:
    """Detect frontend DNS IP from deploy state or runtime."""
    for path in [
        "/var/lib/dns-control/deploy-state.json",
        "/opt/dns-control/deploy-state.json",
    ]:
        try:
            with open(path) as f:
                return json.load(f).get("frontendDnsIp", "")
        except Exception:
            continue

    # Fallback: discover from loopback VIPs (first VIP found)
    code, stdout, _ = run_cmd(["ip", "-j", "addr", "show"])
    if code == 0:
        try:
            ifaces = json.loads(stdout)
            for iface in ifaces:
                ifname = iface.get("ifname", "")
                if not (ifname == "lo" or ifname.startswith("lo") or ifname.startswith("dummy")):
                    continue
                for addr in iface.get("addr_info", []):
                    if addr.get("family") == "inet" and addr.get("local") != "127.0.0.1":
                        return addr["local"]
        except (json.JSONDecodeError, KeyError):
            pass
    return ""


def run_cmd(cmd: list[str], timeout: int = 10) -> tuple[int, str, str]:
    """Run a command and return (exit_code, stdout, stderr)."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except FileNotFoundError:
        return -1, "", f"command not found: {cmd[0]}"
    except Exception as e:
        return -1, "", str(e)


# ── Unbound Metrics ──

def discover_instances() -> list[dict]:
    """Discover unbound instances from systemd."""
    code, stdout, _ = run_cmd(["systemctl", "list-units", "--type=service", "--all", "--no-pager", "--plain"])
    instances = []
    if code == 0:
        for line in stdout.split("\n"):
            if "unbound" in line and ".service" in line:
                name = line.split()[0].replace(".service", "").lstrip("●").strip()
                if name == "unbound":
                    continue
                ctrl = parse_control_config(name)
                instances.append({
                    "name": name,
                    "control_interface": ctrl.get("control_interface", "127.0.0.1"),
                    "control_port": ctrl.get("control_port", 8953),
                    "bind_ip": ctrl.get("bind_ip", ""),
                })

    if not instances:
        instances = [
            {"name": "unbound01", "control_interface": "127.0.0.11", "control_port": 8953, "bind_ip": "100.127.255.101"},
            {"name": "unbound02", "control_interface": "127.0.0.12", "control_port": 8953, "bind_ip": "100.127.255.102"},
        ]
    return instances


def parse_control_config(name: str) -> dict:
    """Parse unbound config file for control/bind info."""
    ctrl = {"control_interface": "127.0.0.1", "control_port": 8953, "bind_ip": ""}
    conf_path = f"/etc/unbound/{name}.conf"
    try:
        with open(conf_path) as f:
            for line in f:
                s = line.strip()
                if s.startswith("control-interface:"):
                    ctrl["control_interface"] = s.split(":", 1)[1].strip()
                elif s.startswith("control-port:"):
                    try:
                        ctrl["control_port"] = int(s.split(":", 1)[1].strip())
                    except ValueError:
                        pass
                elif s.startswith("interface:") and not s.startswith("interface-automatic"):
                    ip = s.split(":", 1)[1].strip().split("@")[0]
                    if ip and ip != "0.0.0.0" and not ip.startswith("127."):
                        ctrl["bind_ip"] = ip
    except FileNotFoundError:
        pass
    return ctrl


def collect_unbound_stats(inst: dict) -> dict | None:
    """Collect stats from a single unbound instance."""
    name = inst["name"]
    ctrl_ip = inst["control_interface"]
    ctrl_port = inst["control_port"]
    conf = f"/etc/unbound/{name}.conf"

    code, stdout, stderr = run_cmd([
        "sudo", "unbound-control",
        "-s", f"{ctrl_ip}@{ctrl_port}",
        "-c", conf,
        "stats_noreset"
    ])

    if code != 0:
        return None

    stats = {}
    for line in stdout.split("\n"):
        if "=" in line:
            k, v = line.split("=", 1)
            try:
                stats[k.strip()] = float(v.strip())
            except ValueError:
                stats[k.strip()] = v.strip()

    total_q = int(stats.get("total.num.queries", 0))
    cache_hits = int(stats.get("total.num.cachehits", 0))
    cache_miss = int(stats.get("total.num.cachemiss", 0))
    hit_ratio = (cache_hits / total_q * 100) if total_q > 0 else 0.0
    rec_avg = float(stats.get("total.recursion.time.avg", 0))

    return {
        "instance": name,
        "bind_ip": inst.get("bind_ip", ""),
        "total_queries": total_q,
        "cache_hits": cache_hits,
        "cache_misses": cache_miss,
        "cache_hit_ratio": round(hit_ratio, 1),
        "recursion_avg_ms": round(rec_avg * 1000, 2),
        "servfail": int(stats.get("num.answer.rcode.SERVFAIL", 0)),
        "nxdomain": int(stats.get("num.answer.rcode.NXDOMAIN", 0)),
        "noerror": int(stats.get("num.answer.rcode.NOERROR", 0)),
        "refused": int(stats.get("num.answer.rcode.REFUSED", 0)),
        "msg_cache_count": int(stats.get("msg.cache.count", 0)),
        "rrset_cache_count": int(stats.get("rrset.cache.count", 0)),
        "mem_cache_msg": int(stats.get("mem.cache.message", 0)),
        "mem_cache_rrset": int(stats.get("mem.cache.rrset", 0)),
        "uptime_seconds": int(stats.get("time.up", 0)),
        "threads": int(stats.get("num.threads", 0)),
        "source": "unbound-control",
        "healthy": True,
    }


# ── nftables Counters ──

def collect_nftables_counters() -> dict:
    """Collect nftables counters for local balancing / interception."""
    code, stdout, stderr = run_cmd(["sudo", "nft", "list", "ruleset"])
    if code != 0:
        return {"available": False, "error": stderr[:200], "backends": [], "total_packets": 0, "total_bytes": 0}

    backends: dict[str, dict] = {}
    current_chain = ""

    for line in stdout.split("\n"):
        s = line.strip()
        chain_m = re.match(r'chain\s+(\S+)\s*\{', s)
        if chain_m:
            current_chain = chain_m.group(1)
            continue

        # DNAT with inline counter
        dnat_m = re.search(r'counter\s+packets\s+(\d+)\s+bytes\s+(\d+)\s+dnat\s+to\s+(\S+)', s)
        if dnat_m:
            pkts, byts, target = int(dnat_m.group(1)), int(dnat_m.group(2)), dnat_m.group(3)
            ip = target.split(":")[0]
            proto = "tcp" if "tcp" in s.split("counter")[0] else "udp" if "udp" in s.split("counter")[0] else "mixed"
            if ip not in backends:
                backends[ip] = {"backend": ip, "name": ip, "chain": current_chain, "packets": 0, "bytes": 0,
                                "tcp_packets": 0, "udp_packets": 0, "tcp_bytes": 0, "udp_bytes": 0}
            b = backends[ip]
            b["packets"] += pkts
            b["bytes"] += byts
            if proto == "tcp":
                b["tcp_packets"] += pkts; b["tcp_bytes"] += byts
            elif proto == "udp":
                b["udp_packets"] += pkts; b["udp_bytes"] += byts
            continue

        # Jump chain counters
        jump_m = re.search(r'counter\s+packets\s+(\d+)\s+bytes\s+(\d+)\s+jump\s+(\S+)', s)
        if jump_m:
            pkts, byts, jt = int(jump_m.group(1)), int(jump_m.group(2)), jump_m.group(3)
            name_m = re.search(r'(unbound\d+)', jt)
            if not name_m:
                continue
            bname = name_m.group(1)
            proto = "tcp" if "tcp" in jt else "udp" if "udp" in jt else "mixed"
            if bname not in backends:
                backends[bname] = {"backend": bname, "name": bname, "chain": current_chain, "packets": 0, "bytes": 0,
                                   "tcp_packets": 0, "udp_packets": 0, "tcp_bytes": 0, "udp_bytes": 0}
            b = backends[bname]
            b["packets"] += pkts
            b["bytes"] += byts
            if proto == "tcp":
                b["tcp_packets"] += pkts; b["tcp_bytes"] += byts
            elif proto == "udp":
                b["udp_packets"] += pkts; b["udp_bytes"] += byts

    backend_list = list(backends.values())
    total_pkts = sum(b["packets"] for b in backend_list)
    total_byts = sum(b["bytes"] for b in backend_list)

    # Compute share percentages
    for b in backend_list:
        b["share"] = round(b["packets"] / total_pkts * 100, 1) if total_pkts > 0 else 0.0

    return {
        "available": True,
        "backends": backend_list,
        "total_packets": total_pkts,
        "total_bytes": total_byts,
        "source": "nftables",
    }


# ── QPS Calculation (delta) ──

def load_state() -> dict:
    """Load previous collector state for delta calculations."""
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state: dict):
    """Save collector state."""
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f)
    except Exception:
        pass


def compute_qps(current_total: int, prev_state: dict) -> float:
    """Compute QPS from delta of total queries."""
    prev_total = prev_state.get("total_queries", 0)
    prev_ts = prev_state.get("timestamp", 0)
    now = time.time()
    elapsed = now - prev_ts if prev_ts > 0 else 0

    if elapsed <= 0 or current_total < prev_total:
        return 0.0

    delta = current_total - prev_total
    return round(delta / elapsed, 1)


# ── Log Availability Detection ──

def detect_log_availability(instances: list[dict]) -> dict:
    """
    Detect whether Unbound instances are configured to emit query logs.
    Checks: logfile config, use-syslog, and journalctl presence.
    Returns telemetry_mode: 'log' or 'logless' with details.
    """
    has_log_config = False
    has_syslog = False
    has_journal_entries = False
    details = []

    for inst in instances:
        name = inst["name"]
        conf_path = f"/etc/unbound/{name}.conf"
        inst_has_log = False
        inst_has_syslog = False

        try:
            with open(conf_path) as f:
                for line in f:
                    s = line.strip()
                    if s.startswith("#"):
                        continue
                    if s.startswith("log-queries:") and "yes" in s.lower():
                        inst_has_log = True
                    if s.startswith("use-syslog:") and "yes" in s.lower():
                        inst_has_syslog = True
                    if s.startswith("logfile:"):
                        val = s.split(":", 1)[1].strip().strip('"').strip("'")
                        if val and val != '""' and val != "''":
                            inst_has_log = True
        except FileNotFoundError:
            pass

        if inst_has_log:
            has_log_config = True
        if inst_has_syslog:
            has_syslog = True
        details.append({
            "instance": name,
            "log_queries": inst_has_log,
            "use_syslog": inst_has_syslog,
        })

    # Quick journal check — look for any unbound query entries in last 60s
    svc = instances[0]["name"] if instances else "unbound01"
    code, stdout, _ = run_cmd([
        "sudo", "journalctl", "--no-pager",
        "-u", f"{svc}.service",
        "--since", "60 seconds ago",
        "-n", "5", "-o", "short-iso",
    ], timeout=10)
    if code == 0 and stdout.strip():
        for line in stdout.split("\n"):
            if "info:" in line:
                has_journal_entries = True
                break

    log_available = has_log_config or has_syslog or has_journal_entries
    return {
        "telemetry_mode": "log" if log_available else "logless",
        "log_queries_configured": has_log_config,
        "use_syslog": has_syslog,
        "journal_entries_found": has_journal_entries,
        "domains_available": log_available,
        "clients_available": log_available,
        "details": details,
    }


# ── Query Log Parsing ──

def collect_query_logs(instances: list[dict], since_seconds: int = 60, log_detection: dict | None = None) -> dict:
    """Parse unbound query logs from journalctl for top domains/clients.
    If log_detection indicates logless mode, skip parsing and return empty with mode flag."""

    # If we already know logs are unavailable, skip all parsing attempts
    if log_detection and log_detection.get("telemetry_mode") == "logless":
        return {
            "top_domains": [],
            "top_clients": [],
            "top_query_types": [],
            "recent_queries": [],
            "log_source": "none",
            "queries_parsed": 0,
            "telemetry_mode": "logless",
            "domains_available": False,
            "clients_available": False,
            "diag": {"skipped": True, "reason": "logless_mode_detected"},
        }

    domains: Counter = Counter()
    clients: Counter = Counter()
    query_types: Counter = Counter()
    recent: deque = deque(maxlen=MAX_RECENT_QUERIES)

    # Load existing history for accumulation
    history = load_query_history()
    hist_domains = Counter(history.get("domains", {}))
    hist_clients = Counter(history.get("clients", {}))
    hist_types = Counter(history.get("query_types", {}))

    unit_args = []
    for inst in instances:
        name = inst["name"]
        # Accept both "unbound01" and "unbound01.service"
        svc = name if name.endswith(".service") else f"{name}.service"
        unit_args.extend(["-u", svc])
    if not unit_args:
        unit_args = ["-u", "unbound01.service", "-u", "unbound02.service"]

    # Try journalctl with sudo (collector may not have journal read perms)
    stdout = ""
    log_source = "none"
    diag_info = {}

    # Attempt 1: sudo + --since (--no-pager MUST be first arg for sudoers match)
    code, raw_out, stderr = run_cmd([
        "sudo", "journalctl", "--no-pager",
        *unit_args,
        "--since", f"{since_seconds} seconds ago",
        "-o", "short-iso",
        "-n", "5000",
    ], timeout=15)

    diag_info["attempt1"] = {"code": code, "lines": len(raw_out.strip().split("\n")) if raw_out.strip() else 0, "stderr": stderr[:200]}

    if code == 0 and raw_out.strip():
        stdout = raw_out
        log_source = "journalctl"

    if not stdout.strip():
        # Attempt 2: sudo + last N lines (no --since)
        code2, raw_out2, stderr2 = run_cmd([
            "sudo", "journalctl", "--no-pager",
            *unit_args,
            "-o", "short-iso",
            "-n", "2000",
        ], timeout=15)
        diag_info["attempt2"] = {"code": code2, "lines": len(raw_out2.strip().split("\n")) if raw_out2.strip() else 0, "stderr": stderr2[:200]}
        if code2 == 0 and raw_out2.strip():
            stdout = raw_out2
            log_source = "journalctl"

    if not stdout.strip():
        # Attempt 3: without sudo (fallback)
        code3, raw_out3, stderr3 = run_cmd([
            "journalctl", "--no-pager",
            *unit_args,
            "-o", "short-iso",
            "-n", "2000",
        ], timeout=15)
        diag_info["attempt3"] = {"code": code3, "lines": len(raw_out3.strip().split("\n")) if raw_out3.strip() else 0, "stderr": stderr3[:200]}
        if code3 == 0 and raw_out3.strip():
            stdout = raw_out3
            log_source = "journalctl"

    if not stdout.strip():
        # Attempt 4: ALL journal units, filter in Python
        code4, raw_out4, stderr4 = run_cmd([
            "sudo", "journalctl", "--no-pager",
            "--since", f"{since_seconds * 2} seconds ago",
            "-o", "short-iso",
            "-n", "5000",
        ], timeout=15)
        diag_info["attempt4_all_units"] = {"code": code4, "lines": len(raw_out4.strip().split("\n")) if raw_out4.strip() else 0}
        if code4 == 0 and raw_out4.strip():
            unbound_lines = [l for l in raw_out4.split("\n") if "unbound" in l.lower()]
            if unbound_lines:
                stdout = "\n".join(unbound_lines)
                log_source = "journalctl"
                diag_info["attempt4_unbound_lines"] = len(unbound_lines)

    # Unbound log-queries format from real journalctl:
    #   Apr 01 14:43:56 dnscontrol unbound[109556]: [1775069036] unbound[109556:3] info: 172.250.40.100 google.com. A IN
    # The key part after "info:" is: <client> <domain> <qtype> <qclass>
    # Client can be IP, IP#port, or other formats — use \S+ for robustness
    query_patterns = [
        # Primary: info: <client> <domain> <qtype> <qclass>
        re.compile(
            r'info:\s+(\S+)\s+(\S+)\s+([A-Z0-9]+)\s+([A-Z0-9]+)'
        ),
        # Fallback: query: <domain> <class> <type> from <client>
        re.compile(
            r'query:\s+(\S+)\s+(\w+)\s+(\w+)\s+from\s+(\d+\.\d+\.\d+\.\d+)'
        ),
    ]

    # Debug: capture sample lines for diagnostics
    all_lines = stdout.split("\n")
    info_lines = [l for l in all_lines if "info:" in l]
    sample_lines = info_lines[:5] if info_lines else all_lines[:5]

    parsed_count = 0
    for line in all_lines:
        # Quick pre-filter: must contain "info:" to be a query log line
        if "info:" not in line:
            continue

        for i, pat in enumerate(query_patterns):
            m = pat.search(line)
            if not m:
                continue

            if i == 0:
                # info: <client> <domain> <qtype> <qclass>
                raw_client, domain, qtype, _qclass = m.groups()
                # Strip optional #port from client (e.g. 172.250.40.100#12345)
                client = raw_client.split("#")[0]
            else:
                # query: <domain> <class> <type> from <client>
                domain, _qclass, qtype, client = m.groups()

            domain = domain.rstrip(".")
            if not domain or domain == "." or domain == "localhost":
                continue

            domains[domain] += 1
            clients[client] += 1
            query_types[qtype] += 1

            # Extract timestamp from line start
            time_str = ""
            tm = re.match(r'(\d{4}-\d{2}-\d{2}T[\d:]+)', line)
            if tm:
                time_str = tm.group(1)[-8:]
            else:
                tm2 = re.match(r'\w+\s+\d+\s+([\d:]+)', line)
                if tm2:
                    time_str = tm2.group(1)

            recent.append({
                "time": time_str or "??:??:??",
                "client": client,
                "domain": domain,
                "type": qtype,
            })
            parsed_count += 1
            break

    # Merge with history
    hist_domains.update(domains)
    hist_clients.update(clients)
    hist_types.update(query_types)

    # Save updated history
    save_query_history({
        "domains": dict(hist_domains.most_common(500)),
        "clients": dict(hist_clients.most_common(200)),
        "query_types": dict(hist_types.most_common(50)),
    })

    # Determine if we actually got any data
    has_data = parsed_count > 0 or len(hist_domains) > 0
    telemetry_mode = "log" if has_data else "logless"

    return {
        "top_domains": [{"domain": d, "count": c} for d, c in hist_domains.most_common(MAX_TOP_ENTRIES)],
        "top_clients": [{"ip": ip, "queries": c} for ip, c in hist_clients.most_common(MAX_TOP_ENTRIES)],
        "top_query_types": [{"type": t, "count": c} for t, c in hist_types.most_common(10)],
        "recent_queries": list(recent),
        "log_source": log_source,
        "queries_parsed": parsed_count,
        "telemetry_mode": telemetry_mode,
        "domains_available": has_data,
        "clients_available": has_data,
        "diag": {
            "total_lines": len(all_lines),
            "info_lines": len(info_lines),
            "sample_lines": sample_lines,
            "unit_args": unit_args,
            **diag_info,
        },
    }


def load_query_history() -> dict:
    try:
        with open(HISTORY_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_query_history(data: dict):
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump(data, f)
    except Exception:
        pass


# ── Frontend Health ──

def check_frontend_health(frontend_ip: str) -> dict:
    """Check if frontend DNS is responding."""
    if not frontend_ip:
        return {"ip": "", "port": 53, "healthy": False, "error": "no frontend IP configured"}

    code, stdout, stderr = run_cmd([
        "dig", f"@{frontend_ip}", "google.com", "+short", "+time=2", "+tries=1"
    ], timeout=5)

    return {
        "ip": frontend_ip,
        "port": 53,
        "healthy": code == 0 and len(stdout.strip()) > 0,
        "response": stdout.strip().split("\n")[0] if code == 0 else "",
        "error": stderr.strip()[:100] if code != 0 else None,
    }


# ── Systemd Status ──

def check_service_status(name: str) -> dict:
    code, stdout, _ = run_cmd(["systemctl", "is-active", name])
    return {
        "name": name,
        "active": code == 0 and stdout.strip() in ("active", "running"),
        "status": stdout.strip(),
    }


# ── Network Info ──

def get_listeners() -> list[dict]:
    """Get DNS listeners from ss, deduplicated."""
    code, stdout, _ = run_cmd(["ss", "-tulnp"])
    seen: set[tuple[str, int]] = set()
    listeners = []
    if code != 0:
        return listeners

    for line in stdout.split("\n"):
        if ":53 " in line or ":53\t" in line:
            parts = line.split()
            for part in parts:
                if ":53" in part:
                    ip = part.rsplit(":", 1)[0]
                    if ip in ("*", "0.0.0.0", "[::]"):
                        continue
                    key = (ip, 53)
                    if key not in seen:
                        seen.add(key)
                        listeners.append({"ip": ip, "port": 53})
    return listeners


# ── Main Collector ──

def collect_all() -> dict:
    """Run full collection cycle and return structured JSON."""
    config = load_config()
    mode = config["mode"] if config["mode"] != "auto" else detect_mode()
    frontend_ip = config.get("frontend_ip") or detect_frontend_ip()
    instances = config.get("instances") or discover_instances()
    prev_state = load_state()

    now = datetime.now(timezone.utc)
    timestamp = now.isoformat()
    epoch = int(now.timestamp())

    # ── Collect from all sources ──
    resolver_stats = []
    total_queries = 0
    total_hits = 0
    total_misses = 0
    total_servfail = 0
    total_nxdomain = 0
    total_latency = 0.0
    live_count = 0

    for inst in instances:
        stats = collect_unbound_stats(inst)
        if stats:
            resolver_stats.append(stats)
            total_queries += stats["total_queries"]
            total_hits += stats["cache_hits"]
            total_misses += stats["cache_misses"]
            total_servfail += stats["servfail"]
            total_nxdomain += stats["nxdomain"]
            total_latency += stats["recursion_avg_ms"]
            live_count += 1
        else:
            resolver_stats.append({
                "instance": inst["name"],
                "bind_ip": inst.get("bind_ip", ""),
                "total_queries": 0, "cache_hits": 0, "cache_misses": 0,
                "cache_hit_ratio": 0, "recursion_avg_ms": 0,
                "servfail": 0, "nxdomain": 0, "noerror": 0, "refused": 0,
                "source": "unavailable", "healthy": False,
                "error": "unbound-control failed",
            })

    cache_hit_ratio = round(total_hits / (total_hits + total_misses) * 100, 1) if (total_hits + total_misses) > 0 else 0.0
    avg_latency = round(total_latency / live_count, 2) if live_count > 0 else 0.0

    # QPS
    qps = compute_qps(total_queries, prev_state)

    # nftables
    nft = collect_nftables_counters()

    # Frontend health
    frontend = check_frontend_health(frontend_ip)

    # Query logs — detect log availability first
    log_detection = detect_log_availability(instances)
    query_analytics = collect_query_logs(instances, since_seconds=30, log_detection=log_detection)

    # Service status
    service_checks = []
    for inst in instances:
        service_checks.append(check_service_status(inst["name"]))

    # Listeners
    listeners = get_listeners()

    # Save state for next delta
    save_state({
        "total_queries": total_queries,
        "timestamp": epoch,
        "nft_total_packets": nft.get("total_packets", 0),
    })

    # ── Build output ──
    # Compute nft QPS
    prev_nft_pkts = prev_state.get("nft_total_packets", 0)
    prev_ts = prev_state.get("timestamp", 0)
    elapsed = epoch - prev_ts if prev_ts > 0 else 0
    nft_qps = round((nft["total_packets"] - prev_nft_pkts) / elapsed, 1) if elapsed > 0 and nft["total_packets"] >= prev_nft_pkts else 0.0

    # Backends with resolver stats merged
    backends = []
    for rs in resolver_stats:
        nft_match = None
        for nb in nft.get("backends", []):
            if rs["bind_ip"] and rs["bind_ip"] in nb.get("backend", ""):
                nft_match = nb
                break
            if rs["instance"] in nb.get("name", ""):
                nft_match = nb
                break

        backends.append({
            "name": rs["instance"],
            "ip": rs.get("bind_ip", ""),
            "healthy": rs.get("healthy", False),
            "resolver": {
                "total_queries": rs["total_queries"],
                "cache_hits": rs["cache_hits"],
                "cache_misses": rs["cache_misses"],
                "cache_hit_ratio": rs.get("cache_hit_ratio", 0),
                "recursion_avg_ms": rs.get("recursion_avg_ms", 0),
                "servfail": rs["servfail"],
                "nxdomain": rs["nxdomain"],
                "noerror": rs.get("noerror", 0),
                "refused": rs.get("refused", 0),
                "uptime_seconds": rs.get("uptime_seconds", 0),
                "source": rs.get("source", "unavailable"),
            },
            "traffic": {
                "packets": nft_match["packets"] if nft_match else 0,
                "bytes": nft_match["bytes"] if nft_match else 0,
                "share": nft_match["share"] if nft_match else 0,
                "source": "nftables" if nft_match else "none",
            },
        })

    # Determine telemetry mode from query analytics
    telemetry_mode = query_analytics.get("telemetry_mode", log_detection.get("telemetry_mode", "log"))

    output = {
        "mode": mode,
        "telemetry_mode": telemetry_mode,
        "timestamp": timestamp,
        "epoch": epoch,
        "collector_version": "1.0.0",

        "frontend": frontend,

        "resolver": {
            "total_queries": total_queries,
            "cache_hits": total_hits,
            "cache_misses": total_misses,
            "cache_hit_ratio": cache_hit_ratio,
            "avg_latency_ms": avg_latency,
            "servfail": total_servfail,
            "nxdomain": total_nxdomain,
            "qps": qps,
            "instances_live": live_count,
            "instances_total": len(instances),
            "source": "unbound-control",
        },

        "traffic": {
            "total_packets": nft["total_packets"] if nft.get("available") else 0,
            "total_bytes": nft.get("total_bytes", 0),
            "qps": nft_qps,
            "available": nft.get("available", False),
            "source": "nftables",
        },

        "backends": backends,

        "top_domains": query_analytics.get("top_domains", []),
        "top_clients": query_analytics.get("top_clients", []),
        "top_query_types": query_analytics.get("top_query_types", []),
        "recent_queries": query_analytics.get("recent_queries", []),
        "query_analytics": {
            "log_source": query_analytics.get("log_source", "none"),
            "queries_parsed": query_analytics.get("queries_parsed", 0),
            "telemetry_mode": telemetry_mode,
            "domains_available": query_analytics.get("domains_available", False),
            "clients_available": query_analytics.get("clients_available", False),
            "diag": query_analytics.get("diag", {}),
        },

        "log_detection": log_detection,

        "services": service_checks,
        "listeners": listeners,

        "health": {
            "collector": "ok",
            "last_update": timestamp,
            "collection_duration_ms": 0,  # filled below
        },
    }

    return output


def append_metrics_history(data: dict):
    """Append a metrics snapshot to history.json (circular buffer)."""
    resolver = data.get("resolver", {})
    point = {
        "timestamp": data.get("timestamp", datetime.now(timezone.utc).isoformat()),
        "epoch": data.get("epoch", int(time.time())),
        "qps": resolver.get("qps", 0),
        "latency_ms": resolver.get("avg_latency_ms", 0),
        "cache_hit_ratio": resolver.get("cache_hit_ratio", 0),
        "servfail": resolver.get("servfail", 0),
        "nxdomain": resolver.get("nxdomain", 0),
        "total_queries": resolver.get("total_queries", 0),
        "cache_hits": resolver.get("cache_hits", 0),
        "cache_misses": resolver.get("cache_misses", 0),
        "instances_live": resolver.get("instances_live", 0),
        "nft_qps": data.get("traffic", {}).get("qps", 0),
        "nft_packets": data.get("traffic", {}).get("total_packets", 0),
    }

    history = []
    try:
        with open(METRICS_HISTORY_FILE) as f:
            history = json.load(f)
        if not isinstance(history, list):
            history = []
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    history.append(point)
    # Keep only last N points
    if len(history) > MAX_HISTORY_POINTS:
        history = history[-MAX_HISTORY_POINTS:]

    try:
        tmp = METRICS_HISTORY_FILE.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(history, f)
        tmp.rename(METRICS_HISTORY_FILE)
    except Exception:
        pass


def main():
    """Entry point for systemd timer execution."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    start = time.time()
    try:
        data = collect_all()
        duration_ms = int((time.time() - start) * 1000)
        data["health"]["collection_duration_ms"] = duration_ms

        # Write mode-specific output
        mode = data["mode"]
        if mode == "recursive_simple":
            output_file = OUTPUT_DIR / "recursive-simple.json"
        else:
            output_file = OUTPUT_DIR / "recursive-interception.json"

        # Also write to latest.json for API consumption
        latest_file = OUTPUT_DIR / "latest.json"

        for f in [output_file, latest_file]:
            tmp = f.with_suffix(".tmp")
            with open(tmp, "w") as fh:
                json.dump(data, fh, indent=2)
            tmp.rename(f)

        # Append to metrics history (circular buffer)
        append_metrics_history(data)

        print(f"OK: collected in {duration_ms}ms, mode={mode}, queries={data['resolver']['total_queries']}, "
              f"qps={data['resolver']['qps']}, nft_pkts={data['traffic']['total_packets']}")

    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        error_data = {
            "mode": "unknown",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "epoch": int(time.time()),
            "health": {
                "collector": "error",
                "last_update": datetime.now(timezone.utc).isoformat(),
                "collection_duration_ms": duration_ms,
                "error": str(e)[:500],
            },
        }
        latest = OUTPUT_DIR / "latest.json"
        try:
            with open(latest, "w") as fh:
                json.dump(error_data, fh, indent=2)
        except Exception:
            pass
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
