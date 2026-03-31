"""
DNS Control — nftables Configuration Generator
Generates modular /etc/nftables.d/*.nft snippets matching production tutorial model.
Supports IPv4+IPv6, per-instance sticky sets, nth balancing, DNAT.

Architecture: ALL service VIPs (including intercepted/anycast VIPs) are defined in
DNS_ANYCAST_IPV4/IPV6 and balanced across ALL backends via sticky source affinity
+ nth balancing. There are NO 1:1 VIP-to-backend chains.
"""

from typing import Any


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        if item and item not in seen:
            ordered.append(item)
            seen.add(item)
    return ordered


def _collect_backends(instances: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Return list of {name, ipv4, ipv6} per instance."""
    backends = []
    for inst in instances:
        bind_ip = str(inst.get("bindIp", "")).strip()
        if bind_ip:
            backends.append({
                "name": inst.get("name", "unbound"),
                "ipv4": bind_ip,
                "ipv6": str(inst.get("bindIpv6", "")).strip(),
            })
    return backends


def _collect_all_vip_ips(payload: dict[str, Any], nat: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Collect ALL VIP IPv4 and IPv6 addresses from serviceVips AND interceptedVips.
    In the production model, intercepted VIPs (e.g. 4.2.2.5, 4.2.2.6) are treated
    identically to service VIPs — they all go into DNS_ANYCAST_IPV4/IPV6 and are
    balanced across all backends.
    """
    ipv4s: list[str] = []
    ipv6s: list[str] = []

    # Service VIPs
    raw_vips = nat.get("serviceVips") or payload.get("serviceVips") or []
    for vip in raw_vips:
        if not isinstance(vip, dict):
            continue
        ipv4 = str(vip.get("ipv4", "")).strip()
        if ipv4:
            ipv4s.append(ipv4)
        ipv6 = str(vip.get("ipv6", "")).strip()
        if ipv6:
            ipv6s.append(ipv6)

    # Intercepted VIPs — merged into the same pool
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    intercepted = payload.get("interceptedVips") or wizard_cfg.get("interceptedVips") or []
    for vip in intercepted:
        if not isinstance(vip, dict):
            continue
        vip_ip = str(vip.get("vipIp", "")).strip()
        if vip_ip and vip_ip not in ipv4s:
            ipv4s.append(vip_ip)
        vip_ipv6 = str(vip.get("vipIpv6", "")).strip()
        if vip_ipv6 and vip_ipv6 not in ipv6s:
            ipv6s.append(vip_ipv6)

    # Fallback: loopback VIP
    if not ipv4s:
        primary_vip = str(payload.get("loopback", {}).get("vip", "")).strip()
        if primary_vip:
            ipv4s.append(primary_vip)

    return _dedupe(ipv4s), _dedupe(ipv6s)


def generate_nftables_config(payload: dict[str, Any], validation_mode: bool = False) -> list[dict]:
    """Generate modular nftables snippets in /etc/nftables.d/.
    Returns list of file dicts. For validation_mode, returns single monolithic file.
    """
    nat = payload.get("nat", {}) if isinstance(payload.get("nat", {}), dict) else {}
    instances = payload.get("instances", []) if isinstance(payload.get("instances", []), list) else []

    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    enable_ipv6 = payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False)

    sticky_timeout_seconds = int(nat.get("stickyTimeout") or payload.get("stickyTimeout") or 1200)
    sticky_timeout_seconds = max(60, sticky_timeout_seconds)
    sticky_timeout_min = max(1, sticky_timeout_seconds // 60)

    vip_ipv4s, vip_ipv6s = _collect_all_vip_ips(payload, nat)
    backends = _collect_backends(instances)

    if validation_mode:
        return _generate_monolithic_validation(vip_ipv4s, backends, enable_ipv6, sticky_timeout_min)

    return _generate_modular(vip_ipv4s, vip_ipv6s, backends, enable_ipv6, sticky_timeout_min)


def _generate_modular(
    vip_ipv4s: list[str],
    vip_ipv6s: list[str],
    backends: list[dict],
    enable_ipv6: bool,
    sticky_timeout_min: int,
) -> list[dict]:
    """Generate /etc/nftables.d/*.nft modular snippets matching production layout.
    ALL VIPs are balanced across ALL backends via sticky source + nth.
    """
    files: list[dict] = []

    def _file(path: str, content: str):
        files.append({"path": path, "content": content, "permissions": "0644", "owner": "root:root"})

    # Master nftables.conf
    _file("/etc/nftables.conf", "#!/usr/sbin/nft -f\n\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n")

    # Tables
    _file("/etc/nftables.d/0002-table-ipv4-nat.nft", "add table ip nat\n")
    if enable_ipv6:
        _file("/etc/nftables.d/0003-table-ipv6-nat.nft", "add table ip6 nat\n")

    # PREROUTING hooks (top-level — no indentation)
    _file("/etc/nftables.d/0051-hook-ipv4-prerouting.nft",
          "add chain ip nat PREROUTING { type nat hook prerouting priority dstnat; policy accept; }\n")
    if enable_ipv6:
        _file("/etc/nftables.d/0052-hook-ipv6-prerouting.nft",
              "add chain ip6 nat PREROUTING { type nat hook prerouting priority dstnat; policy accept; }\n")

    # VIP definitions — ALL VIPs (service + intercepted) in one define (single line)
    if vip_ipv4s:
        vip_list = ", ".join(vip_ipv4s)
        _file("/etc/nftables.d/5100-nat-define-anyaddr-ipv4.nft",
              f"define DNS_ANYCAST_IPV4 = {{ {vip_list} }}\n")

    if enable_ipv6 and vip_ipv6s:
        vip6_list = ", ".join(vip_ipv6s)
        _file("/etc/nftables.d/5200-nat-define-anyaddr-ipv6.nft",
              f"define DNS_ANYCAST_IPV6 = {{ {vip6_list} }}\n")

    # DNS dispatch chains (IPv4)
    for proto in ("tcp", "udp"):
        suffix = "2" if proto == "tcp" else "3"
        _file(f"/etc/nftables.d/510{suffix}-nat-chain-ipv4_{proto}_dns.nft",
              f"add chain ip nat ipv4_{proto}_dns {{}}\n")

    # PREROUTING capture rules (IPv4)
    for proto in ("tcp", "udp"):
        suffix = "1" if proto == "tcp" else "2"
        _file(f"/etc/nftables.d/511{suffix}-nat-rule-ipv4_{proto}_dns.nft",
              f"add rule ip nat PREROUTING ip daddr $DNS_ANYCAST_IPV4 {proto} dport 53 counter packets 0 bytes 0 jump ipv4_{proto}_dns\n")

    # IPv6 dispatch chains + capture rules
    if enable_ipv6:
        for proto in ("tcp", "udp"):
            suffix = "2" if proto == "tcp" else "3"
            _file(f"/etc/nftables.d/520{suffix}-nat-chain-ipv6_{proto}_dns.nft",
                  f"add chain ip6 nat ipv6_{proto}_dns")
        for proto in ("tcp", "udp"):
            suffix = "1" if proto == "tcp" else "2"
            _file(f"/etc/nftables.d/521{suffix}-nat-rule-ipv6_{proto}_dns.nft",
                  f"add rule ip6 nat PREROUTING ip6 daddr $DNS_ANYCAST_IPV6 {proto} dport 53 counter packets 0 bytes 0 jump ipv6_{proto}_dns")

    # Per-instance: sticky sets + backend chains (IPv4)
    ruleid = 6001
    for backend in backends:
        name = backend["name"]
        for proto in ("tcp", "udp"):
            subusers = f"ipv4_users_{name}"
            subchain = f"ipv4_dns_{proto}_{name}"
            _file(f"/etc/nftables.d/{ruleid}-nat-addrlist-{subusers}.nft",
                  f"add set ip nat {subusers} {{ type ipv4_addr; size 8192; flags dynamic, timeout; timeout {sticky_timeout_min}m; }}")
            _file(f"/etc/nftables.d/{ruleid}-nat-chain-{subchain}.nft",
                  f"add chain ip nat {subchain} {{}}")
            ruleid += 1

    # Per-instance: sticky sets + backend chains (IPv6)
    if enable_ipv6:
        ruleid = 6101
        for backend in backends:
            name = backend["name"]
            if not backend.get("ipv6"):
                continue
            for proto in ("tcp", "udp"):
                subusers = f"ipv6_users_{name}"
                subchain = f"ipv6_dns_{proto}_{name}"
                _file(f"/etc/nftables.d/{ruleid}-nat-addrlist-{subusers}.nft",
                      f"add set ip6 nat {subusers} {{ type ipv6_addr; size 8192; flags dynamic, timeout; timeout {sticky_timeout_min}m; }}")
                _file(f"/etc/nftables.d/{ruleid}-nat-chain-{subchain}.nft",
                      f"add chain ip6 nat {subchain} {{}}")
                ruleid += 1

    # Action rules: add to set + update + DNAT (IPv4)
    ruleid = 6201
    for backend in backends:
        name = backend["name"]
        bind_ip = backend["ipv4"]
        for proto in ("tcp", "udp"):
            subchain = f"ipv4_dns_{proto}_{name}"
            subusers = f"ipv4_users_{name}"
            content = "\n".join([
                f"add rule ip nat {subchain} add @{subusers} {{ ip saddr }} counter",
                f"add rule ip nat {subchain} set update ip saddr timeout 0s @{subusers} counter",
                f"add rule ip nat {subchain} {proto} dport 53 counter dnat to {bind_ip}:53",
            ])
            _file(f"/etc/nftables.d/{ruleid}-nat-rule-action-{subchain}.nft", content)
            ruleid += 1

    # Action rules: add to set + update + DNAT (IPv6)
    if enable_ipv6:
        ruleid = 6301
        for backend in backends:
            name = backend["name"]
            bind_ipv6 = backend.get("ipv6", "")
            if not bind_ipv6:
                continue
            for proto in ("tcp", "udp"):
                subchain = f"ipv6_dns_{proto}_{name}"
                subusers = f"ipv6_users_{name}"
                content = "\n".join([
                    f"add rule ip6 nat {subchain} add @{subusers} {{ ip6 saddr }} counter",
                    f"add rule ip6 nat {subchain} set update ip6 saddr timeout 0s @{subusers} counter",
                    f"add rule ip6 nat {subchain} {proto} dport 53 counter dnat to [{bind_ipv6}]:53",
                ])
                _file(f"/etc/nftables.d/{ruleid}-nat-rule-action-{subchain}.nft", content)
                ruleid += 1

    # Memorized source rules (IPv4): sticky clients jump to their assigned backend
    ruleid = 7001
    for backend in backends:
        name = backend["name"]
        for proto in ("tcp", "udp"):
            topchain = f"ipv4_{proto}_dns"
            subchain = f"ipv4_dns_{proto}_{name}"
            subusers = f"ipv4_users_{name}"
            _file(f"/etc/nftables.d/{ruleid}-nat-rule-memorized-{subchain}.nft",
                  f"add rule ip nat {topchain} ip saddr @{subusers} counter jump {subchain}")
            ruleid += 1

    # Memorized source rules (IPv6)
    if enable_ipv6:
        ruleid = 7101
        for backend in backends:
            name = backend["name"]
            if not backend.get("ipv6"):
                continue
            for proto in ("tcp", "udp"):
                topchain = f"ipv6_{proto}_dns"
                subchain = f"ipv6_dns_{proto}_{name}"
                subusers = f"ipv6_users_{name}"
                _file(f"/etc/nftables.d/{ruleid}-nat-rule-memorized-{subchain}.nft",
                      f"add rule ip6 nat {topchain} ip6 saddr @{subusers} counter jump {subchain}")
                ruleid += 1

    # Nth balancing fallback (IPv4): numgen inc mod N with decrementing N
    # Matches production reference: mod 4 → mod 3 → mod 2 → mod 1
    ruleid = 7201
    for proto in ("tcp", "udp"):
        topchain = f"ipv4_{proto}_dns"
        num_backends = len(backends)
        for idx, backend in enumerate(backends):
            mod_val = num_backends - idx
            subchain = f"ipv4_dns_{proto}_{backend['name']}"
            _file(f"/etc/nftables.d/{ruleid}-nat-rule-memorized-{subchain}.nft",
                  f"add rule ip nat {topchain} numgen inc mod {mod_val} 0 counter jump {subchain}")
            ruleid += 1

    # Nth balancing fallback (IPv6): numgen inc mod N with decrementing N
    if enable_ipv6:
        ruleid = 7301
        ipv6_backends = [b for b in backends if b.get("ipv6")]
        num_backends_v6 = len(ipv6_backends)
        for proto in ("tcp", "udp"):
            topchain_v6 = f"ipv6_{proto}_dns"
            for idx, backend in enumerate(ipv6_backends):
                mod_val = num_backends_v6 - idx
                subchain = f"ipv6_dns_{proto}_{backend['name']}"
                _file(f"/etc/nftables.d/{ruleid}-nat-rule-memorized-{subchain}.nft",
                      f"add rule ip6 nat {topchain_v6} numgen inc mod {mod_val} 0 counter jump {subchain}")
                ruleid += 1

    return files


def _generate_monolithic_validation(
    vip_ipv4s: list[str],
    backends: list[dict],
    enable_ipv6: bool,
    sticky_timeout_min: int,
) -> list[dict]:
    """Generate single monolithic file for nft -c -f validation (no flush ruleset)."""
    lines: list[str] = [
        "#!/usr/sbin/nft -f",
        "# DNS Control — nftables validation artifact",
        "# flush ruleset  (removed for validation)",
        "",
        "table ip nat {",
        "    chain PREROUTING {",
        "        type nat hook prerouting priority dstnat; policy accept;",
        "    }",
    ]

    # Sets
    for backend in backends:
        name = backend["name"]
        for proto in ("tcp", "udp"):
            lines.append(f"    set ipv4_users_{name} {{ type ipv4_addr; size 8192; flags dynamic, timeout; timeout {sticky_timeout_min}m; }}")

    # Backend chains
    for backend in backends:
        name = backend["name"]
        bind_ip = backend["ipv4"]
        for proto in ("tcp", "udp"):
            subchain = f"ipv4_dns_{proto}_{name}"
            lines.append(f"    chain {subchain} {{")
            lines.append(f"        {proto} dport 53 counter dnat to {bind_ip}:53")
            lines.append("    }")

    # Dispatch chains with vmap
    for proto in ("tcp", "udp"):
        lines.append(f"    chain ipv4_{proto}_dns {{")
        vmap_entries = ", ".join(
            f"{i} : jump ipv4_dns_{proto}_{b['name']}" for i, b in enumerate(backends)
        )
        lines.append(f"        numgen inc mod {len(backends)} vmap {{ {vmap_entries} }}")
        lines.append("    }")

    lines.append("}")
    lines.append("")

    return [{
        "path": "/etc/nftables.validate.conf",
        "content": "\n".join(lines),
        "permissions": "0644",
        "owner": "root:root",
    }]
