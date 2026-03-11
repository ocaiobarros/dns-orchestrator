"""
DNS Control v2.1 — Worker Scheduler
Runs background health, metrics, and reconciliation workers using APScheduler.
Includes file-lock protection against duplicate workers in multi-process deployments.
"""

import logging
import os
import tempfile
import fcntl
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.workers.health_worker import health_check_job
from app.workers.metrics_worker import metrics_collection_job
from app.workers.reconciliation_worker import reconciliation_job

logger = logging.getLogger("dns-control.scheduler")

_scheduler: BackgroundScheduler | None = None
_lock_file = None
_lock_fd = None

LOCK_PATH = os.path.join(tempfile.gettempdir(), "dns-control-scheduler.lock")


def _acquire_lock() -> bool:
    """
    Acquire a file lock to prevent duplicate scheduler instances.
    This protects against multiple FastAPI workers starting their own schedulers.
    """
    global _lock_fd
    try:
        _lock_fd = open(LOCK_PATH, "w")
        fcntl.flock(_lock_fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_fd.write(str(os.getpid()))
        _lock_fd.flush()
        logger.info(f"Scheduler lock acquired (pid={os.getpid()})")
        return True
    except (IOError, OSError):
        logger.info(f"Scheduler lock already held by another process — skipping scheduler start (pid={os.getpid()})")
        if _lock_fd:
            _lock_fd.close()
            _lock_fd = None
        return False


def _release_lock():
    """Release the scheduler file lock."""
    global _lock_fd
    if _lock_fd:
        try:
            fcntl.flock(_lock_fd.fileno(), fcntl.LOCK_UN)
            _lock_fd.close()
        except Exception:
            pass
        _lock_fd = None
        try:
            os.unlink(LOCK_PATH)
        except Exception:
            pass
        logger.info("Scheduler lock released")


def start_scheduler():
    """Start the background scheduler with all v2.1 workers."""
    global _scheduler

    if _scheduler and _scheduler.running:
        logger.info("Scheduler already running")
        return

    # File lock: only one process runs the scheduler
    if not _acquire_lock():
        return

    _scheduler = BackgroundScheduler(
        job_defaults={"coalesce": True, "max_instances": 1},
    )

    _scheduler.add_job(
        health_check_job,
        trigger=IntervalTrigger(seconds=10),
        id="health_worker",
        name="DNS Instance Health Checks",
        replace_existing=True,
    )

    _scheduler.add_job(
        metrics_collection_job,
        trigger=IntervalTrigger(seconds=30),
        id="metrics_worker",
        name="Unbound Metrics Collection",
        replace_existing=True,
    )

    _scheduler.add_job(
        reconciliation_job,
        trigger=IntervalTrigger(seconds=10),
        id="reconciliation_worker",
        name="DNAT Reconciliation",
        replace_existing=True,
    )

    _scheduler.start()
    logger.info("v2.1 Scheduler started: health(10s), metrics(30s), reconciliation(10s) — file-lock protected")


def stop_scheduler():
    """Gracefully stop the scheduler and release lock."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
        _scheduler = None
    _release_lock()


def get_scheduler_status() -> dict:
    """Get scheduler status and job info."""
    if not _scheduler or not _scheduler.running:
        return {"running": False, "jobs": []}

    jobs = []
    for job in _scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
        })

    return {"running": True, "jobs": jobs}
