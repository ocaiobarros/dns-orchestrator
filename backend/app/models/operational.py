"""
DNS Control v2 — Operational Models
DNS instances, health checks, instance state, metrics, events, actions.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, Boolean, ForeignKey
from app.core.database import Base


class DnsInstance(Base):
    __tablename__ = "dns_instances"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    node_name = Column(String(100), nullable=False, default="local")
    instance_name = Column(String(100), nullable=False, unique=True)
    bind_ip = Column(String(45), nullable=False)
    bind_port = Column(Integer, nullable=False, default=53)
    outgoing_ip = Column(String(45), nullable=True)
    control_port = Column(Integer, nullable=False, default=8953)
    is_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class HealthCheck(Base):
    __tablename__ = "health_checks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    instance_id = Column(String, ForeignKey("dns_instances.id", ondelete="CASCADE"), nullable=False, index=True)
    check_type = Column(String(30), nullable=False)  # dig, port, systemd, unbound_stats
    status = Column(String(20), nullable=False)  # ok, degraded, failed
    latency_ms = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    details_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)


class InstanceState(Base):
    __tablename__ = "instance_state"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    instance_id = Column(String, ForeignKey("dns_instances.id", ondelete="CASCADE"), nullable=False, unique=True)
    current_status = Column(String(20), nullable=False, default="healthy")  # healthy, degraded, failed, withdrawn
    last_success_at = Column(DateTime, nullable=True)
    last_failure_at = Column(DateTime, nullable=True)
    consecutive_failures = Column(Integer, nullable=False, default=0)
    consecutive_successes = Column(Integer, nullable=False, default=0)
    in_rotation = Column(Boolean, nullable=False, default=True)
    last_transition_at = Column(DateTime, nullable=True)
    reason = Column(Text, nullable=True)


class MetricSample(Base):
    __tablename__ = "metrics_samples"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    instance_id = Column(String, ForeignKey("dns_instances.id", ondelete="CASCADE"), nullable=False, index=True)
    metric_name = Column(String(100), nullable=False, index=True)
    metric_value = Column(Float, nullable=False)
    labels_json = Column(Text, nullable=True)
    collected_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)


class OperationalEvent(Base):
    __tablename__ = "events"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    event_type = Column(String(50), nullable=False, index=True)
    severity = Column(String(20), nullable=False, default="info")  # info, warning, critical
    instance_id = Column(String, ForeignKey("dns_instances.id", ondelete="SET NULL"), nullable=True)
    message = Column(Text, nullable=False)
    details_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)


class OperationalAction(Base):
    __tablename__ = "actions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    action_type = Column(String(50), nullable=False)  # remove_backend, restore_backend, restart_service
    target_type = Column(String(50), nullable=False)  # instance, service, vip
    target_id = Column(String, nullable=True)
    status = Column(String(20), nullable=False, default="pending")  # pending, running, success, failed
    stdout_log = Column(Text, default="")
    stderr_log = Column(Text, default="")
    exit_code = Column(Integer, nullable=True)
    trigger_source = Column(String(30), nullable=False, default="manual")  # manual, health_engine, apply_engine
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    finished_at = Column(DateTime, nullable=True)
