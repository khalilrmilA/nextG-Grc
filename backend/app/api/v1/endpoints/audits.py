"""Audit Management — full audit lifecycle with findings, evidence and report workflow."""
import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security_utils import (
    assert_assets_in_tenant,
    assert_path_within,
    assert_safe_upload_name,
    assert_user_in_tenant,
    sanitize_filename,
    verify_file_signature,
)
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.action_item import ActionItem, ActionItemStatus
from app.models.activity_log import ActivityLog
from app.models.audit import (
    Audit, AuditFinding, AuditEvidence,
    AuditType, AuditStatus, FindingSeverity, FindingStatus,
)
from app.models.audit_campaign import AuditCampaign
from app.models.audit_collaboration import AuditComment, AuditFindingStatusEvent
from app.models.audit_grid import AuditGrid
from app.models.audit_recommendation import AuditRecommendation, RECOMMENDATION_STATUSES
from app.models.auditor_assignment import AuditorAssignment
from app.models.compliance import ComplianceAssessment
from app.models.notification import Notification, NotificationType
from app.models.org_unit import BusinessProcess, OrgEntity
from app.models.report_distribution import ReportDistribution
from app.models.stored_file_version import StoredFileVersion
from app.models.tenant import Tenant
from app.services.activity_chain import chain_and_add
from app.services.ai_locale import get_request_language, normalize_language
from app.services.report_generator import generate_single_audit_report
from app.services import file_integrity
from app.workers.tasks.notifications import notify_audit_assigned

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Access control ───────────────────────────────────────────────────────
# Every route in this module used to be a bare `get_current_user` plus a tenant
# WHERE, so any authenticated account of the tenant — a vendor manager, a demo
# viewer — could read every engagement, every constat and download every report,
# and could hard-delete all three. require_feature() is a BILLING gate, not
# access control, so the fix is require_roles() on the writes plus, for reads, a
# per-audit visibility check: require_roles(AUDITOR) admits *every* auditor of
# the tenant, never only the one this engagement was given to.

# Consultation of the register. VIEWER is the read-only demo profile (its writes
# are refused in get_current_user) and EXECUTIVE is read-only by RFP design;
# both are kept so the demo and the Direction Générale dashboards keep working.
AUDIT_READ_ROLES = (
    UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.RISK_MANAGER,
    UserRole.AUDITOR, UserRole.EXECUTIVE, UserRole.VIEWER,
)
# Conducting an engagement: creating it, raising constats, attaching preuves.
AUDIT_WRITE_ROLES = (UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.AUDITOR)
# Acts that must not be available to the person doing the fieldwork: approving
# the report, closing a constat, deleting anything.
AUDIT_MANAGE_ROLES = (UserRole.CISO, UserRole.COMPLIANCE_MANAGER)

_ADMIN_ROLES = (UserRole.SUPER_ADMIN, UserRole.TENANT_ADMIN)

# Answer given when the caller has no rights on the engagement. Deliberately the
# same 404 the missing-audit path returns: a 403 would confirm that an audit
# with this id exists in the tenant, which is itself information.
_NOT_FOUND = "Audit not found"


def _is_admin(user: User) -> bool:
    return user.role in _ADMIN_ROLES


async def _effective_roles(db: AsyncSession, user: User) -> set[str]:
    """The caller's effective role set (personal ∪ group ∪ delegated, minus
    carve-outs) — the same source require_roles() uses, so a role granted
    through a Group is honoured here too. Admins are treated as holding
    everything, matching require_roles()'s auto-pass."""
    if _is_admin(user):
        return {r.value for r in UserRole}
    from app.services.authz import get_effective_roles
    return set(await get_effective_roles(user, db))


async def _has_any_role(db: AsyncSession, user: User, roles) -> bool:
    return bool((await _effective_roles(db, user)) & {r.value for r in roles})


async def _assigned_audit_ids(db: AsyncSession, user: User, tenant_id: str) -> set[str]:
    """Engagements an auditor was actually given.

    auditor_assignments.audit_id is new, so every existing assignment row points
    at a compliance assessment instead. An engagement that covers an assessment
    the auditor was assigned to therefore still resolves — otherwise this
    tightening would strand the live assignments on day one.
    """
    rows = (await db.execute(
        select(AuditorAssignment.audit_id, AuditorAssignment.assessment_id).where(
            AuditorAssignment.auditor_id == user.id,
            AuditorAssignment.tenant_id == tenant_id,
            AuditorAssignment.is_active == True,  # noqa: E712
        )
    )).all()
    audit_ids = {r[0] for r in rows if r[0]}
    assessment_ids = {r[1] for r in rows if r[1]}
    if assessment_ids:
        audit_ids |= {
            aid for (aid,) in (await db.execute(
                select(Audit.id).where(
                    Audit.tenant_id == tenant_id,
                    Audit.assessment_id.in_(list(assessment_ids)),
                )
            )).all()
        }
    return audit_ids


async def _visible_audit_ids(db: AsyncSession, user: User, tenant_id: str) -> set[str] | None:
    """Ids the caller may see, or None when the whole register is theirs.

    Returning None rather than a set of every id keeps the common case a single
    unfiltered query instead of an IN () over the tenant's whole audit table.
    """
    roles = await _effective_roles(db, user)
    if roles & {UserRole.CISO.value, UserRole.COMPLIANCE_MANAGER.value,
                UserRole.RISK_MANAGER.value, UserRole.EXECUTIVE.value,
                UserRole.VIEWER.value}:
        return None

    ids: set[str] = set()
    # The lead auditor always reaches their own engagement, assignment or not.
    ids |= {aid for (aid,) in (await db.execute(
        select(Audit.id).where(Audit.tenant_id == tenant_id, Audit.lead_auditor_id == user.id)
    )).all()}
    if UserRole.AUDITOR.value in roles:
        ids |= await _assigned_audit_ids(db, user, tenant_id)
    # An audité — the person a constat was assigned to, or who owns a
    # recommendation — must be able to read what was raised against them and
    # answer it (objectif 5, « échanger avec les audités ») without being handed
    # the whole register.
    ids |= {aid for (aid,) in (await db.execute(
        select(AuditFinding.audit_id)
        .join(Audit, AuditFinding.audit_id == Audit.id)
        .where(Audit.tenant_id == tenant_id, AuditFinding.remediation_owner_id == user.id)
    )).all()}
    ids |= {aid for (aid,) in (await db.execute(
        select(AuditRecommendation.audit_id).where(
            AuditRecommendation.tenant_id == tenant_id,
            AuditRecommendation.owner_id == user.id,
        )
    )).all()}
    return ids


# ── Schemas ──────────────────────────────────────────────────────────────

# Recurring-campaign cadence values (RFP: "planification annuelle, semestrielle,
# ponctuelle"). "none"/None = one-off (ponctuelle), never auto-spawns a next cycle.
AUDIT_RECURRENCES = {"annual", "semi_annual", "none"}

# Report document lifecycle (objectif 6, « validation du rapport par l'équipe
# d'audit avant diffusion »). Distinct from Audit.status, which describes the
# engagement, not the document.
REPORT_STATUSES = ("draft", "submitted", "approved", "rejected", "issued")

# What kind of finding this is — « niveau de conformité ou de non-conformité ».
# Severity says how bad; finding_type says what an ISO 27001 report is structured
# around. NULL keeps the legacy rows readable and means "derive from severity".
FINDING_TYPES = ("nonconformity_major", "nonconformity_minor", "observation", "improvement")

_SEVERITY_TO_FINDING_TYPE = {
    "critical": "nonconformity_major",
    "high": "nonconformity_major",
    "medium": "nonconformity_minor",
    "low": "nonconformity_minor",
    "observation": "observation",
}

# Evidence uploads: the denylist in security_utils is the real gate (it checks
# every suffix); this allowlist is the "we only want documents" half, kept
# identical in spirit to the compliance evidence endpoint.
_EVIDENCE_EXTENSIONS = (
    ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".md",
    ".png", ".jpg", ".jpeg", ".msg", ".eml", ".zip",
)


class AuditCreate(BaseModel):
    title: str
    description: str | None = None
    audit_type: str = "internal"
    lead_auditor_id: str | None = None
    framework_id: str | None = None
    planned_start: str | None = None
    planned_end: str | None = None
    scope: str | None = None
    in_scope_systems: list[str] = []
    recurrence: str | None = None
    # Perimeter + campaign (objectif 4). Empty lists mean "no perimeter declared",
    # which is exactly how every existing engagement reads.
    campaign_id: str | None = None
    grid_id: str | None = None
    assessment_id: str | None = None
    process_ids: list[str] = []
    org_entity_ids: list[str] = []
    asset_ids: list[str] = []
    audit_plan: str | None = None

class AuditUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    lead_auditor_id: str | None = None
    planned_start: str | None = None
    planned_end: str | None = None
    actual_start: str | None = None
    actual_end: str | None = None
    scope: str | None = None
    executive_summary: str | None = None
    in_scope_systems: list[str] | None = None
    recurrence: str | None = None
    campaign_id: str | None = None
    grid_id: str | None = None
    assessment_id: str | None = None
    process_ids: list[str] | None = None
    org_entity_ids: list[str] | None = None
    asset_ids: list[str] | None = None
    audit_plan: str | None = None

class AuditOut(BaseModel):
    id: str; tenant_id: str; title: str; description: str | None
    audit_type: str; status: str; lead_auditor_id: str | None
    framework_id: str | None; planned_start: str | None; planned_end: str | None
    actual_start: str | None; actual_end: str | None; scope: str | None
    executive_summary: str | None; in_scope_systems: list
    report_url: str | None = None
    report_approved_by_id: str | None = None
    report_approved_at: str | None = None
    recurrence: str | None = None
    # Perimeter / campaign / grid (objectif 4)
    campaign_id: str | None = None
    grid_id: str | None = None
    assessment_id: str | None = None
    process_ids: list = []
    org_entity_ids: list = []
    asset_ids: list = []
    audit_plan: str | None = None
    # Report workflow (objectif 6)
    report_status: str = "draft"
    report_submitted_at: str | None = None
    report_submitted_by_id: str | None = None
    report_rejected_reason: str | None = None
    report_issued_at: str | None = None
    # Register durability (objectif 8)
    deleted_at: str | None = None
    finding_count: int = 0
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


def _validate_recurrence(recurrence: str | None) -> None:
    if recurrence is not None and recurrence not in AUDIT_RECURRENCES:
        raise HTTPException(400, f"recurrence must be one of {sorted(AUDIT_RECURRENCES)}")


def _enum_or_400(enum_cls, value: str, field_name: str):
    """Coerce a caller-supplied string to an enum member, or 400.

    `AuditStatus("bogus")` raises ValueError, which this codebase turns into a
    500 — a server error for what is plainly a bad request, and one an evaluator
    finds by typing a wrong value into a status field.
    """
    try:
        return enum_cls(value)
    except ValueError:
        raise HTTPException(
            400, f"{field_name} must be one of {[m.value for m in enum_cls]}"
        ) from None

class FindingCreate(BaseModel):
    title: str; description: str; severity: str = "medium"
    control_id: str | None = None; remediation_owner_id: str | None = None
    due_date: str | None = None; recommendation: str | None = None
    finding_type: str | None = None

class FindingUpdate(BaseModel):
    title: str | None = None; description: str | None = None
    severity: str | None = None; status: str | None = None
    remediation_owner_id: str | None = None; due_date: str | None = None
    recommendation: str | None = None; management_response: str | None = None
    remediation_notes: str | None = None; finding_type: str | None = None

class FindingOut(BaseModel):
    id: str; audit_id: str; title: str; description: str
    severity: str; status: str; control_id: str | None
    remediation_owner_id: str | None; due_date: str | None
    recommendation: str | None; management_response: str | None
    remediation_notes: str | None
    finding_type: str | None = None
    closed_at: str | None = None
    closed_by_id: str | None = None
    closure_note: str | None = None
    closure_evidence_id: str | None = None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


# ── Helpers ──────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value) -> str | None:
    """DateTime columns render as ISO strings; the pre-existing string columns
    (report_approved_at, planned_start …) are already strings and pass through."""
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _enum_value(value) -> str:
    return value.value if hasattr(value, "value") else str(value or "")


def _as_list(value) -> list:
    """A NULL JSON column must read as "nothing declared", never as an error:
    every row written before the perimeter columns existed carries NULL."""
    return list(value) if isinstance(value, (list, tuple)) else []


def _default_finding_type(severity) -> str:
    return _SEVERITY_TO_FINDING_TYPE.get(_enum_value(severity), "nonconformity_minor")


async def _audit(db, audit_id, tenant_id, *, include_deleted: bool = False):
    """Fetch a live audit. Soft-deleted engagements are invisible here so every
    child route (findings, evidence, report) 404s on them for free."""
    q = select(Audit).where(Audit.id == audit_id, Audit.tenant_id == tenant_id)
    if not include_deleted:
        q = q.where(Audit.deleted_at.is_(None))
    a = (await db.execute(q)).scalar_one_or_none()
    if not a: raise HTTPException(404, _NOT_FOUND)
    return a


