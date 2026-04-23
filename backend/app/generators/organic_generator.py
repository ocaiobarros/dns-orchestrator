"""
DNS Control — Organic Layout Generator (Interception Mode)

Emits config files in the native OS layout used by the production server:

  /etc/nftables.conf                              [shared, idempotent BEGIN/END]
  /etc/network/nftables.d/interfaces              [owned, header banner]
  /etc/network/nftables.d/post-up.sh              [owned, header banner]
  /etc/network/nftables.d/*.nft                   [owned, header banner]
  /etc/unbound/unbound.conf.d/remote-control.conf [owned, header banner]
  /etc/unbound/unbound.conf.d/root-auto-trust-anchor-file.conf [owned]
  /etc/unbound/gen-block-domains.sh               [owned]

It deliberately does NOT touch the following operator-managed assets:
  - /etc/network/if-{up,down,pre-up}.d/* (Debian defaults)
  - /usr/lib/systemd/system/unbound.service (package default)
  - /etc/network/ifupdown2/* (operator-managed)

For /etc/network/interfaces the deploy pipeline performs an idempotent
BEGIN/END DNS-CONTROL splice so the organic fragment is auto-sourced — no
manual edit required after deploy.

The unboundXX.conf and unboundXX.service files continue to be emitted by
unbound_generator.py and systemd_generator.py — they already write to the
correct native paths.

Idempotency contract:
  - Files marked OWNED are overwritten in full with a header comment.
  - Files marked SHARED carry BEGIN DNS-CONTROL / END DNS-CONTROL markers and
    only the bounded region is replaced; the deploy script is responsible for
    splicing the block in/out without touching content outside the markers.
"""

from typing import Any

# Marker convention used by the deploy script when splicing into shared files.
DNS_CONTROL_BEGIN = "# >>> BEGIN DNS-CONTROL — managed block — do not edit"
DNS_CONTROL_END = "# <<< END DNS-CONTROL — managed block"

OWNED_HEADER = (
    "# ---------------------------------------------------------------\n"
    "# DNS Control — Generated file. DO NOT EDIT.\n"
    "# Manual edits are overwritten on every deploy.\n"
    "# ---------------------------------------------------------------\n"
)


# ── Helpers ─────────────────────────────────────────────────────────────


def _shared_block(payload_lines: list[str]) -> str:
    """Wrap payload lines with BEGIN/END markers for splicing into shared files."""
    body = "\n".join(payload_lines)
    return f"{DNS_CONTROL_BEGIN}\n{body}\n{DNS_CONTROL_END}\n"


def _file(path: str, content: str, perms: str = "0644", owner: str = "root:root") -> dict:
    return {"path": path, "content": content, "permissions": perms, "owner": owner}


def _collect_egress_listener_vip(payload: dict, instances: list, intercepted_vips: list, service_vips: list) -> dict:
    egress_v4: list[str] = []
    egress_v6: list[str] = []
    listener_v4: list[str] = []
    listener_v6: list[str] = []

    for inst in instances:
        bind_ip = str(inst.get("bindIp", "")).strip()
        if bind_ip and bind_ip != "127.0.0.1":
            listener_v4.append(bind_ip)
        bind_ipv6 = str(inst.get("bindIpv6", "")).strip()
        if bind_ipv6:
            listener_v6.append(bind_ipv6)
        eip = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
        if eip:
            egress_v4.append(eip)
        eip6 = str(inst.get("exitIpv6", "") or inst.get("egressIpv6", "")).strip()
        if eip6:
            egress_v6.append(eip6)

    vips_v4: list[str] = []
    vips_v6: list[str] = []
    for v in intercepted_vips or []:
        if not isinstance(v, dict):
            continue
        if (ip := str(v.get("vipIp", "")).strip()):
            vips_v4.append(ip)
        if (ip6 := str(v.get("vipIpv6", "")).strip()):
            vips_v6.append(ip6)
    for v in service_vips or []:
        if not isinstance(v, dict):
            continue
        if (ip := str(v.get("ipv4", "")).strip()) and ip not in vips_v4:
            vips_v4.append(ip)
        if (ip6 := str(v.get("ipv6", "")).strip()) and ip6 not in vips_v6:
            vips_v6.append(ip6)

    # Deduplicate while preserving order
    def _dedupe(xs: list[str]) -> list[str]:
        seen, out = set(), []
        for x in xs:
            if x and x not in seen:
                out.append(x)
                seen.add(x)
        return out

    return {
        "egress_v4": _dedupe(egress_v4),
        "egress_v6": _dedupe(egress_v6),
        "listener_v4": _dedupe(listener_v4),
        "listener_v6": _dedupe(listener_v6),
        "vips_v4": _dedupe(vips_v4),
        "vips_v6": _dedupe(vips_v6),
    }


