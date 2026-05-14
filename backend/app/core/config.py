"""
DNS Control — Application Configuration
All settings are loaded from environment variables with sensible defaults.
"""

import os
import secrets as _secrets
import logging as _logging
from pydantic_settings import BaseSettings
from typing import List

_INSECURE_SECRET_DEFAULT = "change-me-in-production-use-openssl-rand-hex-32"


def _resolve_secret_key() -> str:
    """Resolve SECRET_KEY: env var if set, otherwise generate ephemeral random key.
    Never silently fall back to the well-known placeholder string."""
    val = os.environ.get("DNS_CONTROL_SECRET_KEY", "").strip()
    if val and val != _INSECURE_SECRET_DEFAULT:
        return val
    ephemeral = _secrets.token_hex(32)
    _logging.getLogger("dns-control").warning(
        "DNS_CONTROL_SECRET_KEY not set or using insecure placeholder. "
        "Generated EPHEMERAL key (sessions will be invalidated on restart). "
        "Set DNS_CONTROL_SECRET_KEY in /etc/dns-control/env for production."
    )
    return ephemeral


class Settings(BaseSettings):
    # Database
    DB_PATH: str = os.environ.get("DNS_CONTROL_DB_PATH", "/var/lib/dns-control/dns-control.db")

    # Security
    SECRET_KEY: str = _resolve_secret_key()
    ALGORITHM: str = "HS256"

    # Sessions — sessões eternas (persistentes) para admin e viewer.
    # Timeout default: ~10 anos (5.256.000 minutos). Warning desativado (0).
    SESSION_TIMEOUT_MINUTES: int = int(os.environ.get("DNS_CONTROL_SESSION_TIMEOUT_MINUTES", "5256000"))
    SESSION_WARNING_SECONDS: int = int(os.environ.get("DNS_CONTROL_SESSION_WARNING_SECONDS", "0"))
    KIOSK_SESSION_TIMEOUT_MINUTES: int = int(os.environ.get("DNS_CONTROL_KIOSK_SESSION_TIMEOUT_MINUTES", "5256000"))

    # Server
    HOST: str = os.environ.get("DNS_CONTROL_HOST", "127.0.0.1")
    PORT: int = int(os.environ.get("DNS_CONTROL_PORT", "8000"))

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Admin bootstrap
    INITIAL_ADMIN_USERNAME: str = os.environ.get("DNS_CONTROL_INITIAL_ADMIN_USERNAME", "admin")
    INITIAL_ADMIN_PASSWORD: str = os.environ.get("DNS_CONTROL_INITIAL_ADMIN_PASSWORD", "admin")

    # Paths
    BACKUP_DIR: str = "/var/lib/dns-control/backups"
    GENERATED_DIR: str = "/var/lib/dns-control/generated"

    # Password policy
    MIN_PASSWORD_LENGTH: int = 6
    MIN_USERNAME_LENGTH: int = 3

    class Config:
        env_prefix = "DNS_CONTROL_"


settings = Settings()
