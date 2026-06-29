"""
DNS Control — Infra Probe Service (read-only)

Reads `unbound-control dump_infra` from each local Unbound instance and
produces a normalized list of authoritatives/CDNs that the resolver has
actually contacted recently. Powers the "live CDN map" in iterative mode,
where there is no fixed forward-addr to probe.

Read-only by design — `dump_infra` is a diagnostic command. Per-instance
failures are non-fatal (best-effort aggregation).
"""

from __future__ import annotations

import ipaddress
import logging
import re
import threading
import time
from typing import Any, Iterable

from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.infra_probe")



# Local Unbound instances — same convention used everywhere else in the codebase
# (diagnostics_service, metrics_collector, etc.).
INSTANCES: list[tuple[str, str]] = [
    ("127.0.0.11@8953", "/etc/unbound/unbound01.conf"),
    ("127.0.0.12@8953", "/etc/unbound/unbound02.conf"),
    ("127.0.0.13@8953", "/etc/unbound/unbound03.conf"),
    ("127.0.0.14@8953", "/etc/unbound/unbound04.conf"),
]

# `ip zone ttl <n> ping <n> var <n> rtt <n> rto <n> tA <n> tAAAA <n> tother <n>
#  ednsknown <n> edns <n> delay <n> lame dnssec_lame reclame A AAAA`
# Example real line (vdns-02):
#   2.16.166.130 e8960.b.akamaiedge.net. ttl 855 ping 71 var 5 rtt 91 rto 91 ...
_LINE_RE = re.compile(
    r"^(?P<ip>\S+)\s+(?P<zone>\S+)\s+ttl\s+(?P<ttl>\d+)\s+"
    r"ping\s+(?P<ping>-?\d+)\s+var\s+(?P<var>-?\d+)\s+"
    r"rtt\s+(?P<rtt>-?\d+)\s+rto\s+(?P<rto>-?\d+)"
)


# ── Provider classification ─────────────────────────────────────────────────
# Substring match on the zone name is the honest primary signal (the resolver
# knows the auth zone). IP ranges are a complement for the cases where zone
# names are opaque (e.g. plain IPs, generic anycast).
_ZONE_PROVIDERS: list[tuple[str, str]] = [
    ("akamaiedge", "Akamai"),
    ("akadns", "Akamai"),
    ("akamai", "Akamai"),
    ("cloudflare", "Cloudflare"),
    ("1e100", "Google"),
    ("googleusercontent", "Google"),
    ("googledomains", "Google"),
    ("google.com", "Google"),
    ("gstatic", "Google"),
    ("awsdns", "AWS"),
    ("amazonaws", "AWS"),
    ("cloudfront", "AWS"),
    ("fastly", "Fastly"),
    ("edgekey", "Akamai"),
    ("edgesuite", "Akamai"),
    ("azureedge", "Azure"),
    ("azure", "Azure"),
    ("microsoft", "Microsoft"),
    ("apple", "Apple"),
    ("icloud", "Apple"),
    ("facebook", "Meta"),
    ("fbcdn", "Meta"),
    ("instagram", "Meta"),
    ("whatsapp", "Meta"),
    ("netflix", "Netflix"),
    ("nflxvideo", "Netflix"),
    ("spotify", "Spotify"),
    ("tiktok", "TikTok"),
    ("bytedance", "TikTok"),
]

# Coarse IPv4 CIDR ranges, only used when the zone name didn't identify the
# provider. Kept short on purpose — this is a hint, not a registry.
_IP_RANGES: list[tuple[str, str]] = [
    ("104.16.0.0/12", "Cloudflare"),
    ("172.64.0.0/13", "Cloudflare"),
    ("162.158.0.0/15", "Cloudflare"),
    ("162.159.0.0/16", "Cloudflare"),
    ("23.32.0.0/11", "Akamai"),
    ("23.192.0.0/11", "Akamai"),
    ("2.16.0.0/13", "Akamai"),
    ("8.8.4.0/24", "Google"),
    ("8.8.8.0/24", "Google"),
    ("142.250.0.0/15", "Google"),
    ("172.217.0.0/16", "Google"),
    ("151.101.0.0/16", "Fastly"),
    ("199.232.0.0/16", "Fastly"),
]

# IANA TLDs that show up as zone names like "com.", "br.", "net.".
_TLD_HINTS = {"com.", "net.", "org.", "br.", "info.", "io.", "co.", "us.", "uk."}


