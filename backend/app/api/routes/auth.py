"""
DNS Control — Auth Routes
Login, logout, session management, password change.
Implements login event throttling to reduce operational noise.
"""

import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import verify_password, hash_password, validate_password_strength
from app.core.sessions import create_session, invalidate_session, refresh_session
from app.core.config import settings
from app.core.logging import log_auth_event, log_event
from app.api.deps import get_current_user, get_session_id
from app.models.user import User
from app.models.log_entry import LogEntry
from app.models.operational import OperationalEvent
from app.schemas.auth import (
    LoginRequest, LoginResponse, UserResponse,
    SessionInfoResponse, ChangePasswordRequest,
    ForceChangePasswordRequest, RefreshResponse,
)

router = APIRouter()

# ── Login Event Throttling ──
# Suppress repeated successful login log entries for the same user
# within a short window to reduce NOC event noise.
_LOGIN_THROTTLE_SECONDS = 60
_last_login_log: dict[str, float] = {}


def _should_log_login(username: str) -> bool:
    """Returns True if we should log this login event (throttle repeated logins)."""
    now = datetime.now(timezone.utc).timestamp()
    last = _last_login_log.get(username, 0)
    if now - last < _LOGIN_THROTTLE_SECONDS:
        return False
    _last_login_log[username] = now
    return True


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        created_at=user.created_at,
        updated_at=user.updated_at,
        last_login_at=user.last_login_at,
    )


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else ""

    user = db.query(User).filter(User.username == body.username).first()
    if not user or not verify_password(body.password, user.password_hash):
        log_auth_event(db, f"Login falhou para '{body.username}'", body.username, client_ip, False)
        db.add(OperationalEvent(event_type="login_failed", severity="warning", instance_id=None, message=f"Failed login attempt for '{body.username}' from {client_ip}"))
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais inválidas")

    if not user.is_active:
        log_auth_event(db, f"Login bloqueado: usuário inativo '{body.username}'", body.username, client_ip, False)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuário desativado")

    user_agent = request.headers.get("User-Agent", "")
    is_kiosk = user.is_viewer  # Viewer users always get kiosk (long-lived) sessions
    token, _, expires_at = create_session(db, user, client_ip, user_agent, kiosk=is_kiosk)

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    # Throttle repeated successful login log entries
    if _should_log_login(user.username):
        log_auth_event(db, f"Login bem-sucedido: '{user.username}'", user.username, client_ip, True)
        db.add(OperationalEvent(event_type="login_success", severity="info", instance_id=None, message=f"User '{user.username}' logged in from {client_ip}"))
        db.commit()

    return LoginResponse(
        token=token,
        expires_at=expires_at,
        must_change_password=user.must_change_password,
        user=_user_response(user),
    )


@router.post("/logout")
def logout(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    session_id: str = Depends(get_session_id),
):
    invalidate_session(db, session_id)
    log_auth_event(db, f"Logout: '{user.username}'", user.username)
    return {"success": True}


@router.get("/me", response_model=SessionInfoResponse)
def get_current_session(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    session_id: str = Depends(get_session_id),
):
    from app.models.session import SessionRecord
    session = db.query(SessionRecord).filter(SessionRecord.id == session_id).first()
    return SessionInfoResponse(
        user=_user_response(user),
        session_id=session_id,
        expires_at=session.expires_at if session else datetime.now(timezone.utc),
        session_timeout_minutes=settings.SESSION_TIMEOUT_MINUTES,
        session_warning_seconds=settings.SESSION_WARNING_SECONDS,
    )


@router.post("/refresh", response_model=RefreshResponse)
def refresh(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    session_id: str = Depends(get_session_id),
):
    is_kiosk = user.is_viewer
    new_expires = refresh_session(db, session_id, kiosk=is_kiosk)
    if not new_expires:
        raise HTTPException(status_code=401, detail="Sessão inválida")
    return RefreshResponse(expires_at=new_expires)


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")

    err = validate_password_strength(body.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    user.password_hash = hash_password(body.new_password)
    user.updated_at = datetime.now(timezone.utc)
    db.commit()

    log_auth_event(db, f"Senha alterada: '{user.username}'", user.username)
    return {"success": True}


@router.post("/force-change-password")
def force_change_password(
    body: ForceChangePasswordRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not user.must_change_password:
        raise HTTPException(status_code=400, detail="Troca de senha não é necessária")

    err = validate_password_strength(body.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    user.updated_at = datetime.now(timezone.utc)
    db.commit()

    log_auth_event(db, f"Senha inicial alterada: '{user.username}'", user.username)
    return {"success": True}