# ── Shared file: /etc/nftables.conf with BEGIN/END splice ──────────────


def _generate_nftables_entrypoint() -> dict:
    """Emit /etc/nftables.conf with a BEGIN/END managed include block.

    The deploy script is expected to splice this block into the existing
    /etc/nftables.conf file, replacing any prior managed block. Content
    outside the markers is preserved untouched.
    """
    block = _shared_block([
        '# Loaded by nftables.service on boot.',
        '# DNS Control modular ruleset for the interception data plane.',
        'include "/etc/network/nftables.d/*.nft"',
    ])
    # If the file does not yet exist, the deploy script writes the full
    # content below as the initial entrypoint.
    initial = (
        "#!/usr/sbin/nft -f\n"
        "# /etc/nftables.conf — system entrypoint loaded by nftables.service.\n"
        "# DNS Control manages ONLY the block delimited by markers below.\n"
        "# Add your own rules above or below the markers.\n\n"
        "flush ruleset\n\n"
        f"{block}"
    )
    return _file("/etc/nftables.conf", initial)


# ── Owned: /etc/network/nftables.d/interfaces and post-up.sh ───────────


def _generate_network_dropin_interfaces(payload: dict, addrs: dict) -> dict:
    """ifupdown2-style interfaces fragment that materializes lo and lo0.

    /etc/network/interfaces is automatically spliced by the deploy pipeline to
    `source /etc/network/nftables.d/interfaces` inside a BEGIN/END DNS-CONTROL
    managed block — no manual operator action required.
    """
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    main_iface = str(payload.get("mainInterface") or wizard_cfg.get("mainInterface") or "")
    enable_ipv6 = bool(payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False))

    lines: list[str] = [
        OWNED_HEADER,
        "# Loopback aliases and dummy interface lo0 for the dual-plane model:",
        "#   lo  = egress public IPs (IPv4)",
        "#   lo0 = listeners + intercepted VIPs + IPv6 /128",
        "",
        "auto lo0",
        "iface lo0 inet manual",
        "    pre-up /sbin/ip link add lo0 type dummy 2>/dev/null || true",
        "    pre-up /sbin/ip link set lo0 up",
        "    post-up /etc/network/nftables.d/post-up.sh",
        "",
    ]
    if main_iface:
        lines.append(f"# Hint: physical interface in use is '{main_iface}'")
        if enable_ipv6:
            lines.append(f"# IPv6 is enabled; gateway should be configured on {main_iface}")
        lines.append("")
    return _file("/etc/network/nftables.d/interfaces", "\n".join(lines))


