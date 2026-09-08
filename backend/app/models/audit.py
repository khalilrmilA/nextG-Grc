"""Audit management models."""
import enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum as SAEnum, JSON, DateTime
from app.core.database import Base


class AuditType(str, enum.Enum):
    INTERNAL = "internal"
    EXTERNAL = "external"
    REGULATORY = "regulatory"
    CERTIFICATION = "certification"


class AuditStatus(str, enum.Enum):
    PLANNING = "planning"
    FIELDWORK = "fieldwork"
    REVIEW = "review"
    REPORTING = "reporting"
    CLOSED = "closed"


class FindingSeverity(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    OBSERVATION = "observation"


class FindingStatus(str, enum.Enum):
    OPEN = "open"
    IN_REMEDIATION = "in_remediation"
    REMEDIATED = "remediated"
    ACCEPTED = "accepted"
    CLOSED = "closed"


class Audit(Base):
    """An audit engagement."""
    __tablename__ = "audits"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    audit_type: Mapped[AuditType] = mapped_column(SAEnum(AuditType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    status: Mapped[AuditStatus] = mapped_column(
        SAEnum(AuditStatus, values_callable=lambda x: [e.value for e in x]), default=AuditStatus.PLANNING
    )

    # Auditor
    lead_auditor_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Framework being audited
    framework_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("frameworks.id"), nullable=True
    )

    # Dates
    planned_start: Mapped[str | None] = mapped_column(String(20), nullable=True)
    planned_end: Mapped[str | None] = mapped_column(String(20), nullable=True)
    actual_start: Mapped[str | None] = mapped_column(String(20), nullable=True)
    actual_end: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Scope
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    in_scope_systems: Mapped[list] = mapped_column(JSON, default=list)

    # Report
    report_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    executive_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Report validation workflow (RFP gap: "validation du document de rapport avant
    # diffusion" — distinct from the audit engagement's own status). A simple
    # approval stamp: who signed off on the generated report, and when.
    report_approved_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    report_approved_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Recurring campaigns (RFP gap: "planification annuelle, semestrielle,
    # ponctuelle" — audits could only be scheduled with free-form dates, with
    # no periodic auto-generation of the next cycle). One of "annual" |
    # "semi_annual" | "none" | None; "none"/None means a one-off (ponctuelle)
    # audit that never auto-repeats. See app.services.audit_recurrence_scheduler.
    recurrence: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Set (to an ISO timestamp string) once the recurrence scheduler has
    # auto-created this audit's successor cycle, so it's never spawned twice —
    # the claim token for the background scheduler under 2 uvicorn workers,
    # mirroring ReportSchedule.next_run_at's role in report_scheduler.py.
    recurrence_spawned_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # --- STB objectif 4: périmètre et campagne -------------------------------
    # "selon le périmètre défini (processus, entités, systèmes)". Stored as JSON
    # id lists rather than association tables: an audit's perimeter is read as a
    # whole every time and never joined against, so three extra tables would buy
    # nothing. Validated against the tenant's own rows on write.
    campaign_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("audit_campaigns.id"), nullable=True, index=True
    )
    process_ids: Mapped[list] = mapped_column(JSON, default=list)
    org_entity_ids: Mapped[list] = mapped_column(JSON, default=list)
    asset_ids: Mapped[list] = mapped_column(JSON, default=list)

    # The customisable grid this engagement is conducted on (objectif 5). Null
    # keeps today's behaviour: the checklist is the framework's controls.
    grid_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("audit_grids.id"), nullable=True
    )
    # Links the engagement to the compliance assessment it covers, so the
    # auditor portal can list audits rather than only assessments.
    assessment_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_assessments.id"), nullable=True
    )
    # The generated audit plan, persisted instead of discarded after display.
    audit_plan: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- STB objectif 6: validation du rapport avant diffusion ---------------
    # draft -> submitted -> approved | rejected -> issued. Download and scheduled
    # delivery are gated on `approved`; that gate is what makes the requirement
    # real rather than advisory. report_approved_by_id/at already existed.
    report_status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    report_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    report_submitted_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    report_rejected_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- STB objectif 8: le registre doit survivre ---------------------------
    # DELETE was an unconditional hard delete; a completed engagement must remain
    # in the register. Rows with deleted_at set are filtered out of list_audits.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="audits")
    findings: Mapped[list["AuditFinding"]] = relationship(
        "AuditFinding", back_populates="audit"
    )
    evidence: Mapped[list["AuditEvidence"]] = relationship(
        "AuditEvidence", back_populates="audit"
    )


class AuditFinding(Base):
    """A finding identified during an audit."""
    __tablename__ = "audit_findings"

    audit_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audits.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[FindingSeverity] = mapped_column(
        SAEnum(FindingSeverity, values_callable=lambda x: [e.value for e in x]), nullable=False
    )
    status: Mapped[FindingStatus] = mapped_column(
        SAEnum(FindingStatus, values_callable=lambda x: [e.value for e in x]), default=FindingStatus.OPEN
    )

    # Linked control
    control_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("framework_controls.id"), nullable=True
    )

    # Owner
    remediation_owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    recommendation: Mapped[str | None] = mapped_column(Text, nullable=True)
    management_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    remediation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- STB objectif 5: "niveau de conformité ou de non-conformité" ---------
    # Severity says how bad it is; finding_type says what kind of finding it is,
    # which is what an ISO 27001 audit report is actually structured around.
    # Defaulted from severity by the endpoint when not given explicitly.
    finding_type: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # --- STB objectif 7: "jusqu'à leur clôture effective" --------------------
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    closure_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    closure_evidence_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    audit: Mapped["Audit"] = relationship("Audit", back_populates="findings")


class AuditEvidence(Base):
    """Evidence collected during an audit."""
    __tablename__ = "audit_evidence"

    audit_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audits.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    uploaded_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )

    # --- STB objectif 5: "Ajout de constats, pièces jointes, preuves" --------
    # This table held caller-supplied strings and no bytes (0 rows on the live
    # database). These columns make it a real upload record, matching
    # compliance.Evidence field for field so services/file_integrity.py and
    # services/file_retention.py apply unchanged.
    finding_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("audit_findings.id"), nullable=True, index=True
    )
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # NULL means "unrecorded", never "tampered with" — same rule as Evidence.
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    record_version: Mapped[int] = mapped_column(default=1)

    audit: Mapped["Audit"] = relationship("Audit", back_populates="evidence")
