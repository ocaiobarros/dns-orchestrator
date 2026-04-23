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
        redistribute = ospf.get("redistribute", [])
        network_cidr = env.get("networkCidr", "10.0.0.0/24")

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

        for iface in interfaces:
            iface_name = iface.get("name", "") if isinstance(iface, dict) else str(iface)
            passive = iface.get("passive", False) if isinstance(iface, dict) else False
            cost = iface.get("cost", 10) if isinstance(iface, dict) else 10
            if iface_name:
                config += f"""interface {iface_name}
 ip ospf cost {cost}
 ip ospf hello-interval 10
 ip ospf dead-interval 40
"""
                if passive:
                    config += " ip ospf passive\n"
                config += "!\n"

        if loopback.get("ip"):
            config += """interface lo
 ip ospf passive
!
"""

        config += f"""router ospf
 ospf router-id {router_id}
 network {network_cidr} area {area}
"""

        if loopback.get("ip"):
            config += f" network {loopback['ip']}/32 area {area}\n"

        if loopback.get("vip"):
            config += f" network {loopback['vip']}/32 area {area}\n"

        for r in redistribute:
            config += f" redistribute {r}\n"

        config += """ passive-interface lo
 log-adjacency-changes
!
line vty
!
"""

    files = [{
        "path": "/etc/frr/frr.conf",
        "content": config,
        "permissions": "0640",
        "owner": "frr:frr",
    }]

    daemons = f"""# DNS Control — FRR daemons
# Layout homologado: este arquivo SEMPRE existe no modo Interceptação.
# OSPF ativo: {"SIM" if ospf_active else "NÃO (placeholder seguro)"}
ospfd={"yes" if ospf_active else "no"}
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
staticd_options="-A 127.0.0.1"
"""

    files.append({
        "path": "/etc/frr/daemons",
        "content": daemons,
        "permissions": "0640",
        "owner": "frr:frr",
    })

    return files
