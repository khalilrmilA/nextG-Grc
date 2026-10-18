"""Risk management endpoints."""
import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import String, cast, select, func
from pydantic import BaseModel
from typing import Any

from app.core.database import get_db
from app.models.risk import Risk, RiskStatus, RiskSeverity, RiskTreatment
from app.models.risk_treatment_version import RiskTreatmentVersion
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add
from app.models.risk_scenario import RiskScenario
from app.models.subscription import Subscription
from app.models.notification import NotificationType
from app.models.user import UserRole
from app.api.v1.dependencies import get_current_user, require_roles, get_tenant_id, PaginationParams
from app.models.user import User
from app.services import risk_scoring, residual_risk, risk_versioning
from app.models.risk_version import RiskVersion
from app.models.applied_control import AppliedControl
from app.models.org_unit import OrgEntity, BusinessProcess
from app.services.notification_generator import create_notification, get_recipients_for_tenant, notification_exists
from app.services import perimeter
from app.services.authz import get_effective_roles
from app.services.ai_locale import get_request_language
from app.api.v1.endpoints.activity_log import log_activity

router = APIRouter()

_RISK_NOT_FOUND = "Risk not found"


def _is_super_admin(user: User) -> bool:
    role = getattr(user, "role", None)
    return str(getattr(role, "value", role)).lower() == "super_admin"


async def _assert_feature(db: AsyncSession, tenant_id: str, user: User, flag: str) -> None:
    """Raise 402 (Elite upsell) unless the tenant's plan unlocks `flag`. Super admins
    and users individually granted the Elite Pack bypass."""
    if _is_super_admin(user) or getattr(user, "elite_access", False):
        return
    sub = (await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))).scalar_one_or_none()
    if not sub or not sub.has_feature(flag):
        raise HTTPException(
            status_code=402,
            detail={"error": "feature_not_in_plan", "feature": flag, "pack": "elite",
                    "message": "This capability requires the Elite Pack."},
        )


async def _apply_scoring(db: AsyncSession, tenant_id: str, risk: Risk) -> tuple[dict, str]:
    """Resolve the tenant's matrix and set risk.severity from it.

    Severity reflects the residual (post-control) position when residual scores are
    present, otherwise the inherent position — so the register shows the *current*
    risk level. Returns (definition, matrix_name) for response enrichment.
    """
    definition, name = await risk_scoring.resolve_matrix(db, tenant_id, getattr(risk, "risk_matrix_id", None))
    if risk.residual_likelihood and risk.residual_impact:
        risk.severity = risk_scoring.severity_for(definition, risk.residual_likelihood, risk.residual_impact)
    else:
        risk.severity = risk_scoring.severity_for(definition, risk.likelihood, risk.impact)
    return definition, name


async def _alert_over_appetite(db: AsyncSession, risk: Risk) -> int:
    """Notify risk owners/CISO that a risk's residual score exceeds its appetite threshold."""
    score = risk.residual_risk_score if risk.residual_risk_score is not None else risk.inherent_risk_score
    created = 0
    recipients = await get_recipients_for_tenant(db, risk.tenant_id)
    for user in recipients:
        if await notification_exists(db, user.id, NotificationType.RISK_OVER_APPETITE, risk.id, within_days=7):
            continue
        # STB: a Tunisian bank cannot be sent English sentences. The client
        # renders title_key/message_key with params; the stored strings stay as
        # the fallback and as the e-mail body.
        await create_notification(
            db, user=user, notif_type=NotificationType.RISK_OVER_APPETITE,
            title=f"Risk over appetite: {risk.title[:50]}",
            message=(f"Risk '{risk.title}' has a residual score of {score} which exceeds "
                     f"the appetite threshold of {risk.appetite_threshold}. Treatment is required."),
            entity_id=risk.id, entity_type="risk",
            link=f"/risks?highlight={risk.id}", severity="critical",
            title_key="notifications.risk_over_appetite.title",
            message_key="notifications.risk_over_appetite.message",
            params={"risk": risk.title, "score": score,
                    "threshold": risk.appetite_threshold},
        )
        created += 1
    return created


async def _alert_target_over_appetite(db: AsyncSession, risk: Risk) -> int:
    """RFP rule: a treatment plan's TARGET (post-treatment) score must also clear
    appetite — a residual score can look fine today while the planned end-state
    still breaches it. Distinct notification type/message from the residual alert
    so the two don't get conflated."""
    created = 0
    recipients = await get_recipients_for_tenant(db, risk.tenant_id)
    for user in recipients:
        if await notification_exists(db, user.id, NotificationType.RISK_TARGET_OVER_APPETITE, risk.id, within_days=7):
            continue
        await create_notification(
            db, user=user, notif_type=NotificationType.RISK_TARGET_OVER_APPETITE,
            title=f"Target risk still over appetite: {risk.title[:50]}",
            message=(f"Risk '{risk.title}' has a TARGET score of {risk.target_risk_score} which still "
                     f"exceeds the appetite threshold of {risk.appetite_threshold} even after the planned "
                     f"treatment. The treatment plan may need to be strengthened."),
            entity_id=risk.id, entity_type="risk",
            link=f"/risks?highlight={risk.id}", severity="high",
            title_key="notifications.risk_target_over_appetite.title",
            message_key="notifications.risk_target_over_appetite.message",
            params={"risk": risk.title, "target_score": risk.target_risk_score,
                    "threshold": risk.appetite_threshold},
        )
        created += 1
    return created


