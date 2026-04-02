"""
DNS Control — Security Utilities
Password hashing (bcrypt) and session token generation.
"""

import secrets
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import jwt, JWTError

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def generate_session_token() -> str:
    return secrets.token_urlsafe(48)


def create_access_token(user_id: str, session_id: str, timeout_minutes: int | None = None) -> str:
    minutes = timeout_minutes or settings.SESSION_TIMEOUT_MINUTES
    expires = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {
        "sub": user_id,
        "sid": session_id,
        "exp": expires,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None


def validate_password_strength(password: str) -> str | None:
    if len(password) < settings.MIN_PASSWORD_LENGTH:
        return f"Senha deve ter no mínimo {settings.MIN_PASSWORD_LENGTH} caracteres"
    if password.isdigit():
        return "Senha não pode conter apenas números"
    return None


def validate_username(username: str) -> str | None:
    if len(username) < settings.MIN_USERNAME_LENGTH:
        return f"Usuário deve ter no mínimo {settings.MIN_USERNAME_LENGTH} caracteres"
    if not username.isalnum() and "_" not in username and "-" not in username:
        return "Usuário deve conter apenas letras, números, _ ou -"
    return None
