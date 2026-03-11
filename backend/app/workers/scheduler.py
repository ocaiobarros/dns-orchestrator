"""
DNS Control v2 — Worker Scheduler
Runs background health, metrics, and reconciliation workers using APScheduler.
"""

import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.workers.health_worker import health_check_job
from app.workers.metrics_worker import metrics_collection_job
from app.workers.reconciliation_worker import reconciliation_job

logger = logging.getLogger("dns-control.scheduler")

_scheduler: BackgroundScheduler | None = None


def start_scheduler():
    """Start the background scheduler with all v2 workers."""
    global _scheduler

    if _scheduler and _scheduler.running:
        logger.info("Scheduler already running")
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
    logger.info("v2 Scheduler started: health(10s), metrics(30s), reconciliation(10s)")


def stop_scheduler():
    """Gracefully stop the scheduler."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
        _scheduler = None


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
