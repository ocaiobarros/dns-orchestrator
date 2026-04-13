"""
DNS Control — nftables Configuration Generator (Interception Mode)
Generates modular /etc/nftables.d/*.nft snippets for DNS interception via DNAT.

Architecture: ALL service VIPs (including intercepted/anycast VIPs) are defined in
DNS_ANYCAST_IPV4/IPV6 and balanced across ALL backends via sticky source affinity
+ nth balancing (numgen inc mod N decrementing).

File ordering convention (lexicographic include):
  0002  table ip nat (empty, additive)
  0003  table ip6 nat (empty, additive)
  0051  PREROUTING hook
  0052  IPv6 PREROUTING hook
  0053  OUTPUT hook (local interception)
  0060  filter table IPv4 (EDGE ACL)
  0061  filter table IPv6 (EDGE ACL)
  5100  define DNS_ANYCAST_IPV4
  5200  define DNS_ANYCAST_IPV6
  5102  dispatch chain ipv4_tcp_dns
  5103  dispatch chain ipv4_udp_dns
  5111  PREROUTING capture rule tcp
  5112  PREROUTING capture rule udp
  5113  OUTPUT capture rule tcp (local interception)
  5114  OUTPUT capture rule udp (local interception)
  6001+ sticky sets + backend chains
  6201+ action rules (add, update, DNAT)
  7001+ memorized-source rules
  7201+ nth balancing rules

All snippets use block syntax: table ip nat { ... }
Compatible with Debian 13 nft -f atomic load.
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
    """Collect ALL VIP IPv4 and IPv6 addresses from serviceVips AND interceptedVips."""
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
    """Generate modular nftables snippets in /etc/nftables.d/."""
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

    files = _generate_modular(vip_ipv4s, vip_ipv6s, backends, enable_ipv6, sticky_timeout_min)

    # ═══ TABLE FILTER — EDGE ACL ═══
    files.extend(_generate_filter_table(payload, enable_ipv6))

    return files


def _generate_modular(
    vip_ipv4s: list[str],
    vip_ipv6s: list[str],
    backends: list[dict],
    enable_ipv6: bool,
    sticky_timeout_min: int,
) -> list[dict]:
    """Generate /etc/nftables.d/*.nft modular snippets using block syntax.
    All snippets wrapped in table ip nat { ... } for Debian 13 compatibility.
    """
    files: list[dict] = []

    def _file(path: str, content: str):
        files.append({"path": path, "content": content, "permissions": "0644", "owner": "root:root"})

    # ── Master nftables.conf ──
    _file("/etc/nftables.conf", "#!/usr/sbin/nft -f\n\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n")

    # ── Tables (empty, additive) ──
    _file("/etc/nftables.d/0002-table-ipv4-nat.nft", "table ip nat {\n}\n")
    if enable_ipv6:
        _file("/etc/nftables.d/0003-table-ipv6-nat.nft", "table ip6 nat {\n}\n")

    # ── PREROUTING hooks (block syntax) ──
    _file("/etc/nftables.d/0051-hook-ipv4-prerouting.nft",
          "table ip nat {\n    chain PREROUTING {\n        type nat hook prerouting priority dstnat; policy accept;\n    }\n}\n")
    if enable_ipv6:
        _file("/etc/nftables.d/0052-hook-ipv6-prerouting.nft",
              "table ip6 nat {\n    chain PREROUTING {\n        type nat hook prerouting priority dstnat; policy accept;\n    }\n}\n")

    # ── OUTPUT hook (local interception — captures DNS from host itself) ──
    _file("/etc/nftables.d/0053-hook-ipv4-output.nft",
          "table ip nat {\n    chain OUTPUT {\n        type nat hook output priority dstnat; policy accept;\n    }\n}\n")
    if enable_ipv6:
        _file("/etc/nftables.d/0054-hook-ipv6-output.nft",
              "table ip6 nat {\n    chain OUTPUT {\n        type nat hook output priority dstnat; policy accept;\n    }\n}\n")

    # ── VIP definitions ──
    if vip_ipv4s:
        vip_lines = ", ".join(vip_ipv4s)
        _file("/etc/nftables.d/5100-nat-define-anyaddr-ipv4.nft",
              f"define DNS_ANYCAST_IPV4 = {{ {vip_lines} }}\n")

    if enable_ipv6 and vip_ipv6s:
        vip6_lines = ", ".join(vip_ipv6s)
        _file("/etc/nftables.d/5200-nat-define-anyaddr-ipv6.nft",
              f"define DNS_ANYCAST_IPV6 = {{ {vip6_lines} }}\n")

    # ── DNS dispatch chains (IPv4, empty, block syntax) ──
    for proto in ("tcp", "udp"):
        suffix = "2" if proto == "tcp" else "3"
        _file(f"/etc/nftables.d/510{suffix}-nat-chain-ipv4_{proto}_dns.nft",
              f"table ip nat {{\n    chain ipv4_{proto}_dns {{\n    }}\n}}\n")

    # ── PREROUTING capture rules (IPv4, block syntax) ──
    for proto in ("tcp", "udp"):
        suffix = "1" if proto == "tcp" else "2"
        _file(f"/etc/nftables.d/511{suffix}-nat-rule-ipv4_{proto}_dns.nft",
              f"table ip nat {{\n    chain PREROUTING {{\n        ip daddr $DNS_ANYCAST_IPV4 {proto} dport 53 counter packets 0 bytes 0 jump ipv4_{proto}_dns\n    }}\n}}\n")

    # ── OUTPUT capture rules (IPv4, local interception, block syntax) ──
    for proto in ("tcp", "udp"):
        suffix = "3" if proto == "tcp" else "4"
        _file(f"/etc/nftables.d/511{suffix}-nat-rule-output-ipv4_{proto}_dns.nft",
              f"table ip nat {{\n    chain OUTPUT {{\n        ip daddr $DNS_ANYCAST_IPV4 {proto} dport 53 counter packets 0 bytes 0 jump ipv4_{proto}_dns\n    }}\n}}\n")

    # ── IPv6 dispatch chains + capture rules ──
    if enable_ipv6:
        for proto in ("tcp", "udp"):
            suffix = "2" if proto == "tcp" else "3"
            _file(f"/etc/nftables.d/520{suffix}-nat-chain-ipv6_{proto}_dns.nft",
                  f"table ip6 nat {{\n    chain ipv6_{proto}_dns {{\n    }}\n}}\n")

        for proto in ("tcp", "udp"):
            suffix = "1" if proto == "tcp" else "2"
            _file(f"/etc/nftables.d/521{suffix}-nat-rule-ipv6_{proto}_dns.nft",
                  f"table ip6 nat {{\n    chain PREROUTING {{\n        ip6 daddr $DNS_ANYCAST_IPV6 {proto} dport 53 counter packets 0 bytes 0 jump ipv6_{proto}_dns\n    }}\n}}\n")

        for proto in ("tcp", "udp"):
            suffix = "3" if proto == "tcp" else "4"
            _file(f"/etc/nftables.d/521{suffix}-nat-rule-output-ipv6_{proto}_dns.nft",
                  f"table ip6 nat {{\n    chain OUTPUT {{\n        ip6 daddr $DNS_ANYCAST_IPV6 {proto} dport 53 counter packets 0 bytes 0 jump ipv6_{proto}_dns\n    }}\n}}\n")

    # ── Per-instance: sticky sets + backend chains (IPv4, block syntax) ──
    ruleid = 6001
    for backend in backends:
        name = backend["name"]
        for proto in ("tcp", "udp"):
            subusers = f"ipv4_users_{name}"
            subchain = f"ipv4_dns_{proto}_{name}"
            # Set definition inside table block (multi-line)
            _file(f"/etc/nftables.d/{ruleid}-nat-addrlist-{subusers}.nft",
                  "\n".join([
                      "table ip nat {",
                      f"    set {subusers} {{",
                      f"        type ipv4_addr",
                      f"        size 8192",
                      f"        flags dynamic, timeout",
                      f"        timeout {sticky_timeout_min}m",
                      f"    }}",
                      "}",
                  ]) + "\n")
            # Chain inside table block
            _file(f"/etc/nftables.d/{ruleid}-nat-chain-{subchain}.nft",
                  f"table ip nat {{\n    chain {subchain} {{\n    }}\n}}\n")
            ruleid += 1

    # ── Per-instance: sticky sets + backend chains (IPv6, block syntax) ──
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
                      "\n".join([
                          "table ip6 nat {",
                          f"    set {subusers} {{",
                          f"        type ipv6_addr",
                          f"        size 8192",
                          f"        flags dynamic, timeout",
                          f"        timeout {sticky_timeout_min}m",
                          f"    }}",
                          "}",
                      ]) + "\n")
                _file(f"/etc/nftables.d/{ruleid}-nat-chain-{subchain}.nft",
                      f"table ip6 nat {{\n    chain {subchain} {{\n    }}\n}}\n")
                ruleid += 1

    # ── Action rules: add + update + DNAT (IPv4, block syntax) ──
    ruleid = 6201
    for backend in backends:
        name = backend["name"]
        bind_ip = backend["ipv4"]
        for proto in ("tcp", "udp"):
            subchain = f"ipv4_dns_{proto}_{name}"
            subusers = f"ipv4_users_{name}"
            _file(f"/etc/nftables.d/{ruleid}-nat-rule-action-{subchain}.nft",
                  "\n".join([
                      "table ip nat {",
                      f"    chain {subchain} {{",
                      f"        add @{subusers} {{ ip saddr }} counter",
                      f"        set update ip saddr timeout 0s @{subusers} counter",
                      f"        {proto} dport 53 counter dnat to {bind_ip}:53",
                      "    }",
                      "}",
                  ]) + "\n")
            ruleid += 1

    # ── Action rules: add + update + DNAT (IPv6, block syntax) ──
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
                _file(f"/etc/nftables.d/{ruleid}-nat-rule-action-{subchain}.nft",
                      "\n".join([
                          "table ip6 nat {",
                          f"    chain {subchain} {{",
                          f"        add @{subusers} {{ ip6 saddr }} counter",
                          f"        set update ip6 saddr timeout 0s @{subusers} counter",
                          f"        {proto} dport 53 counter dnat to [{bind_ipv6}]:53",
                          "    }",
                          "}",
                      ]) + "\n")
                ruleid += 1

    # ── Memorized source rules (IPv4, block syntax) ──
    ruleid = 7001
    for backend in backends:
        name = backend["name"]
        for proto in ("tcp", "udp"):
            topchain = f"ipv4_{proto}_dns"
            subchain = f"ipv4_dns_{proto}_{name}"
            subusers = f"ipv4_users_{name}"
            _file(f"/etc/nftables.d/{ruleid}-nat-rule-memorized-{subchain}.nft",
                  f"table ip nat {{\n    chain {topchain} {{\n        ip saddr @{subusers} counter jump {subchain}\n    }}\n}}\n")
            ruleid += 1

    # ── Memorized source rules (IPv6, block syntax) ──
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
                      f"table ip6 nat {{\n    chain {topchain} {{\n        ip6 saddr @{subusers} counter jump {subchain}\n    }}\n}}\n")
                ruleid += 1

    # ── Nth balancing: numgen inc mod N decrementing (Part1 pattern, block syntax) ──
    num_backends = len(backends)

    # IPv4
    ruleid = 7201
    for proto in ("tcp", "udp"):
        topchain = f"ipv4_{proto}_dns"
        randnum = num_backends
        for backend in backends:
            name = backend["name"]
            subchain = f"ipv4_dns_{proto}_{name}"
            _file(f"/etc/nftables.d/{ruleid}-nat-rule-nth-ipv4_{proto}_dns_{name}.nft",
                  f"table ip nat {{\n    chain {topchain} {{\n        numgen inc mod {randnum} 0 counter packets 0 bytes 0 jump {subchain}\n    }}\n}}\n")
            ruleid += 1
            randnum -= 1

    # IPv6
    if enable_ipv6:
        ipv6_backends = [b for b in backends if b.get("ipv6")]
        num_v6 = len(ipv6_backends)
        ruleid = 7301
        for proto in ("tcp", "udp"):
            randnum = num_v6
            for backend in ipv6_backends:
                name = backend["name"]
                subchain = f"ipv6_dns_{proto}_{name}"
                _file(f"/etc/nftables.d/{ruleid}-nat-rule-nth-ipv6_{proto}_dns_{name}.nft",
                      f"table ip6 nat {{\n    chain {topchain} {{\n        numgen inc mod {randnum} 0 counter packets 0 bytes 0 jump {subchain}\n    }}\n}}\n")
                ruleid += 1
                randnum -= 1

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
        "# DNS Control — nftables interception validation artifact",
        "# flush ruleset  (removed for validation)",
        "",
        "table ip nat {",
    ]

    # Sets with counter
    for backend in backends:
        name = backend["name"]
        lines.append(f"    set ipv4_users_{name} {{")
        lines.append(f"        type ipv4_addr")
        lines.append(f"        size 8192")
        lines.append(f"        flags dynamic, timeout")
        lines.append(f"        timeout {sticky_timeout_min}m")
        lines.append(f"    }}")

    # Backend chains
    for backend in backends:
        name = backend["name"]
        bind_ip = backend["ipv4"]
        for proto in ("tcp", "udp"):
            subchain = f"ipv4_dns_{proto}_{name}"
            subusers = f"ipv4_users_{name}"
            lines.append(f"    chain {subchain} {{")
            lines.append(f"        add @{subusers} {{ ip saddr }} counter")
            lines.append(f"        set update ip saddr timeout 0s @{subusers} counter")
            lines.append(f"        {proto} dport 53 counter dnat to {bind_ip}:53")
            lines.append("    }")

    # Dispatch chains with sticky + numgen inc mod N decrementing
    num_backends = len(backends)
    for proto in ("tcp", "udp"):
        lines.append(f"    chain ipv4_{proto}_dns {{")
        # Sticky memorized
        for backend in backends:
            name = backend["name"]
            lines.append(f"        ip saddr @ipv4_users_{name} counter jump ipv4_dns_{proto}_{name}")
        # Nth balancing
        randnum = num_backends
        for backend in backends:
            name = backend["name"]
            subchain = f"ipv4_dns_{proto}_{name}"
            lines.append(f"        numgen inc mod {randnum} 0 counter jump {subchain}")
            randnum -= 1
        lines.append("    }")

    # PREROUTING hook
    lines.append("    chain PREROUTING {")
    lines.append("        type nat hook prerouting priority dstnat; policy accept;")
    vip_str = ", ".join(vip_ipv4s) if vip_ipv4s else "127.0.0.1"
    for proto in ("tcp", "udp"):
        lines.append(f"        ip daddr {{ {vip_str} }} {proto} dport 53 counter jump ipv4_{proto}_dns")
    lines.append("    }")

    # OUTPUT hook (local interception)
    lines.append("    chain OUTPUT {")
    lines.append("        type nat hook output priority dstnat; policy accept;")
    for proto in ("tcp", "udp"):
        lines.append(f"        ip daddr {{ {vip_str} }} {proto} dport 53 counter jump ipv4_{proto}_dns")
    lines.append("    }")

    lines.append("}")
    lines.append("")

    return [{
        "path": "/etc/nftables.validate.conf",
        "content": "\n".join(lines),
        "permissions": "0644",
        "owner": "root:root",
    }]


def _generate_filter_table(payload: dict[str, Any], enable_ipv6: bool) -> list[dict]:
    """Generate table ip filter / table ip6 filter with INPUT chain for DNS ACL.
    Security boundary: access control is enforced at nftables EDGE before DNAT.
    Unbound remains 0.0.0.0/0 allow — it trusts nftables to filter.
    In legacy mode, no filter table is generated (reproduces Part1/Part2 runtime).
    """
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    security_profile = payload.get("securityProfile") or wizard_cfg.get("securityProfile", "legacy")
    if security_profile == "legacy":
        return []

    files: list[dict] = []

    acl_ipv4 = payload.get("accessControlIpv4") or wizard_cfg.get("accessControlIpv4") or []
    acl_ipv6 = payload.get("accessControlIpv6") or wizard_cfg.get("accessControlIpv6") or []
    enable_rate_limit = payload.get("enableDnsProtection") or wizard_cfg.get("enableDnsProtection", False)
    enable_anti_amp = payload.get("enableAntiAmplification") or wizard_cfg.get("enableAntiAmplification", False)
    open_resolver_confirmed = payload.get("openResolverConfirmed") or wizard_cfg.get("openResolverConfirmed", False)

    # ── table ip filter ──
    lines = [
        "table ip filter {",
        "    chain INPUT {",
        "        type filter hook input priority 0; policy accept;",
        "",
        "        # ═══ DNS Access Control (EDGE) ═══",
    ]

    # 1. Explicit deny/refuse first
    for acl in acl_ipv4:
        if not isinstance(acl, dict):
            continue
        network = str(acl.get("network", "")).strip()
        action = str(acl.get("action", "")).strip()
        if network and action in ("refuse", "deny"):
            lines.append(f"        ip saddr {network} udp dport 53 counter drop")
            lines.append(f"        ip saddr {network} tcp dport 53 counter drop")

    # 2. Anti-amplification (drop BEFORE any accept)
    if enable_anti_amp:
        lines.append("")
        lines.append("        # Anti-amplificação DNS")
        lines.append("        udp dport 53 ip length > 512 counter drop")
        lines.append("        udp dport 53 ct state new limit rate over 1000/second counter drop")

    # 3. Rate limit (drop excess BEFORE any accept)
    if enable_rate_limit:
        lines.append("")
        lines.append("        # Rate limiting DNS")
        lines.append("        udp dport 53 limit rate over 2000/second counter drop")
        lines.append("        tcp dport 53 limit rate over 2000/second counter drop")

    # 4. Accept entries (only reached after protections)
    for acl in acl_ipv4:
        if not isinstance(acl, dict):
            continue
        network = str(acl.get("network", "")).strip()
        action = str(acl.get("action", "")).strip()
        if network and action == "allow" and network != "0.0.0.0/0":
            lines.append(f"        ip saddr {network} udp dport 53 counter accept")
            lines.append(f"        ip saddr {network} tcp dport 53 counter accept")

    # 5. Default deny
    is_open = any(
        isinstance(a, dict) and str(a.get("network", "")).strip() == "0.0.0.0/0" and str(a.get("action", "")).strip() == "allow"
        for a in acl_ipv4
    ) and open_resolver_confirmed
    if not is_open:
        lines.append("")
        lines.append("        # DEFAULT DENY")
        lines.append("        udp dport 53 counter drop")
        lines.append("        tcp dport 53 counter drop")

    lines.append("    }")
    lines.append("}")

    files.append({
        "path": "/etc/nftables.d/0060-filter-table-ipv4.nft",
        "content": "\n".join(lines) + "\n",
        "permissions": "0644",
        "owner": "root:root",
    })

    # ── table ip6 filter ──
    if enable_ipv6:
        lines6 = [
            "table ip6 filter {",
            "    chain INPUT {",
            "        type filter hook input priority 0; policy accept;",
            "",
            "        # ═══ DNS Access Control IPv6 (EDGE) ═══",
        ]

        # 1. DENY
        for acl in acl_ipv6:
            if not isinstance(acl, dict):
                continue
            network = str(acl.get("network", "")).strip()
            action = str(acl.get("action", "")).strip()
            if network and action in ("refuse", "deny"):
                lines6.append(f"        ip6 saddr {network} udp dport 53 counter drop")
                lines6.append(f"        ip6 saddr {network} tcp dport 53 counter drop")

        # 2. Anti-amplification
        if enable_anti_amp:
            lines6.append("")
            lines6.append("        udp dport 53 ip6 length > 512 counter drop")
            lines6.append("        udp dport 53 ct state new limit rate over 1000/second counter drop")

        # 3. Rate limit
        if enable_rate_limit:
            lines6.append("")
            lines6.append("        udp dport 53 limit rate over 2000/second counter drop")
            lines6.append("        tcp dport 53 limit rate over 2000/second counter drop")

        # 4. ACCEPT
        for acl in acl_ipv6:
            if not isinstance(acl, dict):
                continue
            network = str(acl.get("network", "")).strip()
            action = str(acl.get("action", "")).strip()
            if network and action == "allow" and network != "::/0":
                lines6.append(f"        ip6 saddr {network} udp dport 53 counter accept")
                lines6.append(f"        ip6 saddr {network} tcp dport 53 counter accept")

        # 5. DEFAULT DENY
        is_open_v6 = any(
            isinstance(a, dict) and str(a.get("network", "")).strip() == "::/0" and str(a.get("action", "")).strip() == "allow"
            for a in acl_ipv6
        ) and open_resolver_confirmed
        if not is_open_v6:
            lines6.append("")
            lines6.append("        udp dport 53 counter drop")
            lines6.append("        tcp dport 53 counter drop")

        lines6.append("    }")
        lines6.append("}")

        files.append({
            "path": "/etc/nftables.d/0061-filter-table-ipv6.nft",
            "content": "\n".join(lines6) + "\n",
            "permissions": "0644",
            "owner": "root:root",
        })

    return files
