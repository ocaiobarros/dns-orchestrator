"""
DNS Control — nftables Configuration Generator
Generates modular /etc/nftables.d/*.nft snippets matching production vdns-01 model.
Supports IPv4+IPv6, per-instance sticky sets, nth balancing, DNAT.
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


def _collect_egress_ips(instances: list[dict[str, Any]]) -> list[str]:
    return _dedupe([
        str(inst.get("exitIp", "")).strip() or str(inst.get("egressIpv4", "")).strip()
        for inst in instances
        if inst.get("exitIp") or inst.get("egressIpv4")
    ])


def _collect_service_vips(payload: dict[str, Any], nat: dict[str, Any]) -> list[dict[str, Any]]:
    raw_vips = nat.get("serviceVips") or payload.get("serviceVips") or []
    vips: list[dict[str, Any]] = []
    for vip in raw_vips:
        if not isinstance(vip, dict):
            continue
        ipv4 = str(vip.get("ipv4", "")).strip()
        if not ipv4:
            continue
        vips.append({
            "ipv4": ipv4,
            "ipv6": str(vip.get("ipv6", "")).strip(),
            "protocol": str(vip.get("protocol", "udp+tcp")).strip() or "udp+tcp",
            "port": int(vip.get("port", 53) or 53),
        })

    if vips:
        return vips

    primary_vip = str(payload.get("loopback", {}).get("vip", "")).strip()
    if primary_vip:
        return [{"ipv4": primary_vip, "ipv6": "", "protocol": "udp+tcp", "port": 53}]
    return []


def generate_nftables_config(payload: dict[str, Any], validation_mode: bool = False) -> list[dict]:
    """Generate modular nftables snippets in /etc/nftables.d/.
    Returns list of file dicts. For validation_mode, returns single monolithic file.
    """
    nat = payload.get("nat", {}) if isinstance(payload.get("nat", {}), dict) else {}
    instances = payload.get("instances", []) if isinstance(payload.get("instances", []), list) else []

    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    enable_ipv6 = payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False)

    distribution_policy = str(nat.get("distributionPolicy") or payload.get("distributionPolicy") or "round-robin")
    sticky_timeout_seconds = int(nat.get("stickyTimeout") or payload.get("stickyTimeout") or 1200)
    sticky_timeout_seconds = max(60, sticky_timeout_seconds)
    sticky_timeout_min = max(1, sticky_timeout_seconds // 60)

    service_vips = _collect_service_vips(payload, nat)
    backends = _collect_backends(instances)

    if validation_mode:
        return _generate_monolithic_validation(payload, service_vips, backends, enable_ipv6, distribution_policy, sticky_timeout_min)

    return _generate_modular(service_vips, backends, enable_ipv6, distribution_policy, sticky_timeout_min, payload)


def _generate_modular(
    service_vips: list[dict],
    backends: list[dict],
    enable_ipv6: bool,
    distribution_policy: str,
    sticky_timeout_min: int,
    payload: dict,
) -> list[dict]:
    """Generate /etc/nftables.d/*.nft modular snippets matching vdns-01 production layout."""
    files: list[dict] = []

    def _file(path: str, content: str):
        files.append({"path": path, "content": content, "permissions": "0644", "owner": "root:root"})

    # Master nftables.conf
    _file("/etc/nftables.conf", "#!/usr/sbin/nft -f\n\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n")

    # Tables
    _file("/etc/nftables.d/0002-table-ipv4-nat.nft", "create table ip nat")
    if enable_ipv6:
        _file("/etc/nftables.d/0003-table-ipv6-nat.nft", "create table ip6 nat")

    # PREROUTING hooks
    _file("/etc/nftables.d/0051-hook-ipv4-prerouting.nft",
          "    create chain ip nat PREROUTING {\n        type nat hook prerouting priority dstnat;\n        policy accept;\n    }")
    if enable_ipv6:
        _file("/etc/nftables.d/0052-hook-ipv6-prerouting.nft",
              "    create chain ip6 nat PREROUTING {\n        type nat hook prerouting priority dstnat;\n        policy accept;\n    }")

    # VIP definitions
    if service_vips:
        vip_ipv4s = ",\n    ".join(v["ipv4"] for v in service_vips if v.get("ipv4"))
        _file("/etc/nftables.d/5100-nat-define-anyaddr-ipv4.nft",
              f"define DNS_ANYCAST_IPV4 = {{\n    {vip_ipv4s}\n}}")

        if enable_ipv6:
            vip_ipv6s = [v["ipv6"] for v in service_vips if v.get("ipv6")]
            if vip_ipv6s:
                _file("/etc/nftables.d/5200-nat-define-anyaddr-ipv6.nft",
                      f"define DNS_ANYCAST_IPV6 = {{\n    {','.join(vip_ipv6s)}\n}}")

    # DNS dispatch chains
    for proto in ("tcp", "udp"):
        suffix = "2" if proto == "tcp" else "3"
        _file(f"/etc/nftables.d/510{suffix}-nat-chain-ipv4_{proto}_dns.nft",
              f"add chain ip  nat ipv4_{proto}_dns")

    # PREROUTING capture rules
    for proto in ("tcp", "udp"):
        suffix = "1" if proto == "tcp" else "2"
        _file(f"/etc/nftables.d/511{suffix}-nat-rule-ipv4_{proto}_dns.nft",
              f"add rule ip  nat PREROUTING ip daddr $DNS_ANYCAST_IPV4 {proto} dport 53 counter packets 0 bytes 0 jump ipv4_{proto}_dns")

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
                  f"add set ip nat {subusers} {{ type ipv4_addr; counter; size 8192; flags dynamic, timeout; timeout {sticky_timeout_min}m; }}")
            _file(f"/etc/nftables.d/{ruleid}-nat-chain-{subchain}.nft",
                  f"add chain ip nat {subchain}")
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
                      f"add set ip6 nat {subusers} {{ type ipv6_addr; counter; size 8192; flags dynamic, timeout; timeout {sticky_timeout_min}m; }}")
                _file(f"/etc/nftables.d/{ruleid}-nat-chain-{subchain}.nft",
                      f"add chain ip6 nat {subchain}")
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
            _file(f"/etc/nftables.d/{ruleid}-nat-rule-action-ipv4_dns_{proto}_{name}.nft", content)
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
                    f"add rule ip6 nat {subchain} {proto} dport 53 counter dnat to {bind_ipv6}:53",
                ])
                _file(f"/etc/nftables.d/{ruleid}-nat-rule-action-ipv6_dns_{proto}_{name}.nft", content)
                ruleid += 1

    # Memorized source rules (IPv4): sticky clients jump to their assigned backend
    ruleid = 7001
    for backend in backends:
        name = backend["name"]
        for proto in ("tcp", "udp"):
            topchain = f"ipv4_{proto}_dns"
            subchain = f"ipv4_dns_{proto}_{name}"
            subusers = f"ipv4_users_{name}"
            _file(f"/etc/nftables.d/{ruleid}-nat-rule-memorized-ipv4_dns_{proto}_{name}.nft",
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
                _file(f"/etc/nftables.d/{ruleid}-nat-rule-memorized-ipv6_dns_{proto}_{name}.nft",
                      f"add rule ip6 nat {topchain} ip6 saddr @{subusers} counter jump {subchain}")
                ruleid += 1

    # Nth balancing fallback (IPv4): numgen inc mod N with decreasing N
    ruleid = 7201
    for proto in ("tcp", "udp"):
        rand_num = len(backends)
        for backend in backends:
            name = backend["name"]
            topchain = f"ipv4_{proto}_dns"
            subchain = f"ipv4_dns_{proto}_{name}"
            _file(f"/etc/nftables.d/{ruleid}-nat-rule-memorized-ipv4_dns_{proto}_{name}.nft",
                  f"add rule ip nat {topchain} numgen inc mod {rand_num} 0 counter jump {subchain}")
            ruleid += 1
            rand_num -= 1

    # Nth balancing fallback (IPv6)
    if enable_ipv6:
        ruleid = 7301
        ipv6_backends = [b for b in backends if b.get("ipv6")]
        for proto in ("tcp", "udp"):
            rand_num = len(ipv6_backends)
            for backend in ipv6_backends:
                name = backend["name"]
                topchain = f"ipv6_{proto}_dns"
                subchain = f"ipv6_dns_{proto}_{name}"
                _file(f"/etc/nftables.d/{ruleid}-nat-rule-memorized-ipv6_dns_{proto}_{name}.nft",
                      f"add rule ip6 nat {topchain} numgen inc mod {rand_num} 0 counter jump {subchain}")
                ruleid += 1
                rand_num -= 1

    return files


def _generate_monolithic_validation(
    payload: dict[str, Any],
    service_vips: list[dict],
    backends: list[dict],
    enable_ipv6: bool,
    distribution_policy: str,
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
            lines.append(f"    set ipv4_users_{name} {{ type ipv4_addr; counter; size 8192; flags dynamic, timeout; timeout {sticky_timeout_min}m; }}")

    # Backend chains
    for backend in backends:
        name = backend["name"]
        bind_ip = backend["ipv4"]
        for proto in ("tcp", "udp"):
            subchain = f"ipv4_dns_{proto}_{name}"
            lines.append(f"    chain {subchain} {{")
            lines.append(f"        {proto} dport 53 counter dnat to {bind_ip}:53")
            lines.append("    }")

    # Dispatch chains
    for proto in ("tcp", "udp"):
        lines.append(f"    chain ipv4_{proto}_dns {{")
        rand_num = len(backends)
        for backend in backends:
            subchain = f"ipv4_dns_{proto}_{backend['name']}"
            lines.append(f"        numgen inc mod {rand_num} 0 counter jump {subchain}")
            rand_num -= 1
        lines.append("    }")

    lines.append("}")
    lines.append("")

    return [{
        "path": "/etc/nftables.validate.conf",
        "content": "\n".join(lines),
        "permissions": "0644",
        "owner": "root:root",
    }]
