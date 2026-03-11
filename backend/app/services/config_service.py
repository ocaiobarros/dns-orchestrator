"""
DNS Control — Config Service
Validation and preview generation for configuration profiles.
"""

from typing import Any
from app.generators.unbound_generator import generate_unbound_configs
from app.generators.nftables_generator import generate_nftables_config
from app.generators.frr_generator import generate_frr_config
from app.generators.network_generator import generate_network_config
from app.generators.systemd_generator import generate_systemd_units


def validate_config(payload: dict[str, Any]) -> dict:
    errors = []
    env = payload.get("environment", {})
    if not env.get("environmentId"):
        errors.append({"field": "environment.environmentId", "message": "ID do ambiente é obrigatório"})
    if not env.get("networkCidr"):
        errors.append({"field": "environment.networkCidr", "message": "CIDR de rede é obrigatório"})

    instances = payload.get("instances", [])
    if not instances:
        errors.append({"field": "instances", "message": "Pelo menos uma instância Unbound é necessária"})

    return {"valid": len(errors) == 0, "errors": errors}


def generate_preview(payload: dict[str, Any]) -> list[dict]:
    files = []
    try:
        files.extend(generate_unbound_configs(payload))
    except Exception:
        pass
    try:
        files.extend(generate_nftables_config(payload))
    except Exception:
        pass
    try:
        files.extend(generate_frr_config(payload))
    except Exception:
        pass
    try:
        files.extend(generate_network_config(payload))
    except Exception:
        pass
    try:
        files.extend(generate_systemd_units(payload))
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
