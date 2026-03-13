"""
DNS Control — nftables Configuration Generator
Generates production and validation-safe nftables artifacts.
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


def _collect_backends(instances: list[dict[str, Any]]) -> list[str]:
    return _dedupe([str(inst.get("bindIp", "")).strip() for inst in instances if inst.get("bindIp")])


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
        protocol = str(vip.get("protocol", "udp+tcp")).strip() or "udp+tcp"
        try:
            port = int(vip.get("port", 53) or 53)
        except (TypeError, ValueError):
            port = 53
        vips.append({"ipv4": ipv4, "protocol": protocol, "port": port})

    if vips:
        return vips

    primary_vip = str(payload.get("loopback", {}).get("vip", "")).strip()
    if primary_vip:
        return [{"ipv4": primary_vip, "protocol": "udp+tcp", "port": 53}]
    return []


def _proto_enabled(vip_protocol: str, proto: str) -> bool:
    if vip_protocol == "udp+tcp":
        return True
    return vip_protocol == proto


def _render_vmap(proto: str, backend_count: int) -> str:
    entries = ", ".join([f"{idx} : jump dns_{proto}_backend_{idx}" for idx in range(backend_count)])
    return f"numgen inc mod {backend_count} vmap {{ {entries} }}"


def generate_nftables_config(payload: dict[str, Any], validation_mode: bool = False) -> list[dict]:
    nat = payload.get("nat", {}) if isinstance(payload.get("nat", {}), dict) else {}
    instances = payload.get("instances", []) if isinstance(payload.get("instances", []), list) else []
    security = payload.get("security", {}) if isinstance(payload.get("security", {}), dict) else {}

    # Panel / management ports from wizard config
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    panel_port = int(wizard_cfg.get("panelPort") or payload.get("panelPort") or 8443)
    api_port = 8000  # backend API port (always needed for nginx proxy)

    service_vips = _collect_service_vips(payload, nat)
    backend_ips = _collect_backends(instances)
    egress_ips = _collect_egress_ips(instances)

    distribution_policy = str(nat.get("distributionPolicy") or payload.get("distributionPolicy") or "round-robin")
    sticky_timeout_seconds = int(nat.get("stickyTimeout") or payload.get("stickyTimeout") or 1200)
    sticky_timeout_seconds = max(60, sticky_timeout_seconds)

    rate_limit = int(security.get("rateLimitQps", 0) or 0)
    flush_line = "# flush ruleset  (removed for validation)" if validation_mode else "flush ruleset"

    udp_ports = sorted({int(vip["port"]) for vip in service_vips if _proto_enabled(vip["protocol"], "udp")})
    tcp_ports = sorted({int(vip["port"]) for vip in service_vips if _proto_enabled(vip["protocol"], "tcp")})
    udp_ports = udp_ports or [53]
    tcp_ports = tcp_ports or [53]

    # Management TCP ports: SSH + HTTP (nginx) + API + panel
    mgmt_ports = sorted({22, 80, api_port, panel_port})
    mgmt_port_set = ", ".join(str(p) for p in mgmt_ports)

    lines: list[str] = [
        "#!/usr/sbin/nft -f",
        "# DNS Control — nftables configuration",
        "# Generated configuration — do not edit manually",
        f"# Distribution policy: {distribution_policy}",
        "",
        flush_line,
        "",
        "table inet filter {",
        "    chain input {",
        "        type filter hook input priority 0; policy drop;",
        "",
        "        # Loopback",
        "        iif \"lo\" accept",
        "",
        "        # Established/related",
        "        ct state established,related accept",
        "",
        "        # ICMP",
        "        ip protocol icmp accept",
        "        ip6 nexthdr icmpv6 accept",
        "",
        f"        # Management: SSH, HTTP (nginx), API ({api_port}), Panel ({panel_port})",
        f"        tcp dport {{ {mgmt_port_set} }} accept",
        "",
    ]

    if tcp_ports:
        tcp_port_set = ", ".join(str(p) for p in tcp_ports)
        lines.append(f"        tcp dport {{ {tcp_port_set} }} accept")

    if udp_ports:
        udp_port_set = ", ".join(str(p) for p in udp_ports)
        if rate_limit > 0:
            lines.append(f"        udp dport {{ {udp_port_set} }} limit rate {rate_limit}/second accept")
            lines.append(f"        udp dport {{ {udp_port_set} }} drop")
        else:
            lines.append(f"        udp dport {{ {udp_port_set} }} accept")

    lines.extend([
        "    }",
        "",
        "    chain forward {",
        "        type filter hook forward priority 0; policy drop;",
        "    }",
        "",
        "    chain output {",
        "        type filter hook output priority 0; policy accept;",
        "    }",
        "}",
        "",
    ])

    if service_vips and backend_ips:
        vip_ips = _dedupe([vip["ipv4"] for vip in service_vips])
        vip_mappings = nat.get("vipMappings") or payload.get("vipMappings") or []
        fixed_map: dict[int, int] = {}
        for mapping in vip_mappings:
            if not isinstance(mapping, dict):
                continue
            try:
                vip_index = int(mapping.get("vipIndex"))
                backend_index = int(mapping.get("instanceIndex"))
            except (TypeError, ValueError):
                continue
            if 0 <= vip_index < len(service_vips) and 0 <= backend_index < len(backend_ips):
                fixed_map[vip_index] = backend_index

        lines.extend([
            "table ip nat {",
            "    # Reconciliation engine manipulates this set via nft add/delete element",
            f"    set dns_backends {{ type ipv4_addr; elements = {{ {', '.join(backend_ips)} }} }}",
            f"    set dns_vips {{ type ipv4_addr; flags interval; elements = {{ {', '.join(vip_ips)} }} }}",
        ])

        if egress_ips:
            lines.append(f"    set dns_egress_ipv4 {{ type ipv4_addr; elements = {{ {', '.join(egress_ips)} }} }}")

        if distribution_policy == "sticky-source":
            for idx in range(len(backend_ips)):
                lines.append(
                    f"    set sticky_udp_{idx} {{ type ipv4_addr; flags dynamic,timeout; timeout {sticky_timeout_seconds}s; }}"
                )
                lines.append(
                    f"    set sticky_tcp_{idx} {{ type ipv4_addr; flags dynamic,timeout; timeout {sticky_timeout_seconds}s; }}"
                )

        lines.extend([
            "",
            "    chain prerouting {",
            "        type nat hook prerouting priority -100; policy accept;",
            "",
            "        # VIP capture (multi-VIP, per-protocol)",
        ])

        for vip_index, vip in enumerate(service_vips):
            vip_ip = vip["ipv4"]
            vip_port = int(vip.get("port", 53) or 53)
            vip_protocol = vip.get("protocol", "udp+tcp")

            mapped_backend_idx = fixed_map.get(vip_index)
            mapped_backend = backend_ips[mapped_backend_idx] if mapped_backend_idx is not None else None

            if _proto_enabled(vip_protocol, "udp"):
                if distribution_policy == "fixed-mapping" and mapped_backend:
                    lines.append(
                        f"        ip daddr {vip_ip} udp dport {vip_port} counter dnat to {mapped_backend}:53"
                    )
                else:
                    lines.append(
                        f"        ip daddr {vip_ip} udp dport {vip_port} counter jump dns_udp"
                    )

            if _proto_enabled(vip_protocol, "tcp"):
                if distribution_policy == "fixed-mapping" and mapped_backend:
                    lines.append(
                        f"        ip daddr {vip_ip} tcp dport {vip_port} counter dnat to {mapped_backend}:53"
                    )
                else:
                    lines.append(
                        f"        ip daddr {vip_ip} tcp dport {vip_port} counter jump dns_tcp"
                    )

        lines.extend([
            "    }",
            "",
            "    chain postrouting {",
            "        type nat hook postrouting priority 100; policy accept;",
            "        ip saddr @dns_backends oifname != \"lo\" counter masquerade",
            "    }",
            "",
        ])

        for proto in ("udp", "tcp"):
            for idx, backend_ip in enumerate(backend_ips):
                lines.append(f"    chain dns_{proto}_backend_{idx} {{")
                if distribution_policy == "sticky-source":
                    lines.append(
                        f"        update @sticky_{proto}_{idx} {{ ip saddr timeout {sticky_timeout_seconds}s }} counter"
                    )
                lines.append(f"        {proto} dport 53 counter dnat to {backend_ip}:53")
                lines.append("    }")
                lines.append("")

            lines.append(f"    chain dns_{proto} {{")
            if distribution_policy == "active-passive":
                lines.append(f"        jump dns_{proto}_backend_0")
            else:
                if distribution_policy == "sticky-source":
                    for idx in range(len(backend_ips)):
                        lines.append(f"        ip saddr @sticky_{proto}_{idx} counter jump dns_{proto}_backend_{idx}")
                lines.append(f"        {_render_vmap(proto, len(backend_ips))}")
            lines.append("    }")
            lines.append("")

        lines.append("}")
        lines.append("")

    lines.extend([
        "table inet counters {",
        "    counter dns_queries_total {",
        "        comment \"Total DNS queries received\"",
        "    }",
        "    counter dns_queries_dropped {",
        "        comment \"DNS queries dropped by rate limiter\"",
        "    }",
        "",
        "    chain count_dns {",
        "        type filter hook input priority -10; policy accept;",
        "        udp dport 53 counter name dns_queries_total",
        "    }",
        "}",
        "",
    ])

    target_path = "/etc/nftables.validate.conf" if validation_mode else "/etc/nftables.conf"
    return [{
        "path": target_path,
        "content": "\n".join(lines),
        "permissions": "0644",
        "owner": "root:root",
    }]

