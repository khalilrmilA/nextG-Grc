"""User model with role-based access control."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, ForeignKey, Enum as SAEnum
from app.core.database import Base


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"       # Platform admin (internal)
    TENANT_ADMIN = "tenant_admin"     # Org admin
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
        SAEnum(UserRole), nullable=False, default=UserRole.VIEWER
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)

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
