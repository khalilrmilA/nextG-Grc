"""Team Groups — bundle users and grant them a shared set of roles.

Distinct from GovernanceGroup (app/models/governance.py), which is scoped to
RACI assignment only and unrelated to access control. New table — created by
create_all() on restart.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, ForeignKey, JSON
from app.core.database import Base


class Group(Base):
    __tablename__ = "groups"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    member_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Role values (UserRole strings) this group grants to every member, in
    # addition to each member's personal roles.
    roles: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
