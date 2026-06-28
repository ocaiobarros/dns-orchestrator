"""DNS Control — Upstream probe worker.

Periodically probes configured DNS upstreams (forward-addr) and refreshes
the in-memory state cache in :mod:`upstream_probe_service`. Read-only.

A second, slower job runs the optional path probe (mtr/traceroute).
"""

from __future__ import annotations

import logging

from app.services import upstream_probe_service

logger = logging.getLogger("dns-control.upstream_probe_worker")


def upstream_probe_job() -> None:
    """Fast cycle: PoP code + rtt + alive. Runs every 30s."""
    try:
        results = upstream_probe_service.run_probe_cycle(with_path=False)
        if results:
            alive = sum(1 for r in results if r.get("alive"))
            logger.debug(
                "upstream probe cycle: %d/%d alive", alive, len(results)
            )
    except Exception:
        logger.exception("upstream_probe_job failed")


def upstream_path_probe_job() -> None:
    """Slow cycle: also runs mtr/traceroute. Runs every 5 min."""
    try:
        upstream_probe_service.run_probe_cycle(with_path=True)
    except Exception:
        logger.exception("upstream_path_probe_job failed")
