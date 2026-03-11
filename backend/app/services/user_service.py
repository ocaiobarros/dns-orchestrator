"""
DNS Control — User Service
"""

from sqlalchemy.orm import Session
from app.models.user import User


def get_all_users(db: Session) -> list[User]:
    return db.query(User).order_by(User.created_at).all()


def get_user_by_id(db: Session, user_id: str) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def user_exists(db: Session, username: str) -> bool:
    return db.query(User).filter(User.username == username).count() > 0