def _generate_network_dropin_post_up(payload: dict, addrs: dict) -> dict:
    """Materializes egress on lo, listeners and VIPs on lo0, then loads nftables."""
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    enable_ipv6 = bool(payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False))
    egress_delivery = str(
        payload.get("egressDeliveryMode")
        or wizard_cfg.get("egressDeliveryMode")
        or "host-owned"
    )
    is_border_routed = egress_delivery == "border-routed"

    lines: list[str] = [
        "#!/bin/sh",
        "# DNS Control — post-up hook for /etc/network/nftables.d/interfaces",
        "# Materializes the dual-plane address layout and reloads nftables.",
        "set -e",
        "",
        '/sbin/ip link add lo0 type dummy 2>/dev/null || true',
        '/sbin/ip link set lo0 up',
        "",
    ]

    # Egress IPv4 on lo (host-owned only)
    if not is_border_routed and addrs["egress_v4"]:
        lines.append("# Egress IPv4 (lo)")
        for eip in addrs["egress_v4"]:
            lines.append(f"/sbin/ip -4 addr add {eip}/32 dev lo 2>/dev/null || true")
        lines.append("")

    # Egress IPv6 on lo0 (production reference puts v6 egress on lo0)
    if not is_border_routed and enable_ipv6 and addrs["egress_v6"]:
        lines.append("# Egress IPv6 (lo0)")
        for eip6 in addrs["egress_v6"]:
            lines.append(f"/sbin/ip -6 addr add {eip6}/128 dev lo0 2>/dev/null || true")
        lines.append("")

    # Listeners on lo0
    if addrs["listener_v4"]:
        lines.append("# Listener IPv4 (lo0)")
        for lip in addrs["listener_v4"]:
            lines.append(f"/sbin/ip -4 addr add {lip}/32 dev lo0 2>/dev/null || true")
        lines.append("")
    if enable_ipv6 and addrs["listener_v6"]:
        lines.append("# Listener IPv6 (lo0)")
        for lip6 in addrs["listener_v6"]:
            lines.append(f"/sbin/ip -6 addr add {lip6}/128 dev lo0 2>/dev/null || true")
        lines.append("")

    # VIPs on lo0
    if addrs["vips_v4"]:
        lines.append("# Intercepted/Service VIPs IPv4 (lo0)")
        for vip in addrs["vips_v4"]:
            lines.append(f"/sbin/ip -4 addr add {vip}/32 dev lo0 2>/dev/null || true")
        lines.append("")
    if enable_ipv6 and addrs["vips_v6"]:
        lines.append("# Intercepted/Service VIPs IPv6 (lo0)")
        for vip6 in addrs["vips_v6"]:
            lines.append(f"/sbin/ip -6 addr add {vip6}/128 dev lo0 2>/dev/null || true")
        lines.append("")

    lines.extend([
        "# Reload nftables ruleset (idempotent)",
        "/usr/sbin/nft -f /etc/nftables.conf || true",
        "",
        "exit 0",
        "",
    ])

    return _file(
        "/etc/network/nftables.d/post-up.sh",
        OWNED_HEADER + "\n".join(lines),
        perms="0755",
    )


def _generate_post_up_wrapper() -> dict:
    """Wrapper hook in /etc/network/post-up.d/ that invokes the managed post-up.sh.

    ifupdown(2) iterates /etc/network/post-up.d/ after bringing each interface
    up. This wrapper is the single integration point with the OS — it lets the
    operator avoid editing /etc/network/interfaces while still guaranteeing the
    DNS Control materialization (lo0, addresses, nft reload) runs at boot.
    Idempotent: re-running is safe because post-up.sh is itself idempotent.
    """
    body = (
        "#!/bin/sh\n"
        + OWNED_HEADER
        + "# Hook invoked by ifupdown(2) after each interface comes up.\n"
        "# Delegates to the managed materialization script.\n"
        "set -e\n"
        "TARGET=/etc/network/nftables.d/post-up.sh\n"
        "if [ -x \"$TARGET\" ]; then\n"
        "    \"$TARGET\" \"$@\" || true\n"
        "fi\n"
        "exit 0\n"
    )
    return _file("/etc/network/post-up.d/dns-control", body, perms="0755")


# ── Unbound drop-ins under /etc/unbound/unbound.conf.d/ ────────────────


def _generate_unbound_dropins(payload: dict, instances: list) -> list[dict]:
    """Emit shared remote-control and DNSSEC anchor drop-ins.

    The per-instance remote-control block already lives inside each
    unboundXX.conf (emitted by unbound_generator). The shared drop-in here
    is for the package-default unbound.service path which the operator may
    leave masked but which other tools sometimes consult.
    """
    files: list[dict] = []

    files.append(_file(
        "/etc/unbound/unbound.conf.d/remote-control.conf",
        OWNED_HEADER + (
            "remote-control:\n"
            "    control-enable: yes\n"
            "    # Per-instance remote-control is configured inside each unboundNN.conf.\n"
            "    # This shared drop-in only enables the feature for the package-default unit.\n"
            '    control-interface: /run/unbound.ctl\n'
        ),
    ))

    files.append(_file(
        "/etc/unbound/unbound.conf.d/root-auto-trust-anchor-file.conf",
        OWNED_HEADER + (
            "server:\n"
            "    # DNSSEC root trust anchor — refreshed by the unbound-anchor utility.\n"
            '    auto-trust-anchor-file: "/var/lib/unbound/root.key"\n'
        ),
    ))

    return files


# ── Block-domains pipeline (gen script + base list + placeholder) ──────


