"""
DNS Control — API Dependencies
Authentication dependency for protected routes.
"""

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.core.sessions import validate_session
from app.models.user import User, ROLE_ADMIN


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Extract and validate auth token from Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticação não fornecido",
        )

    token = auth_header.split(" ", 1)[1]
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
        )

    # Validate session is still active
    session = validate_session(db, payload.get("sid", ""))
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão expirada ou inválida",
        )

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário desativado",
        )

    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Require admin role for protected admin-only routes."""
    if user.role != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permissão negada — acesso restrito a administradores",
        )
    return user


def get_session_id(request: Request) -> str:
    """Extract session ID from token."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return ""
    token = auth_header.split(" ", 1)[1]
    payload = decode_access_token(token)
    return payload.get("sid", "") if payload else ""
