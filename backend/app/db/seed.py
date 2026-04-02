"""
DNS Control — Database Seeder
Creates the default admin user on first startup.
"""

from sqlalchemy.orm import Session
from app.models.user import User
from app.core.security import hash_password
from app.core.config import settings


def seed_admin(db: Session) -> None:
    """Create the default admin user if no users exist."""
    user_count = db.query(User).count()
    if user_count > 0:
        return

    admin = User(
        username=settings.INITIAL_ADMIN_USERNAME,
        password_hash=hash_password(settings.INITIAL_ADMIN_PASSWORD),
        role="admin",
        is_active=True,
        must_change_password=True,
    )
    db.add(admin)
    db.commit()
    print(f"[DNS Control] Default admin user created: {settings.INITIAL_ADMIN_USERNAME}")
    print(f"[DNS Control] ⚠ must_change_password=True — password change required on first login")
