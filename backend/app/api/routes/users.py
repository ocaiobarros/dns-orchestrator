"""
DNS Control — User Management Routes
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import hash_password, validate_password_strength, validate_username
from app.core.sessions import invalidate_user_sessions
from app.core.logging import log_event
from app.api.deps import get_current_user, require_admin
from app.models.user import User, VALID_ROLES
from app.schemas.user import (
    CreateUserRequest, UpdateUserRequest,
    AdminChangePasswordRequest, UserListResponse,
)

router = APIRouter()


def _user_to_response(u: User) -> UserListResponse:
    return UserListResponse(
        id=u.id, username=u.username, role=u.role, is_active=u.is_active,
        must_change_password=u.must_change_password,
        created_at=u.created_at, updated_at=u.updated_at,
        last_login_at=u.last_login_at,
    )


@router.get("", response_model=list[UserListResponse])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    users = db.query(User).order_by(User.created_at).all()
    return [_user_to_response(u) for u in users]


@router.post("", response_model=UserListResponse, status_code=201)
def create_user(body: CreateUserRequest, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    err = validate_username(body.username)
    if err:
        raise HTTPException(status_code=400, detail=err)

    err = validate_password_strength(body.password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role inválida. Valores aceitos: {', '.join(VALID_ROLES)}")

    existing = db.query(User).filter(User.username == body.username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Usuário já existe")

    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
        must_change_password=body.must_change_password,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    log_event(db, "auth", "info", f"Usuário criado: '{user.username}' (role={user.role}) por '{current.username}'")
    return _user_to_response(user)


@router.patch("/{user_id}", response_model=UserListResponse)
def update_user(user_id: str, body: UpdateUserRequest, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if body.is_active is not None:
        user.is_active = body.is_active
        if not body.is_active:
            invalidate_user_sessions(db, user_id)

    if body.username is not None:
        err = validate_username(body.username)
        if err:
            raise HTTPException(status_code=400, detail=err)
        existing = db.query(User).filter(User.username == body.username, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=409, detail="Usuário já existe")
        user.username = body.username

    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Role inválida. Valores aceitos: {', '.join(VALID_ROLES)}")
        user.role = body.role

    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return _user_to_response(user)


@router.post("/{user_id}/change-password")
def admin_change_password(user_id: str, body: AdminChangePasswordRequest, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    err = validate_password_strength(body.password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    user.password_hash = hash_password(body.password)
    user.updated_at = datetime.now(timezone.utc)
    db.commit()

    log_event(db, "auth", "info", f"Senha resetada para '{user.username}' por '{current.username}'")
    return {"success": True}


@router.post("/{user_id}/disable")
def disable_user(user_id: str, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="Não é possível desativar a si mesmo")
    user.is_active = False
    user.updated_at = datetime.now(timezone.utc)
    invalidate_user_sessions(db, user_id)
    db.commit()
    return {"success": True}


@router.post("/{user_id}/enable")
def enable_user(user_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    user.is_active = True
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True}


@router.delete("/{user_id}")
def delete_user(user_id: str, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="Não é possível excluir a si mesmo")

    invalidate_user_sessions(db, user_id)
    db.delete(user)
    db.commit()

    log_event(db, "auth", "info", f"Usuário excluído: '{user.username}' por '{current.username}'")
    return {"success": True}
