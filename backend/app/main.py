"""
DNS Control — Backend Entry Point
FastAPI application for managing recursive DNS infrastructure on Debian 13.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db
from app.api.routes import (
    auth, users, dashboard, services, network, dns,
    nat, ospf, logs, troubleshooting, configs, apply,
    files, history, settings as settings_route,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="DNS Control",
    version="1.0.0",
    description="Recursive DNS infrastructure management for Debian 13",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount route groups
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


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}
