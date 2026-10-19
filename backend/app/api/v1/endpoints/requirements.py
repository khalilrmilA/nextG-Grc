"""Centralised requirements referential — STB objectif 1, « référentiel centralisé ».

The tender asks for *one* referential of « normes, réglementations, lois et
politiques internes », each line « classée par source, domaine, type et
applicabilité ». The platform holds all of that, but in four unrelated silos:

    framework_controls      the 4 537 lines of the 95 built-in/forked frameworks
    policies                the internal policy register
    governance_documents    the governance repository (chartes, plans, PV)
    regulatory_updates      the regulatory watch

A bank had to open four menus to answer « montrez-moi votre référentiel ». This
module is the missing read model: a single union over the four tables projected
onto one shape, so the whole referential is one list, one search box and one set
of filters.

Design notes
------------
* **Read-only.** Nothing here writes. Each silo keeps its own CRUD and its own
  ownership rules; duplicating them would create a second source of truth, which
  is the opposite of what « centralisé » means. Applicability is *decided*
  through ``PUT /frameworks/{fw}/controls/{id}/applicability`` and only *read*
  here.
* **Filtered and paginated in SQL.** The union is wrapped in a subquery and the
  filters, COUNT and LIMIT/OFFSET are applied to it. Pulling 4 537 controls into
  Python to slice them would make the page unusable on the live database and
  would give a wrong ``total``.
* **Classification falls back.** ``frameworks.source_type`` and
  ``framework_controls.domain``/``requirement_type`` are the new controlled
  columns and are still NULL on every live row until the backfill scripts run.
  Every projection therefore COALESCEs onto something meaningful today
  (``category`` lower-cased for the domain, ``norme``/``exigence`` for the type),
  so the referential is populated now and gets *more* precise — never different
  — once the backfill lands.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import (
    String, Text, and_, case, cast, func, literal, null, or_, select, union_all,
)
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select
from sqlalchemy.sql.selectable import Subquery

from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
# The document read ACL is governance.py's; importing its role set rather than
# restating it is what keeps the register and the repository in agreement.
# One-directional — governance.py does not import this module.
from app.api.v1.endpoints.governance import _DOCUMENT_ELEVATED_ROLES
from app.core.database import get_db
from app.services.content_translation import get_display_language, localize_fields
from app.models.control_applicability import APPLICABILITY_VALUES, ControlApplicability
from app.models.framework import Framework, FrameworkControl
from app.models.governance import GovernanceDocument, GovernanceDocumentAccess
from app.models.policy import Policy, PolicyStatus
from app.models.regulatory_update import RegulatoryUpdate, UpdateStatus
from app.models.tenant import Tenant
from app.models.user import User

router = APIRouter()

# The four silos the tender's sentence enumerates, in the order a compliance
# officer reads them.
SOURCE_KINDS = ("framework_control", "policy", "governance_document", "regulatory_update")

# Same controlled vocabulary as frameworks.source_type (see the migration).
SOURCE_TYPES = ("norme", "reglementation", "loi", "politique_interne")

# Same controlled vocabulary as framework_controls.requirement_type.
REQUIREMENT_TYPES = ("exigence", "recommandation", "mesure")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class RequirementOut(BaseModel):
    """One line of the referential, whichever table it came from."""

    source_kind: str                 # which silo — see SOURCE_KINDS
    source_id: str                   # the row's own id, for deep-linking
    ref_code: str | None             # "A.8.1", a policy number, or nothing
    title: str
    description: str | None
    source_name: str | None          # ISO27001 / Politique interne / BCT ...
    source_type: str | None          # norme | reglementation | loi | politique_interne
    domain: str | None
    requirement_type: str | None     # exigence | recommandation | mesure
    applicability: str | None        # applicable | not_applicable | partially_applicable
    status: str | None               # the silo's own lifecycle status, when it has one
    framework_id: str | None
    created_at: datetime | None
    # Machine translation of a framework requirement / feed regulatory item for
    # display (content_translations). Stored text in original_*.
    translated: bool = False
    translation_official: bool = False
    original_title: str | None = None
    original_description: str | None = None
    model_config = {"from_attributes": True}


class RequirementListOut(BaseModel):
    items: list[RequirementOut]
    total: int
    limit: int
    offset: int


class FacetBucket(BaseModel):
    value: str | None
    count: int


class RequirementFacetsOut(BaseModel):
    """Counts per classification axis, for the filter sidebar."""

    total: int
    by_source_kind: list[FacetBucket]
    by_source_type: list[FacetBucket]
    by_domain: list[FacetBucket]
    by_requirement_type: list[FacetBucket]
    by_applicability: list[FacetBucket]


class LinkedPolicyOut(BaseModel):
    id: str
    title: str
    policy_number: str | None
    category: str | None
    status: str
    owner_id: str | None
    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Union construction
# ---------------------------------------------------------------------------
def _like(term: str) -> str:
    """Escape a user search term for LIKE, so '%' and '_' are literal."""
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


# control_applicability is one of the tables create_all() provisions at the next
# backend start. Cached once it is seen: the table can only appear at startup, and
# this module is on the hot path of the register page.
_APPLICABILITY_TABLE_READY: bool = False


async def _applicability_table_ready(db: AsyncSession) -> bool:
    """Whether ``control_applicability`` physically exists on this deployment.

    The union LEFT JOINs that table. On a backend that has not restarted since the
    table was added, the join makes the whole query — and therefore the entire
    referential page — answer 500, and a 5xx ejects the SPA to /service-down
    instead of showing an error. frameworks.py and compliance.py answer 424 on
    their dedicated applicability routes for the same reason; here the honest
    degradation is different: the referential itself is not unavailable, only the
    applicability column is, so the branch drops the join and every framework line
    reads as the default « applicable » — exactly what the COALESCE returns once
    the table exists and is empty.

    CALLER CONTRACT: the recovery is ``db.rollback()`` (a failed statement aborts
    the transaction on PostgreSQL), and a rollback EXPIRES every ORM instance in
    the session, ``get_current_user``'s User included. It is therefore probed
    first, before anything else in the request reads or writes.
    """
    global _APPLICABILITY_TABLE_READY
    if _APPLICABILITY_TABLE_READY:
        return True
    try:
        await db.execute(select(ControlApplicability.control_id).limit(1))
    except (OperationalError, ProgrammingError):
        await db.rollback()
        return False
    _APPLICABILITY_TABLE_READY = True
    return True


async def _framework_ids_in_scope(
    db: AsyncSession, tenant_id: str, scope: str
) -> tuple[list[str] | None, bool]:
    """Which frameworks feed the referential.

    Returns ``(explicit_ids, include_all_builtin)``. ``scope='selected'`` (the
    default) restricts built-ins to the ones the tenant actually adopted —
    otherwise a Tunisian bank's referential opens on 4 537 lines of 95 standards
    it never chose. ``scope='all'`` is the catalogue view.

    A tenant that has selected nothing yet falls back to the whole catalogue
    rather than to an empty screen, which would read as data loss.
    """
    if scope == "all":
        return None, True
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    selected = {fid for fid in (tenant.selected_framework_ids or []) if fid} if tenant else set()
    if tenant and tenant.primary_framework_id:
        selected.add(tenant.primary_framework_id)
    if not selected:
        return None, True
    return sorted(selected), False


def _branch_framework_controls(
    tenant_id: str,
    explicit_ids: list[str] | None,
    include_all_builtin: bool,
    with_applicability: bool = True,
) -> Select:
    """Framework controls — the bulk of the referential.

    The LEFT JOIN onto control_applicability is what makes « applicabilité » a
    property of the requirement rather than a verdict buried in one assessment.
    Only the organisation-wide decision (both perimeter columns NULL) is joined;
    a per-processus decision is a narrower statement and belongs to the
    assessment that carries that perimeter, not to the global list.

    ``with_applicability=False`` builds the same branch without that join, for a
    deployment where the table does not exist yet — see
    _applicability_table_ready. The projected column keeps its name and its
    default value, so the shape of the union, the filters and the facets are
    identical either way.
    """
    applicability_col = (
        func.coalesce(ControlApplicability.applicability, literal("applicable"))
        if with_applicability
        else literal("applicable")
    ).label("applicability")
    stmt = (
        select(
            literal("framework_control").label("source_kind"),
            FrameworkControl.id.label("source_id"),
            FrameworkControl.control_id.label("ref_code"),
            FrameworkControl.title.label("title"),
            FrameworkControl.description.label("description"),
            Framework.short_name.label("source_name"),
            # NULL until scripts/ backfills source_type; a framework is a
            # standard unless stated otherwise, which is true for 88 of 95.
            func.coalesce(Framework.source_type, literal("norme")).label("source_type"),
            # `category` is uncontrolled free text with case variants
            # (organizational 1819 / ORGANIZATIONAL 56) — lower-casing merges
            # them into one bucket until `domain` is backfilled.
            func.coalesce(FrameworkControl.domain, func.lower(FrameworkControl.category)).label("domain"),
            func.coalesce(FrameworkControl.requirement_type, literal("exigence")).label("requirement_type"),
            applicability_col,
            cast(null(), String).label("status"),
            Framework.id.label("framework_id"),
            FrameworkControl.created_at.label("created_at"),
        )
        .select_from(FrameworkControl)
        .join(Framework, Framework.id == FrameworkControl.framework_id)
    )
    if with_applicability:
        stmt = stmt.outerjoin(
            ControlApplicability,
            and_(
                ControlApplicability.control_id == FrameworkControl.id,
                ControlApplicability.tenant_id == tenant_id,
                ControlApplicability.org_entity_id.is_(None),
                ControlApplicability.business_process_id.is_(None),
            ),
        )
    # A tenant always sees its own forks; built-ins are shared and scoped by the
    # `scope` argument.
    if include_all_builtin:
        return stmt.where(
            or_(Framework.tenant_id == tenant_id, Framework.is_builtin == True)  # noqa: E712
        )
    return stmt.where(
        or_(Framework.tenant_id == tenant_id, Framework.id.in_(explicit_ids or []))
    )


def _branch_policies(tenant_id: str) -> Select:
    """Internal policies — « politiques internes applicables à l'organisation »."""
    return select(
        literal("policy").label("source_kind"),
        Policy.id.label("source_id"),
        Policy.policy_number.label("ref_code"),
        Policy.title.label("title"),
        Policy.description.label("description"),
        literal("Politique interne").label("source_name"),
        literal("politique_interne").label("source_type"),
        Policy.category.label("domain"),
        # A published internal policy states obligations; the
        # recommandation/mesure half of the vocabulary only ever applies to
        # framework lines.
        literal("exigence").label("requirement_type"),
        # A retired policy is still part of the referential's history but no
        # longer binds anyone — the honest applicability for it.
        case((Policy.status == PolicyStatus.RETIRED, literal("not_applicable")),
             else_=literal("applicable")).label("applicability"),
        # TEXT, not VARCHAR: `status` is a SQLAlchemy Enum, which becomes a NATIVE
        # enum type on PostgreSQL, and PostgreSQL refuses CAST(<enum> AS VARCHAR)
        # while accepting CAST(... AS TEXT). SQLite treats the two identically, so
        # this costs nothing here and keeps the referential working on the
        # PostgreSQL deployment .env.dev targets.
        cast(Policy.status, Text).label("status"),
        cast(null(), String).label("framework_id"),
        Policy.created_at.label("created_at"),
    ).where(Policy.tenant_id == tenant_id)


