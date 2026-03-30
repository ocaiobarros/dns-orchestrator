"""
DNS Control — Drift Detection & Version Tracking
Detects manual changes to deployed config files and tracks active config version.
"""

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.drift")

VERSION_FILE = "/etc/dns-control/version.json"


def compute_file_hash(content: str) -> str:
    """SHA-256 hash of file content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def write_version_manifest(
    deploy_id: str,
    operator: str,
    files: list[dict[str, Any]],
    revision_id: str | None = None,
):
    """
    Write /etc/dns-control/version.json after successful deploy.
    Records deployed file hashes for drift detection.
    """
    file_hashes = {}
    for f in files:
        path = f.get("path", "")
        content = f.get("content", "")
        if path and content:
            file_hashes[path] = compute_file_hash(content)

    manifest = {
        "deploy_id": deploy_id,
        "revision_id": revision_id,
        "operator": operator,
        "deployed_at": datetime.now(timezone.utc).isoformat(),
        "config_hash": hashlib.sha256(
            json.dumps(file_hashes, sort_keys=True).encode()
        ).hexdigest()[:24],
        "file_hashes": file_hashes,
        "file_count": len(file_hashes),
    }

    # Write via privileged install
    os.makedirs("/tmp/dns-control-version", exist_ok=True)
    tmp_path = "/tmp/dns-control-version/version.json"
    with open(tmp_path, "w") as f:
        json.dump(manifest, f, indent=2)

    run_command("mkdir", ["-p", os.path.dirname(VERSION_FILE)], timeout=5, use_privilege=True)
    result = run_command("install", ["-m", "0644", tmp_path, VERSION_FILE], timeout=5, use_privilege=True)

    if result["exit_code"] == 0:
        logger.info(f"Version manifest written: deploy_id={deploy_id} hash={manifest['config_hash']}")
    else:
        logger.warning(f"Failed to write version manifest: {result['stderr'][:200]}")

    return manifest


def read_version_manifest() -> dict | None:
    """Read current version manifest from host."""
    if not os.path.exists(VERSION_FILE):
        return None
    try:
        with open(VERSION_FILE) as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to read version manifest: {e}")
        return None


def detect_drift() -> dict:
    """
    Compare deployed file hashes against actual disk content.
    Returns drift report with modified/missing/extra files.
    """
    manifest = read_version_manifest()
    if not manifest:
        return {
            "status": "no_manifest",
            "message": "No version manifest found — drift detection unavailable",
            "drifted_files": [],
            "missing_files": [],
        }

    file_hashes = manifest.get("file_hashes", {})
    drifted: list[dict] = []
    missing: list[str] = []

    for path, expected_hash in file_hashes.items():
        if not os.path.exists(path):
            missing.append(path)
            continue

        try:
            with open(path, "r") as f:
                actual_content = f.read()
            actual_hash = compute_file_hash(actual_content)
            if actual_hash != expected_hash:
                drifted.append({
                    "path": path,
                    "expected_hash": expected_hash,
                    "actual_hash": actual_hash,
                })
        except PermissionError:
            # Try via sudo cat
            result = run_command("cat", [path], timeout=5, use_privilege=True)
            if result["exit_code"] == 0:
                actual_hash = compute_file_hash(result["stdout"])
                if actual_hash != expected_hash:
                    drifted.append({
                        "path": path,
                        "expected_hash": expected_hash,
                        "actual_hash": actual_hash,
                    })
            else:
                drifted.append({
                    "path": path,
                    "expected_hash": expected_hash,
                    "actual_hash": "unreadable",
                })
        except Exception as e:
            logger.warning(f"Drift check failed for {path}: {e}")

    has_drift = len(drifted) > 0 or len(missing) > 0
    return {
        "status": "drift_detected" if has_drift else "clean",
        "deploy_id": manifest.get("deploy_id"),
        "config_hash": manifest.get("config_hash"),
        "deployed_at": manifest.get("deployed_at"),
        "total_files": len(file_hashes),
        "drifted_files": drifted,
        "missing_files": missing,
        "message": (
            f"Drift detected: {len(drifted)} modified, {len(missing)} missing"
            if has_drift
            else f"All {len(file_hashes)} files match deployed config"
        ),
    }
