"""
DNS Control — Upstream Silence Detector (v1, conntrack quick-win)

Purpose
-------
Detect, in (near) real time, IPs autoritativos na internet que NÃO respondem
às queries de recursão do Unbound. v1 lê eventos do nf_conntrack para fluxos
UDP destinados à porta 53 do mundo externo (egress do resolver) que são
destruídos AINDA na flag ``[UNREPLIED]`` — sinal vital de "site não abre".

Postura
-------
- **Opt-in admin** via setting ``UPSTREAM_SILENCE_DETECTOR_ENABLED``. OFF
  por padrão. OFF → subprocesso não roda, custo zero, endpoint "disabled".
- **Puramente observacional.** Nada de geração nftables/NOTRACK. Só leitura
  de ``conntrack -E`` (ou ``/proc/net/nf_conntrack`` como fallback futuro).
- **Degradação honesta.** Se o binário ``conntrack`` faltar ou o subprocesso
  cair, o status vira ``degraded`` e a UI exibe "indisponível" em vez de
  fabricar "0 falhas observadas".
- **Resiliente.** O leitor roda em thread daemon supervisionada; se cair,
  marca degraded sem derrubar o restante da telemetria.

Arquitetura
-----------
``UpstreamSilenceDetector`` é um *singleton* com ``start()/stop()/snapshot()``.
Mantém um agregado em memória por IP autoritativo, com sliding-window de
5 e 15 minutos (deque de timestamps). Nada é persistido por evento — apenas
o agregado entra no snapshot exposto via API.

Parser
------
``parse_conntrack_event_line`` é puro e testável: aceita uma linha do output
de ``conntrack -E -p udp --dport 53 --event-mask DESTROY -o extended`` e
retorna ``{ip, family, replied}`` ou ``None``. Linhas com ``[UNREPLIED]``
contam; linhas sem essa flag (DESTROY de fluxo respondido) são ignoradas.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Deque, Dict, Optional

logger = logging.getLogger("dns-control.upstream-silence")

SETTING_KEY = "UPSTREAM_SILENCE_DETECTOR_ENABLED"

# Windows for the sliding aggregate, in seconds.
WINDOW_5MIN = 5 * 60
WINDOW_15MIN = 15 * 60
RETENTION_SECONDS = WINDOW_15MIN  # we never keep timestamps older than this.

# Cap top-N IPs returned by the snapshot to keep payload small.
SNAPSHOT_TOP_N = 200

# Regexes for conntrack -E output (`-o extended`).
#
# Sample lines (real, kernel-formatted; whitespace-tolerant):
#   "[DESTROY] udp      17 src=10.0.0.1 dst=8.8.8.8 sport=12345 dport=53 [UNREPLIED] src=8.8.8.8 dst=10.0.0.1 sport=53 dport=12345"
#   "[DESTROY] udp      17 src=2001:db8::1 dst=2001:4860:4860::8888 sport=12345 dport=53 [UNREPLIED] src=... dst=..."
#
# We extract the FIRST `dst=` (= autoritativo) and detect the literal
# substring "[UNREPLIED]". `dport=53` filter is applied by conntrack itself
# but we re-check defensively.
_RE_DST = re.compile(r"\bdst=([0-9a-fA-F:.]+)\b")
_RE_DPORT53 = re.compile(r"\bdport=53\b")
_RE_PROTO_UDP = re.compile(r"\budp\b", re.IGNORECASE)


def _ip_family(ip: str) -> str:
    return "ipv6" if ":" in ip else "ipv4"


def parse_conntrack_event_line(line: str) -> Optional[Dict[str, object]]:
    """Pure parser. Returns dict with keys ``ip``, ``family``, ``replied`` or
    ``None`` if the line is not a UDP/53 DESTROY event we care about.

    A "silent autoritativo" event is one with ``[UNREPLIED]`` present. Lines
    without that flag are returned with ``replied=True`` so callers can
    distinguish "ignored" from "not a DNS DESTROY at all".
    """
    if not line:
        return None
    s = line.strip()
    if "[DESTROY]" not in s and not s.startswith("[DESTROY]"):
        # conntrack -E sometimes omits the bracket prefix depending on -o flags.
        if "DESTROY" not in s:
            return None
    if not _RE_PROTO_UDP.search(s):
        return None
    if not _RE_DPORT53.search(s):
        return None
    m = _RE_DST.search(s)
    if not m:
        return None
    ip = m.group(1)
    # Filter junk like dst=0 / dst=127.0.0.1 noise — keep only routable peers.
    if ip in ("0.0.0.0", "::"):
        return None
    replied = "[UNREPLIED]" not in s
    return {"ip": ip, "family": _ip_family(ip), "replied": replied}


@dataclass
class _IpAggregate:
    """In-memory aggregate for one autoritativo IP."""
    ip: str
    family: str
    timestamps: Deque[float] = field(default_factory=deque)
    first_seen: float = 0.0
    last_seen: float = 0.0

    def record(self, ts: float) -> None:
        if self.first_seen == 0.0:
            self.first_seen = ts
        self.last_seen = ts
        self.timestamps.append(ts)
        # Drop anything past retention.
        cutoff = ts - RETENTION_SECONDS
        while self.timestamps and self.timestamps[0] < cutoff:
            self.timestamps.popleft()

    def count_window(self, now: float, window: int) -> int:
        cutoff = now - window
        # timestamps is sorted (appended monotonically); linear scan from tail is fine.
        return sum(1 for t in self.timestamps if t >= cutoff)


class UpstreamSilenceDetector:
    """Singleton supervised reader."""

    _instance: "Optional[UpstreamSilenceDetector]" = None
    _instance_lock = threading.Lock()

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._aggregates: Dict[str, _IpAggregate] = {}
        self._proc: Optional[subprocess.Popen] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False  # operator intent (toggle ON?)
        self._supervised_started_at: Optional[float] = None
        self._last_error: Optional[str] = None
        self._status = "disabled"  # disabled | ok | degraded
        self._events_total = 0  # all [UNREPLIED] events ever observed
        self._enabled_changed_at: Optional[float] = None
        # Allow test override of the conntrack binary or argv builder.
        self._cmd_factory = self._default_cmd

    # ---------- factory ----------
    @classmethod
    def instance(cls) -> "UpstreamSilenceDetector":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = UpstreamSilenceDetector()
            return cls._instance

    # ---------- lifecycle ----------
    def _default_cmd(self) -> list[str]:
        return [
            "conntrack", "-E",
            "-p", "udp",
            "--dport", "53",
            "--event-mask", "DESTROY",
            "-o", "extended",
        ]

    def start(self) -> Dict[str, object]:
        """Enable the detector. Idempotent."""
        with self._lock:
            if self._running:
                return self._status_payload_unlocked()
            # Pre-flight: binary must exist.
            if shutil.which("conntrack") is None and not os.environ.get(
                "DNS_CONTROL_UPSTREAM_SILENCE_TEST_BYPASS_BINARY"
            ):
                self._status = "degraded"
                self._last_error = (
                    "binário 'conntrack' não encontrado no PATH. Instale "
                    "'conntrack' (Debian: apt install conntrack)."
                )
                self._running = True  # intent ON, but degraded.
                self._enabled_changed_at = time.time()
                logger.warning("upstream-silence: %s", self._last_error)
                return self._status_payload_unlocked()
            self._running = True
            self._status = "ok"
            self._last_error = None
            self._enabled_changed_at = time.time()
            self._thread = threading.Thread(
                target=self._supervisor_loop,
                name="upstream-silence-supervisor",
                daemon=True,
            )
            self._thread.start()
            return self._status_payload_unlocked()

    def stop(self) -> Dict[str, object]:
        """Disable the detector. Idempotent. Tears down the subprocess."""
        with self._lock:
            self._running = False
            self._status = "disabled"
            self._enabled_changed_at = time.time()
            proc = self._proc
            self._proc = None
        # Kill outside the lock — Popen.terminate may block briefly.
        if proc is not None:
            try:
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()
            except Exception:
                pass
        # We do NOT join the thread (daemon, exits when proc dies).
        return self.snapshot()

    # ---------- supervisor ----------
    def _supervisor_loop(self) -> None:
        backoff = 1.0
        while True:
            with self._lock:
                if not self._running:
                    return
                cmd = list(self._cmd_factory())
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,  # line-buffered
                )
            except FileNotFoundError as e:
                with self._lock:
                    self._status = "degraded"
                    self._last_error = f"falha ao iniciar conntrack: {e}"
                logger.warning("upstream-silence: %s", self._last_error)
                # No point retrying — binary truly absent.
                return
            except Exception as e:  # noqa: BLE001
                with self._lock:
                    self._status = "degraded"
                    self._last_error = f"erro ao iniciar conntrack: {e}"
                time.sleep(min(backoff, 30))
                backoff = min(backoff * 2, 30)
                continue
            with self._lock:
                self._proc = proc
                self._status = "ok"
                self._supervised_started_at = time.time()
                self._last_error = None
                backoff = 1.0
            try:
                self._consume_stream(proc)
            except Exception as e:  # noqa: BLE001
                with self._lock:
                    self._last_error = f"erro no stream: {e}"
                    self._status = "degraded"
                logger.exception("upstream-silence: stream error")
            finally:
                try:
                    if proc.poll() is None:
                        proc.terminate()
                        try:
                            proc.wait(timeout=2)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                except Exception:
                    pass
                with self._lock:
                    if self._proc is proc:
                        self._proc = None
                    if not self._running:
                        return
                    # Subprocess died but operator still wants ON — backoff and respawn.
                    self._status = "degraded"
                    self._last_error = (
                        self._last_error
                        or "conntrack subprocess terminou — reiniciando."
                    )
                time.sleep(min(backoff, 30))
                backoff = min(backoff * 2, 30)

    def _consume_stream(self, proc: subprocess.Popen) -> None:
        assert proc.stdout is not None
        for raw_line in proc.stdout:
            if not self._running:
                return
            event = parse_conntrack_event_line(raw_line)
            if event is None or event.get("replied"):
                continue
            ip = str(event["ip"])
            family = str(event["family"])
            self._record(ip, family, time.time())

    # ---------- aggregation ----------
    def _record(self, ip: str, family: str, ts: float) -> None:
        with self._lock:
            agg = self._aggregates.get(ip)
            if agg is None:
                agg = _IpAggregate(ip=ip, family=family)
                self._aggregates[ip] = agg
            agg.record(ts)
            self._events_total += 1

    def ingest_for_test(self, line: str, ts: Optional[float] = None) -> bool:
        """Test helper. Returns True if the line counted as a silent event."""
        event = parse_conntrack_event_line(line)
        if event is None or event.get("replied"):
            return False
        self._record(str(event["ip"]), str(event["family"]), ts if ts is not None else time.time())
        return True

    # ---------- snapshot ----------
    def _status_payload_unlocked(self) -> Dict[str, object]:
        return {
            "status": self._status,
            "running": self._running,
            "supervised_started_at": self._supervised_started_at,
            "enabled_changed_at": self._enabled_changed_at,
            "last_error": self._last_error,
        }

    def snapshot(self) -> Dict[str, object]:
        """Return current aggregate + status. Read-only."""
        now = time.time()
        with self._lock:
            items = []
            for agg in self._aggregates.values():
                c15 = agg.count_window(now, WINDOW_15MIN)
                if c15 == 0:
                    continue  # outside retention; will be pruned lazily.
                items.append({
                    "ip": agg.ip,
                    "family": agg.family,
                    "count_5min": agg.count_window(now, WINDOW_5MIN),
                    "count_15min": c15,
                    "first_seen": datetime.fromtimestamp(agg.first_seen, tz=timezone.utc).isoformat(),
                    "last_seen": datetime.fromtimestamp(agg.last_seen, tz=timezone.utc).isoformat(),
                    "last_seen_epoch": int(agg.last_seen),
                })
            items.sort(key=lambda r: (r["count_15min"], r["last_seen_epoch"]), reverse=True)
            items = items[:SNAPSHOT_TOP_N]
            payload = {
                "collector_status": self._status,  # disabled | ok | degraded
                "running": self._running,
                "window_seconds": {"short": WINDOW_5MIN, "long": WINDOW_15MIN},
                "events_total": self._events_total,
                "unique_ips": len(items),
                "last_error": self._last_error,
                "supervised_started_at": (
                    datetime.fromtimestamp(self._supervised_started_at, tz=timezone.utc).isoformat()
                    if self._supervised_started_at else None
                ),
                "enabled_changed_at": (
                    datetime.fromtimestamp(self._enabled_changed_at, tz=timezone.utc).isoformat()
                    if self._enabled_changed_at else None
                ),
                "items": items,
                "snapshot_at": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
                "binary_available": shutil.which("conntrack") is not None,
            }
            return payload

    # ---------- test introspection ----------
    def reset_for_test(self) -> None:
        with self._lock:
            self._aggregates.clear()
            self._events_total = 0
            self._status = "disabled"
            self._running = False
            self._last_error = None
            self._supervised_started_at = None
            self._enabled_changed_at = None
            self._proc = None
            self._thread = None


# ---------- DB-backed enabled flag ----------

def is_enabled(db) -> bool:
    """Read persisted toggle from the settings table. Default OFF."""
    from app.models.log_entry import Setting
    row = db.query(Setting).filter(Setting.key == SETTING_KEY).first()
    if not row or not row.value:
        return False
    return str(row.value).strip().lower() in ("1", "true", "on", "yes")


def set_enabled(db, enabled: bool) -> None:
    from app.models.log_entry import Setting
    row = db.query(Setting).filter(Setting.key == SETTING_KEY).first()
    val = "true" if enabled else "false"
    if row:
        row.value = val
    else:
        db.add(Setting(key=SETTING_KEY, value=val))
    db.commit()
