"""
DNS Control — Server-side Session Management
Handles creation, validation, refresh, and expiration of sessions.
"""

from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import generate_session_token, create_access_token
from app.models.session import SessionRecord
from app.models.user import User


def create_session(db: Session, user: User, client_ip: str = "", user_agent: str = "") -> tuple[str, str, datetime]:
    """Create a new session and return (access_token, session_token, expires_at)."""
    session_token = generate_session_token()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.SESSION_TIMEOUT_MINUTES)

    session_record = SessionRecord(
        user_id=user.id,
        session_token=session_token,
        expires_at=expires_at,
        client_ip=client_ip,
        user_agent=user_agent,
    )
    db.add(session_record)
    db.commit()
    db.refresh(session_record)

    access_token = create_access_token(str(user.id), str(session_record.id))
    return access_token, session_token, expires_at


def validate_session(db: Session, session_id: str) -> SessionRecord | None:
    """Return session if valid and not expired, else None."""
    session = db.query(SessionRecord).filter(
        SessionRecord.id == session_id,
        SessionRecord.is_active == True,
    ).first()

    if not session:
        return None

    # Normalize naive datetime from SQLite to UTC-aware
    expires_at = session.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        session.is_active = False
        db.commit()
        return None

    # Update last_seen
    session.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return session


def refresh_session(db: Session, session_id: str) -> datetime | None:
    """Extend session expiration. Returns new expires_at or None if invalid."""
    session = validate_session(db, session_id)
    if not session:
        return None

    session.expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.SESSION_TIMEOUT_MINUTES)
    db.commit()
    return session.expires_at


def invalidate_session(db: Session, session_id: str) -> bool:
    """Mark session as inactive (logout)."""
    session = db.query(SessionRecord).filter(SessionRecord.id == session_id).first()
    if session:
        session.is_active = False
        db.commit()
        return True
    return False


def invalidate_user_sessions(db: Session, user_id: str) -> int:
    """Invalidate all active sessions for a user."""
    count = db.query(SessionRecord).filter(
        SessionRecord.user_id == user_id,
        SessionRecord.is_active == True,
    ).update({"is_active": False})
    db.commit()
    return count
