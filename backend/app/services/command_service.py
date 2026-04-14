"""
DNS Control — Command Service
Public interface for the safe command execution layer.
Supports privilege-aware execution for diagnostic commands.
"""

from app.executors.command_catalog import get_runtime_command_catalog
from app.executors.command_runner import run_command


def get_available_commands() -> list[dict]:
    runtime_catalog = get_runtime_command_catalog()
    return [
        {
            "id": cmd.id, "name": cmd.name,
            "description": cmd.description,
            "category": cmd.category,
            "dangerous": cmd.dangerous,
            "requires_privilege": cmd.requires_privilege,
        }
        for cmd in runtime_catalog.values()
    ]


def run_whitelisted_command(command_id: str, args: dict[str, str] | None = None) -> dict:
    runtime_catalog = get_runtime_command_catalog()
    if command_id not in runtime_catalog:
        return {
            "command_id": command_id,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Comando não permitido: {command_id}",
            "duration_ms": 0,
        }

    cmd_def = runtime_catalog[command_id]
    cmd_args = cmd_def.build_args(args or {})

    # Use privilege escalation when the command requires it
    result = run_command(
        cmd_def.executable,
        cmd_args,
        timeout=cmd_def.timeout,
        use_privilege=cmd_def.requires_privilege,
    )
    result["command_id"] = command_id
    return result
