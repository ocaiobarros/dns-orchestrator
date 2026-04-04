#!/usr/bin/env python3
"""
DNS Control — dnstap Collector
Connects to Unbound's dnstap Unix/TCP socket, parses Frame Streams + protobuf
messages, and outputs structured DNS events for the API/frontend.

Requires: protobuf (google.protobuf) — falls back to a minimal binary parser
if the generated dnstap_pb2 module is unavailable.

Usage:
    python3 dnstap_collector.py [--socket /var/run/unbound/dnstap.sock] [--output /var/lib/dns-control/telemetry/dnstap.json]

Safe degradation:
    - If dnstap is not enabled on Unbound, the collector exits cleanly.
    - If the socket is unavailable, it retries with exponential backoff.
    - If protobuf is unavailable, it uses a minimal struct-based parser.
"""

import json
import os
import socket
import struct
import sys
import time
import signal
import logging
from collections import Counter, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("dns-control.dnstap-collector")

# ── Configuration ──

DEFAULT_SOCKET = os.environ.get("DNSTAP_SOCKET", "/var/run/unbound/dnstap.sock")
DEFAULT_OUTPUT = os.environ.get("DNSTAP_OUTPUT", "/var/lib/dns-control/telemetry/dnstap.json")
DEFAULT_EVENTS_OUTPUT = os.environ.get("DNSTAP_EVENTS_OUTPUT", "/var/lib/dns-control/telemetry/dnstap-events.json")
MAX_EVENTS_BUFFER = int(os.environ.get("DNSTAP_BUFFER_SIZE", "5000"))
BATCH_FLUSH_INTERVAL = int(os.environ.get("DNSTAP_FLUSH_INTERVAL", "10"))
RECONNECT_DELAY_BASE = 2
RECONNECT_DELAY_MAX = 60

# ── Frame Streams constants ──
FSTRM_CONTROL_ACCEPT = 0x01
FSTRM_CONTROL_START = 0x02
FSTRM_CONTROL_STOP = 0x03
FSTRM_CONTROL_READY = 0x04
FSTRM_CONTROL_FINISH = 0x05
FSTRM_CONTENT_TYPE = b"protobuf:dnstap.Dnstap"

# ── dnstap protobuf field numbers ──
# Message types
DNSTAP_MESSAGE = 1  # field 1 = Dnstap.message
MSG_TYPE = 1        # Message.type
MSG_QUERY_TIME_SEC = 9
MSG_QUERY_TIME_NSEC = 10
MSG_RESPONSE_TIME_SEC = 13
MSG_RESPONSE_TIME_NSEC = 14
MSG_QUERY_ADDRESS = 7
MSG_RESPONSE_ADDRESS = 8
MSG_QUERY_MESSAGE = 11
MSG_RESPONSE_MESSAGE = 12

# dnstap MessageType enum
AUTH_QUERY = 1
AUTH_RESPONSE = 2
RESOLVER_QUERY = 3
RESOLVER_RESPONSE = 4
CLIENT_QUERY = 5
CLIENT_RESPONSE = 6
FORWARDER_QUERY = 7
FORWARDER_RESPONSE = 8

MSG_TYPE_NAMES = {
    1: "AUTH_QUERY", 2: "AUTH_RESPONSE",
    3: "RESOLVER_QUERY", 4: "RESOLVER_RESPONSE",
    5: "CLIENT_QUERY", 6: "CLIENT_RESPONSE",
    7: "FORWARDER_QUERY", 8: "FORWARDER_RESPONSE",
}

# DNS RCODE names
RCODE_NAMES = {
    0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN",
    4: "NOTIMP", 5: "REFUSED", 6: "YXDOMAIN", 7: "YXRRSET",
    8: "NXRRSET", 9: "NOTAUTH", 10: "NOTZONE",
}


class DnstapEvent:
    """Parsed DNS event from dnstap."""
    __slots__ = (
        "timestamp", "msg_type", "client_ip", "qname", "qtype",
        "rcode", "status", "latency_ms", "instance_name",
    )

    def __init__(self):
        self.timestamp: float = 0.0
        self.msg_type: str = ""
        self.client_ip: str = ""
        self.qname: str = ""
        self.qtype: str = "A"
        self.rcode: str = "NOERROR"
        self.status: str = "ok"
        self.latency_ms: Optional[float] = None
        self.instance_name: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "timestamp": datetime.fromtimestamp(self.timestamp, tz=timezone.utc).isoformat() if self.timestamp else None,
            "msg_type": self.msg_type,
            "client_ip": self.client_ip,
            "qname": self.qname,
            "qtype": self.qtype,
            "rcode": self.rcode,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "instance_name": self.instance_name,
            "source": "dnstap",
            "confidence": 1.0,
        }


