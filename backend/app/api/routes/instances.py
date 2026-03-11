"""
DNS Control v2 — Instance Management Routes
CRUD for dns_instances table.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.operational import DnsInstance, InstanceState

router = APIRouter()


class InstanceCreate(BaseModel):
    instance_name: str
    bind_ip: str
    bind_port: int = 53
    outgoing_ip: str | None = None
    control_port: int = 8953
    node_name: str = "local"


@router.get("")
def list_instances(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    instances = db.query(DnsInstance).all()
    return [
        {
            "id": i.id, "node_name": i.node_name, "instance_name": i.instance_name,
            "bind_ip": i.bind_ip, "bind_port": i.bind_port,
            "outgoing_ip": i.outgoing_ip, "control_port": i.control_port,
            "is_enabled": i.is_enabled,
            "created_at": i.created_at.isoformat(),
        }
        for i in instances
    ]


@router.post("")
def create_instance(body: InstanceCreate, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    existing = db.query(DnsInstance).filter(DnsInstance.instance_name == body.instance_name).first()
    if existing:
        raise HTTPException(400, f"Instance {body.instance_name} already exists")

    inst = DnsInstance(
        instance_name=body.instance_name,
        bind_ip=body.bind_ip,
        bind_port=body.bind_port,
        outgoing_ip=body.outgoing_ip,
        control_port=body.control_port,
        node_name=body.node_name,
    )
    db.add(inst)
    db.flush()

    # Create initial state
    state = InstanceState(instance_id=inst.id, current_status="healthy", in_rotation=True)
    db.add(state)
    db.commit()

    return {"id": inst.id, "instance_name": inst.instance_name}


@router.delete("/{instance_id}")
def delete_instance(instance_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    inst = db.query(DnsInstance).filter(DnsInstance.id == instance_id).first()
    if not inst:
        raise HTTPException(404, "Instance not found")
    db.delete(inst)
    db.commit()
    return {"success": True}
