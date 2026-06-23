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
        router_id = ospf.get("routerId", loopback.get("ip", "10.0.0.1"))
        area = ospf.get("area", "0.0.0.0")
        interfaces = ospf.get("interfaces", [])
        redistribute = ospf.get("redistribute", []) or ["connected"]
        network_cidr = env.get("networkCidr", "10.0.0.0/24")
        network_type = ospf.get("networkType", "point-to-point") or "point-to-point"
        hello = ospf.get("helloInterval", 10)
        dead = ospf.get("deadInterval", 40)
        default_cost = ospf.get("cost", 1) or 1

        # Host main IPv4 (sem máscara) — usado como next-hop do route-map
        host_ipv4_raw = str(env.get("ipv4Address") or payload.get("ipv4Address") or "").strip()
        host_ipv4 = host_ipv4_raw.split("/")[0].strip() if host_ipv4_raw else ""

        wizard_cfg = payload.get("_wizardConfig", {}) or {}
        enable_ipv6 = bool(payload.get("enableIpv6") or wizard_cfg.get("enableIpv6") or env.get("enableIpv6"))
        main_iface = env.get("mainInterface") or wizard_cfg.get("mainInterface") or ""

        # Garantir que a interface principal apareça no bloco de interfaces
        normalized_ifaces: list[dict] = []
        seen_names: set[str] = set()
        for iface in interfaces:
            if isinstance(iface, dict):
                normalized_ifaces.append(iface)
                if iface.get("name"):
                    seen_names.add(iface["name"])
            elif isinstance(iface, str) and iface:
                normalized_ifaces.append({"name": iface})
                seen_names.add(iface)
        if main_iface and main_iface not in seen_names:
            normalized_ifaces.insert(0, {"name": main_iface})

        config = f"""! DNS Control — FRR configuration
! Generated configuration — do not edit manually
!
frr version 10.2
frr defaults traditional
hostname {hostname}
log syslog informational
service integrated-vtysh-config
!
"""

        for iface in normalized_ifaces:
            iface_name = iface.get("name", "")
            if not iface_name:
                continue
            passive = bool(iface.get("passive", False))
            cost = iface.get("cost", default_cost)
            config += f"interface {iface_name}\n"
            config += f" ip ospf cost {cost}\n"
            config += f" ip ospf network {network_type}\n"
            config += f" ip ospf hello-interval {hello}\n"
            config += f" ip ospf dead-interval {dead}\n"
            if passive:
                config += " ip ospf passive\n"
            if enable_ipv6:
                config += f" ipv6 ospf6 area {area}\n"
                config += f" ipv6 ospf6 cost {cost}\n"
                config += f" ipv6 ospf6 network {network_type}\n"
            config += "!\n"

        if loopback.get("ip"):
            config += "interface lo\n ip ospf passive\n!\n"

        config += f"router ospf\n ospf router-id {router_id}\n"
        for r in redistribute:
            config += f" redistribute {r}\n"
        config += f" network {network_cidr} area {area}\n"
        if loopback.get("ip"):
            config += f" network {loopback['ip']}/32 area {area}\n"
        if loopback.get("vip"):
            config += f" network {loopback['vip']}/32 area {area}\n"
        config += " passive-interface lo\n log-adjacency-changes\n!\n"

        # ── router ospf6 (dual-stack) ──
        if enable_ipv6:
            config += f"router ospf6\n ospf6 router-id {router_id}\n"
            for r in redistribute:
                config += f" redistribute {r}\n"
            config += "!\n"

        # ── route-map OSPF-IMPORT-CONNECTED-IPV4 ──
        # Ajusta next-hop e métrica das rotas redistribute connected (em
        # especial dos VIPs interceptados em lo0). Reproduz o gabarito.
        if host_ipv4:
            metric = ospf.get("redistributeMetric", 10) or 10
            config += "route-map OSPF-IMPORT-CONNECTED-IPV4 permit 65535\n"
            config += f" set ip next-hop {host_ipv4}\n"
            config += f" set metric {metric}\n"
            config += " set metric-type type-1\n!\n"

        config += "line vty\n!\n"

    files = [{
        "path": "/etc/frr/frr.conf",
        "content": config,
        "permissions": "0640",
        "owner": "frr:frr",
    }]

    # Daemons: liga ospf6d quando dual-stack + OSPF ativo
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    enable_ipv6 = bool(payload.get("enableIpv6") or wizard_cfg.get("enableIpv6") or payload.get("environment", {}).get("enableIpv6"))
    ospf6_active = ospf_active and enable_ipv6

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