def _ip_family(ip: str) -> str:
    try:
        return "ipv6" if isinstance(ipaddress.ip_address(ip), ipaddress.IPv6Address) else "ipv4"
    except ValueError:
        return "ipv4"


def classify_provider(ip: str, zone: str) -> str:
    """Return a short provider/CDN label for an (ip, zone) pair.

    Order of preference: root → TLD → zone-name match → IP-range match → "Other".
    """
    z = (zone or "").strip().lower()
    if z in (".", ""):
        return "Root"
    # Accept both "br." and "br" since callers may strip the trailing dot.
    z_dot = z if z.endswith(".") else z + "."
    if z_dot in _TLD_HINTS or ("." not in z.rstrip(".") and len(z.rstrip(".")) <= 4):
        return "TLD"
    for needle, label in _ZONE_PROVIDERS:
        if needle in z:
            return label
    try:
        addr = ipaddress.ip_address(ip)
        for cidr, label in _IP_RANGES:
            if addr in ipaddress.ip_network(cidr):
                return label
    except ValueError:
        pass
    return "Other"


def parse_dump_infra(text: str) -> list[dict]:
    """Parse the raw output of `unbound-control dump_infra` into entries."""
    entries: list[dict] = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        m = _LINE_RE.match(line)
        if not m:
            continue
        ip = m.group("ip")
        zone = m.group("zone")
        rtt = int(m.group("rtt"))
        ping = int(m.group("ping"))
        # tail flags ("lame", "dnssec_lame") — substring search is enough
        tail = line.lower()
        lame = " lame" in tail and " lame 0" not in tail
        dnssec_lame = "dnssec_lame" in tail and "dnssec_lame 0" not in tail
        entries.append({
            "ip": ip,
            "zone": zone.rstrip("."),
            "rtt_ms": rtt if rtt >= 0 else None,
            "ping_ms": ping if ping >= 0 else None,
            "lame": lame,
            "dnssec_lame": dnssec_lame,
            "family": _ip_family(ip),
        })
    return entries


def _run_dump_infra(socket: str, conf: str, timeout: int = 6) -> str:
    """Run `unbound-control dump_infra` on a single instance. Best-effort."""
    try:
        r = run_command(
            "unbound-control",
            ["-s", socket, "-c", conf, "dump_infra"],
            timeout=timeout,
            use_privilege=True,
        )
        if r.get("exit_code") == 0:
            return r.get("stdout") or ""
        logger.debug("dump_infra failed on %s (exit=%s): %s", socket, r.get("exit_code"), r.get("stderr"))
    except Exception:
        logger.exception("dump_infra crashed on %s", socket)
    return ""


def _dedupe_best_rtt(rows: Iterable[dict]) -> list[dict]:
    """Keep one entry per IP — prefer the smallest non-null rtt."""
    by_ip: dict[str, dict] = {}
    for row in rows:
        prev = by_ip.get(row["ip"])
        if prev is None:
            by_ip[row["ip"]] = row
            continue
        prev_rtt = prev.get("rtt_ms")
        new_rtt = row.get("rtt_ms")
        if new_rtt is not None and (prev_rtt is None or new_rtt < prev_rtt):
            by_ip[row["ip"]] = row
    return list(by_ip.values())


def get_infra_entries(instances: list[tuple[str, str]] | None = None) -> list[dict]:
    """Aggregate dump_infra across all local Unbound instances.

    Returns a normalized, deduped list:
        [{ip, zone, provider, rtt_ms, ping_ms, lame, dnssec_lame, family}, ...]
    """
    targets = instances if instances is not None else INSTANCES
    collected: list[dict] = []
    for socket, conf in targets:
        text = _run_dump_infra(socket, conf)
        if not text:
            continue
        collected.extend(parse_dump_infra(text))

    deduped = _dedupe_best_rtt(collected)
    for row in deduped:
        row["provider"] = classify_provider(row["ip"], row["zone"])
    # Stable, useful default sort: provider then rtt asc (None last)
    deduped.sort(key=lambda r: (r["provider"], r["rtt_ms"] if r["rtt_ms"] is not None else 1e9))
    return deduped


# ── Live state + snapshot ──────────────────────────────────────────────────
# Honest "live CDN map" state. The dump_infra probe runs every ~60s and the
# state below remembers, per upstream IP we contacted, the last observation.
# Geo enrichment is opportunistic: we only ask the geoIP service for the TOP-N
# most relevant IPs per cycle and let the existing rate-limiter (10/min,
# 6h cache) absorb the load — never asking for everything (would be hundreds).

