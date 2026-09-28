"""Super-admin view of the automatic content translation (translation_worker).

GET /admin/translations/status — per source and target language: how many
(text, language) pairs exist, how many are translated, how many are missing;
the on-demand CVE queue size; and the last cycle of the background worker.
Read-only. Mounted under /admin, gated with the strict super-admin check (not
require_roles, which would let tenant_admin through).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.admin import _super_admin_only
from app.core.database import get_db
from app.models.user import User

router = APIRouter()


@router.get("/status")
async def translation_status(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_super_admin_only),
) -> dict:
    from app.services.translation_worker import compute_status
    return await compute_status(db)