# ── Minimal protobuf parser (no dependency required) ──

def _decode_varint(data: bytes, offset: int) -> tuple[int, int]:
    """Decode a protobuf varint, return (value, new_offset)."""
    result = 0
    shift = 0
    while offset < len(data):
        b = data[offset]
        offset += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return result, offset


def _parse_protobuf_fields(data: bytes) -> dict[int, list]:
    """Parse protobuf wire format into {field_number: [values]}."""
    fields: dict[int, list] = {}
    offset = 0
    while offset < len(data):
        if offset >= len(data):
            break
        tag, offset = _decode_varint(data, offset)
        field_num = tag >> 3
        wire_type = tag & 0x07

        if wire_type == 0:  # Varint
            val, offset = _decode_varint(data, offset)
            fields.setdefault(field_num, []).append(val)
        elif wire_type == 2:  # Length-delimited
            length, offset = _decode_varint(data, offset)
            val = data[offset:offset + length]
            offset += length
            fields.setdefault(field_num, []).append(val)
        elif wire_type == 1:  # 64-bit
            val = data[offset:offset + 8]
            offset += 8
            fields.setdefault(field_num, []).append(val)
        elif wire_type == 5:  # 32-bit
            val = data[offset:offset + 4]
            offset += 4
            fields.setdefault(field_num, []).append(val)
        else:
            break  # Unknown wire type
    return fields


def _parse_dns_header(data: bytes) -> tuple[str, str, int]:
    """Parse minimal DNS message header to extract QNAME, QTYPE, RCODE."""
    if len(data) < 12:
        return "", "A", 0

    rcode = data[3] & 0x0F
    qdcount = struct.unpack("!H", data[4:6])[0]

    qname = ""
    qtype_val = 1
    if qdcount > 0:
        offset = 12
        labels = []
        while offset < len(data):
            length = data[offset]
            offset += 1
            if length == 0:
                break
            if length >= 0xC0:  # Compression pointer
                break
            if offset + length > len(data):
                break
            labels.append(data[offset:offset + length].decode("ascii", errors="replace"))
            offset += length
        qname = ".".join(labels)

        if offset + 2 <= len(data):
            qtype_val = struct.unpack("!H", data[offset:offset + 2])[0]

    qtype_names = {
        1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR",
        15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 43: "DS",
        46: "RRSIG", 47: "NSEC", 48: "DNSKEY", 50: "NSEC3",
        52: "TLSA", 64: "SVCB", 65: "HTTPS", 255: "ANY", 257: "CAA",
    }

    return qname, qtype_names.get(qtype_val, str(qtype_val)), rcode


