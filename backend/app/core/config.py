"""
DNS Control — Application Configuration
All settings are loaded from environment variables with sensible defaults.
"""

import os
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Database
    DB_PATH: str = os.environ.get("DNS_CONTROL_DB_PATH", "/var/lib/dns-control/dns-control.db")

    # Security
    SECRET_KEY: str = os.environ.get("DNS_CONTROL_SECRET_KEY", "change-me-in-production-use-openssl-rand-hex-32")
    ALGORITHM: str = "HS256"

    # Sessions
    SESSION_TIMEOUT_MINUTES: int = int(os.environ.get("DNS_CONTROL_SESSION_TIMEOUT_MINUTES", "30"))
    SESSION_WARNING_SECONDS: int = int(os.environ.get("DNS_CONTROL_SESSION_WARNING_SECONDS", "120"))

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
