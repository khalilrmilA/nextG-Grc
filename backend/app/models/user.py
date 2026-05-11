"""User model with role-based access control."""
import enum
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import DateTime, String, Boolean, ForeignKey, Enum as SAEnum, JSON
from app.core.database import Base


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"       # Platform admin (internal)
    TENANT_ADMIN = "tenant_admin"     # Company/tenant owner — manages all users
    CISO = "ciso"                     # Chief Information Security Officer
    RISK_MANAGER = "risk_manager"     # Risk management team
    COMPLIANCE_MANAGER = "compliance_manager"
    AUDITOR = "auditor"               # Internal/external auditor (read-heavy)
    POLICY_MANAGER = "policy_manager"
    VENDOR_MANAGER = "vendor_manager"
    CONTROL_OWNER = "control_owner"   # Owns specific controls
    VIEWER = "viewer"                 # Read-only access


class User(Base):
    __tablename__ = "users"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, values_callable=lambda x: [e.value for e in x], native_enum=False), nullable=False, default=UserRole.VIEWER
    )
    # Multi-role support: list of UserRole strings (e.g. ["ciso", "risk_manager"])
    # When non-empty, access is the union of all listed roles.
    roles: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # SSO
    keycloak_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)

    # Avatar
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="users")
    ai_access_requests: Mapped[list["AiAccessRequest"]] = relationship("AiAccessRequest", back_populates="user")
    ai_usage_quotas: Mapped[list["AiUsageQuota"]] = relationship("AiUsageQuota", back_populates="user")
    api_tokens: Mapped[list["ApiToken"]] = relationship("ApiToken", back_populates="user")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"