# Big-CDN priority for top-N geo enrichment. The label set MUST stay in sync
# with classify_provider().
_BIG_PROVIDERS = {
    "Cloudflare", "Akamai", "Google", "AWS", "Fastly",
    "Azure", "Microsoft", "Apple", "Meta", "Netflix",
}

# How many IPs to geo-resolve per cycle (top-N by relevance). The geoIP
# service caps at 10 HTTP calls/min globally and caches for 6h, so picking
# 8 here keeps a safety margin for the egress probe and other callers.
_GEO_TOPN_PER_CYCLE = 8

# Entries older than this are dropped from the snapshot.
_STALE_AFTER_S = 30 * 60

_STATE_LOCK = threading.Lock()
# ip -> {ip, zone, provider, rtt_ms, lame, dnssec_lame, family, last_seen, geo}
_STATE: dict[str, dict[str, Any]] = {}

# Track our own egress IP/geo for the map origin (independent of forward-addrs,
# since iterative mode has none).
_EGRESS_LOCK = threading.Lock()
_EGRESS: dict[str, Any] = {"ip": None, "ecs": None, "geo": None, "ts": 0.0}


def reset_state_for_tests() -> None:
    """Wipe in-memory state between unit tests."""
    with _STATE_LOCK:
        _STATE.clear()
    with _EGRESS_LOCK:
        _EGRESS.update({"ip": None, "ecs": None, "geo": None, "ts": 0.0})


def _relevance_score(row: dict[str, Any]) -> tuple[int, float]:
    """Lower score = more relevant (sort ascending)."""
    big = 0 if row.get("provider") in _BIG_PROVIDERS else 1
    rtt = row.get("rtt_ms")
    return (big, rtt if rtt is not None else 1e9)


def _refresh_egress() -> None:
    """Best-effort refresh of our own egress IP + geo.

    Uses the existing PoP probe (Google myaddr trick via dig). Read-only.
    The geoIP lookup itself is rate-limited and cached by egress_geo_service.
    """
    try:
        from app.services.upstream_probe_service import probe_pop
        from app.services.egress_geo_service import resolve_egress_geo
    except Exception:
        logger.debug("egress probe unavailable", exc_info=True)
        return

    # Try a couple of well-known external resolvers — even in iterative mode
    # the host has outbound DNS to public addresses. First success wins.
    for target in ("8.8.8.8", "1.1.1.1"):
        try:
            pop = probe_pop(target) or {}
        except Exception:
            continue
        egress_ip = pop.get("egress_ip")
        ecs = pop.get("ecs")
        if egress_ip or ecs:
            geo = resolve_egress_geo(egress_ip) if egress_ip else None
            with _EGRESS_LOCK:
                _EGRESS.update({"ip": egress_ip, "ecs": ecs, "geo": geo, "ts": time.time()})
            return


def run_probe_cycle(now: float | None = None) -> int:
    """Read dump_infra from every instance, refresh state, and opportunistically
    geo-resolve the top-N most relevant IPs. Returns the count of merged entries.
    Read-only.
    """
    ts = now if now is not None else time.time()
    entries = get_infra_entries()
    if not entries:
        return 0

    # Merge into state (keyed by IP, last write wins).
    with _STATE_LOCK:
        for row in entries:
            prev = _STATE.get(row["ip"]) or {}
            merged = {
                "ip": row["ip"],
                "zone": row["zone"],
                "provider": row["provider"],
                "rtt_ms": row.get("rtt_ms"),
                "lame": row.get("lame", False),
                "dnssec_lame": row.get("dnssec_lame", False),
                "family": row.get("family", "ipv4"),
                "last_seen": ts,
                # Keep any previously-resolved geo unless we never had one.
                "geo": prev.get("geo"),
            }
            _STATE[row["ip"]] = merged

        # Drop very stale entries to bound memory.
        stale_cut = ts - _STALE_AFTER_S
        for ip in [ip for ip, v in _STATE.items() if v["last_seen"] < stale_cut]:
            _STATE.pop(ip, None)

        # Snapshot the candidates needing geo, OUTSIDE the lock for the HTTP call.
        need_geo = [v for v in _STATE.values() if v.get("geo") is None]

    # Order by relevance, then enrich the top-N. resolve_egress_geo is itself
    # cached + rate-limited; we still bound the per-cycle ask to be a good
    # citizen and never starve other callers (egress probe, etc.).
    need_geo.sort(key=_relevance_score)
    try:
        from app.services.egress_geo_service import resolve_egress_geo
    except Exception:
        resolve_egress_geo = None  # type: ignore[assignment]

    if resolve_egress_geo is not None:
        for row in need_geo[:_GEO_TOPN_PER_CYCLE]:
            try:
                geo = resolve_egress_geo(row["ip"])
            except Exception:
                geo = None
            if geo is None:
                continue
            with _STATE_LOCK:
                cur = _STATE.get(row["ip"])
                if cur is not None:
                    cur["geo"] = geo

    # Refresh our own egress (cheap; geo is cached 6h).
    _refresh_egress()
    return len(entries)