class RiskCreate(BaseModel):
    title: str
    description: str | None = None
    risk_category: str | None = None
    owner_id: str | None = None
    likelihood: float | None = None  # 1-5
    impact: float | None = None      # 1-5
    residual_likelihood: float | None = None
    residual_impact: float | None = None
    target_likelihood: float | None = None
    target_impact: float | None = None
    risk_matrix_id: str | None = None
    # Initial workflow status picked in the create form. None keeps the model
    # default; `closed` is refused — closing goes through PATCH and its reopen rules.
    status: RiskStatus | None = None
    tags: list[str] = []
    linked_controls: list[str] = []
    linked_assets: list[str] = []
    next_review_date: str | None = None
    # STB gap 19.d — département / processus porteur
    org_entity_id: str | None = None
    business_process_id: str | None = None


class RiskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    risk_category: str | None = None
    owner_id: str | None = None
    status: RiskStatus | None = None
    likelihood: float | None = None
    impact: float | None = None
    residual_likelihood: float | None = None
    residual_impact: float | None = None
    target_likelihood: float | None = None
    target_impact: float | None = None
    risk_matrix_id: str | None = None
    severity: RiskSeverity | None = None
    tags: list[str] | None = None
    linked_controls: list[str] | None = None
    next_review_date: str | None = None
    appetite_threshold: float | None = None
    # RFP rule: required when `status` transitions FROM closed to anything else.
    reopen_reason: str | None = None
    org_entity_id: str | None = None
    business_process_id: str | None = None


# Optional on a risk, so an edit may empty them (title / likelihood / impact /
# status / category are not: a risk without them is not assessable).
_CLEARABLE_RISK_FIELDS = (
    "description", "owner_id", "residual_likelihood", "residual_impact",
    "target_likelihood", "target_impact", "next_review_date", "appetite_threshold",
    "org_entity_id", "business_process_id",
)


class RiskResponse(BaseModel):
    id: str
    tenant_id: str
    title: str
    description: str | None
    risk_category: str | None
    owner_id: str | None
    status: RiskStatus
    likelihood: float | None
    impact: float | None
    inherent_risk_score: float | None
    inherent_level: str | None = None
    residual_likelihood: float | None
    residual_impact: float | None
    residual_risk_score: float | None
    residual_level: str | None = None
    target_likelihood: float | None = None
    target_impact: float | None = None
    target_risk_score: float | None = None
    target_level: str | None = None
    risk_matrix_id: str | None = None
    matrix_name: str | None = None
    severity: RiskSeverity | None
    appetite_threshold: float | None = None
    over_appetite: bool | None = None
    # The planned target still breaches appetite — the SPA shows a badge and blocks
    # target validation on it, but the field was never returned.
    target_over_appetite: bool | None = None
    tags: list
    linked_controls: list
    linked_assets: list
    next_review_date: str | None
    last_reviewed_at: str | None
    reopen_reason: str | None = None
    target_validated_at: str | None = None
    target_calculation_notes: str | None = None
    org_entity_id: str | None = None
    business_process_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


def _enrich(risk: Risk, definition: dict, matrix_name: str) -> RiskResponse:
    """Build a RiskResponse with matrix-derived qualitative levels for each tier."""
    _, inh_level = risk_scoring.score_and_level(definition, risk.likelihood, risk.impact)
    _, res_level = risk_scoring.score_and_level(definition, risk.residual_likelihood, risk.residual_impact)
    _, tgt_level = risk_scoring.score_and_level(definition, risk.target_likelihood, risk.target_impact)
    return RiskResponse(
        id=risk.id, tenant_id=risk.tenant_id, title=risk.title, description=risk.description,
        risk_category=risk.risk_category, owner_id=risk.owner_id, status=risk.status,
        likelihood=risk.likelihood, impact=risk.impact,
        inherent_risk_score=risk.inherent_risk_score, inherent_level=inh_level,
        residual_likelihood=risk.residual_likelihood, residual_impact=risk.residual_impact,
        residual_risk_score=risk.residual_risk_score, residual_level=res_level,
        target_likelihood=risk.target_likelihood, target_impact=risk.target_impact,
        target_risk_score=risk.target_risk_score, target_level=tgt_level,
        risk_matrix_id=getattr(risk, "risk_matrix_id", None), matrix_name=matrix_name,
        severity=risk.severity, appetite_threshold=risk.appetite_threshold, over_appetite=risk.over_appetite,
        target_over_appetite=risk.target_over_appetite,
        tags=risk.tags or [], linked_controls=risk.linked_controls or [], linked_assets=risk.linked_assets or [],
        next_review_date=risk.next_review_date, last_reviewed_at=risk.last_reviewed_at,
        reopen_reason=risk.reopen_reason,
        target_validated_at=risk.target_validated_at,
        target_calculation_notes=risk.target_calculation_notes,
        # Declared on RiskResponse but never filled, so every risk read back with
        # no département / processus and the edit form could not pre-fill them.
        org_entity_id=risk.org_entity_id, business_process_id=risk.business_process_id,
        created_at=risk.created_at, updated_at=risk.updated_at,
    )