async def _audit_for(db, audit_id, tenant_id, user, *, include_deleted: bool = False):
    """_audit() plus the caller's rights on it."""
    a = await _audit(db, audit_id, tenant_id, include_deleted=include_deleted)
    visible = await _visible_audit_ids(db, user, tenant_id)
    if visible is not None and a.id not in visible:
        raise HTTPException(404, _NOT_FOUND)
    return a


def _audit_out(a: Audit, finding_count: int = 0) -> AuditOut:
    """Build the response WITHOUT touching the ORM row. get_db() commits on
    teardown, so normalising a NULL JSON column in place would silently write to
    the row on a GET."""
    return AuditOut(
        id=a.id, tenant_id=a.tenant_id, title=a.title, description=a.description,
        audit_type=_enum_value(a.audit_type), status=_enum_value(a.status),
        lead_auditor_id=a.lead_auditor_id, framework_id=a.framework_id,
        planned_start=a.planned_start, planned_end=a.planned_end,
        actual_start=a.actual_start, actual_end=a.actual_end, scope=a.scope,
        executive_summary=a.executive_summary,
        in_scope_systems=_as_list(a.in_scope_systems),
        report_url=a.report_url,
        report_approved_by_id=a.report_approved_by_id,
        report_approved_at=_iso(a.report_approved_at),
        recurrence=a.recurrence,
        campaign_id=a.campaign_id, grid_id=a.grid_id, assessment_id=a.assessment_id,
        process_ids=_as_list(a.process_ids), org_entity_ids=_as_list(a.org_entity_ids),
        asset_ids=_as_list(a.asset_ids), audit_plan=a.audit_plan,
        report_status=a.report_status or "draft",
        report_submitted_at=_iso(a.report_submitted_at),
        report_submitted_by_id=a.report_submitted_by_id,
        report_rejected_reason=a.report_rejected_reason,
        report_issued_at=_iso(a.report_issued_at),
        deleted_at=_iso(a.deleted_at),
        finding_count=finding_count,
        created_at=a.created_at, updated_at=a.updated_at,
    )


async def _with_count(db, audit):
    fc = (await db.execute(select(func.count(AuditFinding.id)).where(AuditFinding.audit_id == audit.id))).scalar() or 0
    return _audit_out(audit, fc)


def _finding_out(f: AuditFinding) -> FindingOut:
    return FindingOut(
        id=f.id, audit_id=f.audit_id, title=f.title, description=f.description,
        severity=_enum_value(f.severity), status=_enum_value(f.status),
        control_id=f.control_id, remediation_owner_id=f.remediation_owner_id,
        due_date=f.due_date, recommendation=f.recommendation,
        management_response=f.management_response, remediation_notes=f.remediation_notes,
        finding_type=f.finding_type or _default_finding_type(f.severity),
        closed_at=_iso(f.closed_at), closed_by_id=f.closed_by_id,
        closure_note=f.closure_note, closure_evidence_id=f.closure_evidence_id,
        created_at=f.created_at, updated_at=f.updated_at,
    )


async def _log(db, tenant_id: str, user: User, action: str, *, entity_type: str = "audit",
               entity_id: str | None = None, entity_name: str | None = None,
               details: dict | None = None) -> None:
    """Append an explicit entry to the tenant's hash-chained trail.

    ActivityLogMiddleware only records {method, path} with a blank actor, so
    objectif 8's « journalisation des modifications » had no before/after and no
    entity name. Never write activity_logs directly — chain_and_add owns the
    sequence and the hash, and it commits, so this must run AFTER the caller's
    own commit or the two writers fight over SQLite's write lock.
    """
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id, user_id=user.id, user_email=user.email,
        action=action, entity_type=entity_type, entity_id=entity_id,
        entity_name=entity_name, details=details or {},
    ))


async def _assert_ids_in_tenant(db, model, ids, tenant_id: str, field_name: str) -> None:
    """Reject perimeter ids that are not the tenant's own rows (cross-tenant IDOR
    through an attacker-supplied id list), mirroring assert_assets_in_tenant."""
    if not ids:
        return
    unique = list(dict.fromkeys(ids))
    found = {r[0] for r in (await db.execute(
        select(model.id).where(model.id.in_(unique), model.tenant_id == tenant_id)
    )).all()}
    missing = [i for i in unique if i not in found]
    if missing:
        raise HTTPException(422, f"Invalid {field_name}: unknown id(s) {missing}")


async def _validate_perimeter(db, tenant_id: str, body) -> None:
    """Validate every perimeter/link field the caller actually sent.

    None means "not supplied" and is skipped, so a client that knows nothing
    about these fields behaves exactly as before.
    """
    if getattr(body, "process_ids", None) is not None:
        await _assert_ids_in_tenant(db, BusinessProcess, body.process_ids, tenant_id, "process_ids")
    if getattr(body, "org_entity_ids", None) is not None:
        await _assert_ids_in_tenant(db, OrgEntity, body.org_entity_ids, tenant_id, "org_entity_ids")
    if getattr(body, "asset_ids", None) is not None:
        await assert_assets_in_tenant(db, body.asset_ids, tenant_id, field_name="asset_ids")
    if getattr(body, "campaign_id", None):
        await _assert_ids_in_tenant(db, AuditCampaign, [body.campaign_id], tenant_id, "campaign_id")
    if getattr(body, "grid_id", None):
        await _assert_ids_in_tenant(db, AuditGrid, [body.grid_id], tenant_id, "grid_id")
    if getattr(body, "assessment_id", None):
        await _assert_ids_in_tenant(db, ComplianceAssessment, [body.assessment_id], tenant_id, "assessment_id")


async def _notify(db, tenant_id: str, user_ids, *, title: str, message: str,
                  title_key: str, message_key: str, params: dict, data: dict) -> None:
    """In-app notification for a report-workflow step.

    The stored strings are the fallback; the client renders title_key/message_key
    with params so a Tunisian bank does not read English sentences. Rows are
    added to the caller's session — the caller commits.
    """
    for uid in {u for u in user_ids if u}:
        db.add(Notification(
            tenant_id=tenant_id, user_id=uid, type=NotificationType.SYSTEM,
            title=title, message=message, title_key=title_key,
            message_key=message_key, params=params, data=data,
        ))


async def _report_reviewer_ids(db, tenant_id: str) -> list[str]:
    """Who is asked to validate a report: the tenant's CISO/compliance managers.

    Effective roles, not the scalar column: a CISO whose role comes from a Group,
    a custom role or a delegation is admitted by require_roles(*AUDIT_MANAGE_ROLES)
    and can therefore approve the report — but was never told one was waiting for
    them. tenant_admin stays in by name because it auto-passes require_roles.
    """
    from app.services.authz import get_effective_roles
    wanted = {UserRole.CISO.value, UserRole.COMPLIANCE_MANAGER.value}
    users = (await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
        )
    )).scalars().all()
    reviewers = []
    for u in users:
        # get_effective_roles rather than _effective_roles: the latter expands an
        # admin to every role, which would add platform super_admins to a tenant's
        # validation queue. The recipient set is the one this function always had,
        # plus the group/custom-role/delegated CISOs it used to miss.
        if u.role == UserRole.SUPER_ADMIN:
            continue
        if u.role == UserRole.TENANT_ADMIN or (wanted & set(await get_effective_roles(u, db))):
            reviewers.append(u.id)
    return reviewers


# ── Audit CRUD ───────────────────────────────────────────────────────────

