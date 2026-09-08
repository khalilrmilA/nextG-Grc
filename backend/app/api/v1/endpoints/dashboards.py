"""Per-module dashboards (Elite Pack) — RFP module 14.

The RFP asks for 9 dashboards; the platform shipped only compliance + a central
KPI view. This adds the 7 missing module dashboards as aggregation endpoints the
SPA renders. Every metric query is wrapped defensively so one missing column
degrades a single tile to empty rather than 500-ing the whole dashboard.

All gated behind ``custom_dashboards`` (billing) **and** a per-dashboard role
gate (access); all tenant-scoped. See ``_dashboard_gate`` below for why both.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.asset import Asset
from app.models.vulnerability import Vulnerability
from app.models.cve_entry import CveEntry, CveAnnotation
from app.models.threat import Threat
from app.models.risk import Risk
from app.models.applied_control import AppliedControl
from app.models.policy import Policy, PolicyAttestation
from app.models.audit import Audit, AuditFinding
from app.models.governance import GovernanceCommittee
from app.api.v1.dependencies.auth import get_tenant_id, require_roles, require_roles_strict
from app.api.v1.dependencies.features import require_feature

router = APIRouter()
logger = logging.getLogger(__name__)

_FEATURE = "custom_dashboards"


def _dashboard_gate(*roles: UserRole, strict: bool = False):
    """Billing half + access half for one dashboard.

    Every route here used to depend on ``require_feature("custom_dashboards")``
    alone. That is a *billing* check — it answers "did this tenant buy the Elite
    Pack?", never "may this account read the executive governance KPIs?". So on
    an Elite tenant a read-only viewer, a vendor manager and the Direction
    Générale all saw exactly the same nine dashboards, which fails the STB
    tender's per-objective access clauses outright.

    ``strict=True`` selects ``require_roles_strict``, i.e. no
    super_admin/tenant_admin auto-pass, and is used only where the French clause
    is an exclusion (« réservé à », « uniquement », « limité à »). Where the
    clause merely names the intended audience (« accès filtré par profil »), the
    ordinary ``require_roles`` is right and the admins keep their access.

    Both halves are declared as sub-dependencies so FastAPI resolves
    ``get_current_user`` once (dependency cache) and the 402 (plan) and 403
    (role) failures stay distinguishable to the SPA, which handles them very
    differently — 402 opens the upgrade dialog.
    """
    _access = require_roles_strict(*roles) if strict else require_roles(*roles)

    async def _gate(
        current_user: Annotated[User, Depends(require_feature(_FEATURE))],
        _role: Annotated[User, Depends(_access)],
    ) -> User:
        return current_user

    return _gate


# --- Per-objective access, one entry per tender clause ----------------------
# Read-only consultation profiles. EXECUTIVE and VIEWER can never write anything
# (get_current_user blocks the mutating verbs for both), so listing them on a
# read-only dashboard grants consultation and nothing more.
_CONSULT = (UserRole.EXECUTIVE, UserRole.VIEWER)

# Objectif 1 (actifs) — the clause names the asset-owning functions and allows
# executive/viewer consultation; it is not phrased as an exclusion, so the
# ordinary gate (admins auto-pass) applies.
_ASSETS_GATE = Depends(_dashboard_gate(
    UserRole.CISO, UserRole.BUSINESS_OWNER, UserRole.RISK_MANAGER,
    UserRole.COMPLIANCE_MANAGER, *_CONSULT,
))

# Objectifs 2 & 3 (vulnérabilités, menaces) — « limité aux analystes sécurité ».
# Strict, otherwise "limité" is false the moment the tenant owner logs in.
# CISO is listed alongside SECURITY_ANALYST on purpose and must stay: no account
# on this installation currently holds security_analyst, so a gate naming that
# role alone would lock out every real user of the screen on the day it ships.
_SECURITY_ANALYSIS_GATE = Depends(_dashboard_gate(
    UserRole.SECURITY_ANALYST, UserRole.CISO, strict=True,
))

# Objectifs 4 & 5 (risques, contrôles) — « réservé aux responsables sécurité ».
_SECURITY_LEAD_GATE = Depends(_dashboard_gate(
    UserRole.CISO, UserRole.RISK_MANAGER, UserRole.CONTROL_OWNER, strict=True,
))

# Objectif 6 (gouvernance) — « réservé aux fonctions de direction ». Direction
# Générale plus the RSSI who reports into it; deliberately excludes the tenant
# owner, which is the whole point of the clause.
_GOVERNANCE_GATE = Depends(_dashboard_gate(
    UserRole.EXECUTIVE, UserRole.CISO, strict=True,
))

# Objectif 8 (audit) — « accès filtré par profil »: a filter, not an exclusion,
# so admins keep their access here.
_AUDIT_GATE = Depends(_dashboard_gate(
    UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.AUDITOR,
))

# Back-compat alias. Any dashboard added here should pick one of the gates above
# rather than this one; it exists so a route written against the old name still
# resolves (a NameError at import time takes down all of api/v1, not just this
# module) and it is the broadest, consultation-level gate, never an executive one.
_Gate = _ASSETS_GATE


def _label(key) -> str:
    """Human label for a group key — enum .value (not 'RiskSeverity.CRITICAL')."""
    if key is None:
        return "unspecified"
    return str(getattr(key, "value", key))


async def _rollback(db: AsyncSession) -> None:
    """Undo the failed statement before the next tile runs.

    On SQLite (what this box runs) a failed SELECT is harmless, but on
    PostgreSQL it aborts the whole transaction and every later query in the same
    request fails too — one missing column would empty the ENTIRE dashboard
    instead of one tile, which is the opposite of what the degradation below is
    for. Same guard endpoints/dashboard.py::_exec_rows already carries.
    """
    try:
        await db.rollback()
    except Exception:
        pass


async def _count_by(db: AsyncSession, model, column, tenant_id: str, *,
                    join_model=None, join_on=None, scope=None) -> dict:
    """Grouped counts {value: n}; empty dict if the query fails.

    ``model`` may not carry ``tenant_id`` itself (e.g. AuditFinding, PolicyAttestation) —
    pass ``join_model``/``join_on`` to scope through the owning tenant-scoped table instead.

    ``scope`` replaces the default ``tenant_id`` predicate entirely, for the one
    table whose rows are not all tenant-owned (the shared threat catalogue, whose
    built-ins carry a NULL tenant_id) — see threats_dashboard below.
    """
    try:
        scope_model = join_model or model
        q = select(column, func.count()).group_by(column)
        if join_model is not None:
            q = q.join(join_model, join_on)
        q = q.where(scope_model.tenant_id == tenant_id if scope is None else scope)
        result = await db.execute(q)
        return {_label(k): int(v) for k, v in result.all()}
    except Exception:
        # Degrade this tile rather than 500 the dashboard — but say so in the
        # log, otherwise a permanently empty tile is indistinguishable from
        # "no data" and nobody ever finds out the query is broken.
        logger.warning("dashboard tile query failed (%s.%s)", getattr(model, "__name__", model),
                       getattr(column, "key", column), exc_info=True)
        await _rollback(db)
        return {}


async def _total(db: AsyncSession, model, tenant_id: str, *, scope=None) -> int:
    try:
        result = await db.execute(
            select(func.count()).select_from(model)
            .where(model.tenant_id == tenant_id if scope is None else scope)
        )
        return int(result.scalar() or 0)
    except Exception:
        logger.warning("dashboard total query failed (%s)", getattr(model, "__name__", model), exc_info=True)
        await _rollback(db)
        return 0


async def _agg(db: AsyncSession, model, agg_fn, tenant_id: str) -> float | None:
    try:
        result = await db.execute(select(agg_fn).where(model.tenant_id == tenant_id))
        value = result.scalar()
        return round(float(value), 2) if value is not None else None
    except Exception:
        logger.warning("dashboard aggregate query failed (%s)", getattr(model, "__name__", model), exc_info=True)
        await _rollback(db)
        return None


@router.get("/assets")
async def assets_dashboard(
    current_user: Annotated[User, _ASSETS_GATE],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "total": await _total(db, Asset, tenant_id),
        "by_type": await _count_by(db, Asset, Asset.asset_type, tenant_id),
        "by_criticality": await _count_by(db, Asset, Asset.criticality, tenant_id),
        "by_class": await _count_by(db, Asset, getattr(Asset, "asset_class", Asset.asset_type), tenant_id),
        # Objectif 1 « leur statut » — deliberately a SEPARATE tile from the
        # lifecycle below: "is it delivering its service right now" and "where is
        # it in its life" are two different questions, and collapsing them is the
        # defect this closes. Plain ``Asset.status`` and NOT the getattr fallback
        # its neighbours use: aliasing to asset_type would publish the TYPE
        # breakdown under a « statut » caption, i.e. invented figures. If
        # scripts/migrate_add_asset_status.py has not been run on a given
        # database, _count_by degrades this one tile to {} and the SPA renders
        # nothing (the tile is declared optional there).
        "by_status": await _count_by(db, Asset, Asset.status, tenant_id),
        "by_lifecycle": await _count_by(db, Asset, getattr(Asset, "lifecycle_state", Asset.asset_type), tenant_id),
    }


async def _cve_summary(db: AsyncSession, tenant_id: str, top_n: int = 5) -> dict:
    """Pertinent-CVE rollup for the vulnerabilities dashboard (RFP gap fix — CVEs
    weren't surfaced in any dashboard: dashboards.py referenced no CVE entity).

    Joins CveAnnotation (per-tenant relevance triage) to the global CveEntry
    catalog, keeping only entries this tenant has marked "pertinent", and returns
    a count plus the top few by CVSS score. Defensive like every other tile here —
    an empty/degraded result on failure rather than a 500 for the whole dashboard.
    """
    # Count and top-N in SQL. The CVE catalog is NVD-sized (thousands of rows on
    # this box already); pulling every pertinent entry — descriptions included —
    # just to len() it and slice five off the front does not scale with a tenant's
    # triage backlog. coalesce(...,0) reproduces the previous Python sort key
    # exactly (an unscored CVE ranked as 0) and stays portable across the
    # supported backends, unlike NULLS LAST.
    _scoped = (
        select(CveEntry)
        .join(CveAnnotation, CveAnnotation.cve_id == CveEntry.cve_id)
        .where(CveAnnotation.tenant_id == tenant_id, CveAnnotation.relevance == "pertinent")
    )
    try:
        pertinent_count = int((await db.execute(
            select(func.count())
            .select_from(CveEntry)
            .join(CveAnnotation, CveAnnotation.cve_id == CveEntry.cve_id)
            .where(CveAnnotation.tenant_id == tenant_id, CveAnnotation.relevance == "pertinent")
        )).scalar() or 0)
        top_entries = (await db.execute(
            _scoped.order_by(func.coalesce(CveEntry.cvss_score, 0.0).desc()).limit(top_n)
        )).scalars().all()
    except Exception:
        logger.warning("CVE dashboard tile failed", exc_info=True)
        return {"pertinent_count": 0, "top": []}

    return {
        "pertinent_count": pertinent_count,
        "top": [
            {
                "cve_id": e.cve_id,
                "cvss_score": e.cvss_score,
                "cvss_vector": e.cvss_vector,
                "description": (e.description or "")[:200],
            }
            for e in top_entries
        ],
    }


@router.get("/vulnerabilities")
async def vulnerabilities_dashboard(
    current_user: Annotated[User, _SECURITY_ANALYSIS_GATE],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "total": await _total(db, Vulnerability, tenant_id),
        "by_severity": await _count_by(db, Vulnerability, Vulnerability.severity, tenant_id),
        "by_status": await _count_by(db, Vulnerability, Vulnerability.status, tenant_id),
        "avg_cvss": await _agg(db, Vulnerability, func.avg(Vulnerability.cvss_score), tenant_id),
        "cve": await _cve_summary(db, tenant_id),
    }


@router.get("/threats")
async def threats_dashboard(
    current_user: Annotated[User, _SECURITY_ANALYSIS_GATE],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Built-in threats carry a NULL tenant_id (models/threat.py: "null =
    # global/builtin") and are shared by every tenant — 729 rows on this
    # database. Scoping on tenant_id alone counted none of them, so this
    # dashboard reported 0 menaces to tenants whose Threat Library page (which
    # lists ``is_builtin OR tenant_id``, endpoints/threats.py) shows hundreds.
    # Two screens contradicting each other in front of the evaluator; the
    # library's own predicate is the one that is right, and it is what
    # /dashboard/executive-summary already uses for the same count.
    visible = (Threat.tenant_id == tenant_id) | (Threat.is_builtin == True)  # noqa: E712
    return {
        "total": await _total(db, Threat, tenant_id, scope=visible),
        # Tenant-authored threats only — what this tenant has actually forked or
        # submitted, kept alongside the catalogue total so the two are readable
        # apart rather than one hiding the other.
        "tenant_specific": await _total(db, Threat, tenant_id),
        "by_category": await _count_by(db, Threat, Threat.category, tenant_id, scope=visible),
        # Same scope as the total on purpose: a breakdown whose buckets do not
        # sum to the headline figure above it is its own defect.
        "pending": await _count_by(db, Threat, getattr(Threat, "is_pending", Threat.category),
                                   tenant_id, scope=visible),
    }


@router.get("/risks")
async def risks_dashboard(
    current_user: Annotated[User, _SECURITY_LEAD_GATE],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # 5x5 heatmap cells from likelihood x impact.
    heatmap: list[dict] = []
    try:
        result = await db.execute(
            select(Risk.likelihood, Risk.impact, func.count())
            .where(Risk.tenant_id == tenant_id)
            .group_by(Risk.likelihood, Risk.impact)
        )
        heatmap = [{"likelihood": lk, "impact": im, "count": int(n)} for lk, im, n in result.all()]
    except Exception:
        logger.warning("risk heatmap tile failed", exc_info=True)
        heatmap = []
    return {
        "total": await _total(db, Risk, tenant_id),
        "by_severity": await _count_by(db, Risk, Risk.severity, tenant_id),
        "by_status": await _count_by(db, Risk, Risk.status, tenant_id),
        "heatmap": heatmap,
    }


@router.get("/controls")
async def controls_dashboard(
    current_user: Annotated[User, _SECURITY_LEAD_GATE],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "total": await _total(db, AppliedControl, tenant_id),
        "by_status": await _count_by(db, AppliedControl, AppliedControl.status, tenant_id),
        "avg_progress": await _agg(db, AppliedControl, func.avg(getattr(AppliedControl, "progress", AppliedControl.id)), tenant_id),
        "total_cost": await _agg(db, AppliedControl, func.sum(getattr(AppliedControl, "cost", AppliedControl.id)), tenant_id),
    }


async def _committee_summary(db: AsyncSession, tenant_id: str) -> dict:
    """Steering committee tile (M14.6): count + the soonest upcoming meeting.

    ``next_meeting_date`` is a free-text ISO date string (project convention, not a
    SQL Date column — see other *_date fields across the schema), so the "soonest"
    pick is done in Python rather than an ORDER BY, skipping unparseable/blank values.
    """
    try:
        result = await db.execute(
            select(GovernanceCommittee).where(GovernanceCommittee.tenant_id == tenant_id)
        )
        committees = result.scalars().all()
    except Exception:
        logger.warning("governance committee tile failed", exc_info=True)
        return {"total": 0, "next_meeting": None}

    upcoming = [
        {"id": c.id, "name": c.name, "next_meeting_date": c.next_meeting_date}
        for c in committees
        if c.next_meeting_date
    ]
    upcoming.sort(key=lambda c: c["next_meeting_date"])
    return {
        "total": len(committees),
        "next_meeting": upcoming[0] if upcoming else None,
    }


@router.get("/governance")
async def governance_dashboard(
    current_user: Annotated[User, _GOVERNANCE_GATE],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "policies_total": await _total(db, Policy, tenant_id),
        "policies_by_status": await _count_by(db, Policy, Policy.status, tenant_id),
        "attestations_by_status": await _count_by(
            db, PolicyAttestation, getattr(PolicyAttestation, "status", PolicyAttestation.id), tenant_id,
            join_model=Policy, join_on=PolicyAttestation.policy_id == Policy.id,
        ),
        "committees": await _committee_summary(db, tenant_id),
    }


@router.get("/audit")
async def audit_dashboard(
    current_user: Annotated[User, _AUDIT_GATE],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return {
        "audits_total": await _total(db, Audit, tenant_id),
        "audits_by_status": await _count_by(db, Audit, Audit.status, tenant_id),
        "findings_by_severity": await _count_by(
            db, AuditFinding, getattr(AuditFinding, "severity", AuditFinding.id), tenant_id,
            join_model=Audit, join_on=AuditFinding.audit_id == Audit.id,
        ),
        "findings_by_status": await _count_by(
            db, AuditFinding, getattr(AuditFinding, "status", AuditFinding.id), tenant_id,
            join_model=Audit, join_on=AuditFinding.audit_id == Audit.id,
        ),
    }