class PaginatedRisks(BaseModel):
    items: list[RiskResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


@router.get("", response_model=PaginatedRisks)
async def list_risks(
    pagination: PaginationParams = Depends(),
    status_filter: RiskStatus | None = Query(None, alias="status"),
    severity: RiskSeverity | None = None,
    # STB gap 19.d — « les risques de la DSI », « les risques du processus Crédit »
    org_entity_id: str | None = Query(None),
    business_process_id: str | None = Query(None),
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List all risks for the tenant with optional filtering."""
    query = select(Risk).where(Risk.tenant_id == tenant_id)

    if status_filter:
        query = query.where(Risk.status == status_filter)
    if severity:
        query = query.where(Risk.severity == severity)
    if org_entity_id:
        query = query.where(Risk.org_entity_id == org_entity_id)
    if business_process_id:
        query = query.where(Risk.business_process_id == business_process_id)

    # Count
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar_one()

    # Paginate
    query = query.offset(pagination.offset).limit(pagination.limit).order_by(Risk.created_at.desc())
    result = await db.execute(query)
    risks = result.scalars().all()

    definition, matrix_name = await risk_scoring.resolve_matrix(db, tenant_id)
    return PaginatedRisks(
        items=[_enrich(r, definition, matrix_name) for r in risks],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
        total_pages=(total + pagination.page_size - 1) // pagination.page_size,
    )


async def _assert_scope_in_tenant(db: AsyncSession, tenant_id: str, org_entity_id, business_process_id) -> None:
    """Refuse a département or processus belonging to another organisation.

    Without this the caller could attach one tenant's risk to another tenant's
    org entity — the id would then leak through every filtered listing that
    joins on it. Same rule compliance.py applies to an assessment's scope.
    """
    if org_entity_id:
        r = await db.execute(
            select(OrgEntity.id).where(OrgEntity.id == org_entity_id, OrgEntity.tenant_id == tenant_id)
        )
        if r.scalar_one_or_none() is None:
            raise HTTPException(status_code=422, detail="org_entity_id does not belong to this organisation")
    if business_process_id:
        r = await db.execute(
            select(BusinessProcess.id).where(
                BusinessProcess.id == business_process_id, BusinessProcess.tenant_id == tenant_id
            )
        )
        if r.scalar_one_or_none() is None:
            raise HTTPException(status_code=422, detail="business_process_id does not belong to this organisation")


@router.post("", response_model=RiskResponse, status_code=status.HTTP_201_CREATED)
async def create_risk(
    body: RiskCreate,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(
        UserRole.CISO, UserRole.RISK_MANAGER
    )),
):
    if body.status == RiskStatus.CLOSED:
        raise HTTPException(
            status_code=422,
            detail="A risk cannot be created as closed. Create it, then close it.",
        )
    await _assert_scope_in_tenant(db, tenant_id, body.org_entity_id, body.business_process_id)
    data = body.model_dump()
    # Risk(status=None) would write NULL instead of letting the column default apply.
    if data.get("status") is None:
        data.pop("status", None)
    risk = Risk(tenant_id=tenant_id, **data)
    definition, matrix_name = await _apply_scoring(db, tenant_id, risk)
    db.add(risk)
    await db.flush()
    # Commit before returning. get_db() commits at teardown, but that runs AFTER
    # ActivityLogMiddleware, which opens its own connection to write the audit
    # entry — so leaving the write uncommitted here holds SQLite's single write
    # lock while the middleware waits for it, and the request hangs.
    await db.commit()
    await db.refresh(risk)
    return _enrich(risk, definition, matrix_name)


@router.get("/{risk_id}", response_model=RiskResponse)
async def get_risk(
    risk_id: str,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)
    definition, matrix_name = await risk_scoring.resolve_matrix(db, tenant_id, risk.risk_matrix_id)
    return _enrich(risk, definition, matrix_name)


@router.patch("/{risk_id}", response_model=RiskResponse)
async def update_risk(
    risk_id: str,
    body: RiskUpdate,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(
        UserRole.CISO, UserRole.RISK_MANAGER, UserRole.BUSINESS_OWNER)),
    # The perimeter refusal below is one of the few 403s the SPA renders
    # verbatim, so it has to answer in the caller's language.
    lang: str = Depends(get_request_language),
):
    result = await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)

    # A perimeter-scoped role may only act on what it owns. Reading stays
    # tenant-wide — see app/services/perimeter.py for why that asymmetry.
    perimeter.assert_in_perimeter(
        current_user, risk, await get_effective_roles(current_user, db), what="risk",
        lang=lang)

    provided = body.model_dump(exclude_none=True)
    # Follow-up D: optional fields can be CLEARED — an explicit null (or "") in the
    # body empties the field; an omitted field is still left untouched.
    for f in _CLEARABLE_RISK_FIELDS:
        if f in body.model_fields_set and getattr(body, f) in (None, ""):
            provided[f] = None
    await _assert_scope_in_tenant(
        db, tenant_id, provided.get("org_entity_id"), provided.get("business_process_id")
    )
    # Risk appetite is an Elite Pack capability — gate the write.
    if "appetite_threshold" in provided:
        await _assert_feature(db, tenant_id, current_user, "risk_appetite")

    # RFP rule: reopening a closed risk requires an explicit justification. Guard
    # the transition FROM closed to any other status before anything is mutated.
    new_status = provided.get("status")
    if risk.status == RiskStatus.CLOSED and new_status is not None and new_status != RiskStatus.CLOSED:
        if not (body.reopen_reason and body.reopen_reason.strip()):
            raise HTTPException(
                status_code=422,
                detail="Reopening a closed risk requires a justification (reopen_reason).",
            )

    # Archive the state this edit starts from, before anything is mutated, and
    # mark it as a lifecycle transition when the status is what moved. The
    # reopen justification the rule demands is carried here — it used to be
    # validated and then discarded, so the one place a reason is mandatory kept
    # none.
    old_status = getattr(risk.status, "value", risk.status)
    moving = new_status is not None and new_status != risk.status
    await risk_versioning.archive(
        db, risk, current_user,
        change_reason=(body.reopen_reason.strip() if getattr(body, "reopen_reason", None)
                       else getattr(body, "change_reason", None)),
        transition_from=old_status if moving else None,
        transition_to=(getattr(new_status, "value", new_status) if moving else None),
    )

    was_over = risk.over_appetite
    was_target_over = risk.target_over_appetite
    for field, value in provided.items():
        setattr(risk, field, value)

    # Recompute severity from the matrix unless it was set explicitly.
    if "severity" not in provided:
        await _apply_scoring(db, tenant_id, risk)

    # Immediate alert when a risk newly breaches its appetite.
    if risk.over_appetite and not was_over:
        await _alert_over_appetite(db, risk)
    # Distinct alert when the planned TARGET score still breaches appetite.
    if risk.target_over_appetite and not was_target_over:
        await _alert_target_over_appetite(db, risk)

    definition, matrix_name = await risk_scoring.resolve_matrix(db, tenant_id, risk.risk_matrix_id)
    # Closing and reopening are lifecycle decisions, not field edits: record them
    # as such. The middleware alone logs every PATCH as a plain "update".
    # log_activity commits the session (hash chain), which also commits the edit.
    if moving and RiskStatus.CLOSED.value in (old_status, getattr(new_status, "value", new_status)):
        closing = getattr(new_status, "value", new_status) == RiskStatus.CLOSED.value
        await log_activity(
            db, tenant_id, current_user, "close" if closing else "reopen", "risk",
            entity_id=risk.id, entity_name=risk.title,
            details={"from": old_status, "to": getattr(new_status, "value", new_status),
                     **({} if closing else {"reason": (body.reopen_reason or "").strip()})},
        )
    # Commit before returning. get_db() would commit at teardown, but that runs
    # AFTER ActivityLogMiddleware, which opens its own connection to write the
    # audit entry — so an uncommitted write here leaves this session holding
    # SQLite's single write lock while the middleware waits for it. The request
    # then hangs until the busy timeout instead of returning.
    await db.commit()
    # Reload server-computed columns (updated_at onupdate) in async context so the
    # sync _enrich never triggers a lazy refresh (MissingGreenlet).
    await db.refresh(risk)
    return _enrich(risk, definition, matrix_name)


@router.delete("/{risk_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_risk(
    risk_id: str,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
):
    result = await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)

    # A closed or formally accepted risk records a decision somebody took, and a
    # scenario's linked register entry is one half of a chain — neither is a
    # draft to be removed. There is no deleted_at column on risks to soft-delete
    # into, so refusing is the honest answer rather than destroying the trail.
    # Anything still open deletes exactly as before.
    current_status = getattr(risk.status, "value", risk.status)
    if current_status in (RiskStatus.CLOSED.value, RiskStatus.ACCEPTED.value):
        raise HTTPException(
            status_code=409,
            detail=(f"A risk in status '{current_status}' records a decision that was taken and "
                    "cannot be deleted. Reopen it first if it was created in error."),
        )
    consolidated_from = (await db.execute(
        select(func.count()).select_from(RiskScenario).where(
            RiskScenario.tenant_id == tenant_id, RiskScenario.linked_risk_id == risk_id
        )
    )).scalar() or 0
    if consolidated_from:
        raise HTTPException(
            status_code=409,
            detail=("This risk is the register entry consolidated from a risk scenario. Delete "
                    "the scenario instead — removing the risk alone would leave it pointing at "
                    "a row that no longer exists."),
        )

    # Snapshot the fields the chain will record BEFORE anything commits, so the
    # entry describes the row as it stood on entry to this handler regardless of
    # what the writes below do to the instance.
    risk_title = risk.title
    risk_payload = {
        "title": risk.title,
        "description": risk.description,
        "risk_category": risk.risk_category,
        "status": current_status,
        "severity": getattr(risk.severity, "value", risk.severity),
        "owner_id": risk.owner_id,
        "likelihood": risk.likelihood, "impact": risk.impact,
        "residual_likelihood": risk.residual_likelihood,
        "residual_impact": risk.residual_impact,
        "target_likelihood": risk.target_likelihood,
        "target_impact": risk.target_impact,
        "appetite_threshold": risk.appetite_threshold,
        "org_entity_id": risk.org_entity_id,
        "business_process_id": risk.business_process_id,
        "linked_controls": list(risk.linked_controls or []),
        "linked_assets": list(risk.linked_assets or []),
        "next_review_date": risk.next_review_date,
        "last_reviewed_at": risk.last_reviewed_at,
        "reopen_reason": risk.reopen_reason,
        "tags": list(risk.tags or []),
    }

    # A treatment plan and its superseded versions hang off risk_id with no
    # database-level cascade (SQLite runs with foreign_keys off). Left behind
    # they become unreachable rather than harmless: list_treatments joins Risk,
    # and GET /risk-treatment/{risk_id}/versions resolves the parent risk first,
    # so both the live plan and its history 404 forever while the rows — cost,
    # justification, responsible, deadlines — stay in the table. Record the
    # decision in the tamper-evident chain, then remove them with the risk.
    treatment = (await db.execute(
        select(RiskTreatment).where(RiskTreatment.risk_id == risk_id)
    )).scalar_one_or_none()
    versions: list[RiskTreatmentVersion] = []
    if treatment is not None:
        versions = list((await db.execute(
            select(RiskTreatmentVersion)
            .where(RiskTreatmentVersion.risk_id == risk_id)
            .order_by(RiskTreatmentVersion.version_number.desc())
        )).scalars().all())
        try:
            await chain_and_add(db, ActivityLog(
                tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
                action="delete", entity_type="risk_treatment", entity_id=treatment.id,
                entity_name=risk_title,
                details={"deleted_with_risk": risk_id, "plan": {
                    "treatment_option": getattr(treatment.treatment_option, "value",
                                                treatment.treatment_option),
                    "description": treatment.description,
                    "acceptance_justification": treatment.acceptance_justification,
                    "delay_justification": treatment.delay_justification,
                    "transfer_to": treatment.transfer_to,
                    "owner_id": treatment.owner_id,
                    "due_date": treatment.due_date,
                    "start_date": treatment.start_date,
                    "progress_percentage": treatment.progress_percentage,
                    "estimated_cost": treatment.estimated_cost,
                    "actual_cost": treatment.actual_cost,
                    "priority": treatment.priority,
                    "complexity": treatment.complexity,
                    "linked_scenario_ids": list(treatment.linked_scenario_ids or []),
                },
                # Snapshots are already-archived states of the same small row;
                # the chain keeps their identity and reason, not every field.
                "archived_versions": [
                    {"version_number": v.version_number,
                     "change_summary": v.change_summary,
                     "created_by_id": v.created_by_id}
                    for v in versions
                ]},
                origin="api",
            ))
        except Exception:
            # Same log-and-continue posture incidents.py uses: a chain failure
            # must not strand the delete half-done.
            pass
        for v in versions:
            await db.delete(v)
        await db.delete(treatment)

    # The register entry itself is the record of fact here, and it was the one
    # hard-delete in this group still leaving nothing behind but the middleware's
    # {method, path}: incidents, vulnerabilities, assets and governance documents
    # all chain their final state before the row goes. Same log-and-continue
    # posture — an audit failure must not strand the delete half-done.
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id, user_id=current_user.id, user_email=current_user.email,
            action="delete", entity_type="risk", entity_id=risk_id, entity_name=risk_title,
            details={"deleted": risk_payload, "had_treatment_plan": treatment is not None},
            origin="api",
        ))
    except Exception:
        pass

    await db.delete(risk)
    # Commit before returning. get_db() commits at teardown, but that runs AFTER
    # ActivityLogMiddleware, which opens its own connection to write the audit
    # entry — so leaving the write uncommitted here holds SQLite's single write
    # lock while the middleware waits for it, and the request hangs.
    await db.commit()


class RiskVersionOut(BaseModel):
    id: str
    risk_id: str
    version_number: int
    snapshot: dict
    risk_title: str | None = None
    transition_from: str | None = None
    transition_to: str | None = None
    change_reason: str | None = None
    author_id: str | None = None
    author_email: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class RiskDiffCell(BaseModel):
    field: str
    from_value: object | None = None
    to_value: object | None = None


@router.get("/{risk_id}/versions", response_model=list[RiskVersionOut])
async def list_risk_versions(
    risk_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Every archived state of this risk, newest first — read-only.

    Nothing in the API updates or deletes a version, which is what "accessibles
    uniquement en lecture seule" means in practice. Scoped on the version rows
    rather than by loading the risk first, so the history of a deleted risk
    remains readable.
    """
    rows = (await db.execute(
        select(RiskVersion)
        .where(RiskVersion.tenant_id == tenant_id, RiskVersion.risk_id == risk_id)
        .order_by(RiskVersion.version_number.desc())
    )).scalars().all()
    return [RiskVersionOut.model_validate(r) for r in rows]


@router.get("/{risk_id}/lifecycle", response_model=list[RiskVersionOut])
async def risk_lifecycle(
    risk_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Just the lifecycle moves, oldest first: who moved this risk, when, why.

    A separate view from the full history because "when was this closed and by
    whom" should not mean reading every field diff.
    """
    rows = (await db.execute(
        select(RiskVersion)
        .where(RiskVersion.tenant_id == tenant_id, RiskVersion.risk_id == risk_id,
               RiskVersion.transition_to.isnot(None))
        .order_by(RiskVersion.version_number.asc())
    )).scalars().all()
    return [RiskVersionOut.model_validate(r) for r in rows]


@router.get("/{risk_id}/versions/diff", response_model=list[RiskDiffCell])
async def diff_risk_versions(
    risk_id: str,
    from_version: int,
    to_version: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """What changed between two archived states — impact, probability, status.

    ``to_version`` may be 0, meaning the risk as it stands now, so the most
    common question ("what has changed since we assessed it?") does not require
    creating a version first.
    """
    async def _load(n: int) -> dict:
        if n == 0:
            risk = (await db.execute(
                select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
            )).scalar_one_or_none()
            if risk is None:
                raise HTTPException(status_code=404, detail="Risk not found")
            return risk_versioning.snapshot(risk)
        row = (await db.execute(
            select(RiskVersion).where(
                RiskVersion.tenant_id == tenant_id,
                RiskVersion.risk_id == risk_id,
                RiskVersion.version_number == n,
            )
        )).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Version {n} not found")
        return row.snapshot or {}

    before, after = await _load(from_version), await _load(to_version)
    return [
        RiskDiffCell(field=f, from_value=c["from"], to_value=c["to"])
        for f, c in risk_versioning.diff(before, after).items()
    ]


@router.get("/heatmap/data")
async def get_risk_heatmap(
    view: str = Query("current", pattern="^(inherent|residual|current)$"),
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return risk data for a heat map, driven by the tenant's active risk matrix.

    view=inherent buckets by inherent likelihood/impact, view=residual by residual,
    view=current (default) uses residual where present else inherent.
    """
    definition, matrix_name = await risk_scoring.resolve_matrix(db, tenant_id)
    result = await db.execute(select(Risk).where(Risk.tenant_id == tenant_id))
    risks = result.scalars().all()

    grid: dict[str, list[dict]] = {}
    plotted = 0
    for risk in risks:
        if view == "inherent":
            likelihood, impact = risk.likelihood, risk.impact
        elif view == "residual":
            likelihood, impact = risk.residual_likelihood, risk.residual_impact
        else:  # current
            likelihood = risk.residual_likelihood or risk.likelihood
            impact = risk.residual_impact or risk.impact
        if not likelihood or not impact:
            continue
        key = f"{int(likelihood)},{int(impact)}"
        grid.setdefault(key, []).append({"id": risk.id, "title": risk.title, "severity": risk.severity})
        plotted += 1

    prob = definition.get("probability", {})
    imp = definition.get("impact", {})
    return {
        "grid": grid,
        "view": view,
        "matrix_name": matrix_name,
        "probability_count": prob.get("count", 5),
        "impact_count": imp.get("count", 5),
        "probability_labels": prob.get("labels", []),
        "impact_labels": imp.get("labels", []),
        "risk_levels": definition.get("risk_levels", []),
        "cells": definition.get("grid", []),
        "total_risks": plotted,
        "by_severity": {
            severity.value: sum(1 for r in risks if r.severity == severity)
            for severity in RiskSeverity
        },
    }


class AppetiteInput(BaseModel):
    appetite_threshold: float | None = None
    target_likelihood: float | None = None
    target_impact: float | None = None


@router.put("/{risk_id}/appetite", response_model=RiskResponse)
async def set_risk_appetite(
    risk_id: str,
    body: AppetiteInput,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(
        UserRole.CISO, UserRole.RISK_MANAGER, UserRole.BUSINESS_OWNER)),
    # The perimeter refusal below is one of the few 403s the SPA renders
    # verbatim, so it has to answer in the caller's language.
    lang: str = Depends(get_request_language),
):
    """Elite Pack: set a risk's appetite threshold + optional target tier; alert on new breach.

    require_feature only answers "is this in the plan" — it is a billing gate and
    grants no authority, so on its own it let any authenticated user rewrite the
    appetite threshold that PATCH /risks/{id} restricts to the risk roles. The
    plan check is kept (as _assert_feature, which raises the same 402), now
    behind the same role gate and perimeter rule the equivalent PATCH applies.
    """
    await _assert_feature(db, tenant_id, current_user, "risk_appetite")
    result = await db.execute(select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)

    # A perimeter-scoped role may only act on the risks it owns — same rule as
    # update_risk (see app/services/perimeter.py).
    perimeter.assert_in_perimeter(
        current_user, risk, await get_effective_roles(current_user, db), what="risk",
        lang=lang)

    # Archive the state this edit starts from, as update_risk does. Both fields
    # this route writes (appetite_threshold and the target tier) are in
    # SNAPSHOT_FIELDS, so changing them here used to leave no version behind
    # while changing the very same fields through PATCH did.
    await risk_versioning.archive(db, risk, current_user)

    was_over = risk.over_appetite
    was_target_over = risk.target_over_appetite
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(risk, field, value)
    definition, matrix_name = await _apply_scoring(db, tenant_id, risk)
    if risk.over_appetite and not was_over:
        await _alert_over_appetite(db, risk)
    if risk.target_over_appetite and not was_target_over:
        await _alert_target_over_appetite(db, risk)
    await db.flush()
    # See update_risk: commit before returning so the write lock is released
    # before ActivityLogMiddleware opens its own connection.
    await db.commit()
    # Reload server-computed columns (updated_at onupdate) before the sync _enrich.
    await db.refresh(risk)
    return _enrich(risk, definition, matrix_name)


class ValidateTargetInput(BaseModel):
    calculation_notes: str | None = None


@router.post("/{risk_id}/validate-target", response_model=RiskResponse)
async def validate_target(
    risk_id: str,
    body: ValidateTargetInput,
    tenant_id: str = Depends(get_tenant_id),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(
        UserRole.CISO, UserRole.RISK_MANAGER, UserRole.BUSINESS_OWNER)),
    # The perimeter refusal below is one of the few 403s the SPA renders
    # verbatim, so it has to answer in the caller's language.
    lang: str = Depends(get_request_language),
):
    """Elite Pack: final validation gate for a risk's treatment plan.

    The Propriétaire métier validates risks and treatment plans "sur son
    périmètre métier", so the role is granted here and then confined to the
    risks it owns — see the perimeter check below and app/services/perimeter.py.

    RFP rules covered:
    - "Utilisé comme critère de validation finale du plan de traitement" — the
      TARGET (post-treatment) score is the gate: this rejects (400) validating
      a plan whose planned end-state still breaches the appetite threshold, or
      whose appetite/target aren't even set yet (nothing to validate against).
    - "Traçabilité du calcul et des hypothèses prises en compte" — on success,
      stamps target_validated_at and persists the caller-supplied
      calculation_notes into target_calculation_notes for that trail.
    """
    await _assert_feature(db, tenant_id, current_user, "risk_appetite")
    result = await db.execute(select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail=_RISK_NOT_FOUND)

    # "Validation ... sur son périmètre métier": a business owner validates the
    # risks they own, not the organisation's.
    perimeter.assert_in_perimeter(
        current_user, risk, await get_effective_roles(current_user, db), what="risk",
        lang=lang)

    if risk.appetite_threshold is None:
        raise HTTPException(
            status_code=400,
            detail="Set an appetite threshold before validating the treatment target.",
        )
    if risk.target_risk_score is None:
        raise HTTPException(
            status_code=400,
            detail="Set a target likelihood and impact before validating the treatment target.",
        )
    if risk.target_over_appetite:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Target score {risk.target_risk_score} still exceeds the appetite threshold "
                f"of {risk.appetite_threshold}. Strengthen the treatment plan before validating."
            ),
        )

    risk.target_validated_at = datetime.utcnow().isoformat()
    risk.target_calculation_notes = body.calculation_notes

    definition, matrix_name = await risk_scoring.resolve_matrix(db, tenant_id, risk.risk_matrix_id)
    await db.flush()
    # See update_risk: committing here releases SQLite's write lock before
    # ActivityLogMiddleware opens its own connection for the audit entry.
    await db.commit()
    await db.refresh(risk)
    return _enrich(risk, definition, matrix_name)


