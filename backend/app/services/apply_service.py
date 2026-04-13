"""Compatibility wrapper for the legacy /api/apply endpoints.

All real writes must flow through execute_deploy so nftables/unbound/system files
use the audited privileged install path with metadata verification.
"""

from typing import Any

from app.services.deploy_service import execute_deploy


def execute_apply(
    payload: dict[str, Any],
    scope: str = "full",
    dry_run: bool = False,
    operator: str = "legacy-apply",
) -> dict[str, Any]:
    return execute_deploy(
        payload=payload,
        scope=scope,
        dry_run=dry_run,
        operator=operator,
    )