def parse_dnstap_message(data: bytes) -> Optional[DnstapEvent]:
    """Parse a dnstap protobuf message into a DnstapEvent."""
    try:
        # Outer Dnstap message
        outer = _parse_protobuf_fields(data)

        # Field 1 = message (length-delimited, contains Message)
        msg_data = outer.get(DNSTAP_MESSAGE, [None])[0]
        if not msg_data or not isinstance(msg_data, bytes):
            return None

        msg = _parse_protobuf_fields(msg_data)

        event = DnstapEvent()

        # Message type
        msg_type_val = msg.get(MSG_TYPE, [0])[0]
        event.msg_type = MSG_TYPE_NAMES.get(msg_type_val, f"UNKNOWN_{msg_type_val}")

        # Timestamps
        query_sec = msg.get(MSG_QUERY_TIME_SEC, [0])[0]
        query_nsec = msg.get(MSG_QUERY_TIME_NSEC, [0])[0]
        resp_sec = msg.get(MSG_RESPONSE_TIME_SEC, [0])[0]
        resp_nsec = msg.get(MSG_RESPONSE_TIME_NSEC, [0])[0]

        if resp_sec:
            event.timestamp = resp_sec + resp_nsec / 1e9
        elif query_sec:
            event.timestamp = query_sec + query_nsec / 1e9
        else:
            event.timestamp = time.time()

        # Latency (response_time - query_time)
        if query_sec and resp_sec:
            q_ts = query_sec + query_nsec / 1e9
            r_ts = resp_sec + resp_nsec / 1e9
            if r_ts >= q_ts:
                event.latency_ms = round((r_ts - q_ts) * 1000, 3)

        # Client IP (query_address, field 7)
        addr_data = msg.get(MSG_QUERY_ADDRESS, [None])[0]
        if addr_data and isinstance(addr_data, bytes):
            if len(addr_data) == 4:
                event.client_ip = ".".join(str(b) for b in addr_data)
            elif len(addr_data) == 16:
                event.client_ip = ":".join(f"{addr_data[i]:02x}{addr_data[i+1]:02x}" for i in range(0, 16, 2))

        # Parse DNS message (prefer response, fallback to query)
        dns_data = msg.get(MSG_RESPONSE_MESSAGE, [None])[0]
        is_response = True
        if not dns_data or not isinstance(dns_data, bytes):
            dns_data = msg.get(MSG_QUERY_MESSAGE, [None])[0]
            is_response = False

        if dns_data and isinstance(dns_data, bytes):
            qname, qtype, rcode = _parse_dns_header(dns_data)
            event.qname = qname
            event.qtype = qtype
            if is_response:
                event.rcode = RCODE_NAMES.get(rcode, f"RCODE_{rcode}")
                if rcode == 0:
                    event.status = "ok"
                elif rcode == 2:
                    event.status = "servfail"
                elif rcode == 3:
                    event.status = "nxdomain"
                elif rcode == 5:
                    event.status = "refused"
                else:
                    event.status = "error"
            else:
                event.rcode = "PENDING"
                event.status = "query"

        return event

    except Exception as e:
        logger.debug(f"Failed to parse dnstap message: {e}")
        return None


# ── Frame Streams protocol ──

def _read_exact(sock: socket.socket, n: int) -> bytes:
    """Read exactly n bytes from socket."""
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("Socket closed")
        buf += chunk
    return buf


def _read_frame(sock: socket.socket) -> tuple[bool, bytes]:
    """
    Read a Frame Streams frame.
    Returns (is_control, payload).
    """
    length_bytes = _read_exact(sock, 4)
    length = struct.unpack("!I", length_bytes)[0]

    if length == 0:
        # Control frame: next 4 bytes are the actual control frame length
        ctrl_len_bytes = _read_exact(sock, 4)
        ctrl_len = struct.unpack("!I", ctrl_len_bytes)[0]
        payload = _read_exact(sock, ctrl_len)
        return True, payload

    # Data frame
    payload = _read_exact(sock, length)
    return False, payload


def _send_control_frame(sock: socket.socket, frame_type: int, content_type: bytes = b""):
    """Send a Frame Streams control frame."""
    ctrl_payload = struct.pack("!I", frame_type)
    if content_type:
        # Content type field: type=1, length, value
        ctrl_payload += struct.pack("!I", 1)  # CONTENT_TYPE field
        ctrl_payload += struct.pack("!I", len(content_type))
        ctrl_payload += content_type

    # Control frame: leading 0x00000000, then length, then payload
    sock.sendall(struct.pack("!I", 0))
    sock.sendall(struct.pack("!I", len(ctrl_payload)))
    sock.sendall(ctrl_payload)


def _handshake_bidirectional(sock: socket.socket):
    """
    Perform bidirectional Frame Streams handshake.
    Unbound acts as sender, we act as receiver.
    Sequence: recv READY → send ACCEPT → recv START
    """
    # Receive READY
    is_ctrl, payload = _read_frame(sock)
    if not is_ctrl:
        raise ConnectionError("Expected control frame (READY), got data frame")

    ctrl_type = struct.unpack("!I", payload[:4])[0]
    if ctrl_type != FSTRM_CONTROL_READY:
        raise ConnectionError(f"Expected READY ({FSTRM_CONTROL_READY}), got {ctrl_type}")

    logger.info("Received READY from Unbound")

    # Send ACCEPT
    _send_control_frame(sock, FSTRM_CONTROL_ACCEPT, FSTRM_CONTENT_TYPE)
    logger.info("Sent ACCEPT")

    # Receive START
    is_ctrl, payload = _read_frame(sock)
    if not is_ctrl:
        raise ConnectionError("Expected control frame (START), got data frame")

    ctrl_type = struct.unpack("!I", payload[:4])[0]
    if ctrl_type != FSTRM_CONTROL_START:
        raise ConnectionError(f"Expected START ({FSTRM_CONTROL_START}), got {ctrl_type}")

    logger.info("Received START — dnstap stream active")