# ── Risk Quantification ──────────────────────────────────────────────────

class RiskQuantInput(BaseModel):
    risk_id: str
    annual_loss_min: float  # Minimum expected annual loss ($)
    annual_loss_max: float  # Maximum expected annual loss ($)
    annual_loss_most_likely: float  # Most likely annual loss ($)
    probability_percent: float = 50.0  # Probability of occurrence (0-100)
    control_effectiveness: float = 50.0  # How effective existing controls are (0-100)

class RiskQuantResult(BaseModel):
    risk_id: str
    risk_title: str
    ale: float           # Annualized Loss Expectancy
    sle: float           # Single Loss Expectancy
    aro: float           # Annual Rate of Occurrence
    residual_ale: float  # ALE after controls
    risk_reduction: float
    p90: float           # 90th percentile
    p95: float           # 95th percentile
    simulations: int
    distribution: list[dict]


class ResidualSuggestion(BaseModel):
    """What the control evidence implies the residual risk should be."""
    risk_id: str
    inherent_score: float | None = None
    current_residual_score: float | None = None
    control_count: int = 0
    evaluated_count: int = 0
    effectiveness: float | None = None
    coverage: float | None = None
    mitigation: float | None = None
    suggested_residual_score: float | None = None
    controls: list = []


@router.get("/{risk_id}/residual-suggestion", response_model=ResidualSuggestion)
async def residual_suggestion(
    risk_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Residual risk implied by the effectiveness of the controls in place.

    The requirement names control effectiveness as an input to residual risk;
    residual likelihood and impact were entered by hand with no connection to
    the controls, so a risk whose every control evaluated non-performant kept
    whatever residual figure someone had typed.

    Returned as a suggestion with its workings, never written to the risk. The
    computed figure says what the evidence implies; the stored one is the
    assessor's judgement having seen the context. Overwriting the second with
    the first would erase a judgement and leave no record that they differed.
    """
    risk = (await db.execute(
        select(Risk).where(Risk.id == risk_id, Risk.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")

    # Controls attached to the risk directly, plus those attached to any
    # scenario consolidated into it — both are mitigations of this risk.
    control_ids: list[str] = []
    direct = (await db.execute(
        select(AppliedControl.id).where(
            AppliedControl.tenant_id == tenant_id,
            cast(AppliedControl.risk_ids, String).ilike(f'%"{risk_id}"%'),
        )
    )).all()
    control_ids.extend(r[0] for r in direct)

    scenarios = (await db.execute(
        select(RiskScenario).where(
            RiskScenario.tenant_id == tenant_id, RiskScenario.linked_risk_id == risk_id
        )
    )).scalars().all()
    for sc in scenarios:
        control_ids.extend(sc.applied_control_ids or [])

    result = await residual_risk.compute(
        db, tenant_id, list(dict.fromkeys(control_ids)), risk.inherent_risk_score
    )
    return ResidualSuggestion(
        risk_id=risk_id,
        current_residual_score=risk.residual_risk_score,
        **result,
    )


def _monte_carlo(
    loss_min: float, loss_max: float, loss_likely: float, aro: float, num_simulations: int
) -> tuple[float, float, float, list[dict]]:
    """The simulation itself: returns (ale, p90, p95, distribution).

    Pure CPU — 10 000 triangular draws plus a ten-bucket histogram over them.
    Kept out of the async handler and run through asyncio.to_thread: inline it
    blocks the event loop, and with two uvicorn workers one quantification
    stalls every other request that worker is serving until it finishes.
    """
    import random

    losses = []
    for _ in range(num_simulations):
        # Loss amount from a triangular (PERT approximation) distribution,
        # counted only in the years the risk actually occurs.
        loss = random.triangular(loss_min, loss_max, loss_likely)
        losses.append(loss if random.random() < aro else 0.0)

    losses.sort()
    ale = sum(losses) / num_simulations  # Average annual loss
    p90 = losses[int(num_simulations * 0.90)]
    p95 = losses[int(num_simulations * 0.95)]

    # Build histogram (10 buckets)
    if max(losses) > 0:
        bucket_size = max(losses) / 10
        distribution = []
        for i in range(10):
            lo = i * bucket_size
            hi = (i + 1) * bucket_size
            count = sum(1 for l in losses if lo <= l < hi)
            distribution.append({
                "range_min": round(lo, 2),
                "range_max": round(hi, 2),
                "count": count,
                "percentage": round(count / num_simulations * 100, 1),
            })
    else:
        distribution = [{"range_min": 0, "range_max": 0, "count": num_simulations, "percentage": 100}]
    return ale, p90, p95, distribution


@router.post("/quantify", response_model=RiskQuantResult)
async def quantify_risk(
    body: RiskQuantInput,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Run Monte Carlo simulation for financial risk quantification (Risk or Risk Scenario)."""
    # Try Risk first, then RiskScenario
    risk_result = await db.execute(select(Risk).where(Risk.id == body.risk_id, Risk.tenant_id == tenant_id))
    risk = risk_result.scalar_one_or_none()

    display_title: str = risk.title if risk else ""  # overwritten below if scenario
    if not risk:
        sc_result = await db.execute(select(RiskScenario).where(RiskScenario.id == body.risk_id, RiskScenario.tenant_id == tenant_id))
        scenario = sc_result.scalar_one_or_none()
        if not scenario:
            raise HTTPException(status_code=404, detail="Risk or Scenario not found")
        display_title = getattr(scenario, "name", None) or getattr(scenario, "title", None) or f"Scenario {scenario.id[:8]}"

    # Monte Carlo parameters
    num_simulations = 10000
    aro = body.probability_percent / 100.0  # Annual Rate of Occurrence
    control_eff = body.control_effectiveness / 100.0

    # The simulation runs off the event loop — see _monte_carlo.
    ale, p90, p95, distribution = await asyncio.to_thread(
        _monte_carlo, body.annual_loss_min, body.annual_loss_max,
        body.annual_loss_most_likely, aro, num_simulations,
    )
    sle = body.annual_loss_most_likely  # Single Loss Expectancy
    residual_ale = ale * (1 - control_eff)

    return RiskQuantResult(
        risk_id=body.risk_id,
        risk_title=display_title,
        ale=round(ale, 2),
        sle=round(sle, 2),
        aro=round(aro, 4),
        residual_ale=round(residual_ale, 2),
        risk_reduction=round(ale - residual_ale, 2),
        p90=round(p90, 2),
        p95=round(p95, 2),
        simulations=num_simulations,
        distribution=distribution,
    )