def _branch_governance_documents(
    tenant_id: str, user_id: str, user_role: str, is_elevated: bool
) -> Select:
    """Governance repository — chartes, règlements intérieurs, plans.

    Carries the SAME read ACL as ``GET /governance/documents``. That listing hides
    a document whose per-document grants do not admit the caller
    (governance.py's ``_passes_document_grants``); the referential unions the table
    directly, so without this clause a document restricted to three named people
    would still have its *title* announced to every member of the tenant on the
    register page — the register would quietly undo the restriction the repository
    enforces.

    The clause is the SQL transcription of that helper, precedence included: an
    elevated governance role passes, the owner passes, a document with no grants at
    all stays tenant-wide readable (the pre-ACL baseline every existing document
    relies on), and otherwise a grant naming the user or their role is required.
    With no grants anywhere — the state of every live tenant today — ``NOT EXISTS``
    is true for every row and the result set is identical to before.
    """
    grants = select(GovernanceDocumentAccess.id).where(
        GovernanceDocumentAccess.tenant_id == tenant_id,
        GovernanceDocumentAccess.document_id == GovernanceDocument.id,
    )
    if is_elevated:
        readable = literal(True)
    else:
        readable = or_(
            GovernanceDocument.created_by_id == user_id,
            ~grants.exists(),
            grants.where(
                or_(
                    GovernanceDocumentAccess.user_id == user_id,
                    GovernanceDocumentAccess.role == user_role,
                )
            ).exists(),
        )
    return select(
        literal("governance_document").label("source_kind"),
        GovernanceDocument.id.label("source_id"),
        cast(null(), String).label("ref_code"),
        GovernanceDocument.title.label("title"),
        # `content` is the whole document body; a list must not carry it.
        cast(null(), Text).label("description"),
        literal("Référentiel documentaire").label("source_name"),
        case(
            (GovernanceDocument.typology == "regulation", literal("reglementation")),
            (GovernanceDocument.typology == "law", literal("loi")),
            else_=literal("politique_interne"),
        ).label("source_type"),
        func.coalesce(GovernanceDocument.module, GovernanceDocument.typology).label("domain"),
        literal("exigence").label("requirement_type"),
        literal("applicable").label("applicability"),
        cast(null(), String).label("status"),
        cast(null(), String).label("framework_id"),
        GovernanceDocument.created_at.label("created_at"),
    ).where(GovernanceDocument.tenant_id == tenant_id, readable)


