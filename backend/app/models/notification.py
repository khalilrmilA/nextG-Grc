"""Notification and notification preference models."""
import enum
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum, JSON, DateTime
from app.core.database import Base


class NotificationType(str, enum.Enum):
    # Risk events
    RISK_NEW = "risk_new"
    RISK_OVERDUE = "risk_overdue"
    RISK_STATUS_CHANGED = "risk_status_changed"
    RISK_OVER_APPETITE = "risk_over_appetite"
    RISK_TARGET_OVER_APPETITE = "risk_target_over_appetite"
    SCENARIO_OVER_APPETITE = "scenario_over_appetite"
    SCENARIO_PRIORITY_THRESHOLD = "scenario_priority_threshold"
    TREATMENT_OVERDUE = "treatment_overdue"
    TREATMENT_BUDGET_OVERRUN = "treatment_budget_overrun"
    # Audit events
    AUDIT_ASSIGNED = "audit_assigned"
    AUDIT_DUE = "audit_due"
    AUDIT_FINDING_NEW = "audit_finding_new"
    AUDIT_FINDING_DEADLINE = "audit_finding_deadline"
    # Policy events
    POLICY_REVIEW_DUE = "policy_review_due"
    POLICY_PUBLISHED = "policy_published"
    # Vendor events
    VENDOR_ALERT = "vendor_alert"
    VENDOR_ASSESSMENT_DUE = "vendor_assessment_due"
    # Compliance events
    COMPLIANCE_SCORE_DROP = "compliance_score_drop"
    COMPLIANCE_ANALYSIS_DONE = "compliance_analysis_done"
    # Framework events
    FRAMEWORK_NEW = "framework_new"
    FRAMEWORK_UPDATED = "framework_updated"
    # AI Access events
    AI_ACCESS_APPROVED = "ai_access_approved"
    AI_ACCESS_REQUEST = "ai_access_request"
    # Share link events
    SHARE_LINK_VIEWED = "share_link_viewed"
    SHARE_LINK_UPLOAD = "share_link_upload"
    # Governance events
    RACI_RESPONSIBLE_CHANGED = "raci_responsible_changed"
    # Compliance action items
    COMPLIANCE_ACTION_OVERDUE = "compliance_action_overdue"
    # Threat events
    THREAT_CRITICAL = "threat_critical"
    THREAT_PROFILE_REVIEW_DUE = "threat_profile_review_due"
    # Asset events
    ASSET_EOL = "asset_eol"
    ASSET_REVIEW_DUE = "asset_review_due"
    # Applied control events
    CONTROL_EXPIRED = "control_expired"
    CONTROL_EVALUATION_DUE = "control_evaluation_due"
    CONTROL_UNVERIFIED = "control_unverified"
    # Auth / security events
    NEW_DEVICE_LOGIN = "new_device_login"
    # General
    WEEKLY_DIGEST = "weekly_digest"
    SYSTEM = "system"


class NotificationChannel(str, enum.Enum):
    EMAIL = "email"
    IN_APP = "in_app"


class NotificationStatus(str, enum.Enum):
    UNREAD = "unread"
    READ = "read"
    DISMISSED = "dismissed"


class Notification(Base):
    """In-app notification record."""
    __tablename__ = "notifications"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    type: Mapped[NotificationType] = mapped_column(
        SAEnum(NotificationType, values_callable=lambda x: [e.value for e in x]), nullable=False, index=True
    )
    status: Mapped[NotificationStatus] = mapped_column(
        SAEnum(NotificationStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=NotificationStatus.UNREAD, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # --- STB: relances et notifications en français et en arabe --------------
    # A notification cannot store an English sentence for a Tunisian bank. The
    # key plus its parameters are stored, and the client renders them with t().
    # `title`/`message` stay populated as the fallback for rows written before
    # this, for the e-mail leg, and for anything the client cannot resolve.
    title_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    message_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Extra data (e.g. link, entity_id, entity_type)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])


class NotificationPreference(Base):
    """Per-user channel preferences for each notification type."""
    __tablename__ = "notification_preferences"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    notification_type: Mapped[NotificationType] = mapped_column(
        SAEnum(NotificationType, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        SAEnum(NotificationChannel, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Relationships
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
