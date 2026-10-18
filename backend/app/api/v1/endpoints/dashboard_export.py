"""Dashboard export — the nine module dashboards as an Excel or PDF artefact.

« Export PDF/Excel » / « Export possible » / « Export multiformats » appears in
seven of the RFP's nine dashboard objectives, and nothing exported a DASHBOARD:
``data_io.py`` exports a register (a flat list of rows from a different screen)
and ``reports.py`` renders five canned narrative PDFs. Neither produces the
numbers the reader is looking at on the dashboard.

Two rules shape this module.

1. **It never re-queries.** Each key resolves to the aggregation function the
   corresponding dashboard route already calls, and that function is invoked
   directly (see ``_resolve_source`` / ``_bind_kwargs``). Re-implementing the
   SQL here would guarantee the artefact drifts from the screen the day either
   side is edited — and the two sides are edited by different people.

2. **It never widens access.** An export of a dashboard the caller may not open
   is a bypass, not a feature, so the same billing gate (``custom_dashboards``)
   and the same role gate as the dashboard itself are applied before the
   aggregation runs — see ``_apply_role_gate``.

The tabular shape is deliberately uniform: ``section | metric | value | detail``.
A dashboard payload is a tree of counts, not a register, and one 4-column table
renders identically in Excel and in a landscape PDF for all nine dashboards
instead of nine bespoke layouts that each rot on their own schedule.

Everything the artefact says is written in the caller's language (``?lang=``,
falling back to Accept-Language), because "the export comes out in English
whatever the UI language" is one of the findings this closes.
"""
import asyncio
import inspect
import logging
import typing
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, params
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, ProgrammingError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.api.v1.dependencies.auth import (
    get_current_user, get_tenant_id, require_roles, require_roles_strict,
)
from app.api.v1.dependencies.features import require_feature
from app.services.ai_locale import get_request_language, normalize_language
from app.services.excel_export import rows_to_xlsx
from app.services.tabular_pdf import rows_to_pdf

# The aggregations. Imported as MODULES, never as individual functions, so the
# lookup below stays late-bound: dashboards.py belongs to another workstream and
# gains routes (compliance, executive) as that work lands.
from app.api.v1.endpoints import dashboard as central_dashboard
from app.api.v1.endpoints import dashboards as module_dashboards

router = APIRouter()
logger = logging.getLogger(__name__)

# Billing, exactly as on the dashboards themselves. ELITE_FEATURES describes
# custom_dashboards as "the full 9-dashboard set + export", so the export is
# part of that entitlement by design, not a second gate invented here.
#
# It stays declared on the routes even though the gate copied from dashboards.py
# checks the same feature again: it is what puts the 402 in the OpenAPI schema,
# and it is the ONLY billing check for the two keys whose route (in dashboard.py)
# carries no gate. The duplicate costs one subscription row read.
_Gate = Depends(require_feature("custom_dashboards"))

_EXPORT_FORMATS = ("xlsx", "pdf")
# "excel" is what a UI button says; accept it rather than 400-ing on a synonym.
_FORMAT_ALIASES = {"excel": "xlsx", "xls": "xlsx", "xlsx": "xlsx", "pdf": "pdf"}

DASHBOARD_KEYS = (
    "assets", "vulnerabilities", "threats", "risks", "controls",
    "governance", "audit", "compliance", "executive",
)

# Where an aggregation lives when dashboards.py does not (yet) own it.
# ``compliance`` and ``executive`` were never part of dashboards.py — the
# compliance posture per framework and the executive KPI roll-up have always
# been served by endpoints/dashboard.py, and those are the functions the SPA
# renders, so those are the functions this exports. If dashboards.py later
# grows ``compliance_dashboard`` / ``executive_dashboard``, _resolve_source
# picks them up automatically and this table stops being consulted for them.
#
# ``executive`` points at get_executive_summary, NOT at get_dashboard_summary:
# /dashboard/summary is the home screen and covers five of the tender's nine
# objectives, while /dashboard/executive-summary is the consolidated view
# objectif 9 asks for (« une vue consolidée ... Export PDF/Excel ») and is the
# one DashboardPage actually renders in its executive block. Exporting /summary
# under the title "Executive dashboard" produced an artefact with four of the
# nine objectives missing from it. It also means the export now inherits that
# route's OWN require_roles_strict(EXECUTIVE, CISO) gate through _route_gates
# instead of the hand-copied fallback entry below — same policy, one authority.
_FALLBACK_SOURCES: dict[str, tuple[Any, str]] = {
    "compliance": (central_dashboard, "get_frameworks_overview"),
    "executive": (central_dashboard, "get_executive_summary"),
}

# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------
# The authority on who may read a dashboard is the dashboard ROUTE, and this
# module reads that decision off the function it is about to call rather than
# restating it. dashboards.py attaches its gate to the route's ``current_user``
# parameter (``Annotated[User, _SECURITY_ANALYSIS_GATE]``); ``_route_gates``
# finds it, ``_resolve_dependency`` runs it. Nothing below lists which role may
# read which dashboard, which is the only arrangement in which the export and
# the screen cannot drift apart.
#
# Two mistakes this code exists to avoid:
#
#  * Calling the gate closure directly. Its own parameters are ``Depends``
#    markers, and outside FastAPI they are just values — ``_gate(user, user)``
#    returns the user having checked NOTHING. The dependency tree has to be
#    resolved by hand, which is what _resolve_dependency does.
#  * Continuing when a gate is found but cannot be evaluated. A refused export
#    is a support ticket; an unchecked one is exactly the bypass this lane
#    exists to close. Unevaluable ⇒ 424, never "allow".


# Parameter names that mean "the caller's tenant". Matched exactly rather than
# by substring: an optional ``tenant_filter=None`` on some future route is a
# query parameter, and silently forcing the caller's own tenant into it would
# change what the aggregation returns.
_TENANT_PARAM_NAMES = ("tenant_id", "tenant")


class _UnresolvableDependency(Exception):
    """A dependency this module cannot supply outside the FastAPI DI machinery."""


def _depends_marker(param: inspect.Parameter):
    """The ``Depends(...)`` attached to a parameter, if any.

    Both spellings are in use in this codebase: ``Annotated[User, Depends(x)]``
    (dashboards.py) and ``user: User = Depends(x)`` (dashboard.py).
    """
    if isinstance(param.default, params.Depends):
        return param.default
    ann = param.annotation
    if typing.get_origin(ann) is typing.Annotated:
        for meta in typing.get_args(ann)[1:]:
            if isinstance(meta, params.Depends):
                return meta
    return None


