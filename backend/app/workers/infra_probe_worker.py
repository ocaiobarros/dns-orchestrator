"""DNS Control — Infra probe worker.

Periodically reads `unbound-control dump_infra` from each local instance,
classifies entries by provider/CDN, and refreshes the live CDN-map state.
Powers the iterative-mode network map. Read-only.
"""

from __future__ import annotations

import logging

from app.services import infra_probe_service

logger = logging.getLogger("dns-control.infra_probe_worker")


def infra_probe_job() -> None:
    """Slow cycle: re-read dump_infra + opportunistic geo. Runs every 60s."""
    try:
        n = infra_probe_service.run_probe_cycle()
        logger.debug("infra probe cycle merged %d entries", n)
    except Exception:
        logger.exception("infra_probe_job failed")
