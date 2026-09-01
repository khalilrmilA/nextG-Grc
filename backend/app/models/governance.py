"""Governance (Elite Pack) — RACI responsibility matrix + document repository.

RFP module 11. String columns (not DB enums) keep this portable across
SQLite/PostgreSQL/Oracle/SQL Server; values are validated at the API layer.
New tables — created by create_all() on restart.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, Text, ForeignKey, JSON
from app.core.database import Base


class RaciAssignment(Base):
    __tablename__ = "raci_assignments"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    activity: Mapped[str] = mapped_column(String(300), nullable=False)
    responsible_type: Mapped[str] = mapped_column(String(10), nullable=False, default="role")  # role | user | group
    role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    raci: Mapped[str] = mapped_column(String(1), nullable=False)  # R | A | C | I
    module: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class GovernanceGroup(Base):
    """A named collection of users that can be assigned a RACI role as a whole
    (e.g. "Security Committee"), instead of a single user or a role string."""
    __tablename__ = "governance_groups"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    member_ids: Mapped[list] = mapped_column(JSON, default=list)


class GovernanceDocument(Base):
    __tablename__ = "governance_documents"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    typology: Mapped[str] = mapped_column(String(50), nullable=False, default="policy")  # policy|charter|regulation|minutes|...
    module: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    access_level: Mapped[str] = mapped_column(String(10), nullable=False, default="read")  # read|edit|validate
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class GovernanceDocumentVersion(Base):
    __tablename__ = "governance_document_versions"

    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("governance_documents.id"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    authored_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class GovernanceDocumentAccess(Base):
    """Per-document ACL (M11.3 — RFP gap fix).

    ``GovernanceDocument.access_level`` is a single tenant-wide read/edit/validate
    flag — it cannot express "user A gets edit, user B gets view-only on the same
    document". This table adds real per-user/per-role grants on top of it.

    Exactly one of ``user_id``/``role`` is set per row (validated at the API layer):
    ``user_id`` targets one person, ``role`` grants every member currently holding
    that role (free-text, same convention as ``RaciAssignment.role`` — custom roles
    supported as-is). When a document has no rows here, callers fall back to the
    legacy ``access_level`` behavior — additive only, existing documents are
    unaffected until an explicit grant is added.
    """
    __tablename__ = "governance_document_access"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("governance_documents.id"), nullable=False, index=True
    )
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    permission: Mapped[str] = mapped_column(String(10), nullable=False, default="view")  # view|edit|validate
    granted_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class GovernanceCommittee(Base):
    """Steering committee tracking (M14.6 — RFP gap fix), distinct from RACI.

    RACI (``RaciAssignment``) records who is R/A/C/I for an activity; this records
    the governance *bodies* themselves (e.g. "Comité de pilotage sécurité") — their
    membership, meeting cadence, and what they oversee (policies/documents) — which
    the RFP asks for as a separate, explicit artifact.
    """
    __tablename__ = "governance_committees"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    cadence: Mapped[str] = mapped_column(String(20), nullable=False, default="quarterly")  # monthly|quarterly|annual|ad_hoc
    member_ids: Mapped[list] = mapped_column(JSON, default=list)
    linked_policy_ids: Mapped[list] = mapped_column(JSON, default=list)
    linked_document_ids: Mapped[list] = mapped_column(JSON, default=list)
    next_meeting_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