def _generate_block_domains_assets(payload: dict) -> list[dict]:
    """Emit the gen-block-domains.sh helper and the empty block list."""
    files: list[dict] = []

    gen_script = (
        OWNED_HEADER
        + "#!/bin/sh\n"
        "# DNS Control — gen-block-domains.sh\n"
        "# Reads /etc/unbound/block-domains.txt and produces\n"
        "# /etc/unbound/unbound-block-domains.conf with one local-zone per domain.\n"
        "\n"
        "BFILE=/etc/unbound/block-domains.txt\n"
        "TFILE=/tmp/block-domains.txt\n"
        "OUTCFG=/etc/unbound/unbound-block-domains.conf\n"
        "\n"
        ": > \"$OUTCFG\"\n"
        "\n"
        "if [ ! -s \"$BFILE\" ]; then\n"
        "    echo \"# DNS Control — block list empty\" > \"$OUTCFG\"\n"
        "    exit 0\n"
        "fi\n"
        "\n"
        "cat \"$BFILE\" 2>/dev/null \\\n"
        "    | egrep '^([a-z0-9]+[a-z0-9-](-[a-z0-9]+)*\\.)+[a-z]{2,}$' \\\n"
        "    | tr '[:upper:]' '[:lower:]' \\\n"
        "    | sort -u \\\n"
        "    > \"$TFILE\"\n"
        "\n"
        "total=$(wc -l < \"$TFILE\" 2>/dev/null || echo 0)\n"
        "if [ \"$total\" = \"0\" ]; then\n"
        "    echo \"# DNS Control — no syntactically valid domains in $BFILE\" > \"$OUTCFG\"\n"
        "    exit 0\n"
        "fi\n"
        "\n"
        "while IFS= read -r domain; do\n"
        "    printf 'local-zone: \"%s\" always_nxdomain\\n' \"$domain\" >> \"$OUTCFG\"\n"
        "done < \"$TFILE\"\n"
        "\n"
        "echo \"# DNS Control — generated $total blocked domains in $OUTCFG\"\n"
        "exit 0\n"
    )
    files.append(_file("/etc/unbound/gen-block-domains.sh", gen_script, perms="0755"))

    # Empty seed list — operator/AnaBlock populates this over time.
    files.append(_file(
        "/etc/unbound/block-domains.txt",
        "# DNS Control — block-domains.txt\n"
        "# One DNS-valid domain per line. Run /etc/unbound/gen-block-domains.sh\n"
        "# to (re)generate /etc/unbound/unbound-block-domains.conf.\n",
    ))

    return files


# ── nftables modular snippets (delegated to existing generator) ────────


def _generate_nftables_modular_snippets(payload: dict) -> list[dict]:
    """Reuse the existing modular nftables generator for the data plane.

    The existing generator already writes correctly to /etc/nftables.d/*.nft
    AND emits /etc/nftables.conf. We strip its /etc/nftables.conf entry and
    rewrite the include path to /etc/network/nftables.d/*.nft to match the
    organic layout.
    """
    from app.generators.nftables_generator import generate_nftables_config

    raw = generate_nftables_config(payload)
    out: list[dict] = []
    for entry in raw:
        path = entry.get("path", "")
        # Drop the entrypoint emitted by the legacy generator — we own it
        # via _generate_nftables_entrypoint.
        if path == "/etc/nftables.conf":
            continue
        # Relocate /etc/nftables.d/*.nft → /etc/network/nftables.d/*.nft
        if path.startswith("/etc/nftables.d/"):
            entry = dict(entry)
            entry["path"] = path.replace(
                "/etc/nftables.d/", "/etc/network/nftables.d/", 1
            )
        out.append(entry)
    return out


# ── Public entrypoint ──────────────────────────────────────────────────


def generate_organic_files(payload: dict[str, Any]) -> list[dict]:
    """Generate the complete organic-layout file set for interception mode."""
    instances = payload.get("instances", []) or []
    intercepted_vips = (
        payload.get("interceptedVips")
        or payload.get("_wizardConfig", {}).get("interceptedVips", [])
        or []
    )
    service_vips = (
        payload.get("serviceVips")
        or payload.get("nat", {}).get("serviceVips", [])
        or []
    )

    addrs = _collect_egress_listener_vip(payload, instances, intercepted_vips, service_vips)

    files: list[dict] = []
    files.append(_generate_nftables_entrypoint())
    files.append(_generate_network_dropin_interfaces(payload, addrs))
    files.append(_generate_network_dropin_post_up(payload, addrs))
    files.append(_generate_post_up_wrapper())
    files.extend(_generate_nftables_modular_snippets(payload))
    files.extend(_generate_unbound_dropins(payload, instances))
    files.extend(_generate_block_domains_assets(payload))
    return files