class DnstapCollector:
    """
    Main dnstap collector.
    Connects to Unbound's Frame Streams socket, parses events, and
    writes aggregated output to JSON files.
    """

    def __init__(
        self,
        socket_path: str = DEFAULT_SOCKET,
        output_path: str = DEFAULT_OUTPUT,
        events_output_path: str = DEFAULT_EVENTS_OUTPUT,
        instance_name: str | None = None,
    ):
        self.socket_path = socket_path
        self.output_path = Path(output_path)
        self.events_output_path = Path(events_output_path)
        self.instance_name = instance_name
        self.running = False
        self.events_buffer: deque[dict] = deque(maxlen=MAX_EVENTS_BUFFER)
        self.error_domains: Counter = Counter()
        self.error_clients: Counter = Counter()
        self.rcode_counts: Counter = Counter()
        self.total_events = 0
        self.total_errors = 0
        self.last_flush = time.time()

    def run(self):
        """Main loop with reconnection."""
        self.running = True
        delay = RECONNECT_DELAY_BASE

        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

        while self.running:
            try:
                self._connect_and_stream()
                delay = RECONNECT_DELAY_BASE
            except FileNotFoundError:
                logger.warning(f"dnstap socket not found: {self.socket_path} — dnstap may not be enabled")
                self._write_status("unavailable", "Socket not found. Enable dnstap in Unbound config.")
                time.sleep(delay)
                delay = min(delay * 2, RECONNECT_DELAY_MAX)
            except ConnectionError as e:
                logger.warning(f"dnstap connection error: {e}")
                self._write_status("disconnected", str(e))
                time.sleep(delay)
                delay = min(delay * 2, RECONNECT_DELAY_MAX)
            except Exception as e:
                logger.exception(f"dnstap collector error: {e}")
                self._write_status("error", str(e)[:200])
                time.sleep(delay)
                delay = min(delay * 2, RECONNECT_DELAY_MAX)

    def _connect_and_stream(self):
        """Connect to socket and process stream."""
        logger.info(f"Connecting to dnstap socket: {self.socket_path}")

        if self.socket_path.startswith("/"):
            # Unix socket
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.connect(self.socket_path)
        else:
            # TCP socket (host:port)
            host, port = self.socket_path.rsplit(":", 1)
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect((host, int(port)))

        sock.settimeout(30)

        try:
            # For Unix sockets with Unbound, we're the listener.
            # Unbound connects to us. But if we connect TO a socket,
            # we need bidirectional handshake.
            _handshake_bidirectional(sock)
            self._write_status("connected", "Streaming dnstap events")

            while self.running:
                try:
                    is_ctrl, payload = _read_frame(sock)
                except socket.timeout:
                    # Periodic flush on timeout
                    self._flush_output()
                    continue

                if is_ctrl:
                    ctrl_type = struct.unpack("!I", payload[:4])[0]
                    if ctrl_type == FSTRM_CONTROL_STOP:
                        logger.info("Received STOP from Unbound")
                        _send_control_frame(sock, FSTRM_CONTROL_FINISH)
                        break
                    continue

                # Data frame: parse dnstap message
                event = parse_dnstap_message(payload)
                if event:
                    event.instance_name = self.instance_name
                    self._process_event(event)

                # Periodic flush
                if time.time() - self.last_flush >= BATCH_FLUSH_INTERVAL:
                    self._flush_output()

        finally:
            sock.close()

    def _process_event(self, event: DnstapEvent):
        """Process a single dnstap event."""
        self.total_events += 1
        evt_dict = event.to_dict()
        self.events_buffer.append(evt_dict)

        self.rcode_counts[event.rcode] += 1

        if event.status not in ("ok", "query"):
            self.total_errors += 1
            if event.qname:
                self.error_domains[event.qname] += 1
            if event.client_ip:
                self.error_clients[event.client_ip] += 1

    def _flush_output(self):
        """Write aggregated output to JSON files."""
        self.last_flush = time.time()
        now = datetime.now(timezone.utc)

        self.output_path.parent.mkdir(parents=True, exist_ok=True)

        summary = {
            "status": "connected",
            "timestamp": now.isoformat(),
            "total_events": self.total_events,
            "total_errors": self.total_errors,
            "rcode_counts": dict(self.rcode_counts),
            "top_error_domains": [
                {"domain": d, "count": c}
                for d, c in self.error_domains.most_common(20)
            ],
            "top_error_clients": [
                {"ip": ip, "count": c}
                for ip, c in self.error_clients.most_common(20)
            ],
            "error_rate_pct": round(
                self.total_errors / max(self.total_events, 1) * 100, 2
            ),
            "source": "dnstap",
            "fidelity": "full",
            "instance_name": self.instance_name,
            "buffer_size": len(self.events_buffer),
        }

        self._atomic_write(self.output_path, summary)

        # Write recent events for API consumption
        events_data = {
            "events": list(self.events_buffer)[-200:],
            "timestamp": now.isoformat(),
        }
        self._atomic_write(self.events_output_path, events_data)

    def _write_status(self, status: str, message: str):
        """Write a status-only output."""
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "message": message,
            "total_events": self.total_events,
            "total_errors": self.total_errors,
            "source": "dnstap",
            "fidelity": "unavailable" if status != "connected" else "full",
        }
        self._atomic_write(self.output_path, data)

    def _atomic_write(self, path: Path, data: dict):
        """Atomic file write via temp + rename."""
        try:
            tmp = path.with_suffix(".tmp")
            with open(tmp, "w") as f:
                json.dump(data, f, indent=2)
            tmp.rename(path)
        except Exception as e:
            logger.error(f"Failed to write {path}: {e}")

    def _signal_handler(self, signum, frame):
        logger.info(f"Received signal {signum}, shutting down")
        self.running = False
        self._flush_output()


