"""
DNS Control — Auth Service
Business logic for authentication. Route handlers delegate here.
"""

from sqlalchemy.orm import Session
from app.models.user import User
from app.core.security import verify_password, hash_password


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = db.query(User).filter(User.username == username).first()
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    if not user.is_active:
        return None
    return user


def set_password(db: Session, user: User, new_password: str) -> None:
    user.password_hash = hash_password(new_password)
    db.commit()
