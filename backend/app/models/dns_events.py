"""
DNS Control — DNS Event Models
Stores observed DNS resolution events for error correlation and analytics.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, Index
from app.core.database import Base


class DnsEvent(Base):
    """Individual DNS resolution event captured from dnstap, logs, or inference."""
    __tablename__ = "dns_events"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    timestamp = Column(DateTime, nullable=False, index=True, default=lambda: datetime.now(timezone.utc))
    client_ip = Column(String(45), nullable=False, index=True)
    qname = Column(String(255), nullable=False, index=True)
    qtype = Column(String(10), nullable=False, default="A")
    rcode = Column(String(20), nullable=False, index=True)  # NOERROR, NXDOMAIN, SERVFAIL, REFUSED, TIMEOUT
    status = Column(String(20), nullable=False, default="ok")  # ok, nxdomain, servfail, timeout, refused
    latency_ms = Column(Float, nullable=True)
    vip = Column(String(45), nullable=True)
    backend_ip = Column(String(45), nullable=True)
    instance_name = Column(String(100), nullable=True, index=True)
    source = Column(String(30), nullable=False, default="logs")  # dnstap, logs, unbound-control, inferred
    confidence = Column(Float, nullable=False, default=1.0)  # 0.0-1.0

    __table_args__ = (
        Index("idx_dns_events_ts_rcode", "timestamp", "rcode"),
        Index("idx_dns_events_qname_rcode", "qname", "rcode"),
    )


class DnsErrorAggregate(Base):
    """Pre-aggregated DNS error counts per minute for fast dashboard queries."""
    __tablename__ = "dns_error_aggregates"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    bucket = Column(DateTime, nullable=False, index=True)  # Truncated to minute
    rcode = Column(String(20), nullable=False, index=True)
    count = Column(Integer, nullable=False, default=0)
    instance_name = Column(String(100), nullable=True)
    top_qnames_json = Column(Text, nullable=True)  # JSON: [{"qname": "...", "count": N}, ...]
    top_clients_json = Column(Text, nullable=True)  # JSON: [{"ip": "...", "count": N}, ...]

    __table_args__ = (
        Index("idx_dns_error_agg_bucket_rcode", "bucket", "rcode"),
    )
