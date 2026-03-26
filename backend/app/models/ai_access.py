"""AI access control and usage tracking models."""
from sqlalchemy import Column, String, Integer, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime, timedelta
from app.core.database import Base


class AiAccessRequest(Base):
    """User requests for AI feature access."""

    __tablename__ = "ai_access_requests"

    id = Column(String(36), primary_key=True)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), index=True)
    user_id = Column(String(36), ForeignKey("users.id"), index=True)
    user_email = Column(String(255), nullable=False)
    user_name = Column(String(255), nullable=False)

    # Feature requested: document-generation, ai-analysis, all
    feature = Column(String(50), nullable=False)
    reason = Column(Text, nullable=False)

    # Request status: pending, approved, denied
    status = Column(String(20), default="pending", index=True)
    admin_notes = Column(Text, nullable=True)

    requested_at = Column(DateTime, default=datetime.utcnow)
    responded_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="ai_access_requests")
    user = relationship("User", back_populates="ai_access_requests")


class AiUsageQuota(Base):
    """Track AI usage quotas per user per month."""

    __tablename__ = "ai_usage_quotas"

    id = Column(String(36), primary_key=True)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), index=True)
    user_id = Column(String(36), ForeignKey("users.id"), unique=True, index=True)

    # Feature: document-generation, ai-analysis
    feature = Column(String(50), nullable=False)

    # Monthly limits
    monthly_limit_tokens = Column(Integer, default=10000)
    monthly_limit_requests = Column(Integer, default=100)

    # Current month usage
    monthly_used_tokens = Column(Integer, default=0)
    monthly_used_requests = Column(Integer, default=0)

    # Reset date for quota
    reset_date = Column(DateTime, default=lambda: datetime.utcnow() + timedelta(days=30))

    # Is user approved for this feature?
    is_approved = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="ai_usage_quotas")
    user = relationship("User", back_populates="ai_usage_quotas")


class ApiToken(Base):
    """API tokens for programmatic access."""

    __tablename__ = "api_tokens"

    id = Column(String(36), primary_key=True)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), index=True)
    user_id = Column(String(36), ForeignKey("users.id"), index=True)
    token_name = Column(String(255), nullable=False)

    # Hashed token value (only show on creation)
    token_hash = Column(String(255), nullable=False, unique=True)

    last_used = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="api_tokens")
    user = relationship("User", back_populates="api_tokens")