# Dependencies whose value this module already holds. Matched by IDENTITY, not
# by name — get_current_user in particular must never be recursed into: it wants
# an Authorization header, which does not exist on this side of the request.
def _known_dependency(dep, *, user: User, tenant_id: str, db: AsyncSession):
    if dep is get_current_user:
        return user
    if dep is get_db:
        return db
    if dep is get_tenant_id:
        return tenant_id
    raise KeyError(dep)


async def _resolve_dependency(dep, *, user: User, tenant_id: str, db: AsyncSession, depth: int = 0):
    """Run one FastAPI dependency (and its sub-dependencies) outside a request.

    A miniature of FastAPI's own resolver, deliberately covering only what a
    dashboard gate is built from: ``require_feature`` and ``require_roles`` /
    ``require_roles_strict`` closures over ``get_current_user`` + ``get_db``.
    Anything else raises _UnresolvableDependency and the caller refuses the
    export — a gate that is not understood is not a gate that is skipped.
    """
    if depth > 6:
        raise _UnresolvableDependency(f"dependency nesting too deep at {getattr(dep, '__name__', dep)}")
    try:
        return _known_dependency(dep, user=user, tenant_id=tenant_id, db=db)
    except KeyError:
        pass
    if not callable(dep):
        raise _UnresolvableDependency(f"{dep!r} is not callable")

    kwargs: dict[str, Any] = {}
    for name, param in inspect.signature(dep).parameters.items():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        marker = _depends_marker(param)
        if marker is not None and marker.dependency is not None:
            kwargs[name] = await _resolve_dependency(
                marker.dependency, user=user, tenant_id=tenant_id, db=db, depth=depth + 1)
            continue
        ann = _annotation_type(param)
        if isinstance(ann, type) and issubclass(ann, AsyncSession):
            kwargs[name] = db
        elif isinstance(ann, type) and issubclass(ann, User):
            kwargs[name] = user
        elif name in _TENANT_PARAM_NAMES:
            kwargs[name] = tenant_id
        elif param.default is not inspect.Parameter.empty:
            continue          # a plain optional (a query param) — leave its default
        else:
            raise _UnresolvableDependency(
                f"{getattr(dep, '__name__', dep)}({name}) cannot be supplied outside a request")

    result = dep(**kwargs)
    return await result if inspect.isawaitable(result) else result


# Dependencies that carry a VALUE rather than a decision. Everything else a
# route depends on is treated as part of its access decision, including anything
# added later — the safe default, since an unrecognised gate refuses the export
# instead of being ignored. Keep additions here to things that genuinely gate
# nothing (get_request_language reads a header), never to something that can
# raise 401/402/403.
_NOT_A_GATE = (get_current_user, get_db, get_tenant_id, get_request_language)


def _route_gates(fn) -> list:
    """The access dependencies declared by a route, in declaration order.

    Everything the route depends on EXCEPT the three values this module already
    holds: what is left is the gate (``require_feature`` + ``require_roles`` for
    dashboards.py, nothing at all for the two routes in dashboard.py, which are
    still ungated — see the module report).
    """
    gates = []
    for param in inspect.signature(fn).parameters.values():
        marker = _depends_marker(param)
        dep = getattr(marker, "dependency", None) if marker is not None else None
        if dep is None or dep in _NOT_A_GATE:
            continue
        gates.append(dep)
    return gates


# Fallback access policy — used ONLY for a dashboard whose route declares no
# gate of its own. Today that is exactly the two served by endpoints/dashboard.py
# (compliance = frameworks-overview, executive = summary), which are still on a
# bare ``get_current_user``. Without this the export of those two would be open
# to every authenticated account, which is the finding this lane closes; with
# it, the export is briefly STRICTER than the screen, and that is the safe
# direction of the two.
#
# ``strict`` selects require_roles_strict (no super_admin/tenant_admin
# auto-pass) and is set only where the tender clause is an exclusion —
# « uniquement aux profils exécutifs » for objectif 9. The role lists mirror the
# ones dashboards.py chose for the neighbouring objectives.
# NOTE: ``executive`` is no longer reached through this table by the export
# itself — get_executive_summary carries its own require_roles_strict gate, which
# _route_gates finds first. The entry stays because /keys reports it to the SPA
# and because it must keep matching that gate.
_FALLBACK_DASHBOARD_ROLES: dict[str, tuple[tuple[UserRole, ...], bool]] = {
    "assets": ((UserRole.CISO, UserRole.BUSINESS_OWNER, UserRole.RISK_MANAGER,
                UserRole.COMPLIANCE_MANAGER, UserRole.EXECUTIVE, UserRole.VIEWER), False),
    "vulnerabilities": ((UserRole.SECURITY_ANALYST, UserRole.CISO), True),
    "threats": ((UserRole.SECURITY_ANALYST, UserRole.CISO), True),
    "risks": ((UserRole.CISO, UserRole.RISK_MANAGER, UserRole.CONTROL_OWNER), True),
    "controls": ((UserRole.CISO, UserRole.RISK_MANAGER, UserRole.CONTROL_OWNER), True),
    "governance": ((UserRole.EXECUTIVE, UserRole.CISO), True),
    "audit": ((UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.AUDITOR), False),
    "compliance": ((UserRole.CISO, UserRole.COMPLIANCE_MANAGER, UserRole.AUDITOR,
                    UserRole.RISK_MANAGER, UserRole.EXECUTIVE), False),
    "executive": ((UserRole.EXECUTIVE, UserRole.CISO), True),
}


