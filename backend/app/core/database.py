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


def init_db():
    # Import all models so they register with Base.metadata
    import app.models.user  # noqa
    import app.models.session  # noqa
    import app.models.config_profile  # noqa
    import app.models.config_revision  # noqa
    import app.models.apply_job  # noqa
    import app.models.log_entry  # noqa
    import app.models.operational  # noqa  — v2 operational models
    import app.models.vip_counter  # noqa  — VIP counter history

    Base.metadata.create_all(bind=engine)

    # Seed default admin if no users exist
    from app.db.seed import seed_admin
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()
