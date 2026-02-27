"""Assets endpoints — stub (to be implemented)."""
from fastapi import APIRouter, Depends
from app.api.v1.dependencies import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("")
async def list_assets(_: User = Depends(get_current_user)):
    return {"module": "assets", "status": "coming_soon"}