async def _run_gate(key: str, gate, user: User, tenant_id: str, db: AsyncSession) -> None:
    """Resolve one access dependency, converting every non-answer into a 424.

    An HTTPException raised by the gate IS the answer (402 plan / 403 role) and
    is re-raised untouched. Everything else is a failure to reach an answer, and
    a failure to reach an answer must not become a 5xx: the SPA hard-redirects
    to /service-down on any 5xx, so a gate that blows up would eject the user
    out of the application instead of showing them a refusal.

    Two ways that happens in practice:

    * ``require_roles``/``require_roles_strict`` resolve the caller's effective
      roles out of ``groups`` / ``custom_roles`` / ``access_delegations``. Those
      tables exist today, but CLAUDE.md's live-schema trap is exactly the case
      where a table in the models is not yet on the database — and that raises
      OperationalError from INSIDE the gate, which the old code let escape.
    * ``_UnresolvableDependency`` from the fallback branch, which was not
      wrapped at all.

    Either way the export is refused, never run unchecked: fail closed.
    """
    try:
        await _resolve_dependency(gate, user=user, tenant_id=tenant_id, db=db)
    except HTTPException:
        # The gate's own answer (403 role / 402 plan). It IS the result.
        raise
    except _UnresolvableDependency as exc:
        logger.error("dashboard export %s: access gate %s could not be evaluated",
                     key, getattr(gate, "__name__", gate), exc_info=True)
        raise HTTPException(
            status_code=424,
            detail={
                "error": "dashboard_gate_not_evaluable",
                "dashboard": key,
                "message": (
                    "The dashboard's access gate could not be evaluated by the export "
                    "path, so the export was refused rather than run unchecked. Teach "
                    "_resolve_dependency in endpoints/dashboard_export.py about the new "
                    f"dependency ({exc})."
                ),
            },
        ) from exc
    except (OperationalError, ProgrammingError) as exc:
        logger.error("dashboard export %s: access gate %s hit a missing table/column",
                     key, getattr(gate, "__name__", gate), exc_info=True)
        raise HTTPException(
            status_code=424,
            detail={
                "error": "dashboard_gate_schema_not_ready",
                "dashboard": key,
                "message": (
                    "The access check for this dashboard reads a table or column that does "
                    "not exist on the database yet, so the export was refused rather than "
                    "run unchecked. Restart the API so create_all() creates the new tables, "
                    "and apply any pending column script from backend/scripts/, then retry. "
                    f"({type(exc).__name__})"
                ),
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001 — fail closed, never 5xx, never unchecked
        logger.exception("dashboard export %s: access gate %s failed",
                         key, getattr(gate, "__name__", gate))
        raise HTTPException(
            status_code=424,
            detail={
                "error": "dashboard_gate_not_evaluable",
                "dashboard": key,
                "message": (
                    "The dashboard's access gate raised while being evaluated, so the export "
                    f"was refused rather than run unchecked. ({type(exc).__name__})"
                ),
            },
        ) from exc


async def _apply_role_gate(key: str, fn, user: User, tenant_id: str, db: AsyncSession) -> None:
    """Run the SAME access check the dashboard route runs before exporting it."""
    gates = _route_gates(fn)
    if gates:
        for gate in gates:
            await _run_gate(key, gate, user, tenant_id, db)
        return

    # No gate on the route: apply the fallback policy above. Wrapped in exactly
    # the same way — this branch used to be bare, so a database error inside
    # require_roles reached the client as a 500.
    roles, strict = _FALLBACK_DASHBOARD_ROLES.get(key, ((), False))
    if not roles:
        return
    # Same rule as the dashboards themselves: the tenant owner is never excluded.
    checker = require_roles_strict(*roles, allow_admin=True) if strict else require_roles(*roles)
    await _run_gate(key, checker, user, tenant_id, db)


# ---------------------------------------------------------------------------
# Calling the dashboard's own aggregation
# ---------------------------------------------------------------------------
def _annotation_type(param: inspect.Parameter) -> Any:
    """The declared type of a parameter, unwrapping ``Annotated[T, Depends(...)]``."""
    ann = param.annotation
    if typing.get_origin(ann) is typing.Annotated:
        args = typing.get_args(ann)
        return args[0] if args else Any
    return ann


def _bind_kwargs(fn, *, user: User, tenant_id: str, db: AsyncSession) -> dict:
    """Build the call kwargs for a route function invoked OUTSIDE FastAPI.

    Calling a route function directly means its ``Depends`` are not resolved for
    us, so the three values every dashboard route needs are supplied by hand.
    Matching is by declared TYPE first and name second, on purpose: dashboards.py
    is owned by another workstream and its parameter names move (``current_user``
    vs ``_``, and a new gate parameter is exactly the kind of thing that gets
    added). A name-only match would turn a harmless rename over there into a
    TypeError here, i.e. a 500, i.e. the SPA ejecting the user to /service-down.

    Parameters that are neither recognised nor optional are reported to the
    caller — never guessed at.
    """
    kwargs: dict[str, Any] = {}
    unresolved: list[str] = []
    for name, param in inspect.signature(fn).parameters.items():
        if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        ann = _annotation_type(param)
        if isinstance(ann, type) and issubclass(ann, AsyncSession):
            kwargs[name] = db
        elif isinstance(ann, type) and issubclass(ann, User):
            kwargs[name] = user
        elif name in _TENANT_PARAM_NAMES:
            kwargs[name] = tenant_id
        elif name in ("current_user", "user", "_"):
            kwargs[name] = user
        elif name == "db":
            kwargs[name] = db
        elif param.default is inspect.Parameter.empty:
            unresolved.append(name)
        # Anything else has a default (``framework_id: str | None = None``) and
        # is left alone so the aggregation behaves as the dashboard's own
        # default call does.
    if unresolved:
        raise HTTPException(
            status_code=424,
            detail={
                "error": "dashboard_aggregation_signature_changed",
                "parameters": unresolved,
                "message": (
                    "The dashboard aggregation now takes parameters this export cannot "
                    "supply. Update _bind_kwargs in endpoints/dashboard_export.py to match "
                    f"{getattr(fn, '__name__', fn)}."
                ),
            },
        )
    return kwargs


def _resolve_source(key: str):
    """The aggregation callable for ``key``.

    dashboards.py names its routes ``<key>_dashboard`` and is the preferred
    source for all nine, including the two it does not serve today; the fallback
    table covers those two until it does.
    """
    fn = getattr(module_dashboards, f"{key}_dashboard", None)
    if callable(fn):
        return fn
    module, attr = _FALLBACK_SOURCES.get(key, (None, ""))
    fn = getattr(module, attr, None) if module is not None else None
    if callable(fn):
        return fn
    raise HTTPException(status_code=404, detail=f"Unknown dashboard '{key}'")


async def _aggregate(key: str, fn, user: User, tenant_id: str, db: AsyncSession) -> dict:
    """Run the dashboard's own aggregation and hand back its payload.

    The per-module aggregations already degrade tile by tile, but the two in
    dashboard.py do not, and CLAUDE.md's live-schema trap applies to both: a
    table or column that exists in the models but not yet on this database
    raises OperationalError, which would surface as a 5xx — and a 5xx does not
    show the user an error, it hard-redirects the SPA to /service-down. So the
    missing-schema case is answered with a 424 the operator can act on.
    """
    kwargs = _bind_kwargs(fn, user=user, tenant_id=tenant_id, db=db)
    try:
        payload = await fn(**kwargs)
    except HTTPException:
        raise
    except (OperationalError, ProgrammingError) as exc:
        logger.error("dashboard export %s: schema not ready", key, exc_info=True)
        raise HTTPException(
            status_code=424,
            detail={
                "error": "dashboard_schema_not_ready",
                "dashboard": key,
                "message": (
                    "A table or column this dashboard reads does not exist on the database "
                    "yet. Restart the API so create_all() creates the new tables, and apply "
                    "any pending column script from backend/scripts/, then retry. "
                    f"({type(exc).__name__})"
                ),
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001 — see below
        # Deliberately broad, and deliberately NOT swallowed: the aggregation
        # functions live in two modules owned by other workstreams, and this
        # module calls them outside FastAPI. A rename over there surfaces here
        # as a TypeError/AttributeError, not a SQLAlchemyError — and a 5xx does
        # not show the user an error, it hard-redirects the SPA to
        # /service-down. The full traceback is logged; the caller gets an
        # operator-actionable 424 naming the dashboard that failed.
        logger.exception("dashboard export %s: aggregation failed", key)
        raise HTTPException(
            status_code=424,
            detail={
                "error": "dashboard_aggregation_failed",
                "dashboard": key,
                "message": f"The {key} dashboard could not be computed ({type(exc).__name__}).",
            },
        ) from exc
    return payload if isinstance(payload, dict) else {"result": payload}


# ---------------------------------------------------------------------------
# Localisation
# ---------------------------------------------------------------------------
# Same shape as report_generator._L10N and compliance.py's _L10N: one flat table
# per supported language with an English fallback. Not a new i18n mechanism —
# these are strings burnt into a file, which no browser will ever translate, and
# a French tender that receives an English spreadsheet has received an English
# spreadsheet.
_TERMS: dict[str, dict[str, str]] = {
    "en": {
        # table chrome
        "section": "Section", "metric": "Metric", "value": "Value", "detail": "Detail",
        "report": "Report", "dashboard": "Dashboard", "organisation": "Organisation",
        "generated": "Generated (UTC)", "language": "Language",
        "summary": "Summary", "yes": "Yes", "no": "No", "none": "—",
        # dashboard names
        "dash_assets": "Asset dashboard",
        "dash_vulnerabilities": "Vulnerability dashboard",
        "dash_threats": "Threat dashboard",
        "dash_risks": "Risk dashboard",
        "dash_controls": "Control dashboard",
        "dash_governance": "Governance dashboard",
        "dash_audit": "Audit dashboard",
        "dash_compliance": "Compliance dashboard",
        "dash_executive": "Executive dashboard",
        # payload keys
        "total": "Total", "by_type": "By type", "by_criticality": "By criticality",
        "by_class": "By class", "by_lifecycle": "By lifecycle", "by_severity": "By severity",
        "by_status": "By status", "by_category": "By category", "avg_cvss": "Average CVSS",
        "cve": "CVE", "pertinent_count": "Relevant CVEs", "top": "Top",
        "cve_id": "CVE", "cvss_score": "CVSS", "cvss_vector": "CVSS vector",
        "description": "Description", "pending": "Pending validation",
        "heatmap": "Heat map", "likelihood": "Likelihood", "impact": "Impact", "count": "Count",
        "avg_progress": "Average progress (%)", "total_cost": "Total cost",
        "policies_total": "Policies", "policies_by_status": "Policies by status",
        "attestations_by_status": "Attestations by status",
        "committees": "Steering committees", "next_meeting": "Next meeting",
        "next_meeting_date": "Date", "name": "Name", "id": "Identifier",
        "audits_total": "Audits", "audits_by_status": "Audits by status",
        "findings_by_severity": "Findings by severity", "findings_by_status": "Findings by status",
        "frameworks": "Frameworks", "has_framework": "Framework selected",
        "framework_id": "Framework id", "framework_name": "Framework",
        "framework_short_name": "Short name", "is_primary": "Primary framework",
        "has_assessment": "Assessment started", "assessment_id": "Assessment id",
        "compliance_score": "Compliance score (%)", "open_gaps": "Open gaps",
        "open_blockers": "Open certification blockers", "cert_readiness": "Certification readiness (%)",
        "controls_total": "Controls", "controls_implemented": "Controls implemented",
        "status": "Status", "risk": "Risk", "compliance": "Compliance", "audit": "Audit",
        "vendor": "Third parties", "policy": "Policies", "total_open": "Open risks",
        "average_score": "Average score (%)", "total_assessments": "Assessments",
        "control_coverage_percent": "Control coverage (%)",
        "controls_by_status": "Controls by status", "open_findings": "Open findings",
        "total_vendors": "Third parties", "attestation_rate_percent": "Attestation rate (%)",
        "total_attestations": "Attestations",
        # Consolidated executive view (objectif 9). These keys only ever reach an
        # artefact through the /dashboard/executive-summary payload, and without
        # them a French PDF printed « Open By Severity »: report_generator's
        # _label title-cases what it does not recognise, which leaves English.
        "generated_at": "Generated at", "refresh_interval_seconds": "Auto-refresh interval (s)",
        "refresh_config_available": "Cadence configurable",
        "posture": "Security posture", "score": "Score", "components": "Components",
        "weights": "Weights", "formula": "Formula",
        "assets": "Assets", "vulnerabilities": "Vulnerabilities", "threats": "Threats",
        "controls": "Controls", "governance": "Governance", "incidents": "Incidents",
        "vendors": "Third parties", "exceptions": "Exceptions and waivers",
        "open_by_severity": "Open by severity", "critical_high_open": "Open critical + high",
        "tenant_specific": "Specific to this organisation",
        "backlog_change": "Backlog change", "from_date": "From (date)",
        "from_open": "Open at start", "to_date": "To (date)", "to_open": "Open at end",
        "change": "Change",
        "applied_total": "Applied controls", "applied_by_status": "Applied controls by status",
        "avg_progress_percent": "Average progress (%)", "assessed_total": "Controls assessed",
        "assessed_implemented": "Controls implemented", "coverage_percent": "Control coverage (%)",
        "committees_total": "Steering committees", "next_committee_meeting": "Next committee meeting",
        "certification_blockers": "Certification blockers",
        "open_findings_by_severity": "Open findings by severity", "by_risk_tier": "By risk tier",
        "title": "Title", "severity": "Severity",
        "inherent_score": "Inherent score", "residual_score": "Residual score",
        "control_coverage": "Control coverage", "risk_exposure": "Risk exposure",
        # Vocabulary the shared table in report_generator does not carry yet, and
        # which these nine dashboards group by — an untranslated key here is a
        # French artefact with English rows in it, which is the finding this closes.
        "primary": "Primary asset", "support": "Supporting asset",
        "application": "Application", "database": "Database", "server": "Server",
        "workstation": "Workstation", "network_device": "Network device",
        "in_use": "In use", "planned": "Planned", "maintenance": "Maintenance",
        "retired": "Retired",
        "cyber_attack": "Cyber attack", "insider_threat": "Insider threat",
        "social_engineering": "Social engineering", "supply_chain": "Supply chain",
        "pending_validation": "Pending validation", "validated": "Validated",
        "operational": "Operational", "degraded": "Degraded",
        "out_of_service": "Out of service", "quarantined": "Quarantined", "lost": "Lost",
        "unspecified": "Not specified", "other": "Other",
        "decommissioned": "Decommissioned", "acquisition": "Acquisition",
        "iot_device": "IoT device", "cloud_service": "Cloud service",
        "physical": "Physical", "natural_disaster": "Natural disaster",
        "technical_failure": "Technical failure", "human_error": "Human error",
        "legal_regulatory": "Legal / regulatory",
    },
    "fr": {
        "section": "Section", "metric": "Indicateur", "value": "Valeur", "detail": "Détail",
        "report": "Rapport", "dashboard": "Tableau de bord", "organisation": "Organisation",
        "generated": "Généré le (UTC)", "language": "Langue",
        "summary": "Synthèse", "yes": "Oui", "no": "Non", "none": "—",
        "dash_assets": "Tableau de bord des actifs",
        "dash_vulnerabilities": "Tableau de bord des vulnérabilités",
        "dash_threats": "Tableau de bord des menaces",
        "dash_risks": "Tableau de bord des risques",
        "dash_controls": "Tableau de bord des contrôles",
        "dash_governance": "Tableau de bord de la gouvernance",
        "dash_audit": "Tableau de bord des audits",
        "dash_compliance": "Tableau de bord de la conformité",
        "dash_executive": "Tableau de bord de direction",
        "total": "Total", "by_type": "Par type", "by_criticality": "Par criticité",
        "by_class": "Par classe", "by_lifecycle": "Par cycle de vie", "by_severity": "Par gravité",
        "by_status": "Par statut", "by_category": "Par catégorie", "avg_cvss": "CVSS moyen",
        "cve": "CVE", "pertinent_count": "CVE pertinentes", "top": "Principaux",
        "cve_id": "CVE", "cvss_score": "CVSS", "cvss_vector": "Vecteur CVSS",
        "description": "Description", "pending": "En attente de validation",
        "heatmap": "Cartographie", "likelihood": "Probabilité", "impact": "Impact",
        "count": "Nombre",
        "avg_progress": "Avancement moyen (%)", "total_cost": "Coût total",
        "policies_total": "Politiques", "policies_by_status": "Politiques par statut",
        "attestations_by_status": "Attestations par statut",
        "committees": "Comités de pilotage", "next_meeting": "Prochaine réunion",
        "next_meeting_date": "Date", "name": "Nom", "id": "Identifiant",
        "audits_total": "Audits", "audits_by_status": "Audits par statut",
        "findings_by_severity": "Constats par gravité", "findings_by_status": "Constats par statut",
        "frameworks": "Référentiels", "has_framework": "Référentiel sélectionné",
        "framework_id": "Identifiant du référentiel", "framework_name": "Référentiel",
        "framework_short_name": "Abréviation", "is_primary": "Référentiel principal",
        "has_assessment": "Évaluation démarrée", "assessment_id": "Identifiant d'évaluation",
        "compliance_score": "Score de conformité (%)", "open_gaps": "Écarts ouverts",
        "open_blockers": "Bloquants de certification ouverts",
        "cert_readiness": "Préparation à la certification (%)",
        "controls_total": "Contrôles", "controls_implemented": "Contrôles mis en œuvre",
        "status": "Statut", "risk": "Risques", "compliance": "Conformité", "audit": "Audit",
        "vendor": "Tiers", "policy": "Politiques", "total_open": "Risques ouverts",
        "average_score": "Score moyen (%)", "total_assessments": "Évaluations",
        "control_coverage_percent": "Couverture des contrôles (%)",
        "controls_by_status": "Contrôles par statut", "open_findings": "Constats ouverts",
        "total_vendors": "Tiers", "attestation_rate_percent": "Taux d'attestation (%)",
        "total_attestations": "Attestations",
        # Consolidated executive view (objectif 9). These keys only ever reach an
        # artefact through the /dashboard/executive-summary payload, and without
        # them a French PDF printed « Open By Severity »: report_generator's
        # _label title-cases what it does not recognise, which leaves English.
        "generated_at": "Généré le", "refresh_interval_seconds": "Intervalle d'actualisation (s)",
        "refresh_config_available": "Cadence configurable",
        "posture": "Posture de sécurité", "score": "Score", "components": "Composantes",
        "weights": "Pondérations", "formula": "Formule",
        "assets": "Actifs", "vulnerabilities": "Vulnérabilités", "threats": "Menaces",
        "controls": "Contrôles", "governance": "Gouvernance", "incidents": "Incidents",
        "vendors": "Tiers", "exceptions": "Dérogations",
        "open_by_severity": "Ouverts par gravité", "critical_high_open": "Ouverts critiques et élevés",
        "tenant_specific": "Propres à l'organisation",
        "backlog_change": "Évolution de l'encours", "from_date": "Du",
        "from_open": "Ouverts au début", "to_date": "Au", "to_open": "Ouverts à la fin",
        "change": "Variation",
        "applied_total": "Mesures appliquées", "applied_by_status": "Mesures par statut",
        "avg_progress_percent": "Avancement moyen (%)", "assessed_total": "Contrôles évalués",
        "assessed_implemented": "Contrôles mis en œuvre", "coverage_percent": "Couverture des contrôles (%)",
        "committees_total": "Comités de pilotage", "next_committee_meeting": "Prochaine réunion de comité",
        "certification_blockers": "Bloquants de certification",
        "open_findings_by_severity": "Constats ouverts par gravité", "by_risk_tier": "Par niveau de risque",
        "title": "Intitulé", "severity": "Gravité",
        "inherent_score": "Score inhérent", "residual_score": "Score résiduel",
        "control_coverage": "Couverture des contrôles", "risk_exposure": "Exposition au risque",
        "primary": "Actif primaire", "support": "Actif support",
        "application": "Application", "database": "Base de données", "server": "Serveur",
        "workstation": "Poste de travail", "network_device": "Équipement réseau",
        "in_use": "En service", "planned": "Planifié", "maintenance": "En maintenance",
        "retired": "Retiré",
        "cyber_attack": "Cyberattaque", "insider_threat": "Menace interne",
        "social_engineering": "Ingénierie sociale", "supply_chain": "Chaîne d'approvisionnement",
        "pending_validation": "En attente de validation", "validated": "Validé",
        "operational": "Opérationnel", "degraded": "Dégradé",
        "out_of_service": "Hors service", "quarantined": "En quarantaine", "lost": "Perdu ou volé",
        "unspecified": "Non renseigné", "other": "Autre",
        "decommissioned": "Démantelé", "acquisition": "Acquisition",
        "iot_device": "Objet connecté", "cloud_service": "Service cloud",
        "physical": "Physique", "natural_disaster": "Catastrophe naturelle",
        "technical_failure": "Défaillance technique", "human_error": "Erreur humaine",
        "legal_regulatory": "Juridique et réglementaire",
    },
    "ar": {
        "section": "القسم", "metric": "المؤشر", "value": "القيمة", "detail": "التفاصيل",
        "report": "التقرير", "dashboard": "لوحة المتابعة", "organisation": "المؤسسة",
        "generated": "تاريخ الإصدار (UTC)", "language": "اللغة",
        "summary": "ملخص", "yes": "نعم", "no": "لا", "none": "—",
        "dash_assets": "لوحة الأصول",
        "dash_vulnerabilities": "لوحة الثغرات",
        "dash_threats": "لوحة التهديدات",
        "dash_risks": "لوحة المخاطر",
        "dash_controls": "لوحة الضوابط",
        "dash_governance": "لوحة الحوكمة",
        "dash_audit": "لوحة التدقيق",
        "dash_compliance": "لوحة الامتثال",
        "dash_executive": "لوحة الإدارة التنفيذية",
        "total": "الإجمالي", "by_type": "حسب النوع", "by_criticality": "حسب الحرجية",
        "by_class": "حسب الفئة", "by_lifecycle": "حسب دورة الحياة", "by_severity": "حسب الخطورة",
        "by_status": "حسب الحالة", "by_category": "حسب التصنيف", "avg_cvss": "متوسط CVSS",
        "cve": "الثغرات المعلنة", "pertinent_count": "ثغرات ذات صلة", "top": "الأبرز",
        "cve_id": "المعرّف", "cvss_score": "درجة CVSS", "cvss_vector": "متجه CVSS",
        "description": "الوصف", "pending": "بانتظار التحقق",
        "heatmap": "الخريطة الحرارية", "likelihood": "الاحتمالية", "impact": "الأثر",
        "count": "العدد",
        "avg_progress": "متوسط التقدم (%)", "total_cost": "التكلفة الإجمالية",
        "policies_total": "السياسات", "policies_by_status": "السياسات حسب الحالة",
        "attestations_by_status": "الإقرارات حسب الحالة",
        "committees": "لجان التوجيه", "next_meeting": "الاجتماع القادم",
        "next_meeting_date": "التاريخ", "name": "الاسم", "id": "المعرّف",
        "audits_total": "المهام التدقيقية", "audits_by_status": "التدقيق حسب الحالة",
        "findings_by_severity": "الملاحظات حسب الخطورة", "findings_by_status": "الملاحظات حسب الحالة",
        "frameworks": "الأطر المرجعية", "has_framework": "إطار مرجعي محدد",
        "framework_id": "معرّف الإطار", "framework_name": "الإطار المرجعي",
        "framework_short_name": "الاختصار", "is_primary": "الإطار الأساسي",
        "has_assessment": "بدأ التقييم", "assessment_id": "معرّف التقييم",
        "compliance_score": "درجة الامتثال (%)", "open_gaps": "الفجوات المفتوحة",
        "open_blockers": "معوقات الاعتماد المفتوحة",
        "cert_readiness": "الجاهزية للاعتماد (%)",
        "controls_total": "الضوابط", "controls_implemented": "الضوابط المطبقة",
        "status": "الحالة", "risk": "المخاطر", "compliance": "الامتثال", "audit": "التدقيق",
        "vendor": "الأطراف الثالثة", "policy": "السياسات", "total_open": "المخاطر المفتوحة",
        "average_score": "متوسط الدرجة (%)", "total_assessments": "التقييمات",
        "control_coverage_percent": "تغطية الضوابط (%)",
        "controls_by_status": "الضوابط حسب الحالة", "open_findings": "الملاحظات المفتوحة",
        "total_vendors": "الأطراف الثالثة", "attestation_rate_percent": "نسبة الإقرار (%)",
        "total_attestations": "الإقرارات",
        # Consolidated executive view (objectif 9). These keys only ever reach an
        # artefact through the /dashboard/executive-summary payload, and without
        # them a French PDF printed « Open By Severity »: report_generator's
        # _label title-cases what it does not recognise, which leaves English.
        "generated_at": "تاريخ الإصدار", "refresh_interval_seconds": "فترة التحديث (ثانية)",
        "refresh_config_available": "إمكانية ضبط التحديث",
        "posture": "الوضع الأمني", "score": "الدرجة", "components": "المكوّنات",
        "weights": "الأوزان", "formula": "المعادلة",
        "assets": "الأصول", "vulnerabilities": "الثغرات", "threats": "التهديدات",
        "controls": "الضوابط", "governance": "الحوكمة", "incidents": "الحوادث",
        "vendors": "الأطراف الثالثة", "exceptions": "الاستثناءات",
        "open_by_severity": "المفتوحة حسب الخطورة", "critical_high_open": "المفتوحة الحرجة والمرتفعة",
        "tenant_specific": "خاصة بالمؤسسة",
        "backlog_change": "تغيّر الرصيد", "from_date": "من تاريخ",
        "from_open": "المفتوحة في البداية", "to_date": "إلى تاريخ", "to_open": "المفتوحة في النهاية",
        "change": "التغيّر",
        "applied_total": "الضوابط المطبقة", "applied_by_status": "الضوابط المطبقة حسب الحالة",
        "avg_progress_percent": "متوسط التقدم (%)", "assessed_total": "الضوابط المقيَّمة",
        "assessed_implemented": "الضوابط المنفذة", "coverage_percent": "تغطية الضوابط (%)",
        "committees_total": "لجان التوجيه", "next_committee_meeting": "اجتماع اللجنة القادم",
        "certification_blockers": "معوقات الاعتماد",
        "open_findings_by_severity": "الملاحظات المفتوحة حسب الخطورة", "by_risk_tier": "حسب مستوى المخاطر",
        "title": "العنوان", "severity": "الخطورة",
        "inherent_score": "الدرجة الكامنة", "residual_score": "الدرجة المتبقية",
        "control_coverage": "تغطية الضوابط", "risk_exposure": "التعرض للمخاطر",
        "primary": "أصل أساسي", "support": "أصل داعم",
        "application": "تطبيق", "database": "قاعدة بيانات", "server": "خادم",
        "workstation": "محطة عمل", "network_device": "جهاز شبكة",
        "in_use": "قيد الاستخدام", "planned": "مخطط", "maintenance": "قيد الصيانة",
        "retired": "مُوقَف",
        "cyber_attack": "هجوم سيبراني", "insider_threat": "تهديد داخلي",
        "social_engineering": "هندسة اجتماعية", "supply_chain": "سلسلة التوريد",
        "pending_validation": "بانتظار التحقق", "validated": "تم التحقق",
        "operational": "قيد التشغيل", "degraded": "أداء متدهور",
        "out_of_service": "خارج الخدمة", "quarantined": "معزول", "lost": "مفقود أو مسروق",
        "unspecified": "غير محدد", "other": "أخرى",
        "decommissioned": "مُفكك", "acquisition": "اقتناء",
        "iot_device": "جهاز إنترنت الأشياء", "cloud_service": "خدمة سحابية",
        "physical": "مادي", "natural_disaster": "كارثة طبيعية",
        "technical_failure": "عطل تقني", "human_error": "خطأ بشري",
        "legal_regulatory": "قانوني وتنظيمي",
    },
}


def _t(lang: str, key: str) -> str:
    """A platform-authored label in the resolved language (English fallback)."""
    table = _TERMS.get(lang) or _TERMS["en"]
    return table.get(key) or _TERMS["en"].get(key) or key.replace("_", " ").capitalize()


def _vocab(lang: str, value: Any) -> str:
    """Translate a vocabulary VALUE — a severity, a status, a lifecycle state.

    Delegates to report_generator._label, which already holds the platform's
    en/fr/ar vocabulary table; a second copy here would drift from the PDFs the
    reports module produces. Imported lazily inside a try/except because that
    module is owned elsewhere: a rename there must degrade this label to English
    title case, not break the export (and certainly not startup).
    """
    try:
        from app.services.report_generator import _label as _rg_label

        return _rg_label(lang, value, default=str(value))
    except Exception:  # noqa: BLE001 — a label lookup must never fail an export
        raw = str(getattr(value, "value", value) or "")
        return raw.replace("_", " ").title()


def _is_vocab_token(text: str) -> bool:
    """True for machine vocabulary (``in_progress``), false for free text.

    Guards the translation above: ``_label`` title-cases anything it does not
    recognise, which would turn the framework name "ISO 27001" into "Iso 27001"
    and a control title into nonsense.
    """
    return bool(text) and text.islower() and " " not in text and text.replace("_", "").isalnum()


# A boolean that has already been stringified upstream. dashboards.py groups by
# real Boolean columns (Threat.is_pending is one) and renders each group key
# through its own ``_label``, so what arrives here is the Python repr "True" /
# "False" — not a bool this module can translate and not a vocabulary token
# (``_is_vocab_token`` rejects it on the capital letter). Untranslated, a French
# export reads « En attente de validation | False », which is the exact finding
# this lane exists to close.
_BOOL_TOKENS = {"true": "yes", "false": "no"}


def _term(lang: str, key: Any) -> str:
    """Label for a payload key: platform term first, vocabulary value second."""
    text = str(getattr(key, "value", key) or "")
    bool_term = _BOOL_TOKENS.get(text.strip().lower())
    if bool_term:
        return _t(lang, bool_term)
    table = _TERMS.get(lang) or _TERMS["en"]
    if text in table or text in _TERMS["en"]:
        return _t(lang, text)
    if _is_vocab_token(text):
        return _vocab(lang, text)
    return text


def _value(lang: str, value: Any) -> Any:
    """Render one cell value.

    Numbers stay numbers so the spreadsheet keeps sorting them; booleans and
    vocabulary strings are translated; everything else is passed through
    untouched (names, ids, dates, free text).
    """
    if value is None:
        return _t(lang, "none")
    if isinstance(value, bool):
        return _t(lang, "yes" if value else "no")
    if isinstance(value, (int, float)):
        return value
    text = str(getattr(value, "value", value))
    bool_term = _BOOL_TOKENS.get(text.strip().lower())
    if bool_term:
        return _t(lang, bool_term)
    return _vocab(lang, text) if _is_vocab_token(text) else text


# ---------------------------------------------------------------------------
# Payload -> rows
# ---------------------------------------------------------------------------
# When a list item carries one of these, it is the row's label / its number.
_ITEM_LABEL_FIELDS = ("framework_name", "name", "title", "cve_id", "label", "month", "period")
_ITEM_VALUE_FIELDS = ("count", "value", "total", "compliance_score", "score", "cvss_score", "n")


def _flatten(payload: dict, lang: str, header: tuple[str, str, str, str]) -> list[dict]:
    """Turn a dashboard payload (a tree of counts) into section/metric/value rows.

    One generic walk rather than nine hand-written shapes: the payloads are
    already heterogeneous (scalars, grouped counts, a heat map, a CVE top-5, a
    per-framework card list) and they change whenever a dashboard gains a tile.
    A bespoke renderer per dashboard would silently drop the new tile; this
    drops nothing.
    """
    col_section, col_metric, col_value, col_detail = header
    rows: list[dict] = []

    def add(section: str, metric: str, value: Any, detail: str = "") -> None:
        rows.append({col_section: section, col_metric: metric,
                     col_value: value, col_detail: detail})

    def item_row(section: str, item: dict) -> None:
        remaining = dict(item)
        label_key = next((k for k in _ITEM_LABEL_FIELDS if k in remaining), None)
        value_key = next(
            (k for k in _ITEM_VALUE_FIELDS
             if k in remaining and isinstance(remaining[k], (int, float)) and not isinstance(remaining[k], bool)),
            None,
        )
        metric = _value(lang, remaining.pop(label_key)) if label_key else ""
        value = remaining.pop(value_key) if value_key else _t(lang, "none")
        if not metric:
            # A heat-map cell has no label field: build one from what is left
            # (likelihood/impact) so the row still identifies itself.
            metric = "; ".join(f"{_term(lang, k)}={_value(lang, v)}" for k, v in list(remaining.items())[:3])
            for k in list(remaining)[:3]:
                remaining.pop(k, None)
        detail = "; ".join(f"{_term(lang, k)}={_value(lang, v)}" for k, v in remaining.items())
        add(section, metric, value, detail)

    def walk(section: str, key: Any, node: Any) -> None:
        label = _term(lang, key)
        if isinstance(node, dict):
            child_section = f"{section} / {label}" if section else label
            if not node:
                add(child_section, _t(lang, "total"), 0)
                return
            for sub_key, sub in node.items():
                walk(child_section, sub_key, sub)
            return
        if isinstance(node, list):
            child_section = f"{section} / {label}" if section else label
            if not node:
                add(child_section, _t(lang, "total"), 0)
                return
            for entry in node:
                if isinstance(entry, dict):
                    item_row(child_section, entry)
                else:
                    add(child_section, _value(lang, entry), "")
            return
        add(section or _t(lang, "summary"), label, _value(lang, node))

    for key, node in payload.items():
        walk("", key, node)
    return rows


def _meta_rows(lang: str, key: str, org: str, header: tuple[str, str, str, str]) -> list[dict]:
    """Provenance block. An artefact handed to an auditor has to say which
    dashboard it is, whose data it holds and when it was taken; the PDF stamps
    a generation time of its own but the spreadsheet has nowhere else to say it.
    """
    col_section, col_metric, col_value, col_detail = header
    stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    return [
        {col_section: _t(lang, "report"), col_metric: _t(lang, "dashboard"),
         col_value: _t(lang, f"dash_{key}"), col_detail: ""},
        {col_section: _t(lang, "report"), col_metric: _t(lang, "organisation"),
         col_value: org, col_detail: ""},
        {col_section: _t(lang, "report"), col_metric: _t(lang, "generated"),
         col_value: stamp, col_detail: ""},
        {col_section: _t(lang, "report"), col_metric: _t(lang, "language"),
         col_value: lang, col_detail: ""},
    ]


async def _org_name(db: AsyncSession, tenant_id: str) -> str:
    """The tenant's display name, or its id if the row cannot be read."""
    try:
        result = await db.execute(select(Tenant.name).where(Tenant.id == tenant_id))
        return result.scalar_one_or_none() or tenant_id
    except SQLAlchemyError:
        logger.warning("dashboard export: tenant name lookup failed", exc_info=True)
        return tenant_id


def _render(fmt: str, title: str, columns: list[str], rows: list[dict],
            subtitle: str, lang: str) -> bytes:
    """Pure-CPU render. Always called through asyncio.to_thread (see below)."""
    if fmt == "pdf":
        # No markup escaping here on purpose: rows_to_pdf renders every cell
        # through pdf_arabic.paragraph_markup, which already escapes & < > —
        # doing it twice is visible corruption, not extra safety.
        return rows_to_pdf(title, columns, rows, subtitle=subtitle, lang=lang)
    return rows_to_xlsx(title, columns, rows)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
# NOTE: /keys is declared BEFORE /{key} — FastAPI matches in declaration order,
# so the reverse would make the catalogue unreachable behind the export route.
@router.get("/keys")
async def list_exportable_dashboards(
    current_user: Annotated[User, _Gate],
    header_lang: Annotated[str, Depends(get_request_language)],
    lang: str | None = None,
):
    """The nine dashboards, their localised names and the formats on offer.

    ``roles`` is ADVISORY and indicative only — enough for the SPA to label or
    hide a button, never a policy. The binding check is ``_apply_role_gate`` on
    the export itself, and for the seven dashboards that carry their own gate
    the roles that actually decide live in dashboards.py, not in the fallback
    table reported here.
    """
    resolved = normalize_language(lang) or header_lang
    return {
        "formats": list(_EXPORT_FORMATS),
        "dashboards": [
            {
                "key": key,
                "label": _t(resolved, f"dash_{key}"),
                "roles": sorted(r.value for r in _FALLBACK_DASHBOARD_ROLES.get(key, ((), False))[0]),
            }
            for key in DASHBOARD_KEYS
        ],
    }


@router.get("/{key}")
async def export_dashboard(
    key: str,
    current_user: Annotated[User, _Gate],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    header_lang: Annotated[str, Depends(get_request_language)],
    format: str = "xlsx",
    lang: str | None = None,
):
    """Export one dashboard as ``.xlsx`` or ``.pdf`` in the caller's language.

    ``?lang=`` wins over Accept-Language for the same reason it does in
    data_io.py: a download is often triggered from an ``<a href>``/``window.open``
    that cannot set a header, so the parameter has to exist and has to win.
    """
    if key not in DASHBOARD_KEYS:
        raise HTTPException(status_code=404, detail=f"Unknown dashboard '{key}'")
    fmt = _FORMAT_ALIASES.get((format or "").strip().lower())
    if fmt is None:
        raise HTTPException(status_code=400,
                            detail=f"format must be one of {', '.join(_EXPORT_FORMATS)}")

    # Resolve the aggregation FIRST so the gate that runs is the one attached to
    # the very function about to be called — not a second opinion about it.
    fn = _resolve_source(key)
    # Access before data: the gate has to run before a single figure is read, or
    # a 403 still costs the tenant the aggregation it was refused.
    await _apply_role_gate(key, fn, current_user, tenant_id, db)

    resolved_lang = normalize_language(lang) or header_lang
    payload = await _aggregate(key, fn, current_user, tenant_id, db)

    header = (_t(resolved_lang, "section"), _t(resolved_lang, "metric"),
              _t(resolved_lang, "value"), _t(resolved_lang, "detail"))
    columns = list(header)
    org = await _org_name(db, tenant_id)
    rows = _meta_rows(resolved_lang, key, org, header) + _flatten(payload, resolved_lang, header)

    title = _t(resolved_lang, f"dash_{key}")
    # Both renderers are pure CPU on a worker that is also serving every other
    # request, and there are only two workers — never render on the event loop.
    data = await asyncio.to_thread(_render, fmt, title, columns, rows, org, resolved_lang)

    stamp = datetime.utcnow().strftime("%Y%m%d")
    filename = f"{key}_dashboard_{stamp}.{fmt}"
    media = ("application/pdf" if fmt == "pdf"
             else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