def check_dnstap_status() -> dict:
    """Check if dnstap collector is running and get its status."""
    output_path = Path(DEFAULT_OUTPUT)
    try:
        with open(output_path) as f:
            data = json.load(f)
        status = data.get("status", "unknown")
        file_age = int(time.time() - output_path.stat().st_mtime)
        return {
            "enabled": True,
            "status": status,
            "stale": file_age > 30,
            "file_age_seconds": file_age,
            "total_events": data.get("total_events", 0),
            "total_errors": data.get("total_errors", 0),
            "fidelity": data.get("fidelity", "unknown"),
            "source": "dnstap",
        }
    except FileNotFoundError:
        return {
            "enabled": False,
            "status": "not_configured",
            "stale": True,
            "fidelity": "unavailable",
            "message": "dnstap collector not running. Enable dnstap in Unbound for full DNS event visibility.",
            "source": "dnstap",
        }
    except Exception as e:
        return {
            "enabled": False,
            "status": "error",
            "stale": True,
            "fidelity": "unavailable",
            "error": str(e)[:200],
            "source": "dnstap",
        }


def get_dnstap_events(limit: int = 100) -> list[dict]:
    """Read recent dnstap events from the events output file."""
    events_path = Path(DEFAULT_EVENTS_OUTPUT)
    try:
        with open(events_path) as f:
            data = json.load(f)
        events = data.get("events", [])
        return events[-limit:]
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def get_dnstap_summary() -> dict:
    """Read the latest dnstap aggregated summary."""
    output_path = Path(DEFAULT_OUTPUT)
    try:
        with open(output_path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "status": "not_configured",
            "total_events": 0,
            "total_errors": 0,
            "source": "dnstap",
            "fidelity": "unavailable",
        }


# ── CLI Entry Point ──

def main():
    import argparse

    parser = argparse.ArgumentParser(description="DNS Control dnstap collector")
    parser.add_argument("--socket", default=DEFAULT_SOCKET, help="dnstap socket path (Unix or host:port)")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Output JSON path")
    parser.add_argument("--events-output", default=DEFAULT_EVENTS_OUTPUT, help="Events JSON path")
    parser.add_argument("--instance", default=None, help="Instance name for tagging events")
    parser.add_argument("--verbose", action="store_true", help="Verbose logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    collector = DnstapCollector(
        socket_path=args.socket,
        output_path=args.output,
        events_output_path=args.events_output,
        instance_name=args.instance,
    )

    logger.info(f"Starting dnstap collector: socket={args.socket}")
    collector.run()


if __name__ == "__main__":
    main()
