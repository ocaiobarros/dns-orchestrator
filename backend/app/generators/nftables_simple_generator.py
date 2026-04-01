"""
DNS Control — nftables Simple Mode (Local Balancing) Generator
Generates local DNAT rules to distribute traffic from a frontend DNS IP
to internal Unbound backend instances.

Architecture: The frontend IP (e.g. 172.250.40.100) receives DNS queries
on port 53 and distributes them across backend IPs (e.g. 100.127.255.101,
100.127.255.102) using numgen round-robin + optional sticky source affinity.
NO interception, NO anycast, NO VIP — just local load balancing.
"""

from typing import Any


def _collect_backends(instances: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Return list of {name, ipv4} per instance."""
    backends = []
    for inst in instances:
        bind_ip = str(inst.get("bindIp", "")).strip()
        if bind_ip:
            backends.append({
                "name": inst.get("name", "unbound"),
                "ipv4": bind_ip,
            })
    return backends


def generate_simple_nftables_config(payload: dict[str, Any], validation_mode: bool = False) -> list[dict]:
    """Generate nftables local balancing rules for simple mode.
    Frontend IP → DNAT → backend instances (round-robin).
    """
    instances = payload.get("instances", []) if isinstance(payload.get("instances", []), list) else []
    backends = _collect_backends(instances)

    if not backends:
        return []

    # Get frontend DNS IP
    frontend_ip = str(
        payload.get("frontendDnsIp")
        or payload.get("_wizardConfig", {}).get("frontendDnsIp", "")
        or ""
    ).strip()

    if not frontend_ip:
        return []

    sticky_timeout_seconds = int(payload.get("stickyTimeout", 0) or 0)
    use_sticky = sticky_timeout_seconds >= 60
    sticky_timeout_min = max(1, sticky_timeout_seconds // 60) if use_sticky else 20

    if validation_mode:
        return _generate_validation(frontend_ip, backends, sticky_timeout_min, use_sticky)

    return _generate_modular(frontend_ip, backends, sticky_timeout_min, use_sticky)


def _generate_modular(
    frontend_ip: str,
    backends: list[dict],
    sticky_timeout_min: int,
    use_sticky: bool,
) -> list[dict]:
    """Generate /etc/nftables.d/*.nft modular snippets for local balancing.
    Uses table block syntax (additive).
    """
    files: list[dict] = []

    def _file(path: str, content: str):
        files.append({"path": path, "content": content, "permissions": "0644", "owner": "root:root"})

    # Master nftables.conf
    _file("/etc/nftables.conf", "#!/usr/sbin/nft -f\n\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n")

    # Table
    _file("/etc/nftables.d/0002-table-ipv4-nat.nft", "table ip nat {\n}\n")

    # PREROUTING hook (external traffic)
    _file("/etc/nftables.d/0051-hook-ipv4-prerouting.nft",
          "table ip nat {\n    chain PREROUTING {\n        type nat hook prerouting priority dstnat; policy accept;\n    }\n}\n")

    # OUTPUT hook (local traffic — dig @frontend on this host)
    _file("/etc/nftables.d/0053-hook-ipv4-output.nft",
          "table ip nat {\n    chain OUTPUT {\n        type nat hook output priority dstnat; policy accept;\n    }\n}\n")

    # Frontend IP define
    _file("/etc/nftables.d/5100-local-define-frontend.nft",
          f"define DNS_FRONTEND_IP = {{ {frontend_ip} }}\n")

    # Dispatch chains (empty, will receive rules)
    for proto in ("tcp", "udp"):
        suffix = "2" if proto == "tcp" else "3"
        _file(f"/etc/nftables.d/510{suffix}-local-chain-{proto}_dns.nft",
              f"table ip nat {{\n    chain local_{proto}_dns {{\n    }}\n}}\n")

    # PREROUTING capture rules — redirect frontend IP traffic to dispatch chain
    for proto in ("tcp", "udp"):
        suffix = "1" if proto == "tcp" else "2"
        _file(f"/etc/nftables.d/511{suffix}-local-rule-prerouting-{proto}.nft",
              f"table ip nat {{\n    chain PREROUTING {{\n        ip daddr $DNS_FRONTEND_IP {proto} dport 53 counter packets 0 bytes 0 jump local_{proto}_dns\n    }}\n}}\n")

    # OUTPUT capture rules — same for locally-generated traffic
    for proto in ("tcp", "udp"):
        suffix = "3" if proto == "tcp" else "4"
        _file(f"/etc/nftables.d/511{suffix}-local-rule-output-{proto}.nft",
              f"table ip nat {{\n    chain OUTPUT {{\n        ip daddr $DNS_FRONTEND_IP {proto} dport 53 counter packets 0 bytes 0 jump local_{proto}_dns\n    }}\n}}\n")

    # Per-backend chains with DNAT
    ruleid = 6001
    for backend in backends:
        name = backend["name"]
        bind_ip = backend["ipv4"]
        for proto in ("tcp", "udp"):
            subchain = f"local_dns_{proto}_{name}"

            if use_sticky:
                subusers = f"local_users_{name}"
                # Sticky set
                set_content = "\n".join([
                    "table ip nat {",
                    f"    set {subusers} {{",
                    f"        type ipv4_addr",
                    f"        size 8192",
                    f"        flags dynamic, timeout",
                    f"        timeout {sticky_timeout_min}m",
                    f"    }}",
                    "}",
                ]) + "\n"
                _file(f"/etc/nftables.d/{ruleid}-local-set-{subusers}.nft", set_content)

            # Backend chain with DNAT
            chain_content = "\n".join([
                "table ip nat {",
                f"    chain {subchain} {{",
                *(([
                    f"        add @local_users_{name} {{ ip saddr }} counter",
                    f"        set update ip saddr timeout 0s @local_users_{name} counter",
                ] if use_sticky else [])),
                f"        {proto} dport 53 counter dnat to {bind_ip}:53",
                f"    }}",
                "}",
            ]) + "\n"
            _file(f"/etc/nftables.d/{ruleid}-local-chain-{subchain}.nft", chain_content)
            ruleid += 1

    # Sticky memorized source rules (if enabled)
    if use_sticky:
        ruleid = 7001
        for backend in backends:
            name = backend["name"]
            for proto in ("tcp", "udp"):
                topchain = f"local_{proto}_dns"
                subchain = f"local_dns_{proto}_{name}"
                subusers = f"local_users_{name}"
                _file(f"/etc/nftables.d/{ruleid}-local-rule-memorized-{subchain}.nft",
                      f"table ip nat {{\n    chain {topchain} {{\n        ip saddr @{subusers} counter jump {subchain}\n    }}\n}}\n")
                ruleid += 1

    # Round-robin fallback: numgen inc mod N with vmap
    ruleid = 7201
    for proto in ("tcp", "udp"):
        topchain = f"local_{proto}_dns"
        vmap_entries = ", ".join(
            f"{i} : jump local_dns_{proto}_{b['name']}" for i, b in enumerate(backends)
        )
        _file(f"/etc/nftables.d/{ruleid}-local-rule-rr-{proto}.nft",
              f"table ip nat {{\n    chain {topchain} {{\n        numgen inc mod {len(backends)} vmap {{ {vmap_entries} }}\n    }}\n}}\n")
        ruleid += 1

    return files


def _generate_validation(
    frontend_ip: str,
    backends: list[dict],
    sticky_timeout_min: int,
    use_sticky: bool,
) -> list[dict]:
    """Generate single monolithic file for nft -c -f validation."""
    lines: list[str] = [
        "#!/usr/sbin/nft -f",
        "# DNS Control — nftables local balancing validation",
        "# flush ruleset  (removed for validation)",
        "",
        "table ip nat {",
        "    chain PREROUTING {",
        "        type nat hook prerouting priority dstnat; policy accept;",
        "    }",
        "    chain OUTPUT {",
        "        type nat hook output priority dstnat; policy accept;",
        "    }",
    ]

    # Sets (if sticky)
    if use_sticky:
        for backend in backends:
            name = backend["name"]
            lines.append(f"    set local_users_{name} {{ type ipv4_addr; size 8192; flags dynamic, timeout; timeout {sticky_timeout_min}m; }}")

    # Backend chains
    for backend in backends:
        name = backend["name"]
        bind_ip = backend["ipv4"]
        for proto in ("tcp", "udp"):
            subchain = f"local_dns_{proto}_{name}"
            lines.append(f"    chain {subchain} {{")
            lines.append(f"        {proto} dport 53 counter dnat to {bind_ip}:53")
            lines.append("    }")

    # Dispatch chains with vmap
    for proto in ("tcp", "udp"):
        lines.append(f"    chain local_{proto}_dns {{")
        vmap_entries = ", ".join(
            f"{i} : jump local_dns_{proto}_{b['name']}" for i, b in enumerate(backends)
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
