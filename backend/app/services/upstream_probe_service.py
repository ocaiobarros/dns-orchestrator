"""Upstream probe service (read-only).

Discovers, for each configured DNS upstream (forward-addr), the PoP/datacenter
serving us, the round-trip latency, and optionally the network path. Runs only
read-only diagnostic commands (``dig``, ``ping``, ``mtr``/``traceroute``) with
short timeouts.

This module does NOT touch production state: it never writes config files,
never restarts services, and never modifies firewall/DNS/deploy artifacts.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field, asdict
from typing import Any

from app.services.healthcheck_service import (
    discover_root_forward_addresses,
    resolve_forward_addresses_from_state,
)

logger = logging.getLogger(__name__)

# Short timeouts so a slow/unreachable upstream never blocks the worker.
_DIG_TIMEOUT_S = 3
_PING_TIMEOUT_S = 4
_MTR_TIMEOUT_S = 8


@dataclass
class UpstreamProbeResult:
    ip: str
    alive: bool = False
    rtt_ms: float | None = None
    pop_code: str | None = None
    pop_raw: str | None = None
    pop_method: str | None = None
    hops: int | None = None
    ingress: str | None = None
    egress_ip: str | None = None
    ecs: str | None = None
    ts: float = field(default_factory=lambda: time.time())
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Upstream discovery (reuses healthcheck_service helpers; no new state)
# ---------------------------------------------------------------------------


def get_upstreams(state: dict[str, Any] | None = None) -> list[str]:
    """Return the configured DNS upstream IPs.

    Prefers a passed deploy-state dict; falls back to scanning deployed Unbound
    configs. Returns an empty list when nothing is configured (recursive mode).
    """
    if state:
        try:
            return resolve_forward_addresses_from_state(state)
        except Exception:  # pragma: no cover - defensive
            logger.debug("resolve_forward_addresses_from_state failed", exc_info=True)
    try:
        return discover_root_forward_addresses()
    except Exception:  # pragma: no cover - defensive
        logger.debug("discover_root_forward_addresses failed", exc_info=True)
        return []


# ---------------------------------------------------------------------------
# Subprocess helpers
# ---------------------------------------------------------------------------


def _run(cmd: list[str], timeout: int) -> tuple[int, str, str]:
    """Run a command read-only. Returns (rc, stdout, stderr); never raises."""
    try:
        proc = subprocess.run(  # noqa: S603 - args are constant + IP only
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return proc.returncode, proc.stdout or "", proc.stderr or ""
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except FileNotFoundError:
        return 127, "", f"missing: {cmd[0]}"
    except Exception as exc:  # pragma: no cover - defensive
        return 1, "", str(exc)


_IPV4_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


def _is_ipv4(s: str) -> bool:
    return bool(_IPV4_RE.match(s))


# ---------------------------------------------------------------------------
# Probes
# ---------------------------------------------------------------------------


def probe_pop(ip: str) -> dict[str, Any]:
    """Detect the upstream PoP/datacenter via CHAOS TXT or Google's myaddr.

    Returns dict with keys: pop_code, raw, method, egress_ip, ecs.
    All values may be None when the upstream does not expose this metadata.
    """
    out: dict[str, Any] = {
        "pop_code": None,
        "raw": None,
        "method": None,
        "egress_ip": None,
        "ecs": None,
    }
    if not shutil.which("dig"):
        return out

    # 1) Cloudflare-style: CHAOS TXT id.server / hostname.bind → "gru17" etc.
    for qname in ("id.server", "hostname.bind"):
        rc, stdout, _ = _run(
            [
                "dig",
                "+short",
                "+time=2",
                "+tries=1",
                "CH",
                "TXT",
                qname,
                f"@{ip}",
            ],
            timeout=_DIG_TIMEOUT_S,
        )
        if rc == 0 and stdout.strip():
            raw = stdout.strip().splitlines()[0].strip().strip('"')
            if raw:
                out["raw"] = raw
                out["method"] = f"CH TXT {qname}"
                # Extract IATA-ish code (3 letters, possibly followed by digits).
                m = re.search(r"\b([a-z]{3})(\d{0,4})\b", raw.lower())
                if m:
                    out["pop_code"] = m.group(1) + (m.group(2) or "")
                return out

    # 2) Google-style: o-o.myaddr.l.google.com returns our egress IP + ECS.
    rc, stdout, _ = _run(
        [
            "dig",
            "+short",
            "+time=2",
            "+tries=1",
            "TXT",
            "o-o.myaddr.l.google.com",
            f"@{ip}",
        ],
        timeout=_DIG_TIMEOUT_S,
    )
    if rc == 0 and stdout.strip():
        out["method"] = "TXT myaddr (google)"
        # NOTE: do NOT use the lone IPv4 line as our egress. When the query is
        # forwarded (e.g. through Cloudflare/Google as resolver), that IPv4 is
        # the remote server's address as seen by Google — NOT our egress. The
        # only trustworthy signal here is the ECS prefix, which reflects the
        # /24 the upstream forwarded with — that IS our egress block.
        for line in stdout.splitlines():
            v = line.strip().strip('"')
            if not v:
                continue
            if v.startswith("edns0-client-subnet"):
                out["ecs"] = v.split()[-1] if " " in v else v.split("=")[-1]
        if out["ecs"]:
            # Derive a representative egress IP from the ECS prefix
            # (e.g. "45.232.215.0/24" → "45.232.215.0"). Honest: it's the
            # block, not a specific host, but it's REAL user-side data.
            prefix = out["ecs"].split("/", 1)[0].strip()
            if _is_ipv4(prefix):
                out["egress_ip"] = prefix
            out["raw"] = stdout.strip()
    return out


_PING_AVG_RE = re.compile(
    r"min/avg/max[^=]*=\s*[\d.]+/([\d.]+)/", re.IGNORECASE
)


def probe_latency(ip: str) -> tuple[bool, float | None]:
    """Return (alive, rtt_avg_ms). Falls back to dig timing if ping is blocked."""
    if shutil.which("ping"):
        rc, stdout, _ = _run(
            ["ping", "-n", "-c", "3", "-W", "1", ip], timeout=_PING_TIMEOUT_S
        )
        if rc == 0:
            m = _PING_AVG_RE.search(stdout)
            if m:
                try:
                    return True, float(m.group(1))
                except ValueError:
                    pass
            return True, None

    # Fallback: dig query time
    if shutil.which("dig"):
        t0 = time.time()
        rc, _, _ = _run(
            [
                "dig",
                "+tries=1",
                "+time=2",
                "+short",
                "CH",
                "TXT",
                "id.server",
                f"@{ip}",
            ],
            timeout=_DIG_TIMEOUT_S,
        )
        elapsed_ms = (time.time() - t0) * 1000.0
        if rc == 0:
            return True, round(elapsed_ms, 2)
    return False, None


_MTR_HOP_LINE_RE = re.compile(r"^\s*\d+\.\|--")


def probe_path(ip: str) -> dict[str, Any]:
    """Optional path probe via mtr (preferred) or traceroute. Best-effort."""
    out: dict[str, Any] = {"hops": None, "ingress": None}
    if shutil.which("mtr"):
        rc, stdout, _ = _run(
            ["mtr", "-rwc", "3", "-n", ip], timeout=_MTR_TIMEOUT_S
        )
        if rc == 0 and stdout:
            hops = [ln for ln in stdout.splitlines() if _MTR_HOP_LINE_RE.match(ln)]
            if hops:
                out["hops"] = len(hops)
                # Penultimate hop is usually the ingress into the dest AS.
                if len(hops) >= 2:
                    out["ingress"] = hops[-2].split()[1] if len(hops[-2].split()) > 1 else None
            return out
    if shutil.which("traceroute"):
        rc, stdout, _ = _run(
            ["traceroute", "-n", "-w", "1", "-q", "1", "-m", "20", ip],
            timeout=_MTR_TIMEOUT_S,
        )
        if rc == 0 and stdout:
            hop_lines = [
                ln for ln in stdout.splitlines() if re.match(r"^\s*\d+\s", ln)
            ]
            if hop_lines:
                out["hops"] = len(hop_lines)
    return out


def probe_upstream(ip: str, with_path: bool = False) -> UpstreamProbeResult:
    """Probe a single upstream. Read-only."""
    result = UpstreamProbeResult(ip=ip)
    try:
        alive, rtt = probe_latency(ip)
        result.alive = alive
        result.rtt_ms = rtt
        pop = probe_pop(ip)
        result.pop_code = pop.get("pop_code")
        result.pop_raw = pop.get("raw")
        result.pop_method = pop.get("method")
        result.egress_ip = pop.get("egress_ip")
        result.ecs = pop.get("ecs")
        # dig succeeded for PoP → upstream is alive even if ping was blocked.
        if not result.alive and (result.pop_raw or result.egress_ip):
            result.alive = True
        if with_path and result.alive:
            path = probe_path(ip)
            result.hops = path.get("hops")
            result.ingress = path.get("ingress")
    except Exception as exc:  # pragma: no cover - defensive
        result.error = str(exc)
        logger.debug("probe_upstream failed for %s", ip, exc_info=True)
    return result


def probe_all(
    state: dict[str, Any] | None = None, with_path: bool = False
) -> list[dict[str, Any]]:
    """Probe every configured upstream and return JSON-serializable dicts."""
    return [probe_upstream(ip, with_path=with_path).to_dict() for ip in get_upstreams(state)]


# ---------------------------------------------------------------------------
# In-memory state cache (per-process, refreshed by upstream_probe_worker)
# ---------------------------------------------------------------------------

from collections import deque  # noqa: E402
from threading import Lock  # noqa: E402

_STATE_LOCK = Lock()
_STATE: dict[str, dict[str, Any]] = {}
_HISTORY_MAX = 10
# A PoP silent longer than this is dropped from the response so the UI
# naturally retires dead nodes after the "red" period.
_DOWN_RETIRE_AFTER_S = 15 * 60


def _new_entry(ip: str) -> dict[str, Any]:
    return {
        "ip": ip,
        "current_pop": None,
        "current_rtt_ms": None,
        "alive": False,
        "last_seen_ts": None,
        "down_since_ts": None,
        "pop_method": None,
        "pop_raw": None,
        "egress_ip": None,
        "ecs": None,
        "hops": None,
        "ingress": None,
        "history": deque(maxlen=_HISTORY_MAX),
    }


def _apply_probe(entry: dict[str, Any], probe: UpstreamProbeResult, now: float) -> None:
    if probe.alive:
        entry["alive"] = True
        entry["last_seen_ts"] = now
        entry["down_since_ts"] = None
        if probe.rtt_ms is not None:
            entry["current_rtt_ms"] = probe.rtt_ms
        if probe.pop_method:
            entry["pop_method"] = probe.pop_method
        if probe.pop_raw:
            entry["pop_raw"] = probe.pop_raw
        if probe.egress_ip:
            entry["egress_ip"] = probe.egress_ip
        if probe.ecs:
            entry["ecs"] = probe.ecs
        if probe.hops is not None:
            entry["hops"] = probe.hops
        if probe.ingress:
            entry["ingress"] = probe.ingress
        new_pop = probe.pop_code
        if new_pop and new_pop != entry["current_pop"]:
            entry["current_pop"] = new_pop
            entry["history"].append(
                {"pop_code": new_pop, "first_seen": now, "last_seen": now}
            )
        elif new_pop and entry["history"]:
            entry["history"][-1]["last_seen"] = now
    else:
        entry["alive"] = False
        if entry["down_since_ts"] is None:
            entry["down_since_ts"] = now


def run_probe_cycle(
    state: dict[str, Any] | None = None, with_path: bool = False
) -> list[dict[str, Any]]:
    """Probe all upstreams once and update the shared state cache."""
    now = time.time()
    ips = get_upstreams(state)
    results: list[UpstreamProbeResult] = [
        probe_upstream(ip, with_path=with_path) for ip in ips
    ]
    with _STATE_LOCK:
        for probe in results:
            entry = _STATE.get(probe.ip) or _new_entry(probe.ip)
            _apply_probe(entry, probe, now)
            _STATE[probe.ip] = entry
    return [r.to_dict() for r in results]


def _serialize_entry(entry: dict[str, Any], now: float) -> dict[str, Any]:
    last_seen = entry.get("last_seen_ts")
    down_since = entry.get("down_since_ts")
    age_since_seen = (now - last_seen) if last_seen else None
    down_for = (now - down_since) if down_since else None
    if entry.get("alive"):
        status = "current"
    elif down_for is not None and down_for >= _DOWN_RETIRE_AFTER_S:
        status = "retired"
    else:
        status = "down"
    from app.services.iata_geo import resolve_pop_geo  # local import (avoid cycles)

    current_geo = resolve_pop_geo(entry.get("current_pop"))
    history = []
    for h in entry.get("history") or []:
        h_geo = resolve_pop_geo(h.get("pop_code"))
        history.append({**h, "geo": h_geo})

    return {
        "ip": entry["ip"],
        "alive": entry.get("alive", False),
        "status": status,
        "current_pop": entry.get("current_pop"),
        "current_geo": current_geo,
        "current_rtt_ms": entry.get("current_rtt_ms"),
        "pop_method": entry.get("pop_method"),
        "pop_raw": entry.get("pop_raw"),
        "egress_ip": entry.get("egress_ip"),
        "ecs": entry.get("ecs"),
        "hops": entry.get("hops"),
        "ingress": entry.get("ingress"),
        "last_seen_ts": last_seen,
        "down_since_ts": down_since,
        "age_since_seen_s": round(age_since_seen, 2) if age_since_seen is not None else None,
        "down_for_s": round(down_for, 2) if down_for is not None else None,
        "history": history,
    }


def get_state_snapshot(include_retired: bool = False) -> dict[str, Any]:
    """Return the current cached state for all probed upstreams."""
    now = time.time()
    with _STATE_LOCK:
        entries = [_serialize_entry(e, now) for e in _STATE.values()]
    if not include_retired:
        entries = [e for e in entries if e["status"] != "retired"]
    egress = next((e["egress_ip"] for e in entries if e.get("egress_ip")), None)
    ecs = next((e["ecs"] for e in entries if e.get("ecs")), None)
    return {
        "ts": now,
        "egress": {"ip": egress, "ecs": ecs} if (egress or ecs) else None,
        "upstreams": entries,
    }


def reset_state_for_tests() -> None:
    """Test helper — wipe the cache between unit tests."""
    with _STATE_LOCK:
        _STATE.clear()