def get_cdn_snapshot() -> dict[str, Any]:
    """Build the public snapshot returned by GET /api/network/cdns.

    Structure:
        {
          "ts": <epoch>,
          "egress": {"ip": ..., "ecs": ..., "geo": {...}|None} | None,
          "providers": [
            {
              "provider": "Cloudflare",
              "count": 42,
              "avg_rtt_ms": 18.2,
              "geo_count": 4,
              "entries": [{ip, zone, rtt_ms, lame, dnssec_lame, family, geo}, ...],
            }, ...
          ]
        }

    Providers are ordered by count desc (most-served first). Within a provider,
    entries are ordered by rtt asc.
    """
    now = time.time()
    with _STATE_LOCK:
        rows = [dict(v) for v in _STATE.values()]
    with _EGRESS_LOCK:
        eg_ip = _EGRESS["ip"]
        eg_ecs = _EGRESS["ecs"]
        eg_geo = _EGRESS["geo"]

    # Real per-instance egresses come from DnsInstance.outgoing_ip — that's
    # the ground truth (tcpdump confirms). The ECS-derived ".0" is just the
    # /24 block label observed by the world. Show both honestly.
    real_egress_ips: list[str] = []
    try:
        from app.core.database import SessionLocal
        from app.models.operational import DnsInstance
        db = SessionLocal()
        try:
            for inst in db.query(DnsInstance).all():
                ip = (inst.outgoing_ip or "").strip()
                if ip and ip not in real_egress_ips:
                    real_egress_ips.append(ip)
        finally:
            db.close()
    except Exception:
        logger.debug("could not read DnsInstance.outgoing_ip", exc_info=True)

    # Block label: prefer ECS (honest /24 the world sees); fallback to /24 of
    # any real egress IP we know.
    block_label: str | None = eg_ecs
    if not block_label and real_egress_ips:
        try:
            net = ipaddress.ip_network(f"{real_egress_ips[0]}/24", strict=False)
            block_label = str(net)
        except ValueError:
            block_label = None

    # Legacy "ip" field: avoid the misleading network address (".0") — use the
    # first real per-instance egress when available.
    legacy_ip = real_egress_ips[0] if real_egress_ips else eg_ip

    egress_block: dict[str, Any] | None
    if real_egress_ips or eg_ip or eg_ecs:
        egress_block = {
            "ip": legacy_ip,
            "block": block_label,
            "ips": real_egress_ips,
            "ecs": eg_ecs,
            "geo": eg_geo,
        }
    else:
        egress_block = None


    # Group by provider.
    buckets: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        buckets.setdefault(r["provider"], []).append({
            "ip": r["ip"],
            "zone": r["zone"],
            "rtt_ms": r.get("rtt_ms"),
            "lame": bool(r.get("lame")),
            "dnssec_lame": bool(r.get("dnssec_lame")),
            "family": r.get("family", "ipv4"),
            "geo": r.get("geo"),
        })

    providers: list[dict[str, Any]] = []
    for provider, items in buckets.items():
        items.sort(key=lambda x: x["rtt_ms"] if x["rtt_ms"] is not None else 1e9)
        rtts = [x["rtt_ms"] for x in items if x["rtt_ms"] is not None]
        providers.append({
            "provider": provider,
            "count": len(items),
            "avg_rtt_ms": round(sum(rtts) / len(rtts), 2) if rtts else None,
            "geo_count": sum(1 for x in items if x.get("geo")),
            "entries": items,
        })
    providers.sort(key=lambda p: (-p["count"], p["provider"]))

    return {"ts": now, "egress": egress_block, "providers": providers}
