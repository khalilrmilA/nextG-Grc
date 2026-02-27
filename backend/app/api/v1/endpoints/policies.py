"""Policies endpoints — stub (to be implemented)."""
from fastapi import APIRouter, Depends
from app.api.v1.dependencies import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("")
async def list_policies(_: User = Depends(get_current_user)):
    return {"module": "policies", "status": "coming_soon"}
