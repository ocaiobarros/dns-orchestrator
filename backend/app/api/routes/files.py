"""
DNS Control — Generated Files Routes
"""

import os
from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import get_current_user
from app.models.user import User
from app.core.config import settings

router = APIRouter()

MANAGED_PATHS = [
    "/etc/unbound/", "/etc/nftables.conf", "/etc/frr/frr.conf",
    "/etc/network/interfaces.d/", "/etc/systemd/system/",
]


@router.get("/generated")
def list_generated_files(_: User = Depends(get_current_user)):
    files = []
    for base in MANAGED_PATHS:
        if os.path.isfile(base):
            stat = os.stat(base)
            files.append({"path": base, "size": stat.st_size, "modified": stat.st_mtime})
        elif os.path.isdir(base):
            for f in os.listdir(base):
                fp = os.path.join(base, f)
                if os.path.isfile(fp):
                    stat = os.stat(fp)
                    files.append({"path": fp, "size": stat.st_size, "modified": stat.st_mtime})
    return files


@router.get("/generated/{path:path}")
def get_file_content(path: str, _: User = Depends(get_current_user)):
    full = "/" + path
    allowed = any(full.startswith(p) for p in MANAGED_PATHS)
    if not allowed:
        raise HTTPException(status_code=403, detail="Acesso não permitido a este caminho")
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    with open(full, "r") as f:
        return {"path": full, "content": f.read()}
