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

import ipaddress
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
from typing import Deque, Dict, Iterable, Optional, Set


logger = logging.getLogger("dns-control.upstream-silence")

SETTING_KEY = "UPSTREAM_SILENCE_DETECTOR_ENABLED"
SETTING_WINDOW_SHORT = "UPSTREAM_SILENCE_WINDOW_SHORT_SEC"
SETTING_WINDOW_LONG = "UPSTREAM_SILENCE_WINDOW_LONG_SEC"
SETTING_SNAPSHOT_CAP = "UPSTREAM_SILENCE_SNAPSHOT_CAP"
SETTING_ALERT_THRESHOLD = "UPSTREAM_SILENCE_ALERT_THRESHOLD"
SETTING_ALERT_WINDOW = "UPSTREAM_SILENCE_ALERT_WINDOW"  # 'short' | 'long'

# Defaults preserved from v1 to keep behavior backward-compatible.
DEFAULT_WINDOW_SHORT = 5 * 60
DEFAULT_WINDOW_LONG = 15 * 60
DEFAULT_SNAPSHOT_CAP = 200
DEFAULT_ALERT_THRESHOLD = 10  # unique silent IPs in the configured window
DEFAULT_ALERT_WINDOW = "short"

# Backend-authoritative clamps. UI is convenience only — backend rejects/clamps.
MIN_WINDOW = 60          # 1 min
MAX_WINDOW = 60 * 60     # 60 min — bounds in-memory aggregate footprint.
MIN_CAP = 1
MAX_CAP = 1000
MIN_THRESHOLD = 1
MAX_THRESHOLD = 10000

# Legacy aliases kept for back-compat with v1 tests / external imports.
WINDOW_5MIN = DEFAULT_WINDOW_SHORT
WINDOW_15MIN = DEFAULT_WINDOW_LONG
RETENTION_SECONDS = MAX_WINDOW  # absolute ceiling for kept timestamps.
SNAPSHOT_TOP_N = DEFAULT_SNAPSHOT_CAP

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


# ---------------------------------------------------------------------------
# Local / own-IP filtering
# ---------------------------------------------------------------------------
#
# Sem este filtro o detector lista os PRÓPRIOS IPs do host (egress, listeners,
# VIPs interceptados) como "autoritativos mudos" — falso-positivo. Aplicamos
# dois níveis:
#   (a) Ranges estáticos não-roteáveis na internet pública: loopback, RFC1918,
#       RFC6598 CGNAT (cobre 100.64/10 e portanto os listeners 100.126.x),
#       link-local IPv4 e IPv6, ULA IPv6 (fc00::/7).
#   (b) Denylist dinâmica `own_ips` com os IPs DESTE host extraídos da config
#       de deploy (egress IPv4/IPv6, bind/listeners, VIPs interceptados,
#       service VIPs). Construída por `collect_own_ips_from_payload`.
#
# A função `is_local_or_own` é pura e testável.

_STATIC_LOCAL_NETS = tuple(
    ipaddress.ip_network(n) for n in (
        "127.0.0.0/8",       # loopback IPv4
        "10.0.0.0/8",        # RFC1918
        "172.16.0.0/12",     # RFC1918
        "192.168.0.0/16",    # RFC1918
        "169.254.0.0/16",    # link-local IPv4
        "100.64.0.0/10",     # RFC6598 CGNAT (cobre listeners 100.126.x)
        "0.0.0.0/8",         # "this network"
        "224.0.0.0/4",       # multicast IPv4
        "::1/128",           # loopback IPv6
        "fc00::/7",          # ULA IPv6 (RFC4193)
        "fe80::/10",         # link-local IPv6
        "ff00::/8",          # multicast IPv6
        "::/128",            # unspecified
    )
)


def is_local_or_own(ip: str, own_ips: Optional[Iterable[str]] = None) -> bool:
    """Pure predicate. True se ``ip`` é loopback/privado/CGNAT/link-local
    (não-roteável na internet) OU pertence à denylist ``own_ips`` (egress,
    listeners, VIPs deste host). Entradas inválidas retornam True (descartam)
    — defesa: nunca agregar lixo."""
    if not ip:
        return True
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    for net in _STATIC_LOCAL_NETS:
        if addr.version == net.version and addr in net:
            return True
    if own_ips:
        # Normalize via ip_address so notation variants (e.g. ::FFFF:1.2.3.4
        # vs 1.2.3.4) compare correctly.
        for raw in own_ips:
            if not raw:
                continue
            try:
                if ipaddress.ip_address(str(raw).strip()) == addr:
                    return True
            except ValueError:
                continue
    return False


