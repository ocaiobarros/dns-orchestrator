"""
DNS Control — System Routes
On-demand self-test for post-install and post-upgrade verification.
"""

from __future__ import annotations

from time import monotonic
from typing import Any

import httpx
from fastapi import APIRouter, Body, Depends
from sqlalchemy import text

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import SessionLocal
from app.executors.command_runner import run_command
from app.models.user import User

router = APIRouter()


def _check_systemd_api() -> dict[str, Any]:
    start = monotonic()
    result = run_command("systemctl", ["is-active", "dns-control-api"], timeout=5, use_privilege=True)
    active = result.get("exit_code") == 0 and result.get("stdout", "").strip() == "active"
    return {
        "name": "systemd_active",
        "status": "pass" if active else "fail",
        "detail": "dns-control-api.service ativo" if active else (result.get("stderr") or result.get("stdout") or "service inactive").strip(),
        "duration_ms": int((monotonic() - start) * 1000),
    }


def _check_api_health() -> dict[str, Any]:
    start = monotonic()
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get("http://127.0.0.1:8000/api/health")
        if response.status_code != 200:
            return {
                "name": "api_health",
                "status": "fail",
                "detail": f"HTTP {response.status_code}",
                "duration_ms": int((monotonic() - start) * 1000),
            }

        payload = response.json()
        health_status = payload.get("status", "unknown")
        return {
            "name": "api_health",
            "status": "pass" if health_status in ("ok", "degraded") else "fail",
            "detail": f"status={health_status}",
            "duration_ms": int((monotonic() - start) * 1000),
        }
    except Exception as exc:
        return {
            "name": "api_health",
            "status": "fail",
            "detail": str(exc),
            "duration_ms": int((monotonic() - start) * 1000),
        }


def _check_database() -> dict[str, Any]:
    start = monotonic()
    db = SessionLocal()
    try:
        users_count = db.execute(text("SELECT count(*) FROM users")).scalar_one()
        return {
            "name": "database_access",
            "status": "pass",
            "detail": f"users={users_count}",
            "duration_ms": int((monotonic() - start) * 1000),
        }
    except Exception as exc:
        return {
            "name": "database_access",
            "status": "fail",
            "detail": str(exc),
            "duration_ms": int((monotonic() - start) * 1000),
        }
    finally:
        db.close()


def _check_login(username: str, password: str) -> dict[str, Any]:
    start = monotonic()
    try:
        with httpx.Client(timeout=4.0) as client:
            response = client.post(
                "http://127.0.0.1:8000/api/auth/login",
                json={"username": username, "password": password},
            )

        if response.status_code == 200:
            return {
                "name": "login_functional",
                "status": "pass",
                "detail": f"login OK para {username}",
                "duration_ms": int((monotonic() - start) * 1000),
            }

        if response.status_code in (401, 403):
            return {
                "name": "login_functional",
                "status": "warn",
                "detail": f"endpoint respondeu {response.status_code} (credencial pode ter mudado)",
                "duration_ms": int((monotonic() - start) * 1000),
            }

        return {
            "name": "login_functional",
            "status": "fail",
            "detail": f"HTTP {response.status_code}",
            "duration_ms": int((monotonic() - start) * 1000),
        }
    except Exception as exc:
        return {
            "name": "login_functional",
            "status": "fail",
            "detail": str(exc),
            "duration_ms": int((monotonic() - start) * 1000),
        }


def _check_nft_access() -> dict[str, Any]:
    start = monotonic()
    result = run_command("nft", ["list", "tables"], timeout=5, use_privilege=True)
    ok = result.get("exit_code") == 0
    return {
        "name": "nft_access",
        "status": "pass" if ok else "fail",
        "detail": "nft list tables OK" if ok else (result.get("stderr") or "nft failed").strip(),
        "duration_ms": int((monotonic() - start) * 1000),
    }


def _check_sudoers() -> dict[str, Any]:
    """Check that the service user has sudo privileges configured."""
    start = monotonic()
    import os
    sudoers_path = "/etc/sudoers.d/dns-control"
    if os.path.isfile(sudoers_path):
        return {
            "name": "sudoers_ok",
            "status": "pass",
            "detail": f"{sudoers_path} exists",
            "duration_ms": int((monotonic() - start) * 1000),
        }
    return {
        "name": "sudoers_ok",
        "status": "fail",
        "detail": f"{sudoers_path} not found",
        "duration_ms": int((monotonic() - start) * 1000),
    }


@router.post("/self-test")
def run_self_test(
    body: dict[str, Any] = Body(default={}),
    _: User = Depends(get_current_user),
):
    username = (body or {}).get("username") or settings.INITIAL_ADMIN_USERNAME
    password = (body or {}).get("password") or settings.INITIAL_ADMIN_PASSWORD

    checks = [
        _check_systemd_api(),
        _check_api_health(),
        _check_database(),
        _check_login(username=username, password=password),
        _check_nft_access(),
        _check_sudoers(),
    ]

    passed = sum(1 for c in checks if c["status"] == "pass")
    warned = sum(1 for c in checks if c["status"] == "warn")
    failed = sum(1 for c in checks if c["status"] == "fail")

    return {
        "overall": "ok" if failed == 0 else "failed",
        "passed": passed,
        "warned": warned,
        "failed": failed,
        "checks": checks,
    }
