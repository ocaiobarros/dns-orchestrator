"""
DNS Control — FRR/OSPF Configuration Generator

FRR é parte do layout homologado do modo Interceptação. Os arquivos
/etc/frr/frr.conf e /etc/frr/daemons são SEMPRE materializados nesse
modo, mesmo com OSPF desativado (placeholder seguro: ospfd=no, frr.conf
como esqueleto comentado). Isso garante paridade estrutural com o
servidor de produção homologado.
"""

from typing import Any


def _is_ospf_enabled(payload: dict[str, Any]) -> bool:
    """OSPF está ativo se enableOspf=True OU routingMode=='frr-ospf'."""
    if payload.get("enableOspf") is True:
        return True
    if payload.get("routingMode") == "frr-ospf":
        return True
    # Compat com payload normalizado (bloco ospf)
    ospf = payload.get("ospf", {})
    if ospf.get("enabled") is True:
        return True
    return False


def _is_interception(payload: dict[str, Any]) -> bool:
    return payload.get("operationMode") == "interception"


def generate_frr_config(payload: dict[str, Any]) -> list[dict]:
    """
    Em modo Interceptação: SEMPRE emite frr.conf + daemons (placeholder ou ativo).
    Em modo Simples: não emite nada (FRR não faz parte desse layout).
    """
    if not _is_interception(payload):
        return []

    ospf = payload.get("ospf", {})
    loopback = payload.get("loopback", {})
    env = payload.get("environment", {})
    hostname = env.get("hostname") or "dns-control"
    ospf_active = _is_ospf_enabled(payload)

    if not ospf_active:
        # Placeholder seguro — layout homologado preservado, sem adjacências
        config = f"""! DNS Control — FRR placeholder (OSPF desativado)
! Layout homologado: este arquivo SEMPRE existe no modo Interceptação.
! Para ativar OSPF, habilite no Wizard → Roteamento (FRR/OSPF).
!
frr version 10.2
frr defaults traditional
hostname {hostname}
log syslog informational
service integrated-vtysh-config
!
! router ospf
!  ospf router-id <preencher no Wizard>
!
line vty
!
"""
    else:
        # ── Modo Interceptação (OSPF ativo) ─────────────────────────────
        # Gerado byte-a-byte fiel ao gabarito (servidor homologado, vtysh
        # show running-config). Não adicionar diretivas extras: o produto
        # reproduz o layout manual aprovado.
        router_id = ospf.get("routerId", loopback.get("ip", "10.0.0.1"))
        area = ospf.get("area", "0.0.0.0")
        interfaces = ospf.get("interfaces", [])
        network_cidr = env.get("networkCidr", "10.0.0.0/24")
        default_cost = ospf.get("cost", 1) or 1
        metric = ospf.get("redistributeMetric", 10) or 10

        host_ipv4_raw = str(env.get("ipv4Address") or payload.get("ipv4Address") or "").strip()
        host_ipv4 = host_ipv4_raw.split("/")[0].strip() if host_ipv4_raw else ""

        wizard_cfg = payload.get("_wizardConfig", {}) or {}
        enable_ipv6 = bool(payload.get("enableIpv6") or wizard_cfg.get("enableIpv6") or env.get("enableIpv6"))
        main_iface = env.get("mainInterface") or wizard_cfg.get("mainInterface") or ""

        # Conjunto de interfaces OSPF (mainInterface garantida)
        normalized_ifaces: list[dict] = []
        seen_names: set[str] = set()
        for iface in interfaces:
            if isinstance(iface, dict) and iface.get("name"):
                normalized_ifaces.append(iface)
                seen_names.add(iface["name"])
            elif isinstance(iface, str) and iface:
                normalized_ifaces.append({"name": iface})
                seen_names.add(iface)
        if main_iface and main_iface not in seen_names:
            normalized_ifaces.insert(0, {"name": main_iface})

        lines: list[str] = [
            "frr version 8.4.4",
            "frr defaults traditional",
            f"hostname {hostname}",
            "service integrated-vtysh-config",
            "!",
            "interface lo0",
            "exit",
            "!",
        ]

        for iface in normalized_ifaces:
            iface_name = iface.get("name", "")
            if not iface_name:
                continue
            cost = iface.get("cost", default_cost)
            lines.append(f"interface {iface_name}")
            lines.append(f" ip ospf cost {cost}")
            lines.append(" ip ospf network point-to-point")
            if enable_ipv6:
                lines.append(f" ipv6 ospf6 area {area}")
                lines.append(f" ipv6 ospf6 cost {cost}")
                lines.append(" ipv6 ospf6 network point-to-point")
            lines.append("exit")
            lines.append("!")

        lines += [
            "router ospf",
            f" ospf router-id {router_id}",
            " redistribute connected",
            f" network {network_cidr} area {area}",
            "exit",
            "!",
        ]

        if host_ipv4:
            lines += [
                "route-map OSPF-IMPORT-CONNECTED-IPV4 permit 65535",
                f" set ip next-hop {host_ipv4}",
                f" set metric {metric}",
                " set metric-type type-1",
                "exit",
                "!",
            ]

        lines += [
            "segment-routing",
            " traffic-eng",
            " exit",
            "exit",
            "!",
            "",
        ]

        config = "\n".join(lines)

    files = [{
        "path": "/etc/frr/frr.conf",
        "content": config,
        "permissions": "0640",
        "owner": "frr:frr",
    }]

    # Daemons: ospf6d ligado em dual-stack (gabarito) — as diretivas ipv6
    # ospf6 na interface exigem ospf6d ativo mesmo sem bloco router ospf6.
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    enable_ipv6_d = bool(payload.get("enableIpv6") or wizard_cfg.get("enableIpv6") or payload.get("environment", {}).get("enableIpv6"))
    ospf6_active = ospf_active and enable_ipv6_d

    daemons = f"""# DNS Control — FRR daemons
# Layout homologado: este arquivo SEMPRE existe no modo Interceptação.
# OSPF ativo: {"SIM" if ospf_active else "NÃO (placeholder seguro)"}
ospfd={"yes" if ospf_active else "no"}
ospf6d={"yes" if ospf6_active else "no"}
bgpd=no
ripd=no
ripngd=no
isisd=no
pimd=no
ldpd=no
nhrpd=no
eigrpd=no
babeld=no
sharpd=no
staticd=yes
pbrd=no
bfdd=no
fabricd=no
vrrpd=no
pathd=no

vtysh_enable=yes
zebra_options="  -A 127.0.0.1 -s 90000000"
ospfd_options="  -A 127.0.0.1"
ospf6d_options="  -A ::1"
staticd_options="-A 127.0.0.1"
"""

    files.append({
        "path": "/etc/frr/daemons",
        "content": daemons,
        "permissions": "0640",
        "owner": "frr:frr",
    })

    return files