def _branch_regulatory_updates(tenant_id: str) -> Select:
    """Regulatory watch — « lois et réglementations » as they land."""
    return select(
        literal("regulatory_update").label("source_kind"),
        RegulatoryUpdate.id.label("source_id"),
        cast(null(), String).label("ref_code"),
        RegulatoryUpdate.title.label("title"),
        RegulatoryUpdate.description.label("description"),
        func.coalesce(RegulatoryUpdate.regulation_name, RegulatoryUpdate.source).label("source_name"),
        literal("reglementation").label("source_type"),
        RegulatoryUpdate.source.label("domain"),
        literal("exigence").label("requirement_type"),
        # The watch has its own "not applicable to us" verdict; surfacing it as
        # applicability is what lets one filter span all four silos.
        case((RegulatoryUpdate.status == UpdateStatus.NOT_APPLICABLE, literal("not_applicable")),
             else_=literal("applicable")).label("applicability"),
        cast(RegulatoryUpdate.status, Text).label("status"),   # TEXT: see _branch_policies
        cast(null(), String).label("framework_id"),
        RegulatoryUpdate.created_at.label("created_at"),
    ).where(RegulatoryUpdate.tenant_id == tenant_id)


async def _filtered_subquery(
    db: AsyncSession,
    tenant_id: str,
    current_user: User,
    *,
    source_kind: str | None,
    source_type: str | None,
    domain: str | None,
    requirement_type: str | None,
    applicability: str | None,
    framework_id: str | None,
    search: str | None,
    scope: str,
) -> Subquery:
    """The whole referential, narrowed — entirely inside SQL."""
    # Read off the caller BEFORE the probe below, into plain scalars. The probe's
    # recovery is a rollback, which expires every ORM instance in the session —
    # `current_user` included — so touching an attribute of it afterwards is a lazy
    # load outside the greenlet: MissingGreenlet, a 500, and the SPA ejected to
    # /service-down on exactly the deployment the probe exists to protect.
    user_id = current_user.id
    user_role = getattr(current_user.role, "value", current_user.role)
    user_is_elevated = current_user.role in _DOCUMENT_ELEVATED_ROLES

    # Probed BEFORE anything else touches the session: the recovery from a missing
    # table is a rollback, which expires every ORM instance already loaded.
    with_applicability = await _applicability_table_ready(db)
    explicit_ids, include_all_builtin = await _framework_ids_in_scope(db, tenant_id, scope)

    # Skipping a whole branch is both the cheapest possible `source_kind` filter
    # and the clearest.
    wanted = {source_kind} if source_kind else set(SOURCE_KINDS)
    branches: list[Select] = []
    if "framework_control" in wanted:
        branches.append(_branch_framework_controls(
            tenant_id, explicit_ids, include_all_builtin, with_applicability
        ))
    if "policy" in wanted:
        branches.append(_branch_policies(tenant_id))
    if "governance_document" in wanted:
        branches.append(_branch_governance_documents(
            tenant_id, user_id, user_role, user_is_elevated
        ))
    if "regulatory_update" in wanted:
        branches.append(_branch_regulatory_updates(tenant_id))
    if not branches:
        # An unknown source_kind: return an empty, correctly-shaped result set
        # rather than a 400 — this is a filter, not a command.
        branches.append(_branch_policies(tenant_id).where(literal(False)))

    # union_all, not union: the branches are disjoint by construction (each
    # carries its own source_kind), so de-duplication would only buy a sort.
    sub = union_all(*branches).subquery("requirements")

    stmt = select(sub)
    # Every classification filter is matched case-insensitively on both sides, as
    # `domain` already was: the backfill scripts write a value for display
    # ("Norme"), a client sends the slug it read off a facet ("norme"), and the
    # two have to select the same rows.
    if source_type:
        stmt = stmt.where(func.lower(sub.c.source_type) == source_type.strip().lower())
    if domain:
        stmt = stmt.where(func.lower(sub.c.domain) == domain.strip().lower())
    if requirement_type:
        stmt = stmt.where(func.lower(sub.c.requirement_type) == requirement_type.strip().lower())
    if applicability:
        stmt = stmt.where(func.lower(sub.c.applicability) == applicability.strip().lower())
    if framework_id:
        stmt = stmt.where(sub.c.framework_id == framework_id)
    if search and search.strip():
        pattern = _like(search.strip())
        stmt = stmt.where(
            or_(
                sub.c.title.ilike(pattern, escape="\\"),
                sub.c.ref_code.ilike(pattern, escape="\\"),
                sub.c.source_name.ilike(pattern, escape="\\"),
            )
        )
    return stmt.subquery("filtered_requirements")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("", response_model=RequirementListOut)
