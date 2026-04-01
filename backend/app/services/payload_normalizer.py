"""
DNS Control — Payload Normalizer
Transforms frontend WizardConfig format into the internal backend payload format
expected by validators and generators.
"""

from typing import Any


def normalize_payload(raw: dict[str, Any]) -> dict[str, Any]:
    """
    Accept both the frontend WizardConfig (flat) format and the legacy
    internal (nested) format. Returns the internal format used by generators.

    If the payload already has 'environment' key with 'environmentId', assume
    it's already in internal format and return as-is.
    """
    # Already in internal format?
    env = raw.get("environment", {})
    if isinstance(env, dict) and env.get("environmentId"):
        return raw

    # ── Transform WizardConfig → internal format ──

    hostname = raw.get("hostname", "")
    ipv4_cidr = raw.get("ipv4Cidr", "")
    ipv4_address = raw.get("ipv4Address", "")

    # Build environment block
    environment = {
        "environmentId": raw.get("project") or raw.get("organization") or hostname or "default",
        "networkCidr": ipv4_cidr or "0.0.0.0/0",
        "hostname": hostname,
        "organization": raw.get("organization", ""),
        "project": raw.get("project", ""),
        "description": raw.get("description", ""),
        "timezone": raw.get("timezone", "UTC"),
        "mainInterface": raw.get("mainInterface", "eth0"),
        "ipv4Address": ipv4_address,
        "ipv4Gateway": raw.get("ipv4Gateway", ""),
        "enableIpv6": raw.get("enableIpv6", False),
        "ipv6Address": raw.get("ipv6Address", ""),
        "ipv6Gateway": raw.get("ipv6Gateway", ""),
        "vlanTag": raw.get("vlanTag", ""),
        "behindFirewall": raw.get("behindFirewall", False),
        "deploymentMode": raw.get("deploymentMode", "internal-recursive"),
    }

    # Build instances block (map frontend DnsInstance to internal format)
    raw_instances = raw.get("instances", [])
    instances = []
    for inst in raw_instances:
        instances.append({
            "name": inst.get("name", "unbound"),
            "bindIp": inst.get("bindIp", "127.0.0.1"),
            "bindIpv6": inst.get("bindIpv6", ""),
            "publicListenerIp": inst.get("publicListenerIp", ""),
            "port": 53,
            "exitIp": inst.get("egressIpv4", ""),
            "exitIpv6": inst.get("egressIpv6", ""),
            "controlInterface": inst.get("controlInterface", "127.0.0.1"),
            "controlPort": inst.get("controlPort", 8953),
        })

    # Build VIPs / loopback block
    service_vips = raw.get("serviceVips", [])
    primary_vip = service_vips[0]["ipv4"] if service_vips else ""
    loopback = {
        "ip": ipv4_address,
        "vip": primary_vip,
    }

    # Build NAT block from VIP mappings and distribution policy
    nat = {
        "distributionPolicy": raw.get("distributionPolicy", "round-robin"),
        "stickyTimeout": raw.get("stickyTimeout", 300),
        "vipMappings": raw.get("vipMappings", []),
        "serviceVips": service_vips,
    }

    # Build security block from access control
    acl_ipv4 = raw.get("accessControlIpv4", [])
    allowed_cidrs = [entry.get("network", "0.0.0.0/0") for entry in acl_ipv4] if acl_ipv4 else ["0.0.0.0/0"]
    security = {
        "allowedCidrs": allowed_cidrs,
        "accessControlIpv4": acl_ipv4,
        "accessControlIpv6": raw.get("accessControlIpv6", []),
        "enableDnsProtection": raw.get("enableDnsProtection", False),
        "enableAntiAmplification": raw.get("enableAntiAmplification", False),
        "rateLimitQps": 0,  # TODO: expose in wizard
    }

    # Build OSPF block
    ospf = {
        "routerId": raw.get("routerId", ""),
        "area": raw.get("ospfArea", "0.0.0.0"),
        "interfaces": raw.get("ospfInterfaces", []),
        "redistribute": ["connected"] if raw.get("redistributeConnected", False) else [],
        "cost": raw.get("ospfCost", 10),
        "networkType": raw.get("networkType", "point-to-point"),
    }

    # Build DNS tuning block
    dns_tuning = {
        "threads": raw.get("threads", 4),
        "msgCacheSize": raw.get("msgCacheSize", "50m"),
        "rrsetCacheSize": raw.get("rrsetCacheSize", "100m"),
        "keyCacheSize": raw.get("keyCacheSize", "50m"),
        "minTtl": raw.get("minTtl", 60),
        "maxTtl": raw.get("maxTtl", 86400),
        "rootHintsPath": raw.get("rootHintsPath", "/usr/share/dns/root.hints"),
        "enableDetailedLogs": raw.get("enableDetailedLogs", False),
        "enableBlocklist": raw.get("enableBlocklist", False),
        "dnsIdentity": raw.get("dnsIdentity", ""),
        "dnsVersion": raw.get("dnsVersion", ""),
        "bootstrapDns": raw.get("bootstrapDns", ""),
    }

    intercepted_vips = raw.get("interceptedVips", [])

    # Determine operation mode — simple mode disables all interception/nftables
    operation_mode = raw.get("operationMode", "interception")

    # In simple mode, force-clear interception data to prevent leakage
    if operation_mode == "simple":
        intercepted_vips = []
        nat["serviceVips"] = []
        nat["vipMappings"] = []
        loopback["vip"] = ""

    return {
        "environment": environment,
        "instances": instances,
        "loopback": loopback,
        "nat": nat,
        "interceptedVips": intercepted_vips,
        "security": security,
        "ospf": ospf,
        "dnsTuning": dns_tuning,
        "routingMode": raw.get("routingMode", "static"),
        "observability": raw.get("observability", {}),
        "egressMode": raw.get("egressMode", "fixed-per-instance"),
        "egressDeliveryMode": raw.get("egressDeliveryMode", "host-owned"),
        "operationMode": operation_mode,
        "frontendDnsIp": raw.get("frontendDnsIp", ""),
        "ipv4Address": ipv4_address,
        "stickyTimeout": raw.get("stickyTimeout", 0),
        # Preserve raw config for reference
        "_wizardConfig": raw,
    }
