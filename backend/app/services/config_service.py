"""
DNS Control — Config Service
Validation and preview generation for configuration profiles.
"""

from typing import Any
from app.generators.unbound_generator import generate_unbound_configs
from app.generators.nftables_generator import generate_nftables_config
from app.generators.nftables_simple_generator import generate_simple_nftables_config
from app.generators.frr_generator import generate_frr_config
from app.generators.network_generator import generate_network_config
from app.generators.systemd_generator import generate_systemd_units
from app.generators.ip_blocking_generator import generate_ip_blocking_configs
from app.generators.sysctl_generator import generate_sysctl_configs
from app.services.payload_normalizer import normalize_payload


def validate_config(payload: dict[str, Any]) -> dict:
    """Validate config payload. Accepts both WizardConfig and internal formats."""
    normalized = normalize_payload(payload)
    errors = []
    env = normalized.get("environment", {})
    if not env.get("environmentId"):
        errors.append({"field": "environment.environmentId", "message": "ID do ambiente é obrigatório"})
    if not env.get("networkCidr"):
        errors.append({"field": "environment.networkCidr", "message": "CIDR de rede é obrigatório"})

    instances = normalized.get("instances", [])
    if not instances:
        errors.append({"field": "instances", "message": "Pelo menos uma instância Unbound é necessária"})

    # ═══ Egress delivery mode validation ═══
    egress_mode = normalized.get("egressDeliveryMode", "host-owned")
    seen_egress: set[str] = set()
    primary_ip = normalized.get("ipv4Address", "").split("/")[0].strip()
    all_bind_ips = {inst.get("bindIp", "") for inst in instances if inst.get("bindIp")}
    all_vips = set()
    for v in normalized.get("interceptedVips", []):
        if isinstance(v, dict) and v.get("vipIp"):
            all_vips.add(v["vipIp"])
    for v in normalized.get("serviceVips", []) or normalized.get("nat", {}).get("serviceVips", []) or []:
        if isinstance(v, dict) and v.get("ipv4"):
            all_vips.add(v["ipv4"])

    for inst in instances:
        exit_ip = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
        name = inst.get("name", "unbound")
        if not exit_ip:
            continue
        # Duplicate check
        if exit_ip in seen_egress:
            errors.append({
                "field": f"instances.{name}.exitIp",
                "message": f"IP de egress {exit_ip} duplicado entre instâncias",
            })
        seen_egress.add(exit_ip)
        # Collision with primary host IP
        if exit_ip == primary_ip:
            errors.append({
                "field": f"instances.{name}.exitIp",
                "message": f"IP de egress {exit_ip} colide com o IP principal do host",
            })
        # Collision with listener/bind IPs
        if exit_ip in all_bind_ips:
            errors.append({
                "field": f"instances.{name}.exitIp",
                "message": f"IP de egress {exit_ip} colide com um listener IP interno",
            })
        # Collision with VIPs
        if exit_ip in all_vips:
            errors.append({
                "field": f"instances.{name}.exitIp",
                "message": f"IP de egress {exit_ip} colide com um VIP interceptado ou de serviço",
            })

    return {"valid": len(errors) == 0, "errors": errors, "normalized": normalized}


def generate_preview(payload: dict[str, Any]) -> list[dict]:
    """Generate file previews. Accepts both WizardConfig and internal formats."""
    normalized = normalize_payload(payload)
    is_simple = normalized.get("operationMode") == "simple"
    files = []
    try:
        files.extend(generate_unbound_configs(normalized))
    except Exception:
        pass
    # nftables interception artifacts — ONLY for interception mode
    if not is_simple:
        try:
            files.extend(generate_nftables_config(normalized))
        except Exception:
            pass
    try:
        files.extend(generate_frr_config(normalized))
    except Exception:
        pass
    try:
        files.extend(generate_network_config(normalized))
    except Exception:
        pass
    try:
        files.extend(generate_systemd_units(normalized))
    except Exception:
        pass
    try:
        files.extend(generate_ip_blocking_configs(normalized))
    except Exception:
        pass
    try:
        files.extend(generate_sysctl_configs(normalized))
    except Exception:
        pass
    return files


def diff_configs(old_payload: dict, new_payload: dict) -> list[dict]:
    old_files = {f["path"]: f["content"] for f in generate_preview(old_payload)}
    new_files = {f["path"]: f["content"] for f in generate_preview(new_payload)}

    diffs = []
    all_paths = set(list(old_files.keys()) + list(new_files.keys()))
    for path in sorted(all_paths):
        old_content = old_files.get(path, "")
        new_content = new_files.get(path, "")
        if old_content != new_content:
            diffs.append({"path": path, "old_content": old_content, "new_content": new_content})
    return diffs
