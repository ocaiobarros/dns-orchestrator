"""
DNS Control — nftables Simple Mode (Local Balancing) Generator
Generates local DNAT rules to distribute traffic from a frontend DNS IP
to internal Unbound backend instances.

File ordering convention (lexicographic include):
  5000  table
  5010  hooks (prerouting, output)
  5100  defines (frontend IP)
  5200  sets (sticky, created BEFORE any chain that references them)
  5300  dispatch chains (empty top-level local_tcp_dns / local_udp_dns)
  5400  backend sub-chains (DNAT targets, may reference @sets)
  5500  sticky memorized-source rules (jump from dispatch → sub-chain)
  5600  round-robin fallback (numgen vmap in dispatch chains)
  5700  capture rules (prerouting/output → dispatch)
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
    """Generate nftables local balancing rules for simple mode."""
    instances = payload.get("instances", []) if isinstance(payload.get("instances", []), list) else []
    backends = _collect_backends(instances)

    if not backends:
        return []

    frontend_ip = str(
        payload.get("frontendDnsIp")
        or payload.get("_wizardConfig", {}).get("frontendDnsIp", "")
        or ""
    ).strip()

    if not frontend_ip:
        return []

    # Distribution strategy: round-robin (default for simple) or sticky-source
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    distribution_strategy = str(
        payload.get("simpleDistributionStrategy")
        or wizard_cfg.get("simpleDistributionStrategy")
        or "round-robin"
    )
    use_sticky = distribution_strategy == "sticky-source"

    sticky_timeout_seconds = int(
        payload.get("simpleStickyTimeout")
        or wizard_cfg.get("simpleStickyTimeout")
        or payload.get("stickyTimeout", 0)
        or 0
    )
    if use_sticky and sticky_timeout_seconds < 60:
        sticky_timeout_seconds = 1200  # default 20min
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
    """Generate /etc/nftables.d/*.nft modular snippets for local balancing."""
    files: list[dict] = []

    def _file(path: str, content: str):
        files.append({"path": path, "content": content, "permissions": "0644", "owner": "root:root"})

    # ── 5000: Master config + table ──
    _file("/etc/nftables.conf", "#!/usr/sbin/nft -f\n\nflush ruleset\ninclude \"/etc/nftables.d/*.nft\"\n")
    _file("/etc/nftables.d/5000-local-table.nft", "table ip nat {\n}\n")

    # ── 5010: Hooks ──
    _file("/etc/nftables.d/5010-local-hook-prerouting.nft",
          "table ip nat {\n    chain PREROUTING {\n        type nat hook prerouting priority dstnat; policy accept;\n    }\n}\n")
    _file("/etc/nftables.d/5011-local-hook-output.nft",
          "table ip nat {\n    chain OUTPUT {\n        type nat hook output priority dstnat; policy accept;\n    }\n}\n")

    # ── 5100: Defines ──
    _file("/etc/nftables.d/5100-local-define-frontend.nft",
          f"define DNS_FRONTEND_IP = {{ {frontend_ip} }}\n")

    # ── 5200: Sets (MUST be created before any chain references them) ──
    if use_sticky:
        for idx, backend in enumerate(backends):
            name = backend["name"]
            set_name = f"local_users_{name}"
            set_content = "\n".join([
                "table ip nat {",
                f"    set {set_name} {{",
                f"        type ipv4_addr",
                f"        size 8192",
                f"        flags dynamic, timeout",
                f"        timeout {sticky_timeout_min}m",
                f"    }}",
                "}",
            ]) + "\n"
            _file(f"/etc/nftables.d/5200-local-set-{set_name}.nft", set_content)

    # ── 5300: Dispatch chains (empty, will receive rules via later snippets) ──
    for proto in ("tcp", "udp"):
        _file(f"/etc/nftables.d/5300-local-chain-{proto}_dns.nft",
              f"table ip nat {{\n    chain local_{proto}_dns {{\n    }}\n}}\n")

    # ── 5400: Backend sub-chains (DNAT targets) ──
    for idx, backend in enumerate(backends):
        name = backend["name"]
        bind_ip = backend["ipv4"]
        for proto in ("tcp", "udp"):
            subchain = f"local_dns_{proto}_{name}"
            chain_lines = [
                "table ip nat {",
                f"    chain {subchain} {{",
            ]
            if use_sticky:
                set_name = f"local_users_{name}"
                chain_lines.append(f"        add @{set_name} {{ ip saddr }} counter")
                chain_lines.append(f"        set update ip saddr timeout 0s @{set_name} counter")
            chain_lines.append(f"        {proto} dport 53 counter dnat to {bind_ip}:53")
            chain_lines.append("    }")
            chain_lines.append("}")
            _file(f"/etc/nftables.d/5400-local-chain-{subchain}.nft", "\n".join(chain_lines) + "\n")

    # ── 5500: Sticky memorized-source rules ──
    if use_sticky:
        for idx, backend in enumerate(backends):
            name = backend["name"]
            set_name = f"local_users_{name}"
            for proto in ("tcp", "udp"):
                topchain = f"local_{proto}_dns"
                subchain = f"local_dns_{proto}_{name}"
                _file(f"/etc/nftables.d/5500-local-rule-sticky-{subchain}.nft",
                      f"table ip nat {{\n    chain {topchain} {{\n        ip saddr @{set_name} counter jump {subchain}\n    }}\n}}\n")

    # ── 5600: Round-robin fallback (numgen vmap) ──
    for proto in ("tcp", "udp"):
        topchain = f"local_{proto}_dns"
        vmap_entries = ", ".join(
            f"{i} : jump local_dns_{proto}_{b['name']}" for i, b in enumerate(backends)
        )
        _file(f"/etc/nftables.d/5600-local-rule-rr-{proto}.nft",
              f"table ip nat {{\n    chain {topchain} {{\n        numgen inc mod {len(backends)} vmap {{ {vmap_entries} }}\n    }}\n}}\n")

    # ── 5700: Capture rules (prerouting + output → dispatch) ──
    for proto in ("tcp", "udp"):
        _file(f"/etc/nftables.d/5700-local-capture-prerouting-{proto}.nft",
              f"table ip nat {{\n    chain PREROUTING {{\n        ip daddr $DNS_FRONTEND_IP {proto} dport 53 counter packets 0 bytes 0 jump local_{proto}_dns\n    }}\n}}\n")
        _file(f"/etc/nftables.d/5701-local-capture-output-{proto}.nft",
              f"table ip nat {{\n    chain OUTPUT {{\n        ip daddr $DNS_FRONTEND_IP {proto} dport 53 counter packets 0 bytes 0 jump local_{proto}_dns\n    }}\n}}\n")

    return files


def _generate_validation(
    frontend_ip: str,
    backends: list[dict],
    sticky_timeout_min: int,
    use_sticky: bool,
) -> list[dict]:
    """Generate single monolithic file for nft -c -f validation.
    Order: table → sets → backend chains → dispatch chains → hooks with capture.
    """
    lines: list[str] = [
        "#!/usr/sbin/nft -f",
        "# DNS Control — nftables local balancing validation",
        "# flush ruleset  (removed for validation)",
        "",
        "table ip nat {",
    ]

    # Sets first (before any chain that references them)
    if use_sticky:
        for backend in backends:
            name = backend["name"]
            lines.append(f"    set local_users_{name} {{ type ipv4_addr; size 8192; flags dynamic, timeout; timeout {sticky_timeout_min}m; }}")

    # Backend sub-chains (may reference sets via @local_users_*)
    for backend in backends:
        name = backend["name"]
        bind_ip = backend["ipv4"]
        for proto in ("tcp", "udp"):
            subchain = f"local_dns_{proto}_{name}"
            lines.append(f"    chain {subchain} {{")
            if use_sticky:
                set_name = f"local_users_{name}"
                lines.append(f"        add @{set_name} {{ ip saddr }} counter")
                lines.append(f"        set update ip saddr timeout 0s @{set_name} counter")
            lines.append(f"        {proto} dport 53 counter dnat to {bind_ip}:53")
            lines.append("    }")

    # Dispatch chains (sticky + round-robin)
    for proto in ("tcp", "udp"):
        lines.append(f"    chain local_{proto}_dns {{")
        if use_sticky:
            for backend in backends:
                name = backend["name"]
                lines.append(f"        ip saddr @local_users_{name} counter jump local_dns_{proto}_{name}")
        vmap_entries = ", ".join(
            f"{i} : jump local_dns_{proto}_{b['name']}" for i, b in enumerate(backends)
        )
        lines.append(f"        numgen inc mod {len(backends)} vmap {{ {vmap_entries} }}")
        lines.append("    }")

    # Hooks with capture rules
    lines.append("    chain PREROUTING {")
    lines.append("        type nat hook prerouting priority dstnat; policy accept;")
    for proto in ("tcp", "udp"):
        lines.append(f"        ip daddr {frontend_ip} {proto} dport 53 counter jump local_{proto}_dns")
    lines.append("    }")

    lines.append("    chain OUTPUT {")
    lines.append("        type nat hook output priority dstnat; policy accept;")
    for proto in ("tcp", "udp"):
        lines.append(f"        ip daddr {frontend_ip} {proto} dport 53 counter jump local_{proto}_dns")
    lines.append("    }")

    lines.append("}")
    lines.append("")

    return [{
        "path": "/etc/nftables.validate.conf",
        "content": "\n".join(lines),
        "permissions": "0644",
        "owner": "root:root",
    }]
