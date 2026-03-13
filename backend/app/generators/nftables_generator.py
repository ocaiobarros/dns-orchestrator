"""
DNS Control — nftables Configuration Generator
Generates /etc/nftables.conf with DNAT rules, rate limiting, and counters.
"""

from typing import Any


def generate_nftables_config(payload: dict[str, Any], validation_mode: bool = False) -> list[dict]:
    nat = payload.get("nat", {})
    vip = payload.get("loopback", {}).get("vip", "")
    instances = payload.get("instances", [])
    security = payload.get("security", {})

    flush_line = "# flush ruleset  (removed for validation)" if validation_mode else "flush ruleset"

    config = f"""#!/usr/sbin/nft -f
# DNS Control — nftables configuration
# Generated configuration — do not edit manually

{flush_line}

"""

    # Filter table
    rate_limit = security.get("rateLimitQps", 0)
    config += """table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;

        # Loopback
        iif "lo" accept

        # Established/related
        ct state established,related accept

        # ICMP
        ip protocol icmp accept
        ip6 nexthdr icmpv6 accept

        # SSH
        tcp dport 22 accept

        # DNS Control API
        tcp dport 8000 accept

        # DNS
        udp dport 53 accept
        tcp dport 53 accept
"""

    if rate_limit > 0:
        config += f"""
        # Rate limiting
        udp dport 53 limit rate {rate_limit}/second accept
        udp dport 53 drop
"""

    config += """    }

    chain forward {
        type filter hook forward priority 0; policy drop;
    }

    chain output {
        type filter hook output priority 0; policy accept;
    }
}
"""

    # NAT table for DNAT load balancing
    if vip and instances:
        backend_ips = [inst.get("bindIp", "") for inst in instances if inst.get("bindIp")]
        if backend_ips:
            backends_str = ", ".join(backend_ips)
            config += f"""
table ip nat {{
    chain prerouting {{
        type nat hook prerouting priority -100; policy accept;

        # DNAT — distribute DNS queries across Unbound instances
        ip daddr {vip} udp dport 53 counter dnat to numgen inc mod {len(backend_ips)} map {{
"""
            for i, ip in enumerate(backend_ips):
                comma = "," if i < len(backend_ips) - 1 else ""
                config += f"            {i}: {ip}{comma}\n"

            config += f"""        }}
        ip daddr {vip} tcp dport 53 counter dnat to numgen inc mod {len(backend_ips)} map {{
"""
            for i, ip in enumerate(backend_ips):
                comma = "," if i < len(backend_ips) - 1 else ""
                config += f"            {i}: {ip}{comma}\n"

            config += """        }
    }

    chain postrouting {
        type nat hook postrouting priority 100; policy accept;
        masquerade
    }
}
"""

    # Counters
    config += """
table inet counters {
    counter dns_queries_total {
        comment "Total DNS queries received"
    }
    counter dns_queries_dropped {
        comment "DNS queries dropped by rate limiter"
    }

    chain count_dns {
        type filter hook input priority -10; policy accept;
        udp dport 53 counter name dns_queries_total
    }
}
"""

    return [{
        "path": "/etc/nftables.conf",
        "content": config,
        "permissions": "0644",
        "owner": "root:root",
    }]
