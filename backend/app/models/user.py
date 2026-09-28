"""User model with role-based access control."""
import enum
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import DateTime, String, Boolean, ForeignKey, Enum as SAEnum, JSON, Integer
from app.core.database import Base


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"       # Platform admin (internal)
    TENANT_ADMIN = "tenant_admin"     # Company/tenant owner — manages all users
    CISO = "ciso"                     # Chief Information Security Officer / RSSI
    RISK_MANAGER = "risk_manager"     # Risk management team
    COMPLIANCE_MANAGER = "compliance_manager"
    AUDITOR = "auditor"               # Internal/external auditor (read-heavy)
    POLICY_MANAGER = "policy_manager"
    VENDOR_MANAGER = "vendor_manager"
    CONTROL_OWNER = "control_owner"   # Owns specific controls
    BUSINESS_OWNER = "business_owner"     # Propriétaire métier — asset qualification/ownership
    SECURITY_ANALYST = "security_analyst"  # Analyste sécurité — threat/vulnerability analysis
    EXECUTIVE = "executive"           # Direction Générale — strategic dashboards, read-only
    VIEWER = "viewer"                 # Read-only access


# Roles a tenant_admin can assign to team members or to a Group — excludes
# SUPER_ADMIN/TENANT_ADMIN, which are never delegated.
ASSIGNABLE_ROLES = {
    UserRole.CISO,
    UserRole.RISK_MANAGER,
    UserRole.COMPLIANCE_MANAGER,
    UserRole.AUDITOR,
    UserRole.POLICY_MANAGER,
    UserRole.VENDOR_MANAGER,
    UserRole.CONTROL_OWNER,
    UserRole.BUSINESS_OWNER,
    UserRole.SECURITY_ANALYST,
    UserRole.EXECUTIVE,
    UserRole.VIEWER,
}

# Read-only profiles: never granted write access via require_roles() checks,
# regardless of which roles a route lists — mirrors the VIEWER write-block in
# get_current_user. Direction Générale ("Executive") is read-only by RFP design
# (consultation des tableaux de bord stratégiques), not a data-entry role.
READ_ONLY_ROLES = {UserRole.VIEWER, UserRole.EXECUTIVE}


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
    # Custom rule: role values to subtract from this user's effective access even
    # when granted by a Group they belong to (see app/services/authz.py). Lets an
    # admin carve out an exception for one member without touching the group.
    excluded_roles: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default="[]")

    # --- STB objectif 4: "auditeurs internes ou externes" --------------------
    # The `auditor` role existed but nothing distinguished an employee from a
    # member of an external firm, which a bank must be able to show its
    # regulator. Defaults to internal, which is what all 17 existing users are.
    is_external: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    external_org: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Per-user Elite Pack grant, set by a super admin. Unlocks every Elite
    # feature for this one user even when the tenant's own pack is lower;
    # honored by require_feature and the entitlements endpoint.
    elite_access: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    # Tenant-defined roles held by this user (see models/access_governance.py).
    # Expanded to their built-in roles by get_effective_roles, so custom roles
    # need no change to any require_roles check.
    custom_role_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Access hardening (Phase 0): forced first-login change + brute-force lockout.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0")
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

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
