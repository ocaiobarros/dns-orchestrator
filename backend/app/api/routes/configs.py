"""
DNS Control — Config Profile Routes + Dry-Run Staging Validation
"""

import json
import os
import re
import tempfile
import subprocess
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.config_profile import ConfigProfile
from app.models.config_revision import ConfigRevision
from app.services.config_service import validate_config, generate_preview
from app.schemas.config import ConfigProfileCreate
from app.generators.unbound_generator import generate_unbound_configs, _compute_slabs

router = APIRouter()


# ═══ Dry-Run Staging Validation ═══

class DryRunStagingRequest(BaseModel):
    config: dict


@router.post("/dry-run-staging")
def dry_run_staging(body: DryRunStagingRequest, _: User = Depends(get_current_user)):
    """
    Staging validation: render files → structural checks → unbound-checkconf.
    Does NOT write to production paths.
    """
    payload = body.config
    results = {
        "checks": [],
        "unbound_checkconf": None,
        "overall": "pass",
    }

    # 1. Generate files
    try:
        files = generate_unbound_configs(payload)
    except Exception as exc:
        results["overall"] = "fail"
        results["checks"].append({
            "id": "render", "label": "Renderização dos arquivos",
            "status": "fail", "detail": str(exc),
        })
        return results

    results["checks"].append({
        "id": "render", "label": "Renderização dos arquivos",
        "status": "pass", "detail": f"{len(files)} artefatos gerados",
    })

    # 2. Find instance configs
    instance_files = [
        f for f in files
        if f["path"].startswith("/etc/unbound/") and f["path"].endswith(".conf")
        and "unbound.conf" not in f["path"] and "block" not in f["path"] and "anablock" not in f["path"]
    ]

    is_simple = payload.get("operationMode") == "simple" or (payload.get("_wizardConfig", {}) or {}).get("operationMode") == "simple"

    for inst_file in instance_files:
        content = inst_file["content"]
        fname = os.path.basename(inst_file["path"])

        # 3. Block order
        server_idx = content.find("server:")
        remote_idx = content.find("remote-control:")
        forward_idx = content.find("forward-zone:")
        order_ok = server_idx >= 0 and remote_idx > server_idx and forward_idx > remote_idx
        results["checks"].append({
            "id": f"block-order-{fname}", "label": f"Ordem de blocos ({fname})",
            "status": "pass" if order_ok else "fail",
            "detail": "server → remote-control → forward-zone" if order_ok else "Ordem incorreta",
        })

        # 4. Forward-zone "."
        has_global_fwd = 'name: "."' in content
        results["checks"].append({
            "id": f"forward-global-{fname}", "label": f'Forward-zone "." ({fname})',
            "status": "pass" if has_global_fwd else "fail",
            "detail": "Presente" if has_global_fwd else "AUSENTE",
        })

        # 5. Root-hints absent in simple mode
        if is_simple:
            has_root_hints = bool(re.search(r'^\s*root-hints:\s*"/', content, re.MULTILINE))
            results["checks"].append({
                "id": f"no-root-hints-{fname}", "label": f"Root-hints ausente ({fname})",
                "status": "pass" if not has_root_hints else "fail",
                "detail": "Nenhum root-hints ativo" if not has_root_hints else "root-hints detectado",
            })

        # 6. ACL from CIDR
        ipv4_addr = payload.get("ipv4Address") or (payload.get("_wizardConfig", {}) or {}).get("ipv4Address", "")
        cidr_match = re.match(r"^(\d+\.\d+\.\d+\.\d+)/(\d+)$", ipv4_addr)
        if cidr_match:
            mask = cidr_match.group(2)
            has_acl = f"/{mask} allow" in content
            results["checks"].append({
                "id": f"acl-cidr-{fname}", "label": f"ACL derivada /{mask} ({fname})",
                "status": "pass" if has_acl else "fail",
                "detail": f"access-control /{mask} detectado" if has_acl else f"ACL /{mask} não encontrada",
            })

    # 7. unbound-checkconf
    checkconf_result = _run_unbound_checkconf(instance_files)
    results["unbound_checkconf"] = checkconf_result
    if checkconf_result and checkconf_result["status"] == "fail":
        results["overall"] = "fail"
    if any(c["status"] == "fail" for c in results["checks"]):
        results["overall"] = "fail"

    return results


def _run_unbound_checkconf(instance_files: list[dict]) -> dict | None:
    """Run unbound-checkconf against rendered files in a temp directory."""
    try:
        subprocess.run(["which", "unbound-checkconf"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {"status": "skip", "detail": "unbound-checkconf não disponível neste host"}

    errors = []
    with tempfile.TemporaryDirectory(prefix="dns-control-staging-") as tmpdir:
        for placeholder in ["unbound-block-domains.conf", "anablock.conf"]:
            with open(os.path.join(tmpdir, placeholder), "w") as f:
                f.write("# placeholder\n")

        for inst_file in instance_files:
            fname = os.path.basename(inst_file["path"])
            content = inst_file["content"]
            content = content.replace("/etc/unbound/", f"{tmpdir}/")
            content = content.replace("/var/run/unbound.pid", f"{tmpdir}/unbound.pid")

            filepath = os.path.join(tmpdir, fname)
            with open(filepath, "w") as f:
                f.write(content)

            try:
                result = subprocess.run(
                    ["unbound-checkconf", filepath],
                    capture_output=True, text=True, timeout=10,
                )
                if result.returncode != 0:
                    errors.append(f"{fname}: {result.stderr.strip()}")
            except subprocess.TimeoutExpired:
                errors.append(f"{fname}: timeout")
            except Exception as exc:
                errors.append(f"{fname}: {str(exc)}")

    if errors:
        return {"status": "fail", "detail": "; ".join(errors)}
    return {"status": "pass", "detail": f"{len(instance_files)} arquivo(s) validado(s)"}


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
