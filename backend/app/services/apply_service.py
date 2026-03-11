"""
DNS Control — Apply Service
Orchestrates the full apply workflow: validate, generate, backup, write, restart.
"""

import os
import shutil
from datetime import datetime
from typing import Any

from app.core.config import settings
from app.services.config_service import validate_config, generate_preview
from app.executors.command_runner import run_command


def execute_apply(payload: dict[str, Any], scope: str = "full", dry_run: bool = False) -> dict:
    steps = []
    stdout_parts = []
    stderr_parts = []
    success = True

    # Step 1: Validate
    step = {"order": 1, "name": "Validar parâmetros", "status": "running", "output": "", "duration_ms": 0, "command": None}
    validation = validate_config(payload)
    if not validation["valid"]:
        step["status"] = "failed"
        step["output"] = f"Erros: {validation['errors']}"
        steps.append(step)
        return {"success": False, "steps": steps, "stdout": "", "stderr": str(validation["errors"]), "exit_code": 1}
    step["status"] = "success"
    step["output"] = "Todos os parâmetros válidos"
    steps.append(step)

    # Step 2: Generate files
    files = generate_preview(payload)
    steps.append({"order": 2, "name": "Gerar arquivos", "status": "success", "output": f"{len(files)} arquivos gerados", "duration_ms": 50, "command": None})

    if dry_run:
        steps.append({"order": 3, "name": "Dry-run completo", "status": "success", "output": "Nenhuma alteração aplicada (dry-run)", "duration_ms": 0, "command": None})
        return {"success": True, "steps": steps, "stdout": "", "stderr": "", "exit_code": 0}

    # Step 3: Backup
    backup_dir = os.path.join(settings.BACKUP_DIR, datetime.now().strftime("%Y%m%d_%H%M%S"))
    os.makedirs(backup_dir, exist_ok=True)
    for f in files:
        src = f["path"]
        if os.path.exists(src):
            dst = os.path.join(backup_dir, src.lstrip("/").replace("/", "_"))
            shutil.copy2(src, dst)
    steps.append({"order": 3, "name": "Backup configuração atual", "status": "success", "output": f"Backup salvo em {backup_dir}", "duration_ms": 100, "command": None})

    # Step 4: Write files
    for f in files:
        if _scope_matches(f["path"], scope):
            dir_path = os.path.dirname(f["path"])
            os.makedirs(dir_path, exist_ok=True)
            with open(f["path"], "w") as fp:
                fp.write(f["content"])
            os.chmod(f["path"], int(f.get("permissions", "0644"), 8))
    steps.append({"order": 4, "name": "Gravar arquivos em disco", "status": "success", "output": "Arquivos gravados", "duration_ms": 80, "command": None})

    # Step 5: Restart services based on scope
    restart_cmds = _get_restart_commands(scope, payload)
    order = 5
    for cmd_name, cmd_args in restart_cmds:
        result = run_command(cmd_args[0], cmd_args[1:], timeout=30)
        status_val = "success" if result["exit_code"] == 0 else "failed"
        if result["exit_code"] != 0:
            success = False
        steps.append({
            "order": order, "name": cmd_name, "status": status_val,
            "output": result["stdout"][:500], "duration_ms": result["duration_ms"],
            "command": " ".join(cmd_args),
        })
        stdout_parts.append(result["stdout"])
        stderr_parts.append(result["stderr"])
        order += 1

    return {
        "success": success, "steps": steps,
        "stdout": "\n".join(stdout_parts),
        "stderr": "\n".join(stderr_parts),
        "exit_code": 0 if success else 1,
    }


def _scope_matches(path: str, scope: str) -> bool:
    if scope == "full":
        return True
    if scope == "dns" and "/unbound/" in path:
        return True
    if scope == "nftables" and "nftables" in path:
        return True
    if scope == "frr" and "/frr/" in path:
        return True
    if scope == "network" and ("/network/" in path or "interfaces" in path):
        return True
    return False


def _get_restart_commands(scope: str, payload: dict) -> list[tuple[str, list[str]]]:
    cmds = []
    if scope in ("full", "nftables"):
        cmds.append(("Aplicar nftables", ["nft", "-f", "/etc/nftables.conf"]))
    if scope in ("full", "dns"):
        instances = payload.get("instances", [])
        for inst in instances:
            name = inst.get("name", "unbound")
            cmds.append((f"Reiniciar {name}", ["systemctl", "restart", name]))
    if scope in ("full", "frr"):
        cmds.append(("Reiniciar FRR", ["systemctl", "restart", "frr"]))
    if scope in ("full", "network"):
        cmds.append(("Recarregar rede", ["ifreload", "-a"]))
    return cmds