def collect_own_ips_from_payload(payload: Optional[Dict[str, object]]) -> Set[str]:
    """Extrai do payload de deploy a denylist de IPs DESTE host: egress
    (IPv4/IPv6), bind/listeners, VIPs interceptados e service VIPs. Tolerante
    a payloads ausentes/parciais."""
    out: Set[str] = set()
    if not isinstance(payload, dict):
        return out

    def _add(v: object) -> None:
        if v is None:
            return
        s = str(v).strip()
        if not s:
            return
        # Strip CIDR mask if present (e.g. "10.0.0.1/32" → "10.0.0.1").
        s = s.split("/", 1)[0]
        out.add(s)

    # Host-level IPs (vários nomes possíveis ao longo da história do schema).
    for k in ("hostIp", "hostIpv4", "hostIpv6", "mainHostIp", "mainIp",
              "frontendIp", "frontendIpv4", "frontendIpv6"):
        _add(payload.get(k))
    loopback = payload.get("loopback") or {}
    if isinstance(loopback, dict):
        _add(loopback.get("vip"))
        _add(loopback.get("ipv4"))
        _add(loopback.get("ipv6"))

    # Wizard nested config (alguns deploys aninham aí).
    wizard_cfg = payload.get("_wizardConfig") or {}
    if isinstance(wizard_cfg, dict):
        out |= collect_own_ips_from_payload(wizard_cfg)

    # Instâncias: egress + binds.
    for inst in payload.get("instances", []) or []:
        if not isinstance(inst, dict):
            continue
        _add(inst.get("exitIp")); _add(inst.get("egressIpv4"))
        _add(inst.get("exitIpv6")); _add(inst.get("egressIpv6"))
        _add(inst.get("bindIp")); _add(inst.get("bindIpv6"))

    # VIPs interceptados (DNS Seizure) — IPs públicos do host atraídos por rota.
    for vip in payload.get("interceptedVips", []) or []:
        if not isinstance(vip, dict):
            continue
        _add(vip.get("vipIp")); _add(vip.get("vipIpv6"))
        _add(vip.get("ipv4")); _add(vip.get("ipv6"))

    # Service VIPs (modo Simples / VIP local).
    for vip in payload.get("serviceVips", []) or []:
        if not isinstance(vip, dict):
            continue
        _add(vip.get("ipv4")); _add(vip.get("ipv6"))

    nat = payload.get("nat") or {}
    if isinstance(nat, dict):
        for vip in nat.get("serviceVips", []) or []:
            if isinstance(vip, dict):
                _add(vip.get("ipv4")); _add(vip.get("ipv6"))

    return out



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
        # Runtime config (overridable via Settings). Defaults = v1 behavior.
        self._cfg: Dict[str, object] = {
            "window_short": DEFAULT_WINDOW_SHORT,
            "window_long": DEFAULT_WINDOW_LONG,
            "snapshot_cap": DEFAULT_SNAPSHOT_CAP,
            "alert_threshold": DEFAULT_ALERT_THRESHOLD,
            "alert_window": DEFAULT_ALERT_WINDOW,
        }
        # Alert debounce state — mirrors anablock.sync.stale dedup pattern.
        # _alert_active stays True from a below→above transition until the
        # count falls back below threshold (re-armed). Worker fires events
        # on transitions only, never per poll.
        self._alert_active = False
        self._alert_last_transition_at: Optional[float] = None

    # ---------- config ----------
    def apply_config(self, cfg: Dict[str, object]) -> None:
        """Replace the runtime config (already validated/clamped)."""
        with self._lock:
            for k in ("window_short", "window_long", "snapshot_cap", "alert_threshold"):
                if k in cfg:
                    self._cfg[k] = int(cfg[k])  # type: ignore[arg-type]
            if "alert_window" in cfg:
                aw = str(cfg["alert_window"])
                self._cfg["alert_window"] = "long" if aw == "long" else "short"

    def get_config(self) -> Dict[str, object]:
        with self._lock:
            return dict(self._cfg)

    def consume_alert_transition(self) -> Optional[Dict[str, object]]:
        """Atomically evaluate the alert state vs current snapshot and return
        a transition payload IF a below→above edge happened since last call.
        Updates the debounce state in place. Returns None when no transition
        (still above, still below, or just rearmed). Worker-only entrypoint."""
        now = time.time()
        cfg = self.get_config()
        window_key = str(cfg.get("alert_window") or "short")
        window_sec = int(cfg["window_short"]) if window_key == "short" else int(cfg["window_long"])  # type: ignore[arg-type]
        threshold = int(cfg["alert_threshold"])  # type: ignore[arg-type]
        # Count unique IPs with at least one event in the window.
        unique = 0
        with self._lock:
            for agg in self._aggregates.values():
                if agg.count_window(now, window_sec) > 0:
                    unique += 1
            was_active = self._alert_active
            now_above = unique >= threshold
            transition: Optional[Dict[str, object]] = None
            if now_above and not was_active:
                self._alert_active = True
                self._alert_last_transition_at = now
                transition = {
                    "direction": "rise",
                    "window": window_key,
                    "window_seconds": window_sec,
                    "threshold": threshold,
                    "count": unique,
                    "at": now,
                }
            elif (not now_above) and was_active:
                self._alert_active = False
                self._alert_last_transition_at = now
                # We only EMIT on rise (per spec), but re-arm here.
            return transition

    # ---------- factory ----------
    @classmethod
    def instance(cls) -> "UpstreamSilenceDetector":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = UpstreamSilenceDetector()
            return cls._instance


    # ---------- lifecycle ----------
    def _default_cmd(self) -> list[str]:
        # conntrack -E (netlink event stream) requires CAP_NET_ADMIN.
        # Service runs as unprivileged user (dns-control); invoke via sudo -n
        # with the absolute path that matches the sudoers allowlist entry.
        # The exact argv (and flag order) must match the sudoers line —
        # /etc/sudoers.d/dns-control-diagnostics.
        return [
            "sudo", "-n",
            "/usr/sbin/conntrack", "-E",
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
            cfg = dict(self._cfg)
            window_short = int(cfg["window_short"])  # type: ignore[arg-type]
            window_long = int(cfg["window_long"])    # type: ignore[arg-type]
            cap = int(cfg["snapshot_cap"])           # type: ignore[arg-type]
            threshold = int(cfg["alert_threshold"])  # type: ignore[arg-type]
            alert_window_key = str(cfg["alert_window"])
            alert_window_sec = window_short if alert_window_key == "short" else window_long
            items = []
            alert_count = 0
            for agg in self._aggregates.values():
                cL = agg.count_window(now, window_long)
                if cL == 0:
                    continue  # outside retention; will be pruned lazily.
                cS = agg.count_window(now, window_short)
                if (alert_window_sec == window_short and cS > 0) or (
                    alert_window_sec == window_long and cL > 0
                ):
                    alert_count += 1
                items.append({
                    "ip": agg.ip,
                    "family": agg.family,
                    "count_5min": cS,   # legacy keys kept for backward compat
                    "count_15min": cL,
                    "count_short": cS,
                    "count_long": cL,
                    "first_seen": datetime.fromtimestamp(agg.first_seen, tz=timezone.utc).isoformat(),
                    "last_seen": datetime.fromtimestamp(agg.last_seen, tz=timezone.utc).isoformat(),
                    "last_seen_epoch": int(agg.last_seen),
                })
            items.sort(key=lambda r: (r["count_long"], r["last_seen_epoch"]), reverse=True)
            items = items[:cap]
            payload = {
                "collector_status": self._status,  # disabled | ok | degraded
                "running": self._running,
                "window_seconds": {"short": window_short, "long": window_long},
                "snapshot_cap": cap,
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
                "config": cfg,
                "alert": {
                    "threshold": threshold,
                    "window": alert_window_key,
                    "window_seconds": alert_window_sec,
                    "count": alert_count,
                    "above": alert_count >= threshold,
                    "active": self._alert_active,
                    "last_transition_at": (
                        datetime.fromtimestamp(self._alert_last_transition_at, tz=timezone.utc).isoformat()
                        if self._alert_last_transition_at else None
                    ),
                },
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
            self._alert_active = False
            self._alert_last_transition_at = None
            self._cfg = {
                "window_short": DEFAULT_WINDOW_SHORT,
                "window_long": DEFAULT_WINDOW_LONG,
                "snapshot_cap": DEFAULT_SNAPSHOT_CAP,
                "alert_threshold": DEFAULT_ALERT_THRESHOLD,
                "alert_window": DEFAULT_ALERT_WINDOW,
            }


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


# ---------- Config (windows / cap / alert) ----------

def _clamp_int(raw: object, lo: int, hi: int, default: int) -> int:
    try:
        v = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def validate_and_clamp_config(raw: Dict[str, object]) -> Dict[str, object]:
    """Backend authority: rejects non-numeric inputs; clamps numeric to bounds.

    Returns a complete config dict. Missing keys fall back to defaults.
    """
    if not isinstance(raw, dict):
        raise ValueError("config must be an object")
    out: Dict[str, object] = {}
    for key, default in (
        ("window_short", DEFAULT_WINDOW_SHORT),
        ("window_long", DEFAULT_WINDOW_LONG),
    ):
        if key in raw and raw[key] is not None:
            try:
                int(raw[key])  # type: ignore[arg-type]
            except (TypeError, ValueError):
                raise ValueError(f"{key} must be an integer")
            out[key] = _clamp_int(raw[key], MIN_WINDOW, MAX_WINDOW, default)
        else:
            out[key] = default
    if int(out["window_short"]) > int(out["window_long"]):  # type: ignore[arg-type]
        out["window_short"], out["window_long"] = out["window_long"], out["window_short"]
    if "snapshot_cap" in raw and raw["snapshot_cap"] is not None:
        try:
            int(raw["snapshot_cap"])  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise ValueError("snapshot_cap must be an integer")
        out["snapshot_cap"] = _clamp_int(
            raw["snapshot_cap"], MIN_CAP, MAX_CAP, DEFAULT_SNAPSHOT_CAP
        )
    else:
        out["snapshot_cap"] = DEFAULT_SNAPSHOT_CAP
    if "alert_threshold" in raw and raw["alert_threshold"] is not None:
        try:
            int(raw["alert_threshold"])  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise ValueError("alert_threshold must be an integer")
        out["alert_threshold"] = _clamp_int(
            raw["alert_threshold"], MIN_THRESHOLD, MAX_THRESHOLD, DEFAULT_ALERT_THRESHOLD
        )
    else:
        out["alert_threshold"] = DEFAULT_ALERT_THRESHOLD
    aw = str(raw.get("alert_window") or DEFAULT_ALERT_WINDOW).lower()
    out["alert_window"] = "long" if aw == "long" else "short"
    return out


_CFG_KEYS = (
    (SETTING_WINDOW_SHORT, "window_short"),
    (SETTING_WINDOW_LONG, "window_long"),
    (SETTING_SNAPSHOT_CAP, "snapshot_cap"),
    (SETTING_ALERT_THRESHOLD, "alert_threshold"),
    (SETTING_ALERT_WINDOW, "alert_window"),
)


def load_config_from_db(db) -> Dict[str, object]:
    """Load persisted config; missing keys fall back to defaults."""
    from app.models.log_entry import Setting
    rows = {s.key: s.value for s in db.query(Setting).filter(
        Setting.key.in_([k for k, _ in _CFG_KEYS])
    ).all()}
    raw: Dict[str, object] = {}
    for skey, ckey in _CFG_KEYS:
        if skey in rows and rows[skey] is not None:
            raw[ckey] = rows[skey]
    return validate_and_clamp_config(raw)


def save_config_to_db(db, cfg: Dict[str, object]) -> None:
    from app.models.log_entry import Setting
    for skey, ckey in _CFG_KEYS:
        val = str(cfg[ckey])
        row = db.query(Setting).filter(Setting.key == skey).first()
        if row:
            row.value = val
        else:
            db.add(Setting(key=skey, value=val))
    db.commit()


def hydrate_detector_config(db) -> Dict[str, object]:
    """Load DB config (or defaults) into the live detector. Safe at startup."""
    cfg = load_config_from_db(db)
    UpstreamSilenceDetector.instance().apply_config(cfg)
    return cfg
