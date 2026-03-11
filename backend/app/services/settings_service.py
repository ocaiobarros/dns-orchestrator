"""
DNS Control v2.1 — Settings Service
Provides configurable health thresholds from the settings table.
"""

from sqlalchemy.orm import Session
from app.models.log_entry import Setting

# Default health engine thresholds
HEALTH_DEFAULTS = {
    "DNS_HEALTH_DIG_TIMEOUT_MS": "2000",
    "DNS_HEALTH_LATENCY_WARN_MS": "50",
    "DNS_HEALTH_CONSECUTIVE_FAILURES": "3",
    "DNS_HEALTH_CONSECUTIVE_SUCCESSES": "3",
    "DNS_HEALTH_COOLDOWN_SECONDS": "120",
}


def get_health_settings(db: Session) -> dict:
    """Get health engine settings from DB, falling back to defaults."""
    settings = {}
    for key, default in HEALTH_DEFAULTS.items():
        row = db.query(Setting).filter(Setting.key == key).first()
        val = row.value if row else default
        settings[key] = val

    return {
        "dig_timeout_ms": int(settings["DNS_HEALTH_DIG_TIMEOUT_MS"]),
        "latency_warn_ms": int(settings["DNS_HEALTH_LATENCY_WARN_MS"]),
        "consecutive_failures": int(settings["DNS_HEALTH_CONSECUTIVE_FAILURES"]),
        "consecutive_successes": int(settings["DNS_HEALTH_CONSECUTIVE_SUCCESSES"]),
        "cooldown_seconds": int(settings["DNS_HEALTH_COOLDOWN_SECONDS"]),
    }