async def list_requirements(
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    source_kind: str | None = Query(None, description="|".join(SOURCE_KINDS)),
    source_type: str | None = Query(None, description="|".join(SOURCE_TYPES)),
    domain: str | None = None,
    requirement_type: str | None = Query(None, description="|".join(REQUIREMENT_TYPES)),
    applicability: str | None = Query(None, description="|".join(APPLICABILITY_VALUES)),
    framework_id: str | None = None,
    search: str | None = None,
    scope: str = Query("selected", pattern="^(selected|all)$"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    lang: str = Depends(get_display_language),
):
    """The whole referential as one list — every source, one shape, one filter set.

    Readable by any authenticated member of the tenant: this is the compliance
    catalogue, not privileged data, and every write path stays in its own module.
    """
    filtered = await _filtered_subquery(
        db, tenant_id, current_user,
        source_kind=source_kind, source_type=source_type, domain=domain,
        requirement_type=requirement_type, applicability=applicability,
        framework_id=framework_id, search=search, scope=scope,
    )
    total = (await db.execute(select(func.count()).select_from(filtered))).scalar() or 0
    rows = (await db.execute(
        select(filtered)
        # Deterministic across pages — without the trailing ids two rows with
        # the same title could swap between page 1 and page 2.
        .order_by(
            filtered.c.source_kind,
            filtered.c.source_name,
            filtered.c.ref_code,
            filtered.c.title,
            filtered.c.source_id,
        )
        .limit(limit)
        .offset(offset)
    )).all()
    items = [RequirementOut.model_validate(dict(r._mapping)) for r in rows]
    # Only platform/feed text ever has a cached translation (built-in requirements,
    # feed regulatory items); policies and governance documents are tenant-authored.
    await localize_fields(db, lang, [
        (it, {"title": it.title, "description": it.description or ""})
        for it in items if it.source_kind in ("framework_control", "regulatory_update")])
    return RequirementListOut(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


async def _facet(db: AsyncSession, filtered: Subquery, column) -> list[FacetBucket]:
    """One bucket per distinct value, counted the way the list filter selects.

    Grouped case-INSENSITIVELY because every filter in _filtered_subquery compares
    ``func.lower()`` on both sides. Grouping on the raw value split one vocabulary
    across two buckets whenever two silos spelled it differently — the corpus
    holds a `POLICY` domain on 31 framework controls while a governance document
    types itself `policy` — and clicking either of those buckets then returned 32
    rows against a chip that promised 31 or 1. The label shown is ``min()`` of the
    variants, so the bucket still reads as a real value rather than a slug.
    """
    key = func.lower(column)
    rows = (await db.execute(
        select(func.min(column), func.count().label("n")).select_from(filtered)
        .group_by(key).order_by(func.count().desc())
    )).all()
    return [FacetBucket(value=r[0], count=r[1]) for r in rows]


@router.get("/facets", response_model=RequirementFacetsOut)
async def requirement_facets(
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    source_kind: str | None = None,
    source_type: str | None = None,
    domain: str | None = None,
    requirement_type: str | None = None,
    applicability: str | None = None,
    framework_id: str | None = None,
    search: str | None = None,
    scope: str = Query("selected", pattern="^(selected|all)$"),
):
    """Counts per classification axis for the same query the list runs.

    Every filter is applied to every facet (rather than the usual "all filters
    except this one" refinement), so a bucket count always matches the list you
    get by clicking it. The domain list is the source of truth for the domain
    dropdown — the vocabulary is data, not a hard-coded frontend constant.
    """
    filtered = await _filtered_subquery(
        db, tenant_id, current_user,
        source_kind=source_kind, source_type=source_type, domain=domain,
        requirement_type=requirement_type, applicability=applicability,
        framework_id=framework_id, search=search, scope=scope,
    )
    total = (await db.execute(select(func.count()).select_from(filtered))).scalar() or 0
    return RequirementFacetsOut(
        total=total,
        by_source_kind=await _facet(db, filtered, filtered.c.source_kind),
        by_source_type=await _facet(db, filtered, filtered.c.source_type),
        by_domain=await _facet(db, filtered, filtered.c.domain),
        by_requirement_type=await _facet(db, filtered, filtered.c.requirement_type),
        by_applicability=await _facet(db, filtered, filtered.c.applicability),
    )


@router.get("/controls/{control_id}/policies", response_model=list[LinkedPolicyOut])
async def policies_for_control(
    control_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """The internal policies that claim to satisfy one framework control.

    ``Policy.linked_controls`` is a JSON array of FrameworkControl ids. There is no
    JSON-containment operator portable across SQLite/PostgreSQL/Oracle/MSSQL, and
    the obvious prefilter — CAST(linked_controls AS VARCHAR) LIKE '%id%' — is a
    hard error on PostgreSQL, which is the deployment target this repo's own
    .env.dev points at. So membership is tested in Python over the tenant's own
    policies, exactly as policies.py's GET /policies/by-control already does: an
    organisation holds a handful of policies, the scan costs nothing, and the
    answer is exact rather than prefix-matched.
    """
    candidates = (await db.execute(
        select(Policy).where(Policy.tenant_id == tenant_id)
    )).scalars().all()
    return [
        LinkedPolicyOut(
            id=p.id, title=p.title, policy_number=p.policy_number,
            category=p.category,
            status=p.status.value if hasattr(p.status, "value") else str(p.status),
            owner_id=p.owner_id,
        )
        for p in candidates
        if control_id in (p.linked_controls or [])
    ]
