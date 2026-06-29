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
from typing import Iterable

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
    # Some zones come like "root-servers.net." — keep as Root only on bare ".".
    if z in _TLD_HINTS or (len(z) <= 5 and z.endswith(".")):
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
