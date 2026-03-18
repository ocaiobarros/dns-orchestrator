"""
DNS Control — VIP Counter History Model
Persistent storage for counter snapshots, surviving API restarts.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, Index
from app.core.database import Base


class VipCounterSnapshot(Base):
    __tablename__ = "vip_counter_snapshots"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    vip_ip = Column(String(45), nullable=False, index=True)
    backend_ip = Column(String(45), nullable=True)  # NULL = VIP entry counter
    protocol = Column(String(10), nullable=False, default="total")  # udp, tcp, total
    packets = Column(Integer, nullable=False, default=0)
    bytes_count = Column(Integer, nullable=False, default=0)
    qps = Column(Float, nullable=True)
    delta_packets = Column(Integer, nullable=True)
    window_seconds = Column(Float, nullable=True)
    counter_reset = Column(Integer, nullable=False, default=0)  # 1 = reset detected
    collected_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)


# Composite index for efficient lookups
Index("idx_vip_counter_vip_backend_proto", VipCounterSnapshot.vip_ip, VipCounterSnapshot.backend_ip, VipCounterSnapshot.protocol)