@router.get("", response_model=list[AuditOut])
async def list_audits(
    status_filter: str | None = None,
    campaign_id: str | None = Query(default=None, description="Only engagements of this campaign"),
    process_id: str | None = Query(default=None, description="« audits couvrant ce processus »"),
    org_entity_id: str | None = None,
    asset_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    q = select(Audit).where(Audit.tenant_id == tenant_id, Audit.deleted_at.is_(None))
    if status_filter: q = q.where(Audit.status == status_filter)
    if campaign_id: q = q.where(Audit.campaign_id == campaign_id)
    visible = await _visible_audit_ids(db, user, tenant_id)
    if visible is not None:
        if not visible:
            return []
        q = q.where(Audit.id.in_(list(visible)))
    audits = list((await db.execute(q.order_by(Audit.created_at.desc()))).scalars().all())
    # The perimeter lives in JSON columns, so "which audits cover this process"
    # is filtered in Python rather than with a JSON operator SQLite and Oracle
    # spell differently. The register is small (tens of rows per tenant).
    if process_id:
        audits = [a for a in audits if process_id in _as_list(a.process_ids)]
    if org_entity_id:
        audits = [a for a in audits if org_entity_id in _as_list(a.org_entity_ids)]
    if asset_id:
        audits = [a for a in audits if asset_id in _as_list(a.asset_ids)]
    return [await _with_count(db, a) for a in audits]


@router.post("", response_model=AuditOut, status_code=201)
async def create_audit(
    body: AuditCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    await assert_user_in_tenant(db, body.lead_auditor_id, tenant_id, field_name="lead_auditor_id")
    _validate_recurrence(body.recurrence)
    await _validate_perimeter(db, tenant_id, body)
    a = Audit(tenant_id=tenant_id, title=body.title, description=body.description,
              audit_type=_enum_or_400(AuditType, body.audit_type, "audit_type"), lead_auditor_id=body.lead_auditor_id or user.id,
              framework_id=body.framework_id, planned_start=body.planned_start,
              planned_end=body.planned_end, scope=body.scope, in_scope_systems=body.in_scope_systems,
              recurrence=body.recurrence,
              campaign_id=body.campaign_id, grid_id=body.grid_id, assessment_id=body.assessment_id,
              process_ids=body.process_ids, org_entity_ids=body.org_entity_ids,
              asset_ids=body.asset_ids, audit_plan=body.audit_plan,
              report_status="draft")
    db.add(a); await db.flush(); await db.commit(); await db.refresh(a)
    await _log(db, tenant_id, user, "create", entity_id=a.id, entity_name=a.title,
               details={"audit_type": _enum_value(a.audit_type), "campaign_id": a.campaign_id,
                        "perimeter": {"processes": len(_as_list(a.process_ids)),
                                      "entities": len(_as_list(a.org_entity_ids)),
                                      "assets": len(_as_list(a.asset_ids))}})
    if a.lead_auditor_id:
        # Best-effort notification — broker may be unavailable in dev (no Redis).
        try:
            notify_audit_assigned.delay(a.id, a.lead_auditor_id)
        except Exception:
            pass
    return _audit_out(a, 0)


# ── Register (objectif 8: « registre de tous les audits réalisés ») ──────────
# Declared before the /{audit_id} routes: "/register" is one segment and would
# otherwise be swallowed by GET /{audit_id}.

class RegisterRow(BaseModel):
    id: str; title: str; audit_type: str; status: str
    campaign_id: str | None; framework_id: str | None
    lead_auditor_id: str | None; lead_auditor_name: str | None
    planned_start: str | None; planned_end: str | None
    actual_start: str | None; actual_end: str | None
    report_status: str; report_issued_at: str | None
    findings_total: int; findings_open: int; nonconformities: int
    process_ids: list; org_entity_ids: list; asset_ids: list
    deleted_at: str | None
    created_at: datetime


@router.get("/register", response_model=list[RegisterRow])
async def audit_register(
    status_filter: str | None = None,
    audit_type: str | None = None,
    campaign_id: str | None = None,
    framework_id: str | None = None,
    lead_auditor_id: str | None = None,
    process_id: str | None = None,
    org_entity_id: str | None = None,
    date_from: str | None = Query(default=None, description="ISO date; keeps audits planned/started on or after it"),
    date_to: str | None = None,
    q: str | None = Query(default=None, description="Substring match on the title"),
    include_deleted: bool = Query(default=False, description="Admins only — shows soft-deleted engagements"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """The interrogable register behind objectif 8: every engagement the caller
    may see, filterable, with its constat counts already rolled up so the client
    does not need N+1 calls to answer « combien de non-conformités ouvertes »."""
    stmt = select(Audit).where(Audit.tenant_id == tenant_id)
    if not (include_deleted and _is_admin(user)):
        stmt = stmt.where(Audit.deleted_at.is_(None))
    if status_filter: stmt = stmt.where(Audit.status == status_filter)
    if audit_type: stmt = stmt.where(Audit.audit_type == audit_type)
    if campaign_id: stmt = stmt.where(Audit.campaign_id == campaign_id)
    if framework_id: stmt = stmt.where(Audit.framework_id == framework_id)
    if lead_auditor_id: stmt = stmt.where(Audit.lead_auditor_id == lead_auditor_id)
    if q: stmt = stmt.where(Audit.title.ilike(f"%{q}%"))
    visible = await _visible_audit_ids(db, user, tenant_id)
    if visible is not None:
        if not visible:
            return []
        stmt = stmt.where(Audit.id.in_(list(visible)))
    rows = list((await db.execute(stmt.order_by(Audit.created_at.desc()))).scalars().all())

    if process_id:
        rows = [a for a in rows if process_id in _as_list(a.process_ids)]
    if org_entity_id:
        rows = [a for a in rows if org_entity_id in _as_list(a.org_entity_ids)]
    if date_from:
        rows = [a for a in rows if (a.actual_start or a.planned_start or "") >= date_from]
    if date_to:
        rows = [a for a in rows if (a.actual_start or a.planned_start or "9999") <= date_to]
    page = rows[offset:offset + limit]
    if not page:
        return []

    ids = [a.id for a in page]
    counts: dict[str, dict[str, int]] = {i: {"total": 0, "open": 0, "nc": 0} for i in ids}
    for aid, sev, st, ftype in (await db.execute(
        select(AuditFinding.audit_id, AuditFinding.severity, AuditFinding.status, AuditFinding.finding_type)
        .where(AuditFinding.audit_id.in_(ids))
    )).all():
        c = counts[aid]
        c["total"] += 1
        if _enum_value(st) in ("open", "in_remediation"):
            c["open"] += 1
        if (ftype or _default_finding_type(sev)).startswith("nonconformity"):
            c["nc"] += 1

    names = {uid: f"{fn} {ln}".strip() for uid, fn, ln in (await db.execute(
        select(User.id, User.first_name, User.last_name).where(
            User.id.in_([a.lead_auditor_id for a in page if a.lead_auditor_id] or [""])
        )
    )).all()}

    return [RegisterRow(
        id=a.id, title=a.title, audit_type=_enum_value(a.audit_type), status=_enum_value(a.status),
        campaign_id=a.campaign_id, framework_id=a.framework_id,
        lead_auditor_id=a.lead_auditor_id, lead_auditor_name=names.get(a.lead_auditor_id),
        planned_start=a.planned_start, planned_end=a.planned_end,
        actual_start=a.actual_start, actual_end=a.actual_end,
        report_status=a.report_status or "draft", report_issued_at=_iso(a.report_issued_at),
        findings_total=counts[a.id]["total"], findings_open=counts[a.id]["open"],
        nonconformities=counts[a.id]["nc"],
        process_ids=_as_list(a.process_ids), org_entity_ids=_as_list(a.org_entity_ids),
        asset_ids=_as_list(a.asset_ids), deleted_at=_iso(a.deleted_at), created_at=a.created_at,
    ) for a in page]


# ── Recommendations (objectif 7) ────────────────────────────────────────────
# Declared before /{audit_id} for the same routing reason as /register.

class RecommendationCreate(BaseModel):
    title: str
    description: str | None = None
    finding_id: str | None = None
    ref_code: str | None = None
    priority: str | None = None
    owner_id: str | None = None
    due_date: str | None = None

class RecommendationUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    ref_code: str | None = None
    priority: str | None = None
    status: str | None = None
    owner_id: str | None = None
    due_date: str | None = None
    progress: int | None = None

class RecommendationOut(BaseModel):
    id: str; tenant_id: str; audit_id: str; audit_title: str | None = None
    finding_id: str | None; ref_code: str | None
    title: str; description: str | None
    priority: str | None; status: str
    owner_id: str | None; owner_name: str | None = None
    due_date: str | None; progress: int
    is_overdue: bool = False
    action_items_total: int = 0
    action_items_done: int = 0
    closed_at: str | None = None; closed_by_id: str | None = None
    closure_note: str | None = None
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


async def _action_rollup(db, finding_ids: list[str]) -> dict[str, tuple[int, int]]:
    """(actionable, completed) action-item counts per finding.

    Cancelled actions are excluded from the denominator: a cancelled task is not
    outstanding work, and counting it would make 100 % unreachable.
    """
    out: dict[str, tuple[int, int]] = {}
    if not finding_ids:
        return out
    for fid, st, n in (await db.execute(
        select(ActionItem.finding_id, ActionItem.status, func.count(ActionItem.id))
        .where(ActionItem.finding_id.in_(finding_ids))
        .group_by(ActionItem.finding_id, ActionItem.status)
    )).all():
        total, done = out.get(fid, (0, 0))
        sv = _enum_value(st)
        if sv == ActionItemStatus.CANCELLED.value:
            continue
        total += n
        if sv == ActionItemStatus.COMPLETED.value:
            done += n
        out[fid] = (total, done)
    return out


def _derive_reco(rec: AuditRecommendation, rollup: tuple[int, int] | None, today: str):
    """Progress and status derived from the linked action items.

    « Mise à jour automatique du statut selon les actions entreprises » — with
    one hard limit: a recommendation is NEVER auto-closed. 100 % of the actions
    done means the work is claimed complete, not that anybody verified it; only
    POST /recommendations/{id}/close, by a human, closes it.

    The derivation only ever moves a recommendation FORWARD. Deriving it in both
    directions made a stored status unreadable: a responsable who set
    status='in_progress' on a recommendation with no action-plan rows behind it
    got 'pending' back on the very next read, and the dashboard bucket
    « en cours » stayed empty. The stored value is therefore the floor and the
    action items can only advance it.
    """
    total, done = rollup or (0, 0)
    if total:
        progress = int(round(done * 100 / total))
    else:
        progress = int(rec.progress or 0)
    stored = rec.status or "pending"
    if stored in ("closed", "rejected"):
        status_value = stored
    elif progress > 0 or stored == "in_progress":
        status_value = "in_progress"
    else:
        status_value = "pending"
    is_overdue = bool(
        status_value not in ("closed", "rejected")
        and rec.due_date and rec.due_date < today
    )
    return progress, status_value, is_overdue, total, done


def _reco_out(rec, progress, status_value, is_overdue, total, done,
              audit_title=None, owner_name=None) -> RecommendationOut:
    return RecommendationOut(
        id=rec.id, tenant_id=rec.tenant_id, audit_id=rec.audit_id, audit_title=audit_title,
        finding_id=rec.finding_id, ref_code=rec.ref_code, title=rec.title,
        description=rec.description, priority=rec.priority, status=status_value,
        owner_id=rec.owner_id, owner_name=owner_name, due_date=rec.due_date,
        progress=progress, is_overdue=is_overdue,
        action_items_total=total, action_items_done=done,
        closed_at=_iso(rec.closed_at), closed_by_id=rec.closed_by_id,
        closure_note=rec.closure_note,
        created_at=rec.created_at, updated_at=rec.updated_at,
    )


async def _one_reco_out(db, rec: AuditRecommendation) -> RecommendationOut:
    """Response for a single recommendation, decorated exactly like a list row.

    The list route joins audit_title and owner_name in; a PATCH or a close used
    to return them as null, so a client that renders the response it just got
    back blanked the row it had only edited.
    """
    rollups = await _action_rollup(db, [rec.finding_id] if rec.finding_id else [])
    progress, status_value, is_overdue, total, done = _derive_reco(
        rec, rollups.get(rec.finding_id), _utcnow().date().isoformat())
    audit_title = (await db.execute(
        select(Audit.title).where(Audit.id == rec.audit_id)
    )).scalar_one_or_none()
    owner_name = None
    if rec.owner_id:
        row = (await db.execute(
            select(User.first_name, User.last_name).where(User.id == rec.owner_id)
        )).first()
        if row:
            owner_name = f"{row[0]} {row[1]}".strip()
    return _reco_out(rec, progress, status_value, is_overdue, total, done,
                     audit_title, owner_name)


async def _load_recommendations(db, tenant_id: str, user: User, *, stmt):
    """Run `stmt`, restrict it to the audits the caller may see, and decorate the
    rows with the derived progress/status plus the audit and owner names the
    dashboard needs (avoids the N+1 the frontend would otherwise do)."""
    recs = list((await db.execute(stmt)).scalars().all())
    visible = await _visible_audit_ids(db, user, tenant_id)
    if visible is not None:
        recs = [r for r in recs if r.audit_id in visible]
    if not recs:
        return []
    rollups = await _action_rollup(db, [r.finding_id for r in recs if r.finding_id])
    titles = {aid: t for aid, t in (await db.execute(
        select(Audit.id, Audit.title).where(Audit.id.in_([r.audit_id for r in recs]))
    )).all()}
    owner_ids = [r.owner_id for r in recs if r.owner_id]
    names = {uid: f"{fn} {ln}".strip() for uid, fn, ln in (await db.execute(
        select(User.id, User.first_name, User.last_name).where(User.id.in_(owner_ids or [""]))
    )).all()}
    today = _utcnow().date().isoformat()
    out = []
    for r in recs:
        progress, status_value, is_overdue, total, done = _derive_reco(
            r, rollups.get(r.finding_id), today)
        out.append((r, _reco_out(r, progress, status_value, is_overdue, total, done,
                                 titles.get(r.audit_id), names.get(r.owner_id))))
    return out


@router.get("/recommendations", response_model=list[RecommendationOut])
async def list_recommendations(
    status_filter: str | None = Query(default=None, description="pending | in_progress | closed | rejected"),
    owner_id: str | None = None,
    audit_id: str | None = None,
    campaign_id: str | None = None,
    priority: str | None = None,
    overdue: bool = False,
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """« Toutes les recommandations en cours, tous audits confondus » — the list
    behind the dashboard counters, which previously required one call per audit
    and could not answer the closed set at all."""
    stmt = select(AuditRecommendation).where(AuditRecommendation.tenant_id == tenant_id)
    if owner_id: stmt = stmt.where(AuditRecommendation.owner_id == owner_id)
    if audit_id: stmt = stmt.where(AuditRecommendation.audit_id == audit_id)
    if priority: stmt = stmt.where(AuditRecommendation.priority == priority)
    if campaign_id:
        stmt = stmt.where(AuditRecommendation.audit_id.in_(
            select(Audit.id).where(Audit.tenant_id == tenant_id, Audit.campaign_id == campaign_id)
        ))
    stmt = stmt.order_by(AuditRecommendation.due_date.is_(None), AuditRecommendation.due_date.asc())
    rows = await _load_recommendations(db, tenant_id, user, stmt=stmt)
    out = [o for _, o in rows]
    # Filtered on the DERIVED status, not the stored one: a recommendation whose
    # actions have started reads "in_progress" even if nobody re-typed the status.
    if status_filter:
        out = [o for o in out if o.status == status_filter]
    if overdue:
        out = [o for o in out if o.is_overdue]
    return out[offset:offset + limit]


class RecommendationSummary(BaseModel):
    total: int
    pending: int
    in_progress: int
    closed: int
    rejected: int
    overdue: int
    avg_progress: int
    by_owner: list[dict]
    by_priority: dict
    by_audit: list[dict]


@router.get("/recommendations/summary", response_model=RecommendationSummary)
async def recommendations_summary(
    campaign_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """« Tableau de bord des recommandations » — lives here rather than in
    dashboard.py so it is not behind that module's feature gate."""
    stmt = select(AuditRecommendation).where(AuditRecommendation.tenant_id == tenant_id)
    if campaign_id:
        stmt = stmt.where(AuditRecommendation.audit_id.in_(
            select(Audit.id).where(Audit.tenant_id == tenant_id, Audit.campaign_id == campaign_id)
        ))
    rows = [o for _, o in await _load_recommendations(db, tenant_id, user, stmt=stmt)]
    by_owner: dict[str, dict] = {}
    by_audit: dict[str, dict] = {}
    by_priority: dict[str, int] = {}
    for o in rows:
        ok = o.owner_id or "unassigned"
        b = by_owner.setdefault(ok, {"owner_id": o.owner_id, "owner_name": o.owner_name,
                                     "total": 0, "open": 0, "overdue": 0})
        b["total"] += 1
        if o.status not in ("closed", "rejected"): b["open"] += 1
        if o.is_overdue: b["overdue"] += 1
        a = by_audit.setdefault(o.audit_id, {"audit_id": o.audit_id, "audit_title": o.audit_title,
                                             "total": 0, "open": 0})
        a["total"] += 1
        if o.status not in ("closed", "rejected"): a["open"] += 1
        by_priority[o.priority or "unset"] = by_priority.get(o.priority or "unset", 0) + 1
    return RecommendationSummary(
        total=len(rows),
        pending=sum(1 for o in rows if o.status == "pending"),
        in_progress=sum(1 for o in rows if o.status == "in_progress"),
        closed=sum(1 for o in rows if o.status == "closed"),
        rejected=sum(1 for o in rows if o.status == "rejected"),
        overdue=sum(1 for o in rows if o.is_overdue),
        avg_progress=int(round(sum(o.progress for o in rows) / len(rows))) if rows else 0,
        by_owner=sorted(by_owner.values(), key=lambda x: -x["open"]),
        by_priority=by_priority,
        by_audit=sorted(by_audit.values(), key=lambda x: -x["open"]),
    )


@router.post("/recommendations/rollup")
async def rollup_recommendations(
    audit_id: str | None = Query(default=None, description="Limit the rollup to one engagement"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Materialise the derived progress/status onto the rows and roll the result
    up onto the parent constats.

    Reads compute this on the fly; this endpoint persists it and — crucially —
    writes the AuditFindingStatusEvent rows, so an automatic transition is
    distinguishable from one a person chose. A finding reaches REMEDIATED when
    every one of its actions is done; it NEVER reaches CLOSED here, because
    « clôture effective » requires a human to certify it.
    """
    # The rollup WRITES: it moves statuses and stamps AuditFindingStatusEvent
    # rows with the caller as actor. It therefore has to obey the same rights
    # filter as every read — an auditor given one engagement was otherwise able
    # to move the constats of every other engagement in the tenant, under their
    # own name. Scoped, not merely tenant-scoped.
    visible = await _visible_audit_ids(db, user, tenant_id)
    if visible is not None and not visible:
        return {"recommendations_updated": 0, "findings_updated": 0, "recommendations_examined": 0}
    stmt = select(AuditRecommendation).where(AuditRecommendation.tenant_id == tenant_id)
    if audit_id:
        # Also proves the caller may see this engagement (404 otherwise).
        await _audit_for(db, audit_id, tenant_id, user)
        stmt = stmt.where(AuditRecommendation.audit_id == audit_id)
    elif visible is not None:
        stmt = stmt.where(AuditRecommendation.audit_id.in_(list(visible)))
    recs = list((await db.execute(stmt)).scalars().all())
    rollups = await _action_rollup(db, [r.finding_id for r in recs if r.finding_id])
    today = _utcnow().date().isoformat()
    changed = 0
    for r in recs:
        progress, status_value, _, _, _ = _derive_reco(r, rollups.get(r.finding_id), today)
        if r.progress != progress or (r.status or "pending") != status_value:
            r.progress = progress
            if (r.status or "pending") not in ("closed", "rejected"):
                r.status = status_value
            changed += 1

    # Now the constats themselves. Only findings that actually have action items
    # move; a finding with no plan behind it is left exactly as it was.
    findings_changed = 0
    if rollups:
        fq = (select(AuditFinding)
              .join(Audit, AuditFinding.audit_id == Audit.id)
              .where(Audit.tenant_id == tenant_id, Audit.deleted_at.is_(None),
                     AuditFinding.id.in_(list(rollups.keys()))))
        if visible is not None:
            fq = fq.where(Audit.id.in_(list(visible)))
        findings = list((await db.execute(fq)).scalars().all())
        for f in findings:
            total, done = rollups.get(f.id, (0, 0))
            if not total:
                continue
            current = _enum_value(f.status)
            if current in (FindingStatus.CLOSED.value, FindingStatus.ACCEPTED.value):
                continue  # a decided finding is not re-opened by a task count
            target = None
            if done == total:
                target = FindingStatus.REMEDIATED
            elif done > 0 and current == FindingStatus.OPEN.value:
                target = FindingStatus.IN_REMEDIATION
            if target and target.value != current:
                _record_status_event(db, f, current, target.value, user.id,
                                     note=f"{done}/{total} actions complete", automatic=True)
                f.status = target
                findings_changed += 1
    await db.commit()
    return {"recommendations_updated": changed, "findings_updated": findings_changed,
            "recommendations_examined": len(recs)}


async def _recommendation(db, rec_id: str, tenant_id: str, user: User) -> AuditRecommendation:
    rec = (await db.execute(select(AuditRecommendation).where(
        AuditRecommendation.id == rec_id, AuditRecommendation.tenant_id == tenant_id
    ))).scalar_one_or_none()
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    # Same visibility rule as the parent engagement.
    await _audit_for(db, rec.audit_id, tenant_id, user)
    return rec


@router.patch("/recommendations/{rec_id}", response_model=RecommendationOut)
async def update_recommendation(
    rec_id: str, body: RecommendationUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    rec = await _recommendation(db, rec_id, tenant_id, user)
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    if body.status is not None:
        # "overdue" is in RECOMMENDATION_STATUSES because the dashboard counts it,
        # but it is DERIVED from due_date — storing it would put the row in a state
        # no read ever reports back, so it is not settable here.
        settable = tuple(s for s in RECOMMENDATION_STATUSES if s != "overdue")
        if body.status not in settable:
            raise HTTPException(400, f"status must be one of {sorted(settable)}")
        if body.status == "closed":
            # Closure is an act with a note and an author, not a field edit —
            # objectif 7 asks for « clôture effective », so it has its own route.
            raise HTTPException(400, "Close a recommendation through POST /recommendations/{id}/close")
    before = {f: getattr(rec, f) for f in ("title", "priority", "status", "owner_id", "due_date", "progress")}
    for f in ("title", "description", "ref_code", "priority", "status", "owner_id", "due_date", "progress"):
        v = getattr(body, f, None)
        if v is not None:
            setattr(rec, f, v)
    await db.commit(); await db.refresh(rec)
    changed = {k: {"from": v, "to": getattr(rec, k)} for k, v in before.items() if getattr(rec, k) != v}
    await _log(db, tenant_id, user, "update", entity_type="audit_recommendation",
               entity_id=rec.id, entity_name=rec.title, details={"changed": changed})
    return await _one_reco_out(db, rec)


class RecommendationClose(BaseModel):
    closure_note: str
    status: str = "closed"


@router.post("/recommendations/{rec_id}/close", response_model=RecommendationOut)
async def close_recommendation(
    rec_id: str, body: RecommendationClose,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """« Jusqu'à leur clôture effective » — a closure carries who certified it,
    when, and on what grounds. The owner of the work cannot certify their own
    closure: that separation is what makes the stamp mean something."""
    rec = await _recommendation(db, rec_id, tenant_id, user)
    if not (body.closure_note or "").strip():
        raise HTTPException(400, "A closure note is required")
    if body.status not in ("closed", "rejected"):
        raise HTTPException(400, "status must be 'closed' or 'rejected'")
    if rec.owner_id and rec.owner_id == user.id and not _is_admin(user):
        raise HTTPException(403, "The recommendation owner cannot certify their own closure")
    rec.status = body.status
    rec.closed_at = _utcnow()
    rec.closed_by_id = user.id
    rec.closure_note = body.closure_note
    await db.commit(); await db.refresh(rec)
    await _log(db, tenant_id, user, "close", entity_type="audit_recommendation",
               entity_id=rec.id, entity_name=rec.title,
               details={"status": rec.status, "closure_note": rec.closure_note})
    return await _one_reco_out(db, rec)


@router.delete("/recommendations/{rec_id}", status_code=204)
async def delete_recommendation(
    rec_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    rec = await _recommendation(db, rec_id, tenant_id, user)
    snapshot = {"title": rec.title, "status": rec.status, "owner_id": rec.owner_id,
                "due_date": rec.due_date, "finding_id": rec.finding_id}
    await db.delete(rec); await db.commit()
    await _log(db, tenant_id, user, "delete", entity_type="audit_recommendation",
               entity_id=rec_id, entity_name=snapshot["title"], details={"deleted": snapshot})


# ── Single audit ─────────────────────────────────────────────────────────

@router.get("/{audit_id}", response_model=AuditOut)
async def get_audit(audit_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    return await _with_count(db, await _audit_for(db, audit_id, tenant_id, user))

@router.patch("/{audit_id}", response_model=AuditOut)
async def update_audit(
    audit_id: str, body: AuditUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    a = await _audit_for(db, audit_id, tenant_id, user)
    await assert_user_in_tenant(db, body.lead_auditor_id, tenant_id, field_name="lead_auditor_id")
    _validate_recurrence(body.recurrence)
    await _validate_perimeter(db, tenant_id, body)
    prev_lead_auditor_id = a.lead_auditor_id
    fields = ["title","description","lead_auditor_id","planned_start","planned_end",
              "actual_start","actual_end","scope","executive_summary","in_scope_systems",
              "recurrence","campaign_id","grid_id","assessment_id","process_ids",
              "org_entity_ids","asset_ids","audit_plan"]
    # Snapshot before/after so the trail records the MODIFICATION, not merely that
    # a PATCH happened (objectif 8) — the middleware only sees {method, path}.
    before = {f: getattr(a, f, None) for f in fields}
    before["status"] = _enum_value(a.status)
    for f in fields:
        v = getattr(body, f, None)
        if v is not None: setattr(a, f, v)
    if body.status: a.status = _enum_or_400(AuditStatus, body.status, "status")
    await db.commit(); await db.refresh(a)
    changed = {}
    for f in fields:
        if getattr(a, f, None) != before[f]:
            changed[f] = {"from": before[f], "to": getattr(a, f, None)}
    if _enum_value(a.status) != before["status"]:
        changed["status"] = {"from": before["status"], "to": _enum_value(a.status)}
    if changed:
        await _log(db, tenant_id, user, "update", entity_id=a.id, entity_name=a.title,
                   details={"changed": changed})
    if a.lead_auditor_id and a.lead_auditor_id != prev_lead_auditor_id:
        # Best-effort notification — broker may be unavailable in dev (no Redis).
        try:
            notify_audit_assigned.delay(a.id, a.lead_auditor_id)
        except Exception:
            pass
    return await _with_count(db, a)


@router.delete("/{audit_id}", status_code=204)
async def delete_audit(
    audit_id: str,
    reason: str = Query(..., min_length=5, description="Why this engagement is being withdrawn from the register"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Soft delete. « Conservation de tous les audits réalisés » cannot survive a
    row that any authenticated user could erase: the engagement is withdrawn from
    the register (deleted_at/deleted_by_id) with a reason and a snapshot in the
    hash chain, and its findings, evidence and report stay on disk and in the
    file-version ledger, recoverable through POST /{id}/restore."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    # A completed engagement is the record a regulator asks for. Withdrawing one
    # is an administrative act, not part of running an audit — hence the explicit
    # check rather than the decorator, which auto-passes tenant_admin anyway.
    if _enum_value(a.status) == AuditStatus.CLOSED.value and not _is_admin(user):
        raise HTTPException(403, "A closed audit can only be withdrawn by a tenant administrator")
    fc = (await db.execute(select(func.count(AuditFinding.id)).where(AuditFinding.audit_id == a.id))).scalar() or 0
    snapshot = {
        "reason": reason, "title": a.title, "status": _enum_value(a.status),
        "audit_type": _enum_value(a.audit_type), "framework_id": a.framework_id,
        "campaign_id": a.campaign_id, "lead_auditor_id": a.lead_auditor_id,
        "planned_start": a.planned_start, "planned_end": a.planned_end,
        "report_status": a.report_status, "report_url": a.report_url,
        "finding_count": fc,
    }
    a.deleted_at = _utcnow()
    a.deleted_by_id = user.id
    await db.commit()
    await _log(db, tenant_id, user, "delete", entity_id=a.id, entity_name=a.title,
               details=snapshot)


@router.post("/{audit_id}/restore", response_model=AuditOut)
async def restore_audit(
    audit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Undo a withdrawal. The counterpart that makes the soft delete honest."""
    a = await _audit(db, audit_id, tenant_id, include_deleted=True)
    if a.deleted_at is None:
        return await _with_count(db, a)
    a.deleted_at = None
    a.deleted_by_id = None
    await db.commit(); await db.refresh(a)
    await _log(db, tenant_id, user, "restore", entity_id=a.id, entity_name=a.title,
               details={"restored": True})
    return await _with_count(db, a)


# ── Audit plan (objectif 4: « planifier selon le périmètre défini ») ─────────

class AuditPlanIn(BaseModel):
    audit_plan: str


@router.post("/{audit_id}/plan", response_model=AuditOut)
async def save_audit_plan(
    audit_id: str, body: AuditPlanIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Persist the generated programme. The AI action produced one and threw it
    away; a plan that is not stored cannot be reviewed, compared with the next
    cycle, or shown to an evaluator."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    a.audit_plan = body.audit_plan
    await db.commit(); await db.refresh(a)
    await _log(db, tenant_id, user, "update", entity_id=a.id, entity_name=a.title,
               details={"changed": {"audit_plan": {"chars": len(body.audit_plan or "")}}})
    return await _with_count(db, a)


# ── Report generation + validation workflow (objectif 6) ────────────────────
# The engagement's own status (review/reporting) describes the fieldwork, not the
# document. report_status is the document's own lifecycle:
#
#     draft ──submit──> submitted ──approve──> approved ──distribute──> issued
#                            └────reject────> rejected ──submit──> submitted
#
# and the gate that makes the requirement real rather than advisory is on the
# download: outside the audit team, nobody gets the PDF before it is approved.

async def _current_report_version(db, audit) -> StoredFileVersion | None:
    """The file-version row for the PDF currently on the audit.

    Used instead of adding a "generated_by" column: generate_audit_report_file
    already records the generator as uploaded_by_id on this ledger.
    """
    return (await db.execute(
        select(StoredFileVersion)
        .where(StoredFileVersion.parent_type == "audit",
               StoredFileVersion.parent_id == audit.id,
               StoredFileVersion.entity_type == "audit_report",
               StoredFileVersion.status == file_integrity.CURRENT)
        .order_by(StoredFileVersion.version_number.desc()).limit(1)
    )).scalars().first()


async def _is_audit_team(db, user: User, audit: Audit) -> bool:
    """May this caller see the report before it has been approved?

    The approver has to read the draft in order to approve it, and the auditor
    has to read what they submitted — so the gate is "outside the audit team",
    not "nobody".
    """
    if _is_admin(user) or user.id in (audit.lead_auditor_id, audit.report_submitted_by_id):
        return True
    version = await _current_report_version(db, audit)
    if version is not None and version.uploaded_by_id == user.id:
        return True
    return await _has_any_role(db, user, AUDIT_MANAGE_ROLES + (UserRole.AUDITOR,))


@router.post("/{audit_id}/report/generate", response_model=AuditOut)
async def generate_audit_report_file(
    audit_id: str,
    lang: str | None = Query(None, description="en | fr | ar — overrides Accept-Language"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
    header_lang: str = Depends(get_request_language),
):
    """Generate this audit's report PDF, persist it to disk, and write its path
    back onto Audit.report_url (previously never populated). Regenerating a
    report clears any prior approval — a changed report needs re-approval
    before it can be distributed again."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    org_name = tenant.name if tenant else "Organization"
    # The engagement report is an artefact that leaves the platform, so it is
    # produced in the requester's language — «?lang=» first (a link cannot set a
    # header), else Accept-Language, which the SPA's axios client always sends.
    # Without this the generator's `lang` defaulted to English however the rest
    # of the application was displayed.
    pdf_bytes = await generate_single_audit_report(
        db, a, org_name, normalize_language(lang) or header_lang,
    )

    uploads_dir = Path(settings.UPLOADS_DIR)
    (uploads_dir / "audit-reports").mkdir(parents=True, exist_ok=True)
    rel_path = f"audit-reports/{uuid.uuid4()}.pdf"
    # write_bytes blocks the event loop, and both uvicorn workers serve every
    # other request on it — a multi-megabyte report is long enough to notice.
    await asyncio.to_thread((uploads_dir / rel_path).write_bytes, pdf_bytes)

    # Regenerating a report used to abandon the previous PDF: report_url was
    # overwritten and the old file left on disk with nothing pointing at it.
    # Recording each generation as a version keeps the superseded report
    # retrievable and, eventually, reclaimable by the retention policy.
    a.report_url = rel_path
    a.report_approved_by_id = None
    a.report_approved_at = None
    # A regenerated document is a new document: it re-enters the workflow at
    # draft, so an approval given to the previous PDF can never leak onto it.
    a.report_status = "draft"
    a.report_submitted_at = None
    a.report_submitted_by_id = None
    a.report_rejected_reason = None
    a.report_issued_at = None
    await file_integrity.record_version(
        db, tenant_id=tenant_id, entity_type="audit_report", entity_id=a.id,
        parent_type="audit", parent_id=a.id,
        file_path=rel_path, file_name=f"audit-report-{a.id}.pdf",
        file_sha256=file_integrity.sha256_bytes(pdf_bytes),
        file_size_bytes=len(pdf_bytes), content_type="application/pdf",
        uploaded_by_id=user.id,
    )
    await db.commit(); await db.refresh(a)
    await _log(db, tenant_id, user, "generate", entity_type="audit_report",
               entity_id=a.id, entity_name=a.title,
               details={"file": rel_path, "bytes": len(pdf_bytes), "report_status": "draft"})
    return await _with_count(db, a)


@router.get("/{audit_id}/report/download")
async def download_audit_report(
    audit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Diffusion gate. Anyone outside the audit team gets the file only once it
    has been approved — that is what « validation … avant diffusion » means."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    if not a.report_url:
        raise HTTPException(404, "No report has been generated for this audit yet")
    if (a.report_status or "draft") not in ("approved", "issued"):
        if not await _is_audit_team(db, user, a):
            raise HTTPException(403, "This report has not been approved for distribution yet")
    uploads_dir = Path(settings.UPLOADS_DIR).resolve()
    # report_url is server-generated today, but it is still a stored path fragment
    # being joined onto the uploads volume: anchor it exactly like the evidence
    # download beside it rather than rely on nothing ever writing that column.
    full = assert_path_within(uploads_dir, uploads_dir / a.report_url)
    if not full.exists():
        raise HTTPException(404, "Report file not found on disk")
    safe_name = "".join(c if c.isalnum() or c in (" ", "_", "-") else "_" for c in a.title)
    return FileResponse(path=str(full), filename=f"{safe_name}_report.pdf", media_type="application/pdf")


@router.post("/{audit_id}/report/submit", response_model=AuditOut)
async def submit_audit_report(
    audit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Hand the generated report to the validators (draft|rejected -> submitted)."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    if not a.report_url:
        raise HTTPException(400, "Generate the report before submitting it for validation")
    current = a.report_status or "draft"
    if current not in ("draft", "rejected"):
        raise HTTPException(400, f"A report in state '{current}' cannot be submitted")
    a.report_status = "submitted"
    a.report_submitted_at = _utcnow()
    a.report_submitted_by_id = user.id
    a.report_rejected_reason = None
    await _notify(
        db, tenant_id, await _report_reviewer_ids(db, tenant_id),
        title="Audit report awaiting validation",
        message=f"The report for '{a.title}' is awaiting validation before distribution.",
        title_key="notifications.audit_report_submitted.title",
        message_key="notifications.audit_report_submitted.message",
        params={"audit": a.title}, data={"entity_type": "audit", "entity_id": a.id},
    )
    await db.commit(); await db.refresh(a)
    await _log(db, tenant_id, user, "submit", entity_type="audit_report",
               entity_id=a.id, entity_name=a.title,
               details={"report_status": {"from": current, "to": "submitted"}})
    return await _with_count(db, a)


class ReportDecision(BaseModel):
    reason: str | None = None


@router.post("/{audit_id}/report/approve", response_model=AuditOut)
async def approve_audit_report_v2(
    audit_id: str,
    body: ReportDecision | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Validate the report before diffusion (submitted -> approved).

    Separation of duties is enforced here, not merely documented: whoever
    generated or submitted the document cannot be the one who validates it —
    including a tenant_admin, who would otherwise auto-pass require_roles().
    """
    a = await _audit_for(db, audit_id, tenant_id, user)
    if not a.report_url:
        raise HTTPException(400, "Generate the report before approving it")
    current = a.report_status or "draft"
    if current == "approved":
        return await _with_count(db, a)
    if current != "submitted":
        raise HTTPException(400, "Only a report submitted for validation can be approved")
    version = await _current_report_version(db, a)
    generated_by = version.uploaded_by_id if version is not None else None
    if user.id in (generated_by, a.report_submitted_by_id):
        raise HTTPException(403, "The report cannot be validated by the person who produced or submitted it")
    a.report_status = "approved"
    a.report_approved_by_id = user.id
    a.report_approved_at = _utcnow().isoformat()
    a.report_rejected_reason = None
    await _notify(
        db, tenant_id, [a.report_submitted_by_id, a.lead_auditor_id],
        title="Audit report approved",
        message=f"The report for '{a.title}' was approved and may now be distributed.",
        title_key="notifications.audit_report_approved.title",
        message_key="notifications.audit_report_approved.message",
        params={"audit": a.title}, data={"entity_type": "audit", "entity_id": a.id},
    )
    await db.commit(); await db.refresh(a)
    await _log(db, tenant_id, user, "approve", entity_type="audit_report",
               entity_id=a.id, entity_name=a.title,
               details={"report_status": {"from": current, "to": "approved"},
                        "reason": (body.reason if body else None),
                        "generated_by": generated_by,
                        "submitted_by": a.report_submitted_by_id})
    return await _with_count(db, a)


@router.post("/{audit_id}/report/reject", response_model=AuditOut)
async def reject_audit_report(
    audit_id: str,
    body: ReportDecision,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Send the report back to the audit team (submitted -> rejected)."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    if (a.report_status or "draft") != "submitted":
        raise HTTPException(400, "Only a report submitted for validation can be rejected")
    if not (body.reason or "").strip():
        raise HTTPException(400, "A rejection reason is required")
    a.report_status = "rejected"
    a.report_rejected_reason = body.reason
    a.report_approved_by_id = None
    a.report_approved_at = None
    await _notify(
        db, tenant_id, [a.report_submitted_by_id, a.lead_auditor_id],
        title="Audit report returned",
        message=f"The report for '{a.title}' was returned for correction.",
        title_key="notifications.audit_report_rejected.title",
        message_key="notifications.audit_report_rejected.message",
        params={"audit": a.title, "reason": body.reason},
        data={"entity_type": "audit", "entity_id": a.id},
    )
    await db.commit(); await db.refresh(a)
    await _log(db, tenant_id, user, "reject", entity_type="audit_report",
               entity_id=a.id, entity_name=a.title,
               details={"report_status": {"from": "submitted", "to": "rejected"},
                        "reason": body.reason})
    return await _with_count(db, a)


@router.post("/{audit_id}/approve-report", response_model=AuditOut)
async def approve_audit_report(
    audit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Legacy path kept so the existing client keeps working. It now walks the
    same state machine: a report that was never submitted is submitted first,
    then approved, and the separation-of-duties refusal still applies."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    if not a.report_url:
        raise HTTPException(400, "Generate the report before approving it")
    if (a.report_status or "draft") in ("draft", "rejected"):
        # Check separation of duties BEFORE the auto-submit. Mutating first left
        # a report the caller is not allowed to approve parked in `submitted`,
        # attributed to the lead auditor, by a request that then 403'd — a
        # refused call must not change the document's state.
        version = await _current_report_version(db, a)
        would_be_submitter = a.report_submitted_by_id or a.lead_auditor_id
        if user.id in ((version.uploaded_by_id if version is not None else None),
                       would_be_submitter):
            raise HTTPException(
                403, "The report cannot be validated by the person who produced or submitted it")
        a.report_status = "submitted"
        a.report_submitted_at = _utcnow()
        a.report_submitted_by_id = would_be_submitter
        await db.commit()
    return await approve_audit_report_v2(audit_id, None, db, user, tenant_id)


class ReportDistributionIn(BaseModel):
    recipients: list[str]
    channel: str = "email"
    note: str | None = None


class ReportDistributionOut(BaseModel):
    id: str; audit_id: str | None; report_kind: str
    file_name: str | None; sha256: str | None; report_version: int
    channel: str; recipients: str; note: str | None
    distributed_by_id: str | None; distributed_at: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


async def _deliver_report(
    db, tenant_id: str, audit: Audit, channel: str, recipients: list[str], lang: str,
) -> dict:
    """Actually e-mail the approved report, and say what happened.

    Best-effort by construction: the ReportDistribution row is the record of the
    diffusion and is already committed, so a relay outage must not roll it back
    or 500 the caller — it is reported instead, in the hash-chained trail and in
    the log. A non-e-mail channel (a hand delivery, a portal drop) records the
    diffusion without sending anything, which is what it always did.

    The payload comes from report_scheduler so the interactive path inherits the
    same two refusals the scheduled one has: not-approved, and bytes that no
    longer match the digest the approval was given to.
    """
    if channel != "email":
        return {"channel": channel, "sent": 0, "skipped": len(recipients), "reason": "channel"}
    # Imported here, not at module import: report_scheduler pulls in the whole
    # report-generation stack, which this module does not otherwise need loaded
    # to serve a single distribution.
    from app.services.email_service import send_report_email
    from app.services.report_scheduler import _engagement_payload, _mail_text

    try:
        pdf_bytes, filename, _a, _v = await _engagement_payload(db, tenant_id, audit.id)
    except PermissionError as exc:
        # Same refusal the scheduler records. The row stays — « on a tenté de
        # diffuser » is itself part of the trail — but nothing is sent.
        logger.warning("Audit report %s not deliverable: %s", audit.id, exc)
        return {"channel": channel, "sent": 0, "failed": len(recipients), "reason": str(exc)[:120]}
    except Exception as exc:  # noqa: BLE001 — never fail the recorded diffusion
        logger.error("Audit report %s payload error: %s", audit.id, exc)
        return {"channel": channel, "sent": 0, "failed": len(recipients), "reason": "payload error"}

    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    org_name = tenant.name if tenant else "Organization"
    subject = _mail_text(lang, "audit_subject", org=org_name, audit=audit.title)
    text = _mail_text(lang, "audit_body", audit=audit.title)

    async def _one(to_email: str) -> bool:
        try:
            return bool(await send_report_email(
                to_email=to_email, subject=subject, pdf_bytes=pdf_bytes,
                filename=filename, body_text=text,
            ))
        except Exception as exc:  # noqa: BLE001 — send_report_email swallows its own
            logger.error("Report distribution to %s failed: %s", to_email, exc)
            return False

    try:
        # aiosmtplib is async, so the sends overlap instead of adding 30s of
        # timeout each; the outer bound keeps one unreachable relay from holding
        # the request open for minutes on a two-worker box.
        results = await asyncio.wait_for(
            asyncio.gather(*(_one(r) for r in recipients)),
            timeout=_DISTRIBUTION_SEND_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.error("Audit report %s distribution timed out", audit.id)
        return {"channel": channel, "sent": 0, "failed": len(recipients), "reason": "timeout"}
    sent = sum(1 for ok in results if ok)
    return {"channel": channel, "sent": sent, "failed": len(recipients) - sent}


#: A recipient string ends up in an SMTP ``To:`` header. email_service folds the
#: subject and the filename but not the address, so anything containing CR/LF (or
#: simply not an address) must be refused here rather than reach the relay.
# \A/\Z rather than ^/$: Python's $ also matches before a trailing newline.
_EMAIL_RE = re.compile(r"\A[^@\s,;<>\"]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\Z")

#: One diffusion is one mail per recipient. Bounded so a single call cannot hold
#: a request open against a slow relay for minutes (2 uvicorn workers, no queue).
_MAX_RECIPIENTS = 20
_DISTRIBUTION_SEND_TIMEOUT = 60


@router.post("/{audit_id}/report/distribute", response_model=ReportDistributionOut, status_code=201)
async def distribute_audit_report(
    audit_id: str,
    body: ReportDistributionIn,
    lang: str | None = Query(None, description="en | fr | ar — overrides Accept-Language"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
    header_lang: str = Depends(get_request_language),
):
    """Diffusion, recorded — and, on the e-mail channel, actually delivered.

    Refused unless the report is approved: that refusal is the whole requirement.
    The row says who received which *version*, which the activity log alone
    cannot answer once the PDF is regenerated.

    Until now the row was the ONLY thing this route did: the register showed a
    diffusion that had never left the building. The bytes and their integrity
    check come from report_scheduler._engagement_payload, so the interactive and
    the scheduled path send exactly the same validated document.
    """
    a = await _audit_for(db, audit_id, tenant_id, user)
    if (a.report_status or "draft") not in ("approved", "issued"):
        raise HTTPException(400, "Only an approved report may be distributed")
    recipients = [r.strip() for r in body.recipients if (r or "").strip()]
    if not recipients:
        raise HTTPException(400, "At least one recipient is required")
    if len(recipients) > _MAX_RECIPIENTS:
        raise HTTPException(422, f"At most {_MAX_RECIPIENTS} recipients per diffusion")
    channel = (body.channel or "email").strip().lower() or "email"
    if channel == "email":
        bad = [r for r in recipients if not _EMAIL_RE.match(r)]
        if bad:
            raise HTTPException(422, f"Not valid e-mail addresses: {bad}")
    version = await _current_report_version(db, a)
    dist = ReportDistribution(
        tenant_id=tenant_id, audit_id=a.id, report_kind="audit",
        file_name=(version.file_name if version is not None else None) or f"audit-report-{a.id}.pdf",
        sha256=version.file_sha256 if version is not None else None,
        report_version=version.version_number if version is not None else 1,
        channel=channel, recipients=", ".join(recipients), note=body.note,
        distributed_by_id=user.id, distributed_at=_utcnow(),
    )
    db.add(dist)
    if (a.report_status or "draft") == "approved":
        a.report_status = "issued"
        a.report_issued_at = _utcnow()
    await db.flush(); await db.commit(); await db.refresh(dist)
    delivery = await _deliver_report(
        db, tenant_id, a, channel, recipients, normalize_language(lang) or header_lang,
    )
    await _log(db, tenant_id, user, "distribute", entity_type="audit_report",
               entity_id=a.id, entity_name=a.title,
               details={"recipients": recipients, "channel": channel,
                        "report_version": dist.report_version, "sha256": dist.sha256,
                        "delivery": delivery})
    return ReportDistributionOut(
        id=dist.id, audit_id=dist.audit_id, report_kind=dist.report_kind,
        file_name=dist.file_name, sha256=dist.sha256, report_version=dist.report_version,
        channel=dist.channel, recipients=dist.recipients, note=dist.note,
        distributed_by_id=dist.distributed_by_id, distributed_at=_iso(dist.distributed_at),
        created_at=dist.created_at,
    )


@router.get("/{audit_id}/report/distributions", response_model=list[ReportDistributionOut])
async def list_report_distributions(
    audit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """« Qui a reçu ce rapport ? » — unanswerable from the activity log alone."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    rows = (await db.execute(
        select(ReportDistribution)
        .where(ReportDistribution.tenant_id == tenant_id, ReportDistribution.audit_id == a.id)
        .order_by(ReportDistribution.created_at.desc())
    )).scalars().all()
    return [ReportDistributionOut(
        id=d.id, audit_id=d.audit_id, report_kind=d.report_kind, file_name=d.file_name,
        sha256=d.sha256, report_version=d.report_version, channel=d.channel,
        recipients=d.recipients, note=d.note, distributed_by_id=d.distributed_by_id,
        distributed_at=_iso(d.distributed_at), created_at=d.created_at,
    ) for d in rows]


# ── Findings CRUD ────────────────────────────────────────────────────────

def _record_status_event(db, finding: AuditFinding, from_status: str | None, to_status: str,
                         actor_id: str | None, *, note: str | None = None,
                         automatic: bool = False) -> None:
    """Append the transition to the finding's own ledger.

    Written into the CALLER's session and committed by the caller: an isolated
    session cannot write while the caller holds SQLite's write lock. `automatic`
    is what tells a rollup-driven move apart from one a person chose.
    """
    db.add(AuditFindingStatusEvent(
        finding_id=finding.id, from_status=from_status, to_status=to_status,
        note=note, is_automatic=automatic, actor_id=actor_id,
    ))


async def _finding(db, audit_id: str, fid: str) -> AuditFinding:
    f = (await db.execute(select(AuditFinding).where(
        AuditFinding.id == fid, AuditFinding.audit_id == audit_id
    ))).scalar_one_or_none()
    if not f: raise HTTPException(404, "Finding not found")
    return f


@router.get("/{audit_id}/findings", response_model=list[FindingOut])
async def list_findings(
    audit_id: str,
    status_filter: str | None = None,
    severity: str | None = None,
    finding_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    await _audit_for(db, audit_id, tenant_id, user)
    q = select(AuditFinding).where(AuditFinding.audit_id == audit_id)
    if status_filter: q = q.where(AuditFinding.status == status_filter)
    if severity: q = q.where(AuditFinding.severity == severity)
    rows = (await db.execute(q.order_by(AuditFinding.created_at.desc()))).scalars().all()
    out = [_finding_out(f) for f in rows]
    # Filtered after mapping so a legacy row with a NULL finding_type is matched
    # on the type derived from its severity rather than dropped.
    if finding_type:
        out = [o for o in out if o.finding_type == finding_type]
    return out


@router.post("/{audit_id}/findings", response_model=FindingOut, status_code=201)
async def create_finding(
    audit_id: str, body: FindingCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    a = await _audit_for(db, audit_id, tenant_id, user)
    await assert_user_in_tenant(db, body.remediation_owner_id, tenant_id, field_name="remediation_owner_id")
    if body.finding_type is not None and body.finding_type not in FINDING_TYPES:
        raise HTTPException(400, f"finding_type must be one of {sorted(FINDING_TYPES)}")
    f = AuditFinding(audit_id=audit_id, title=body.title, description=body.description,
                     severity=_enum_or_400(FindingSeverity, body.severity, "severity"), control_id=body.control_id,
                     remediation_owner_id=body.remediation_owner_id, due_date=body.due_date,
                     recommendation=body.recommendation,
                     # « Majeure / mineure / observation » was inexpressible; when the
                     # caller does not say, derive it from the severity so every row
                     # (including the legacy ones, at read time) carries a type.
                     finding_type=body.finding_type or _default_finding_type(body.severity))
    db.add(f); await db.flush()
    _record_status_event(db, f, None, FindingStatus.OPEN.value, user.id, note="raised")
    await db.commit(); await db.refresh(f)
    await _log(db, tenant_id, user, "create", entity_type="audit_finding",
               entity_id=f.id, entity_name=f.title,
               details={"audit_id": audit_id, "audit_title": a.title,
                        "severity": _enum_value(f.severity), "finding_type": f.finding_type})
    if f.remediation_owner_id:
        await _notify(
            db, tenant_id, [f.remediation_owner_id],
            title="A finding was assigned to you",
            message=f"'{f.title}' was raised in the audit '{a.title}'.",
            title_key="notifications.audit_finding_assigned.title",
            message_key="notifications.audit_finding_assigned.message",
            params={"finding": f.title, "audit": a.title},
            data={"entity_type": "audit_finding", "entity_id": f.id, "audit_id": a.id},
        )
        await db.commit()
    return _finding_out(f)


@router.patch("/{audit_id}/findings/{fid}", response_model=FindingOut)
async def update_finding(
    audit_id: str, fid: str, body: FindingUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    await _audit_for(db, audit_id, tenant_id, user)
    f = await _finding(db, audit_id, fid)
    await assert_user_in_tenant(db, body.remediation_owner_id, tenant_id, field_name="remediation_owner_id")
    if body.finding_type is not None and body.finding_type not in FINDING_TYPES:
        raise HTTPException(400, f"finding_type must be one of {sorted(FINDING_TYPES)}")
    if body.status in (FindingStatus.CLOSED.value, FindingStatus.ACCEPTED.value):
        # A verified closure is not a field edit. Objectif 7 asks for « clôture
        # effective »: who certified it, when, on what grounds — see /close.
        # ACCEPTED is on this list too: it is just as terminal (the rollup treats
        # both as decided and will never move them again), so leaving it settable
        # through PATCH left an untraceable back door into a closed state — no
        # note, no certifying author, no separation of duties.
        raise HTTPException(400, "Close a finding through POST /{audit_id}/findings/{fid}/close")

    # Capture "is this the action that first moves the finding" signals BEFORE
    # applying the update, so auto-transition below reflects what actually changed.
    was_open = f.status == FindingStatus.OPEN
    owner_newly_set = body.remediation_owner_id is not None and not f.remediation_owner_id
    due_date_newly_set = body.due_date is not None and not f.due_date
    notes_provided = bool(body.remediation_notes)
    prev_status = _enum_value(f.status)
    tracked = ("title", "description", "severity", "status", "remediation_owner_id",
               "due_date", "recommendation", "management_response", "remediation_notes",
               "finding_type")
    before = {k: _enum_value(getattr(f, k)) if k in ("severity", "status") else getattr(f, k)
              for k in tracked}

    for fld in ["title","description","remediation_owner_id","due_date","recommendation","management_response","remediation_notes","finding_type"]:
        v = getattr(body, fld, None)
        if v is not None: setattr(f, fld, v)
    if body.severity: f.severity = _enum_or_400(FindingSeverity, body.severity, "severity")

    if body.status:
        # Explicit status change always wins — the caller's direct signal.
        # REMEDIATED/ACCEPTED are reachable here; CLOSED is not (see above), so a
        # closure can never happen without a certifying human and a note.
        f.status = _enum_or_400(FindingStatus, body.status, "status")
    elif was_open and (owner_newly_set or due_date_newly_set or notes_provided):
        # RFP gap: "status isn't updated automatically based on actions taken
        # (only manual PATCH)". Narrow, one-way auto-transition: an OPEN finding
        # that just received its first remediation owner/due date, or had
        # remediation notes logged, is no longer untouched — reflect that
        # automatically instead of requiring a separate manual status PATCH.
        f.status = FindingStatus.IN_REMEDIATION

    new_status = _enum_value(f.status)
    if new_status != prev_status:
        # EVERY status change lands in the ledger, whether the caller asked for
        # it or the auto-transition above inferred it.
        _record_status_event(db, f, prev_status, new_status, user.id,
                             note=body.remediation_notes,
                             automatic=not bool(body.status))
    await db.commit(); await db.refresh(f)
    changed = {}
    for k in tracked:
        now = _enum_value(getattr(f, k)) if k in ("severity", "status") else getattr(f, k)
        if now != before[k]:
            changed[k] = {"from": before[k], "to": now}
    if changed:
        await _log(db, tenant_id, user, "update", entity_type="audit_finding",
                   entity_id=f.id, entity_name=f.title,
                   details={"audit_id": audit_id, "changed": changed})
    return _finding_out(f)


class FindingClose(BaseModel):
    closure_note: str
    closure_evidence_id: str | None = None
    status: str = "closed"


@router.post("/{audit_id}/findings/{fid}/close", response_model=FindingOut)
async def close_finding(
    audit_id: str, fid: str, body: FindingClose,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """« Jusqu'à leur clôture effective ».

    Nothing used to distinguish a verified close from somebody typing
    status='closed' — the handler even discarded the user. A closure now records
    who certified it, when, on what grounds and against which preuve, and is
    refused to the person who owned the remediation.
    """
    a = await _audit_for(db, audit_id, tenant_id, user)
    f = await _finding(db, audit_id, fid)
    if not (body.closure_note or "").strip():
        raise HTTPException(400, "A closure note is required")
    if body.status not in (FindingStatus.CLOSED.value, FindingStatus.ACCEPTED.value):
        raise HTTPException(400, "status must be 'closed' or 'accepted'")
    if f.remediation_owner_id and f.remediation_owner_id == user.id and not _is_admin(user):
        raise HTTPException(403, "The remediation owner cannot certify the closure of their own finding")
    if body.closure_evidence_id:
        ev = (await db.execute(select(AuditEvidence).where(
            AuditEvidence.id == body.closure_evidence_id, AuditEvidence.audit_id == audit_id
        ))).scalar_one_or_none()
        if not ev:
            raise HTTPException(422, "closure_evidence_id is not a piece of evidence of this audit")
    prev_status = _enum_value(f.status)
    f.status = FindingStatus(body.status)
    f.closed_at = _utcnow()
    f.closed_by_id = user.id
    f.closure_note = body.closure_note
    f.closure_evidence_id = body.closure_evidence_id
    _record_status_event(db, f, prev_status, body.status, user.id, note=body.closure_note)
    await db.commit(); await db.refresh(f)
    await _log(db, tenant_id, user, "close", entity_type="audit_finding",
               entity_id=f.id, entity_name=f.title,
               details={"audit_id": audit_id, "audit_title": a.title,
                        "status": {"from": prev_status, "to": body.status},
                        "closure_note": body.closure_note,
                        "closure_evidence_id": body.closure_evidence_id})
    if f.remediation_owner_id:
        await _notify(
            db, tenant_id, [f.remediation_owner_id],
            title="Finding closed",
            message=f"'{f.title}' was closed after verification.",
            title_key="notifications.audit_finding_closed.title",
            message_key="notifications.audit_finding_closed.message",
            params={"finding": f.title, "audit": a.title},
            data={"entity_type": "audit_finding", "entity_id": f.id, "audit_id": a.id},
        )
        await db.commit()
    return _finding_out(f)


class ManagementResponseIn(BaseModel):
    management_response: str


@router.post("/{audit_id}/findings/{fid}/response", response_model=FindingOut)
async def respond_to_finding(
    audit_id: str, fid: str, body: ManagementResponseIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """The audité's own answer to a constat.

    Deliberately NOT behind require_roles(): the person a finding was assigned to
    is usually a control or business owner, who has no audit role at all and
    would otherwise have no field to answer in — « échanger avec les audités ».
    """
    a = await _audit_for(db, audit_id, tenant_id, user)
    f = await _finding(db, audit_id, fid)
    if not (body.management_response or "").strip():
        raise HTTPException(400, "A response is required")
    if f.remediation_owner_id != user.id and not await _has_any_role(db, user, AUDIT_WRITE_ROLES):
        raise HTTPException(403, "Only the finding's owner or the audit team can answer this finding")
    f.management_response = body.management_response
    await db.commit(); await db.refresh(f)
    await _log(db, tenant_id, user, "respond", entity_type="audit_finding",
               entity_id=f.id, entity_name=f.title,
               details={"audit_id": audit_id, "audit_title": a.title,
                        "management_response": body.management_response})
    return _finding_out(f)


class FindingStatusEventOut(BaseModel):
    id: str; finding_id: str
    from_status: str | None; to_status: str
    note: str | None; is_automatic: bool
    actor_id: str | None; actor_name: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


@router.get("/{audit_id}/findings/{fid}/history", response_model=list[FindingStatusEventOut])
async def finding_history(
    audit_id: str, fid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """The transitions, not just the current status — what « suivi jusqu'à la
    clôture » actually requires."""
    await _audit_for(db, audit_id, tenant_id, user)
    await _finding(db, audit_id, fid)
    rows = (await db.execute(
        select(AuditFindingStatusEvent)
        .where(AuditFindingStatusEvent.finding_id == fid)
        .order_by(AuditFindingStatusEvent.created_at.asc())
    )).scalars().all()
    names = {uid: f"{fn} {ln}".strip() for uid, fn, ln in (await db.execute(
        select(User.id, User.first_name, User.last_name)
        .where(User.id.in_([e.actor_id for e in rows if e.actor_id] or [""]))
    )).all()}
    return [FindingStatusEventOut(
        id=e.id, finding_id=e.finding_id, from_status=e.from_status, to_status=e.to_status,
        note=e.note, is_automatic=e.is_automatic, actor_id=e.actor_id,
        actor_name=names.get(e.actor_id), created_at=e.created_at,
    ) for e in rows]


@router.delete("/{audit_id}/findings/{fid}", status_code=204)
async def delete_finding(
    audit_id: str, fid: str,
    reason: str = Query(..., min_length=5, description="Why this constat is being withdrawn"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_MANAGE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """AuditFinding has no deleted_at column, so this remains a hard delete — but
    it is now restricted to the roles that own the engagement's outcome and the
    row is snapshotted into the hash chain first, so the constat that existed is
    still recoverable from the trail."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    f = await _finding(db, audit_id, fid)
    snapshot = {
        "reason": reason, "audit_id": audit_id, "audit_title": a.title,
        "title": f.title, "description": f.description,
        "severity": _enum_value(f.severity), "status": _enum_value(f.status),
        "finding_type": f.finding_type, "control_id": f.control_id,
        "remediation_owner_id": f.remediation_owner_id, "due_date": f.due_date,
        "recommendation": f.recommendation, "management_response": f.management_response,
    }
    await db.delete(f); await db.commit()
    await _log(db, tenant_id, user, "delete", entity_type="audit_finding",
               entity_id=fid, entity_name=snapshot["title"], details={"deleted": snapshot})


# ── Recommendations attached to one engagement ──────────────────────────────

@router.get("/{audit_id}/recommendations", response_model=list[RecommendationOut])
async def list_audit_recommendations(
    audit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    await _audit_for(db, audit_id, tenant_id, user)
    stmt = (select(AuditRecommendation)
            .where(AuditRecommendation.tenant_id == tenant_id,
                   AuditRecommendation.audit_id == audit_id)
            .order_by(AuditRecommendation.created_at.asc()))
    return [o for _, o in await _load_recommendations(db, tenant_id, user, stmt=stmt)]


@router.post("/{audit_id}/recommendations", response_model=RecommendationOut, status_code=201)
async def create_audit_recommendation(
    audit_id: str, body: RecommendationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """One constat routinely yields several distinct recommendations, each with
    its own owner and échéance. AuditFinding.recommendation stays as the summary
    text, so nothing that reads it breaks."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    await assert_user_in_tenant(db, body.owner_id, tenant_id, field_name="owner_id")
    if body.finding_id:
        await _finding(db, audit_id, body.finding_id)
    rec = AuditRecommendation(
        tenant_id=tenant_id, audit_id=audit_id, finding_id=body.finding_id,
        ref_code=body.ref_code, title=body.title, description=body.description,
        priority=body.priority, status="pending", owner_id=body.owner_id,
        due_date=body.due_date, progress=0, created_by_id=user.id,
    )
    db.add(rec); await db.flush(); await db.commit(); await db.refresh(rec)
    await _log(db, tenant_id, user, "create", entity_type="audit_recommendation",
               entity_id=rec.id, entity_name=rec.title,
               details={"audit_id": audit_id, "audit_title": a.title,
                        "finding_id": rec.finding_id, "owner_id": rec.owner_id,
                        "due_date": rec.due_date})
    if rec.owner_id:
        await _notify(
            db, tenant_id, [rec.owner_id],
            title="A recommendation was assigned to you",
            message=f"'{rec.title}' (audit '{a.title}').",
            title_key="notifications.audit_recommendation_assigned.title",
            message_key="notifications.audit_recommendation_assigned.message",
            params={"recommendation": rec.title, "audit": a.title},
            data={"entity_type": "audit_recommendation", "entity_id": rec.id, "audit_id": a.id},
        )
        await db.commit()
    return await _one_reco_out(db, rec)


# ── Evidence: real uploads (objectif 5, « pièces jointes, preuves ») ─────────
# The table held caller-supplied strings and no bytes: there was no multipart
# handler at all, so an auditor could not attach a single preuve, and s3_key was
# whatever the client typed. These routes store the file, hash it, and register
# it in the file-version ledger the rest of the platform already uses.

# The platform-wide cap is 2 MB, which no scanned, signed procedure fits in — a
# preuve nobody can upload does not satisfy the requirement. config.py is owned
# by another lane, so the floor is raised here and only here; when a real
# AUDIT_EVIDENCE_MAX_UPLOAD_SIZE_MB setting exists it should replace this.
_EVIDENCE_MAX_MB = getattr(settings, "AUDIT_EVIDENCE_MAX_UPLOAD_SIZE_MB", None) \
    or max(settings.MAX_UPLOAD_SIZE_MB, 20)


class EvidenceCreate(BaseModel):
    name: str
    description: str | None = None
    file_name: str | None = None
    s3_key: str | None = None
    finding_id: str | None = None

class EvidenceOut(BaseModel):
    id: str; audit_id: str; name: str; description: str | None
    file_name: str | None; s3_key: str | None; uploaded_by_id: str | None
    finding_id: str | None = None
    file_path: str | None = None
    file_size_bytes: int | None = None
    content_type: str | None = None
    file_sha256: str | None = None
    record_version: int = 1
    has_file: bool = False
    created_at: datetime
    model_config = {"from_attributes": True}


def _evidence_out(e: AuditEvidence) -> EvidenceOut:
    return EvidenceOut(
        id=e.id, audit_id=e.audit_id, name=e.name, description=e.description,
        file_name=e.file_name, s3_key=e.s3_key, uploaded_by_id=e.uploaded_by_id,
        finding_id=e.finding_id, file_path=e.file_path, file_size_bytes=e.file_size_bytes,
        content_type=e.content_type, file_sha256=e.file_sha256,
        record_version=e.record_version or 1, has_file=bool(e.file_path),
        created_at=e.created_at,
    )


async def _may_attach(db, user: User, audit: Audit, finding: AuditFinding | None) -> bool:
    """The audit team attaches preuves; so does the audité the constat was
    assigned to, who is otherwise the only person holding the document asked
    for and has no audit role at all."""
    if finding is not None and finding.remediation_owner_id == user.id:
        return True
    if audit.lead_auditor_id == user.id:
        return True
    return await _has_any_role(db, user, AUDIT_WRITE_ROLES)


@router.get("/{audit_id}/evidence", response_model=list[EvidenceOut])
async def list_evidence(
    audit_id: str,
    finding_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    await _audit_for(db, audit_id, tenant_id, user)
    q = select(AuditEvidence).where(AuditEvidence.audit_id == audit_id)
    if finding_id: q = q.where(AuditEvidence.finding_id == finding_id)
    rows = (await db.execute(q.order_by(AuditEvidence.created_at.desc()))).scalars().all()
    return [_evidence_out(e) for e in rows]


@router.post("/{audit_id}/evidence", response_model=EvidenceOut, status_code=201)
async def create_evidence(
    audit_id: str, body: EvidenceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(*AUDIT_WRITE_ROLES)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Metadata-only record (an external reference, a document held elsewhere).
    Kept for the existing clients; the real upload is POST .../evidence/upload."""
    await _audit_for(db, audit_id, tenant_id, user)
    if body.finding_id:
        await _finding(db, audit_id, body.finding_id)
    e = AuditEvidence(audit_id=audit_id, name=body.name, description=body.description,
                      file_name=body.file_name, s3_key=body.s3_key, uploaded_by_id=user.id,
                      finding_id=body.finding_id)
    db.add(e); await db.flush(); await db.commit(); await db.refresh(e)
    await _log(db, tenant_id, user, "create", entity_type="audit_evidence",
               entity_id=e.id, entity_name=e.name,
               details={"audit_id": audit_id, "finding_id": e.finding_id, "has_file": False})
    return _evidence_out(e)


async def _store_evidence_upload(
    db, *, audit: Audit, tenant_id: str, user: User, file: UploadFile,
    name: str | None, description: str | None, finding: AuditFinding | None,
) -> AuditEvidence:
    """Validate, persist and register one uploaded preuve. The caller commits."""
    # Reject filenames whose extension must never reach the uploads volume —
    # checks EVERY suffix, so report.pdf.exe is refused. See security_utils.
    assert_safe_upload_name(file.filename, field_name="file")
    name_lower = (file.filename or "").lower()
    if not any(name_lower.endswith(ext) for ext in _EVIDENCE_EXTENSIONS):
        raise HTTPException(422, f"Unsupported evidence type. Accepted: {', '.join(_EVIDENCE_EXTENSIONS)}")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(422, "The uploaded file is empty")
    max_bytes = _EVIDENCE_MAX_MB * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(413, f"File too large (max {_EVIDENCE_MAX_MB}MB)")

    # Declared type must match the bytes: a .pdf that is not a PDF is either a
    # mistake or an attempt to smuggle something past the extension check.
    declared = (file.content_type or "").lower()
    if "pdf" in declared and not verify_file_signature(file_bytes, "application/pdf"):
        raise HTTPException(415, "File contents do not match the declared PDF type.")
    if "spreadsheetml" in declared and not verify_file_signature(file_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
        raise HTTPException(415, "File contents do not match the declared XLSX type.")
    if "png" in declared and not verify_file_signature(file_bytes, "image/png"):
        raise HTTPException(415, "File contents do not match the declared PNG type.")

    safe_name = sanitize_filename(file.filename or "evidence.pdf")
    rel_path = f"{tenant_id}/audit-evidence/{audit.id}/{uuid.uuid4().hex}_{safe_name}"
    full_path = Path(settings.UPLOADS_DIR) / rel_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    # Preuves are capped an order of magnitude above the platform's 2 MB, so the
    # write goes to a thread rather than stalling the loop (see public_upload.py).
    await asyncio.to_thread(full_path.write_bytes, file_bytes)

    digest = file_integrity.sha256_bytes(file_bytes)
    e = AuditEvidence(
        audit_id=audit.id, name=(name or file.filename or safe_name),
        description=description, file_name=file.filename or safe_name,
        uploaded_by_id=user.id, finding_id=(finding.id if finding is not None else None),
        file_path=rel_path, file_size_bytes=len(file_bytes),
        content_type=file.content_type, file_sha256=digest,
    )
    db.add(e)
    await db.flush()
    # Versions are numbered per PARENT. The parent is the constat when the preuve
    # answers one, otherwise the engagement — deliberately NOT parent_type
    # "audit", which the generated report already owns; sharing it would make
    # each evidence upload supersede the report's own version chain.
    version = await file_integrity.record_version(
        db, tenant_id=tenant_id, entity_type=file_integrity.EVIDENCE, entity_id=e.id,
        parent_type=("audit_finding" if finding is not None else "audit_evidence"),
        parent_id=(finding.id if finding is not None else audit.id),
        file_path=rel_path, file_name=e.file_name, file_sha256=digest,
        file_size_bytes=len(file_bytes), content_type=file.content_type,
        uploaded_by_id=user.id,
    )
    e.record_version = version.version_number
    return e


@router.post("/{audit_id}/evidence/upload", response_model=EvidenceOut, status_code=201)
async def upload_evidence(
    audit_id: str,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    description: str | None = Form(default=None),
    finding_id: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Attach a real preuve to an engagement (optionally to one constat)."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    finding = await _finding(db, audit_id, finding_id) if finding_id else None
    if not await _may_attach(db, user, a, finding):
        raise HTTPException(403, "You may not attach evidence to this audit")
    e = await _store_evidence_upload(db, audit=a, tenant_id=tenant_id, user=user, file=file,
                                     name=name, description=description, finding=finding)
    await db.commit(); await db.refresh(e)
    await _log(db, tenant_id, user, "upload", entity_type="audit_evidence",
               entity_id=e.id, entity_name=e.name,
               details={"audit_id": audit_id, "finding_id": e.finding_id,
                        "file_name": e.file_name, "sha256": e.file_sha256,
                        "bytes": e.file_size_bytes})
    return _evidence_out(e)


@router.post("/{audit_id}/findings/{fid}/evidence", response_model=EvidenceOut, status_code=201)
async def upload_finding_evidence(
    audit_id: str, fid: str,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    description: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Attachment on a constat — the route the audité uses to supply the document
    the auditor asked for, and the one a closure can then point at."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    finding = await _finding(db, audit_id, fid)
    if not await _may_attach(db, user, a, finding):
        raise HTTPException(403, "You may not attach evidence to this finding")
    e = await _store_evidence_upload(db, audit=a, tenant_id=tenant_id, user=user, file=file,
                                     name=name, description=description, finding=finding)
    await db.commit(); await db.refresh(e)
    await _log(db, tenant_id, user, "upload", entity_type="audit_evidence",
               entity_id=e.id, entity_name=e.name,
               details={"audit_id": audit_id, "finding_id": fid,
                        "file_name": e.file_name, "sha256": e.file_sha256,
                        "bytes": e.file_size_bytes})
    return _evidence_out(e)


@router.get("/{audit_id}/evidence/{eid}/download")
async def download_evidence(
    audit_id: str, eid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    await _audit_for(db, audit_id, tenant_id, user)
    e = (await db.execute(select(AuditEvidence).where(
        AuditEvidence.id == eid, AuditEvidence.audit_id == audit_id
    ))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Evidence not found")
    if not e.file_path:
        raise HTTPException(404, "This evidence record has no stored file")
    uploads_dir = Path(settings.UPLOADS_DIR).resolve()
    # Never join an attacker-controllable path fragment without re-anchoring it.
    full = assert_path_within(uploads_dir, uploads_dir / e.file_path)
    if not full.exists():
        raise HTTPException(404, "Evidence file not found on disk")
    return FileResponse(path=str(full), filename=e.file_name or "evidence",
                        media_type=e.content_type or "application/octet-stream")


@router.delete("/{audit_id}/evidence/{eid}", status_code=204)
async def delete_evidence(
    audit_id: str, eid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Deleting a preuve was unconditional and unlogged. It is now restricted to
    the roles that own the engagement's outcome (or the person who uploaded it),
    the bytes are retired rather than unlinked so the file stays recoverable, and
    the removal is written to the hash chain."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    e = (await db.execute(select(AuditEvidence).where(
        AuditEvidence.id == eid, AuditEvidence.audit_id == audit_id
    ))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Evidence not found")
    if e.uploaded_by_id != user.id and not await _has_any_role(db, user, AUDIT_MANAGE_ROLES):
        raise HTTPException(403, "Only the uploader or the audit owners can remove this evidence")
    snapshot = {"audit_id": audit_id, "audit_title": a.title, "name": e.name,
                "file_name": e.file_name, "file_path": e.file_path,
                "sha256": e.file_sha256, "finding_id": e.finding_id}
    if e.file_path:
        await file_integrity.retire_versions(
            db, entity_type=file_integrity.EVIDENCE, entity_id=e.id,
            note="audit evidence deleted",
        )
    await db.delete(e); await db.commit()
    await _log(db, tenant_id, user, "delete", entity_type="audit_evidence",
               entity_id=eid, entity_name=snapshot["name"], details={"deleted": snapshot})


# ── Auditor ↔ audité exchange (objectif 5) ──────────────────────────────────

class CommentCreate(BaseModel):
    body: str
    finding_id: str | None = None
    parent_id: str | None = None
    is_internal: bool = False

class CommentOut(BaseModel):
    id: str; audit_id: str | None; finding_id: str | None; parent_id: str | None
    author_id: str; author_name: str | None = None
    body: str; is_internal: bool
    created_at: datetime
    model_config = {"from_attributes": True}


async def _comment_recipients(
    db, audit: Audit, finding: AuditFinding | None, author: User,
    *, is_team: bool, is_internal: bool,
) -> set[str]:
    """Who is told there is something new to read on an engagement.

    An audité's reply has always reached the lead auditor, and a note on a constat
    reaches that constat's remediation owner. An ENGAGEMENT-LEVEL question from
    the audit team — « pouvez-vous me fournir la procédure ? » — reached nobody,
    so « échanger avec les audités » only worked downwards from a constat. The
    audités of an engagement are resolved here instead: the owners of its
    constats, plus whoever has already spoken in the shared thread.

    An internal note notifies no audité by construction — that separation is what
    makes the rest of the thread safe to open to them.
    """
    if is_internal:
        return set()
    if not is_team:
        # The audité answered: the lead auditor is the one waiting for it.
        targets = {audit.lead_auditor_id}
    elif finding is not None and finding.remediation_owner_id:
        targets = {finding.remediation_owner_id}
    else:
        targets = {oid for (oid,) in (await db.execute(
            select(AuditFinding.remediation_owner_id).where(
                AuditFinding.audit_id == audit.id,
                AuditFinding.remediation_owner_id.is_not(None),
            )
        )).all()}
        targets |= {aid for (aid,) in (await db.execute(
            select(AuditComment.author_id).where(
                AuditComment.tenant_id == audit.tenant_id,
                AuditComment.audit_id == audit.id,
                AuditComment.is_internal == False,  # noqa: E712
                AuditComment.deleted_at.is_(None),
            )
        )).all()}
        targets.add(audit.lead_auditor_id)
    targets.discard(author.id)
    return {t for t in targets if t}


@router.get("/{audit_id}/comments", response_model=list[CommentOut])
async def list_audit_comments(
    audit_id: str,
    finding_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """The thread. Internal notes stay inside the audit team — that separation is
    what makes it safe to open the rest of the exchange to the audités."""
    await _audit_for(db, audit_id, tenant_id, user)
    q = (select(AuditComment)
         .where(AuditComment.tenant_id == tenant_id,
                AuditComment.audit_id == audit_id,
                AuditComment.deleted_at.is_(None)))
    if finding_id:
        q = q.where(AuditComment.finding_id == finding_id)
    if not await _has_any_role(db, user, AUDIT_WRITE_ROLES):
        q = q.where(AuditComment.is_internal == False)  # noqa: E712
    rows = (await db.execute(q.order_by(AuditComment.created_at.asc()))).scalars().all()
    names = {uid: f"{fn} {ln}".strip() for uid, fn, ln in (await db.execute(
        select(User.id, User.first_name, User.last_name)
        .where(User.id.in_([c.author_id for c in rows] or [""]))
    )).all()}
    return [CommentOut(
        id=c.id, audit_id=c.audit_id, finding_id=c.finding_id, parent_id=c.parent_id,
        author_id=c.author_id, author_name=names.get(c.author_id), body=c.body,
        is_internal=c.is_internal, created_at=c.created_at,
    ) for c in rows]


@router.post("/{audit_id}/comments", response_model=CommentOut, status_code=201)
async def post_audit_comment(
    audit_id: str, body: CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Not behind require_roles(): the audité — usually a control or business
    owner with no audit role — has to be able to answer."""
    a = await _audit_for(db, audit_id, tenant_id, user)
    if not (body.body or "").strip():
        raise HTTPException(400, "A comment body is required")
    finding = await _finding(db, audit_id, body.finding_id) if body.finding_id else None
    is_team = await _has_any_role(db, user, AUDIT_WRITE_ROLES)
    if body.parent_id:
        parent = (await db.execute(select(AuditComment).where(
            AuditComment.id == body.parent_id, AuditComment.tenant_id == tenant_id,
            AuditComment.audit_id == audit_id,
        ))).scalar_one_or_none()
        if not parent:
            raise HTTPException(422, "parent_id is not a comment of this audit")
    c = AuditComment(
        tenant_id=tenant_id, audit_id=audit_id,
        finding_id=(finding.id if finding is not None else None),
        parent_id=body.parent_id, author_id=user.id, body=body.body,
        # Only the audit team can mark a note internal; anything an audité writes
        # is by definition part of the shared exchange.
        is_internal=bool(body.is_internal and is_team),
    )
    db.add(c); await db.flush(); await db.commit(); await db.refresh(c)
    # Build the response BEFORE the notification commit and the chained entry:
    # chain_and_add rolls the session back when it loses the seq race, and a
    # rollback expires every loaded object, so reading `c` afterwards would be a
    # MissingGreenlet rather than a lazy query.
    out = CommentOut(
        id=c.id, audit_id=c.audit_id, finding_id=c.finding_id, parent_id=c.parent_id,
        author_id=c.author_id, author_name=f"{user.first_name} {user.last_name}".strip(),
        body=c.body, is_internal=c.is_internal, created_at=c.created_at,
    )
    # Tell the other side there is something to read: the auditee never learned a
    # non-conformity had been raised, and the auditor never learned of a reply.
    targets = await _comment_recipients(
        db, a, finding, user, is_team=is_team, is_internal=c.is_internal)
    if targets:
        await _notify(
            db, tenant_id, targets,
            title="New audit comment",
            message=f"A new message was posted on the audit '{a.title}'.",
            title_key="notifications.audit_comment_new.title",
            message_key="notifications.audit_comment_new.message",
            params={"audit": a.title}, data={"entity_type": "audit", "entity_id": a.id},
        )
        await db.commit()
    # Objectif 8 « journalisation des modifications »: every other write in this
    # module names itself in the hash chain. An exchange between an auditor and an
    # audité was recorded only as the middleware's {method, path} with a blank
    # actor, which is precisely the evidence a regulator asks for.
    await _log(db, tenant_id, user, "create", entity_type="audit_comment",
               entity_id=out.id, entity_name=a.title,
               details={"audit_id": audit_id, "finding_id": out.finding_id,
                        "is_internal": out.is_internal, "notified": len(targets)})
    return out


# ── Recommendation tracking: overdue findings across the tenant's audits ─────

class OverdueFindingOut(BaseModel):
    id: str; audit_id: str; audit_title: str; title: str
    severity: str; status: str; due_date: str | None
    remediation_owner_id: str | None; recommendation: str | None

@router.get("/findings/overdue", response_model=list[OverdueFindingOut])
async def overdue_findings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Open/in-remediation findings whose due_date has passed (ISO dates compare lexically)."""
    today = _utcnow().date().isoformat()
    q = (
        select(AuditFinding, Audit.title)
        .join(Audit, AuditFinding.audit_id == Audit.id)
        .where(
            Audit.tenant_id == tenant_id,
            Audit.deleted_at.is_(None),
            AuditFinding.due_date.is_not(None),
            AuditFinding.due_date != "",
            AuditFinding.due_date < today,
            AuditFinding.status.in_([FindingStatus.OPEN, FindingStatus.IN_REMEDIATION]),
        )
        .order_by(AuditFinding.due_date.asc())
    )
    visible = await _visible_audit_ids(db, user, tenant_id)
    if visible is not None:
        if not visible:
            return []
        q = q.where(Audit.id.in_(list(visible)))
    out = []
    for f, audit_title in (await db.execute(q)).all():
        out.append(OverdueFindingOut(
            id=f.id, audit_id=f.audit_id, audit_title=audit_title, title=f.title,
            severity=_enum_value(f.severity),
            status=_enum_value(f.status),
            due_date=f.due_date, remediation_owner_id=f.remediation_owner_id,
            recommendation=f.recommendation,
        ))
    return out
