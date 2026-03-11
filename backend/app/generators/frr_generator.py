"""
DNS Control — FRR/OSPF Configuration Generator
Generates /etc/frr/frr.conf with OSPF redistribution.
"""

from typing import Any


def generate_frr_config(payload: dict[str, Any]) -> list[dict]:
    ospf = payload.get("ospf", {})
    loopback = payload.get("loopback", {})
    env = payload.get("environment", {})

    router_id = ospf.get("routerId", loopback.get("ip", "10.0.0.1"))
    area = ospf.get("area", "0.0.0.0")
    interfaces = ospf.get("interfaces", [])
    redistribute = ospf.get("redistribute", [])
    network_cidr = env.get("networkCidr", "10.0.0.0/24")

    config = f"""! DNS Control — FRR configuration
! Generated configuration — do not edit manually
!
frr version 9.1
frr defaults traditional
hostname dns-control
log syslog informational
service integrated-vtysh-config
!
"""

    # Interface configurations
    for iface in interfaces:
        iface_name = iface.get("name", "")
        passive = iface.get("passive", False)
        cost = iface.get("cost", 10)
        if iface_name:
            config += f"""interface {iface_name}
 ip ospf cost {cost}
 ip ospf hello-interval 10
 ip ospf dead-interval 40
"""
            if passive:
                config += f" ip ospf passive\n"
            config += "!\n"

    # Loopback
    if loopback.get("ip"):
        config += f"""interface lo
 ip ospf passive
!\n"""

    # OSPF router
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

    # Daemons file
    daemons = """# DNS Control — FRR daemons
ospfd=yes
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
