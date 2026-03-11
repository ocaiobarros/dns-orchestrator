"""
DNS Control — Config Profile Routes
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.config_profile import ConfigProfile
from app.models.config_revision import ConfigRevision
from app.services.config_service import validate_config, generate_preview
from app.schemas.config import ConfigProfileCreate

router = APIRouter()


@router.get("")
def list_configs(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    profiles = db.query(ConfigProfile).order_by(ConfigProfile.created_at.desc()).all()
    return [
        {
            "id": p.id, "name": p.name, "description": p.description,
            "created_by": p.created_by, "created_at": p.created_at.isoformat(),
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        }
        for p in profiles
    ]


@router.post("", status_code=201)
def create_config(body: ConfigProfileCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = ConfigProfile(
        name=body.name,
        description=body.description,
        payload_json=json.dumps(body.payload),
        created_by=user.username,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)

    # Create initial revision
    revision = ConfigRevision(
        profile_id=profile.id,
        revision_number=1,
        payload_json=json.dumps(body.payload),
        created_by=user.username,
    )
    db.add(revision)
    db.commit()

    return {"id": profile.id, "name": profile.name}


@router.get("/{config_id}")
def get_config(config_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    profile = db.query(ConfigProfile).filter(ConfigProfile.id == config_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil não encontrado")
    return {
        "id": profile.id, "name": profile.name, "description": profile.description,
        "payload": json.loads(profile.payload_json),
        "created_by": profile.created_by,
        "created_at": profile.created_at.isoformat(),
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


@router.patch("/{config_id}")
def update_config(config_id: str, body: ConfigProfileCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = db.query(ConfigProfile).filter(ConfigProfile.id == config_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil não encontrado")

    profile.name = body.name
    profile.description = body.description
    profile.payload_json = json.dumps(body.payload)

    # Create new revision
    last_rev = db.query(ConfigRevision).filter(ConfigRevision.profile_id == config_id).order_by(ConfigRevision.revision_number.desc()).first()
    rev_num = (last_rev.revision_number + 1) if last_rev else 1

    revision = ConfigRevision(
        profile_id=config_id,
        revision_number=rev_num,
        payload_json=json.dumps(body.payload),
        created_by=user.username,
    )
    db.add(revision)
    db.commit()
    return {"success": True}


@router.post("/{config_id}/clone")
def clone_config(config_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    profile = db.query(ConfigProfile).filter(ConfigProfile.id == config_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil não encontrado")

    clone = ConfigProfile(
        name=f"{profile.name} (cópia)",
        description=profile.description,
        payload_json=profile.payload_json,
        created_by=user.username,
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return {"id": clone.id, "name": clone.name}


@router.get("/{config_id}/preview")
def preview_config(config_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    profile = db.query(ConfigProfile).filter(ConfigProfile.id == config_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil não encontrado")
    payload = json.loads(profile.payload_json)
    return generate_preview(payload)


@router.get("/{config_id}/files")
def config_files(config_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    profile = db.query(ConfigProfile).filter(ConfigProfile.id == config_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil não encontrado")
    payload = json.loads(profile.payload_json)
    return generate_preview(payload)


@router.get("/{config_id}/diff/{rev_a}/{rev_b}")
def config_diff(config_id: str, rev_a: str, rev_b: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    ra = db.query(ConfigRevision).filter(ConfigRevision.id == rev_a).first()
    rb = db.query(ConfigRevision).filter(ConfigRevision.id == rev_b).first()
    if not ra or not rb:
        raise HTTPException(status_code=404, detail="Revisão não encontrada")

    from app.services.config_service import diff_configs
    return diff_configs(json.loads(ra.payload_json), json.loads(rb.payload_json))


@router.get("/{config_id}/history")
def config_history(config_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    revisions = db.query(ConfigRevision).filter(
        ConfigRevision.profile_id == config_id
    ).order_by(ConfigRevision.revision_number.desc()).all()
    return [
        {
            "id": r.id, "revision_number": r.revision_number,
            "created_by": r.created_by, "created_at": r.created_at.isoformat(),
        }
        for r in revisions
    ]
