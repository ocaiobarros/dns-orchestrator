"""
DNS Control — Database Setup
SQLite with SQLAlchemy. Creates tables on startup.
"""

import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def _get_engine():
    db_dir = os.path.dirname(settings.DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{settings.DB_PATH}",
        connect_args={"check_same_thread": False},
        echo=False,
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


engine = _get_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _run_migrations(eng):
    """Apply schema migrations for existing databases."""
    import sqlite3
    raw = eng.raw_connection()
    try:
        cur = raw.cursor()
        # Check if 'role' column exists in users table
        cur.execute("PRAGMA table_info(users)")
        columns = [row[1] for row in cur.fetchall()]
        if "role" not in columns:
            cur.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'")
            raw.commit()
            print("[DNS Control] Migration: added 'role' column to users table")
    except Exception as exc:
        print(f"[DNS Control] Migration warning: {exc}")
    finally:
        raw.close()


def _apply_versioned_migrations(eng):
    """
    Versioned, additive migrations registry (CREATE TABLE / ADD COLUMN only).
    Tracked in schema_migrations(version PK, applied_at). Idempotent.
    """
    raw = eng.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        raw.commit()
        cur.execute("SELECT version FROM schema_migrations")
        applied = {row[0] for row in cur.fetchall()}
        from app.db.migrations import MIGRATIONS
        for version, fn in MIGRATIONS:
            if version in applied:
                continue
            try:
                fn(raw)
                cur.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES(?, datetime('now'))",
                    (version,),
                )
                raw.commit()
                print(f"[DNS Control] Migration applied: {version}")
            except Exception as exc:
                raw.rollback()
                print(f"[DNS Control] Migration FAILED {version}: {exc}")
                raise
    finally:
        raw.close()


def init_db():
    # Run legacy in-place migrations BEFORE SQLAlchemy touches the schema
    _run_migrations(engine)

    # Import all models so they register with Base.metadata
    import app.models.user  # noqa
    import app.models.session  # noqa
    import app.models.config_profile  # noqa
    import app.models.config_revision  # noqa
    import app.models.apply_job  # noqa
    import app.models.log_entry  # noqa
    import app.models.operational  # noqa  — v2 operational models
    import app.models.dns_events  # noqa  — DNS query/error events for filtered analytics
    import app.models.vip_counter  # noqa  — VIP counter history
    import app.models.policy  # noqa  — POL-1: policy plane foundation

    Base.metadata.create_all(bind=engine)

    # Versioned additive migrations (run AFTER create_all for legacy DBs)
    _apply_versioned_migrations(engine)

    # Seed default admin if no users exist
    from app.db.seed import seed_admin
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()
