#!/usr/bin/env python3
"""
DNS Control — Create Admin User
Standalone script to create or reset the admin user.

Usage:
    python create_admin.py [username] [password]

If no arguments are provided, uses environment variables:
    DNS_CONTROL_INITIAL_ADMIN_USERNAME (default: admin)
    DNS_CONTROL_INITIAL_ADMIN_PASSWORD (required)
"""

import sys
import os

# Add parent directories to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.core.database import SessionLocal, init_db
from app.core.security import hash_password
from app.core.config import settings
from app.models.user import User


def create_admin(username: str, password: str):
    init_db()
    db = SessionLocal()

    try:
        existing = db.query(User).filter(User.username == username).first()
        if existing:
            print(f"User '{username}' already exists. Resetting password...")
            existing.password_hash = hash_password(password)
            existing.is_active = True
            existing.must_change_password = True
            db.commit()
            print(f"✓ Password reset for '{username}'. Must change on next login.")
        else:
            admin = User(
                username=username,
                password_hash=hash_password(password),
                is_active=True,
                must_change_password=True,
            )
            db.add(admin)
            db.commit()
            print(f"✓ Admin user '{username}' created. Must change password on first login.")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) >= 3:
        create_admin(sys.argv[1], sys.argv[2])
    elif os.environ.get("DNS_CONTROL_INITIAL_ADMIN_PASSWORD"):
        create_admin(
            settings.INITIAL_ADMIN_USERNAME,
            settings.INITIAL_ADMIN_PASSWORD,
        )
    else:
        print("Usage: python create_admin.py <username> <password>")
        print("   Or: set DNS_CONTROL_INITIAL_ADMIN_PASSWORD env var")
        sys.exit(1)
