"""
DNS Control — File Generation Service
Orchestrates config file generation from a profile payload.
"""

from typing import Any
from app.services.config_service import generate_preview


def generate_files_for_profile(payload: dict[str, Any]) -> list[dict]:
    return generate_preview(payload)
