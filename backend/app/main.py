"""
DNS Control — Backend Entry Point
FastAPI application for managing recursive DNS infrastructure on Debian 13.
v2.1: Stability upgrade — cooldown, quorum health, enhanced observability.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from app.core.config import settings
from app.core.database import init_db, SessionLocal
from app.api.routes import (
    auth, users, dashboard, services, network, dns,
    nat, ospf, logs, troubleshooting, configs, apply,
    files, history, settings as settings_route,
    healthcheck, deploy, import_config,
)
from app.api.routes import (
    health_v2, metrics_v2, events, actions, instances,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()

    # Start v2.1 scheduler (health, metrics, reconciliation workers)
    # File-lock protected against duplicate workers
    try:
        from app.workers.scheduler import start_scheduler, stop_scheduler
        start_scheduler()
    except Exception as e:
        import logging
        logging.getLogger("dns-control").warning(f"Scheduler failed to start: {e}")

    yield

    # Shutdown scheduler
    try:
        from app.workers.scheduler import stop_scheduler
        stop_scheduler()
    except Exception:
        pass


app = FastAPI(
    title="DNS Control",
    version="2.1.0",
    description="Recursive DNS infrastructure management — Carrier Edition (Stability Upgrade)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- v1 routes ----
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(services.router, prefix="/api/services", tags=["Services"])
app.include_router(network.router, prefix="/api/network", tags=["Network"])
app.include_router(dns.router, prefix="/api/dns", tags=["DNS"])
app.include_router(nat.router, prefix="/api/nat", tags=["NAT"])
app.include_router(ospf.router, prefix="/api/ospf", tags=["OSPF"])
app.include_router(logs.router, prefix="/api/logs", tags=["Logs"])
app.include_router(troubleshooting.router, prefix="/api/troubleshooting", tags=["Troubleshooting"])
app.include_router(configs.router, prefix="/api/configs", tags=["Configs"])
app.include_router(apply.router, prefix="/api/apply", tags=["Apply"])
app.include_router(files.router, prefix="/api/files", tags=["Files"])
app.include_router(history.router, prefix="/api/history", tags=["History"])
app.include_router(settings_route.router, prefix="/api/settings", tags=["Settings"])
app.include_router(healthcheck.router, prefix="/api/healthcheck", tags=["Health Check"])
app.include_router(deploy.router, prefix="/api/deploy", tags=["Deploy"])
app.include_router(import_config.router, prefix="/api/config", tags=["Config Import"])
# Backward-compatibility alias for older frontend/runtime combinations.
app.include_router(deploy.router, prefix="/deploy", tags=["Deploy Legacy"])

# ---- v2 routes ----
app.include_router(health_v2.router, prefix="/api/health", tags=["Health v2"])
app.include_router(metrics_v2.router, prefix="/api/metrics", tags=["Metrics v2"])
app.include_router(events.router, prefix="/api/events", tags=["Events"])
app.include_router(actions.router, prefix="/api/actions", tags=["Actions"])
app.include_router(instances.router, prefix="/api/instances", tags=["Instances"])


# ---- Prometheus endpoint (no auth) ----
@app.get("/metrics", response_class=PlainTextResponse, tags=["Prometheus"])
def prometheus_metrics():
    from app.services.prometheus_service import generate_prometheus_output
    db = SessionLocal()
    try:
        return generate_prometheus_output(db)
    finally:
        db.close()


# ---- Health endpoint ----
@app.get("/api/health")
def health_check():
    db_ok = False
    user_count = 0
    scheduler_status = {}
    try:
        db = SessionLocal()
        from app.models.user import User
        user_count = db.query(User).count()
        db_ok = True
        db.close()
    except Exception:
        pass

    try:
        from app.workers.scheduler import get_scheduler_status
        scheduler_status = get_scheduler_status()
    except Exception:
        pass

    return {
        "status": "ok" if db_ok else "degraded",
        "version": "2.1.0",
        "database": "connected" if db_ok else "unreachable",
        "users": user_count,
        "engine": "FastAPI + SQLite + SQLAlchemy",
        "auth": "bcrypt + JWT + server-side sessions",
        "scheduler": scheduler_status,
    }
