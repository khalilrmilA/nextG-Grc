"""Risk Matrices — configurable risk assessment scales."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.risk_matrix import RiskMatrix
from app.services.risk_scoring import DEFAULT_MATRIX_5X5, DEFAULT_MATRIX_3X3

router = APIRouter()

class MatrixCreate(BaseModel):
    name: str; description: str | None = None; definition: dict; is_default: bool = False

class MatrixOut(BaseModel):
    id: str; tenant_id: str | None; name: str; description: str | None
    is_default: bool; is_builtin: bool; definition: dict
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

# Prebuilt matrices (canonical definitions live in services.risk_scoring so the
# scoring engine and this endpoint never drift apart).
BUILTIN_5X5 = DEFAULT_MATRIX_5X5
BUILTIN_3X3 = DEFAULT_MATRIX_3X3

@router.get("", response_model=list[MatrixOut])
async def list_matrices(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    matrices = list((await db.execute(select(RiskMatrix).where((RiskMatrix.is_builtin == True) | (RiskMatrix.tenant_id == tenant_id)))).scalars().all())  # noqa: E712
    # Add builtins if empty
    if not any(m.is_builtin for m in matrices):
        return [
            MatrixOut(id="builtin-5x5", tenant_id=None, name="Standard 5x5 Matrix", description="Default 5x5 probability x impact matrix",
                     is_default=True, is_builtin=True, definition=BUILTIN_5X5, created_at=datetime.utcnow(), updated_at=datetime.utcnow()),
            MatrixOut(id="builtin-3x3", tenant_id=None, name="Simple 3x3 Matrix", description="Simplified 3x3 matrix for quick assessments",
                     is_default=False, is_builtin=True, definition=BUILTIN_3X3, created_at=datetime.utcnow(), updated_at=datetime.utcnow()),
        ] + [MatrixOut.model_validate(m) for m in matrices]
    return [MatrixOut.model_validate(m) for m in matrices]

@router.post("", response_model=MatrixOut, status_code=201)
async def create_matrix(body: MatrixCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    m = RiskMatrix(tenant_id=tenant_id, name=body.name, description=body.description,
                   definition=body.definition, is_default=body.is_default, is_builtin=False)
    db.add(m); await db.flush(); await db.commit(); await db.refresh(m)
    return MatrixOut.model_validate(m)

@router.put("/{mid}/default", response_model=MatrixOut)
async def set_default_matrix(mid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    """Activate a tenant-owned matrix as the default that drives risk scoring.

    Clears is_default on the tenant's other matrices so exactly one is active.
    """
    r = await db.execute(select(RiskMatrix).where(RiskMatrix.id == mid, RiskMatrix.tenant_id == tenant_id))
    m = r.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Matrix not found")
    others = (await db.execute(select(RiskMatrix).where(RiskMatrix.tenant_id == tenant_id, RiskMatrix.is_default == True))).scalars().all()  # noqa: E712
    for o in others:
        o.is_default = False
    m.is_default = True
    await db.commit(); await db.refresh(m)
    return MatrixOut.model_validate(m)


@router.delete("/{mid}", status_code=204)
async def delete_matrix(mid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskMatrix).where(RiskMatrix.id == mid, RiskMatrix.tenant_id == tenant_id, RiskMatrix.is_builtin == False))  # noqa: E712
    m = r.scalar_one_or_none()
    if not m: raise HTTPException(404, "Matrix not found or is built-in")
    await db.delete(m); await db.commit()
