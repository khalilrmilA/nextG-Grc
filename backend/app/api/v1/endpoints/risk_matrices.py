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

router = APIRouter()

class MatrixCreate(BaseModel):
    name: str; description: str | None = None; definition: dict; is_default: bool = False

class MatrixOut(BaseModel):
    id: str; tenant_id: str | None; name: str; description: str | None
    is_default: bool; is_builtin: bool; definition: dict
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}

# Prebuilt matrices
BUILTIN_5X5 = {
    "probability": {"count": 5, "labels": ["Very Low", "Low", "Medium", "High", "Very High"]},
    "impact": {"count": 5, "labels": ["Negligible", "Minor", "Moderate", "Major", "Catastrophic"]},
    "risk_levels": [
        {"name": "low", "color": "#22c55e", "min_score": 1, "max_score": 6},
        {"name": "medium", "color": "#eab308", "min_score": 7, "max_score": 12},
        {"name": "high", "color": "#f97316", "min_score": 13, "max_score": 18},
        {"name": "critical", "color": "#ef4444", "min_score": 19, "max_score": 25},
    ],
    "grid": [[1,2,3,4,5],[2,4,6,8,10],[3,6,9,12,15],[4,8,12,16,20],[5,10,15,20,25]],
}
BUILTIN_3X3 = {
    "probability": {"count": 3, "labels": ["Low", "Medium", "High"]},
    "impact": {"count": 3, "labels": ["Low", "Medium", "High"]},
    "risk_levels": [
        {"name": "low", "color": "#22c55e", "min_score": 1, "max_score": 3},
        {"name": "medium", "color": "#eab308", "min_score": 4, "max_score": 6},
        {"name": "high", "color": "#ef4444", "min_score": 7, "max_score": 9},
    ],
    "grid": [[1,2,3],[2,4,6],[3,6,9]],
}

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

@router.delete("/{mid}", status_code=204)
async def delete_matrix(mid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    r = await db.execute(select(RiskMatrix).where(RiskMatrix.id == mid, RiskMatrix.tenant_id == tenant_id, RiskMatrix.is_builtin == False))  # noqa: E712
    m = r.scalar_one_or_none()
    if not m: raise HTTPException(404, "Matrix not found or is built-in")
    await db.delete(m); await db.commit()
