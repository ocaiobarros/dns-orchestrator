"""
DNS Control — Command Service
Public interface for the safe command execution layer.
"""

from app.executors.command_catalog import COMMAND_CATALOG, CommandDefinition
from app.executors.command_runner import run_command


def get_available_commands() -> list[dict]:
    return [
        {
            "id": cmd.id, "name": cmd.name,
            "description": cmd.description,
            "category": cmd.category,
            "dangerous": cmd.dangerous,
        }
        for cmd in COMMAND_CATALOG.values()
    ]


def run_whitelisted_command(command_id: str, args: dict[str, str] | None = None) -> dict:
    if command_id not in COMMAND_CATALOG:
        return {
            "command_id": command_id,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Comando não permitido: {command_id}",
            "duration_ms": 0,
        }

    cmd_def = COMMAND_CATALOG[command_id]
    cmd_args = cmd_def.build_args(args or {})

    result = run_command(cmd_def.executable, cmd_args, timeout=cmd_def.timeout)
    result["command_id"] = command_id
    return result
