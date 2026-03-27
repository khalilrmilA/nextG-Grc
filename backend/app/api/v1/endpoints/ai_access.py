"""AI access control and usage tracking endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel, field_serializer
from datetime import datetime, timedelta
from uuid import uuid4
import logging

from app.core.database import get_db
from app.api.v1.dependencies import get_current_user
from app.models.user import User
from app.models.ai_access import AiAccessRequest, AiUsageQuota, ApiToken

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/ai-access", tags=["AI Access"])


class AiAccessRequestCreate(BaseModel):
    feature: str  # document-generation, ai-analysis, all
    reason: str


class AiAccessRequestResponse(BaseModel):
    id: str
    user_email: str
    user_name: str
    feature: str
    reason: str
    status: str
    admin_notes: str | None
    requested_at: datetime
    responded_at: datetime | None

    class Config:
        from_attributes = True

    @field_serializer('requested_at', 'responded_at')
    def serialize_datetime(self, value: datetime | None) -> str | None:
        return value.isoformat() if value else None


class AiUsageResponse(BaseModel):
    tokens_used: int
    tokens_limit: int
    requests_made: int
    requests_limit: int
    reset_at: str
    percentage_used: int


class AiAccessStatusResponse(BaseModel):
    requests: list[AiAccessRequestResponse]
    quotas: list[dict]


class AiAccessCheckResponse(BaseModel):
    has_access: bool
    tokens_used: int
    tokens_limit: int
    requests_used: int
    requests_limit: int
    percentage_used: int
    reset_at: str | None


@router.get("/check", response_model=AiAccessCheckResponse)
async def check_ai_access(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Check if user has AI access and get current token usage."""
    try:
        # Check if user has an approved AI quota
        result = await db.execute(
            select(AiUsageQuota).where(
                and_(
                    AiUsageQuota.user_id == current_user.id,
                    AiUsageQuota.is_approved == True,  # noqa: E712
                )
            )
        )
        quota = result.scalar_one_or_none()

        if not quota:
            # User has no approved access
            return AiAccessCheckResponse(
                has_access=False,
                tokens_used=0,
                tokens_limit=10000,
                requests_used=0,
                requests_limit=100,
                percentage_used=0,
                reset_at=None,
            )

        # Reset quota if needed
        if datetime.utcnow() > quota.reset_date:
            quota.monthly_used_tokens = 0
            quota.monthly_used_requests = 0
            quota.reset_date = datetime.utcnow() + timedelta(days=30)
            await db.commit()

        percentage = int(
            (quota.monthly_used_tokens / quota.monthly_limit_tokens * 100)
            if quota.monthly_limit_tokens > 0
            else 0
        )

        # Check if user has exceeded token or request limits
        has_access = (
            quota.monthly_used_tokens < quota.monthly_limit_tokens
            and quota.monthly_used_requests < quota.monthly_limit_requests
        )

        return AiAccessCheckResponse(
            has_access=has_access,
            tokens_used=quota.monthly_used_tokens,
            tokens_limit=quota.monthly_limit_tokens,
            requests_used=quota.monthly_used_requests,
            requests_limit=quota.monthly_limit_requests,
            percentage_used=percentage,
            reset_at=quota.reset_date.isoformat() if quota.reset_date else None,
        )
    except Exception as e:
        logger.error(f"Failed to check AI access: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to check access",
        )


@router.post("/request", response_model=AiAccessRequestResponse)
async def request_ai_access(
    body: AiAccessRequestCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """User requests access to AI features."""
    try:
        request_id = str(uuid4())
        ai_request = AiAccessRequest(
            id=request_id,
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            user_email=current_user.email,
            user_name=current_user.full_name,
            feature=body.feature,
            reason=body.reason,
            status="pending",
        )
        db.add(ai_request)
        await db.commit()
        await db.refresh(ai_request)

        logger.info(f"AI access request created: {request_id} by {current_user.email}")
        return ai_request
    except Exception as e:
        logger.error(f"Failed to create AI access request: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create request",
        )


@router.get("/status", response_model=AiAccessStatusResponse)
async def get_ai_access_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get user's AI access requests and current quotas."""
    try:
        # Get user's requests
        result = await db.execute(
            select(AiAccessRequest).where(
                AiAccessRequest.user_id == current_user.id
            )
        )
        requests = result.scalars().all()

        # Get user's quotas
        result = await db.execute(
            select(AiUsageQuota).where(
                AiUsageQuota.user_id == current_user.id
            )
        )
        quotas_data = result.scalars().all()
        quotas = [
            {
                "feature": q.feature,
                "monthly_limit": q.monthly_limit_tokens,
                "monthly_used": q.monthly_used_tokens,
                "is_approved": q.is_approved,
                "reset_date": q.reset_date.isoformat(),
            }
            for q in quotas_data
        ]

        return AiAccessStatusResponse(requests=requests, quotas=quotas)
    except Exception as e:
        logger.error(f"Failed to get AI access status: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve status",
        )


@router.get("/usage", response_model=AiUsageResponse)
async def get_ai_usage(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current AI token usage and limits."""
    try:
        # Get user's AI quota (for now assume document-generation)
        result = await db.execute(
            select(AiUsageQuota).where(
                and_(
                    AiUsageQuota.user_id == current_user.id,
                    AiUsageQuota.feature == "document-generation",
                )
            )
        )
        quota = result.scalar_one_or_none()

        if not quota:
            # Return default limits if no quota set
            return AiUsageResponse(
                tokens_used=0,
                tokens_limit=10000,
                requests_made=0,
                requests_limit=100,
                reset_at=(datetime.utcnow() + timedelta(days=30)).isoformat(),
                percentage_used=0,
            )

        # Reset quota if needed
        if datetime.utcnow() > quota.reset_date:
            quota.monthly_used_tokens = 0
            quota.monthly_used_requests = 0
            quota.reset_date = datetime.utcnow() + timedelta(days=30)
            await db.commit()

        percentage = int(
            (quota.monthly_used_tokens / quota.monthly_limit_tokens * 100)
            if quota.monthly_limit_tokens > 0
            else 0
        )

        return AiUsageResponse(
            tokens_used=quota.monthly_used_tokens,
            tokens_limit=quota.monthly_limit_tokens,
            requests_made=quota.monthly_used_requests,
            requests_limit=quota.monthly_limit_requests,
            reset_at=quota.reset_date.isoformat(),
            percentage_used=percentage,
        )
    except Exception as e:
        logger.error(f"Failed to get AI usage: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve usage",
        )
