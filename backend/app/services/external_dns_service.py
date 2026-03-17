"""
DNS Control — External DNS Probe Service
Tests external DNS reachability, hijack detection, and root recursion.

4.2.2.5 and 4.2.2.6 are Lumen/Level3 PUBLIC resolvers used as probes,
NOT part of the local infrastructure.
"""

import time
import re
import logging
from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.external-dns")

# External resolvers for connectivity probes
EXTERNAL_RESOLVERS = [
    {"ip": "4.2.2.5", "label": "Lumen/Level3 Resolver A", "provider": "Lumen"},
    {"ip": "4.2.2.6", "label": "Lumen/Level3 Resolver B", "provider": "Lumen"},
]

HIJACK_LATENCY_THRESHOLD_MS = 10
PROBE_DOMAIN = "google.com"


def _safe_run(executable: str, args: list[str], timeout: int = 10) -> dict:
    try:
        return run_command(executable, args, timeout=timeout)
    except Exception as e:
        logger.debug(f"Command {executable} failed: {e}")
        return {"exit_code": -1, "stdout": "", "stderr": str(e), "duration_ms": 0}


def run_external_dns_probes() -> dict:
    """Run all external DNS diagnostic probes."""
    reachability = _probe_external_reachability()
    hijack = _detect_dns_hijack(reachability)
    root_recursion = _probe_root_recursion()

    overall_reachable = all(r["reachable"] for r in reachability)
    hijack_detected = hijack["detected"]

    return {
        "external_reachability": reachability,
        "hijack_detection": hijack,
        "root_recursion": root_recursion,
        "summary": {
            "external_dns_reachable": overall_reachable,
            "hijack_suspected": hijack_detected,
            "root_recursion_ok": root_recursion["root_query"]["status"] == "ok",
            "trace_ok": root_recursion["trace"]["status"] == "ok",
        },
    }


def _probe_external_reachability() -> list[dict]:
    """Test DNS resolution against external public resolvers (4.2.2.5, 4.2.2.6)."""
    results = []
    for resolver in EXTERNAL_RESOLVERS:
        start = time.monotonic()
        r = _safe_run(
            "dig",
            [f"@{resolver['ip']}", PROBE_DOMAIN, "+short", "+time=3", "+tries=1"],
            timeout=8,
        )
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)

        has_answer = r["exit_code"] == 0 and len(r["stdout"].strip()) > 0
        resolved_ip = r["stdout"].strip().split("\n")[0] if has_answer else ""

        results.append({
            "resolver": resolver["ip"],
            "label": resolver["label"],
            "provider": resolver["provider"],
            "reachable": has_answer,
            "latency_ms": elapsed_ms,
            "resolved_ip": resolved_ip,
            "error": r["stderr"].strip()[:200] if not has_answer else None,
            "purpose": "External DNS connectivity probe",
        })

    return results


def _detect_dns_hijack(reachability_results: list[dict]) -> dict:
    """
    Detect DNS hijacking by analyzing latency to external resolvers.
    If latency < threshold, a local device may be intercepting DNS queries.
    """
    suspicious = []
    for probe in reachability_results:
        if probe["reachable"] and probe["latency_ms"] < HIJACK_LATENCY_THRESHOLD_MS:
            suspicious.append({
                "resolver": probe["resolver"],
                "label": probe["label"],
                "latency_ms": probe["latency_ms"],
                "reason": f"Latency {probe['latency_ms']}ms < {HIJACK_LATENCY_THRESHOLD_MS}ms threshold — "
                          f"possible local interception",
            })

    detected = len(suspicious) > 0

    return {
        "detected": detected,
        "threshold_ms": HIJACK_LATENCY_THRESHOLD_MS,
        "suspicious_probes": suspicious,
        "message": (
            f"⚠ Possível interceptação DNS detectada em {len(suspicious)} resolver(s). "
            f"Latência extremamente baixa (<{HIJACK_LATENCY_THRESHOLD_MS}ms) indica que um "
            f"dispositivo na rede pode estar respondendo no lugar do resolver real."
            if detected
            else "✓ Nenhuma interceptação DNS detectada. Latências dentro do esperado para resolvers externos."
        ),
    }


def _probe_root_recursion() -> dict:
    """
    Test root recursion capability:
    1. dig +trace google.com — full iterative resolution from root
    2. dig @a.root-servers.net . — direct query to root server
    """
    # 1. Trace
    trace_start = time.monotonic()
    trace_r = _safe_run("dig", ["+trace", PROBE_DOMAIN], timeout=15)
    trace_elapsed = round((time.monotonic() - trace_start) * 1000, 1)

    trace_ok = trace_r["exit_code"] == 0 and "ANSWER SECTION" in trace_r["stdout"]
    trace_has_root = "root-servers.net" in trace_r["stdout"].lower() if trace_ok else False

    # 2. Root server direct query
    root_start = time.monotonic()
    root_r = _safe_run(
        "dig", ["@a.root-servers.net", ".", "NS", "+short", "+time=5", "+tries=1"],
        timeout=10,
    )
    root_elapsed = round((time.monotonic() - root_start) * 1000, 1)

    root_ok = root_r["exit_code"] == 0 and "root-servers.net" in root_r["stdout"].lower()

    return {
        "trace": {
            "status": "ok" if trace_ok else "failed",
            "latency_ms": trace_elapsed,
            "reached_root": trace_has_root,
            "output_lines": len(trace_r["stdout"].split("\n")) if trace_ok else 0,
            "error": trace_r["stderr"].strip()[:200] if not trace_ok else None,
        },
        "root_query": {
            "status": "ok" if root_ok else "failed",
            "target": "a.root-servers.net",
            "latency_ms": root_elapsed,
            "answer": root_r["stdout"].strip()[:500] if root_ok else "",
            "error": root_r["stderr"].strip()[:200] if not root_ok else None,
        },
    }
