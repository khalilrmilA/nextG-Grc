"""Applied Controls — actionable controls with cost, effort, progress tracking.

Elite Pack (RFP module 3) addition:
- Security-referent validation workflow: POST /{id}/validate and
  POST /{id}/reject let a security referent formally approve/reject a
  control, independent of its planned/in_progress/implemented lifecycle
  status. Mirrors the Vulnerability validation workflow in vulnerabilities.py.

STB objectif 5 ("Contrôles") additions:
- « leur état » / « résultats des évaluations d'efficacité »: the register
  answers both on the same row — ?include_evaluation=true attaches each
  control's latest effectiveness evaluation (level, 0-10 score, method,
  follow-up), and ``validation_stale`` says when a sign-off predates the last
  edit it was supposed to cover. GET /{id} always carries it.
- « alertes sur les contrôles obsolètes »: GET /obsolescence is the working
  alert list, and ?expiring_within_days= filters the register itself. Both use
  the same window and the same date parsing as
  services/notification_generator.check_control_expiration(), so the screen
  and the notification a user has just received cannot disagree.
- « historique des modifications visible »: GET /history is the register-wide
  change feed (GET /{id}/history only ever answered for one control).
"""
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, select, func
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.applied_control import (
    AppliedControl, ControlEffort, ControlStatus, ControlValidationStatus, CSFFunction,
)
from app.models.applied_control_history import CONTROL_ACTIONS, AppliedControlHistory
from app.models.control_evaluation import ControlEvaluation, NON_PERFORMANT
from app.models.risk import Risk
from app.models.risk_scenario import RiskScenario
from app.services import control_registry as registry
from app.models.activity_log import ActivityLog
from app.services.activity_chain import chain_and_add

router = APIRouter()

logger = logging.getLogger(__name__)

# The alert window. Not a new convention: check_control_expiration() already
# warns 30 days out, and a screen that disagreed with the notification a user
# received this morning would be worse than no screen at all.
EXPIRY_WINDOW_DAYS = 30
# A control recorded yesterday is not "unverified", it is new. Same grace
# period as notification_generator.check_unverified_controls().
UNVERIFIED_GRACE_DAYS = 30
# Statuses that mean the measure is actually operating, so everything reading
# the register counts it as a mitigation. NB ControlStatus has no "active"
# member — the enum is planned/in_progress/implemented/not_applicable/
# deprecated (check_unverified_controls() filters on "active" and therefore
# never sees an implemented control; reported, not fixed here — that file is
# not this module's).
IN_SERVICE_STATUSES = (ControlStatus.IN_PROGRESS.value, ControlStatus.IMPLEMENTED.value)

# Nullable columns a PATCH may explicitly clear by sending null. Everything
# else (name, status, progress, the JSON id lists) is NOT NULL in the table, so
# a null there is treated as "not provided" instead of writing a value the
# column would reject.
_CLEARABLE_FIELDS = frozenset({
    "description", "category", "csf_function", "eta", "expiration",
    "effort", "cost", "recurring_cost", "owner_id", "link",
})

_STATUS_VALUES = tuple(s.value for s in ControlStatus)
_EFFORT_VALUES = tuple(e.value for e in ControlEffort)
_CSF_VALUES = tuple(f.value for f in CSFFunction)
_VALIDATION_VALUES = tuple(v.value for v in ControlValidationStatus)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_date(value: str | None) -> date | None:
    """An ISO date out of eta/expiration, or None when there isn't a usable one.

    Both columns are String(20), not Date, so they hold whatever was typed.
    Tolerant on read — the live register holds rows created before any of this
    existed — and strict on write, see :func:`_validate_fields`.
    """
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


def _days_until(value: str | None, today: date) -> int | None:
    """Days from `today` to an expiration/eta string; negative once past."""
    parsed = _parse_date(value)
    return None if parsed is None else (parsed - today).days


def _naive(value: datetime | None) -> datetime | None:
    """Naive UTC, so a tz-aware column can be compared with a naive one.

    created_at/updated_at are DateTime(timezone=True) while validated_at is
    written naive-UTC by _utcnow(). SQLite hands both back naive and
    PostgreSQL does not; comparing the two raises TypeError, which would be a
    5xx and would eject the user to /service-down. Converted to UTC before the
    tzinfo is dropped rather than merely stripped — stripping an offset would
    shift the value by that offset and make a sign-off look hours older (or
    newer) than the edit it is being compared against.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _is_missing_table(exc: Exception) -> bool:
    """True when the driver actually said "that table isn't there".

    OperationalError is not only "the table does not exist": on SQLite it is
    also "database is locked" (two uvicorn workers on one file make that a
    routine event) and "disk I/O error". Telling an operator to restart the
    backend to provision a table that already exists sends them to fix the
    wrong thing — and a production restart is not a cheap wrong turn.
    """
    text = str(getattr(exc, "orig", exc)).lower()
    return ("no such table" in text            # SQLite
            or "does not exist" in text        # PostgreSQL: relation "x" does not exist
            or "undefined table" in text
            or "doesn't exist" in text)        # MySQL


def _table_not_ready(name: str, exc: Exception | None = None) -> HTTPException:
    """424, not 500: client.ts hard-redirects the SPA to /service-down on any 5xx.

    ``applied_control_history`` and ``control_evaluations`` are provisioned by
    create_all() at the next backend restart. Until that restart these reads
    cannot work, and an operator-actionable sentence beats a stack trace and a
    bounced session. Same handling frameworks.py gives its own new tables.

    The message is only the restart instruction when the failure really was a
    missing table; any other database error keeps the 424 (so the SPA is not
    ejected) but says what is actually known, and the exception is logged so
    an operator has something to read.
    """
    if exc is not None and not _is_missing_table(exc):
        logger.warning("applied_controls.%s.unavailable: %s", name, exc)
        return HTTPException(
            status_code=424,
            detail="The %s table could not be read right now (database error). "
                   "Retry in a moment; if it persists, check the backend log." % name,
        )
    return HTTPException(
        status_code=424,
        detail="The %s table has not been created yet — restart the backend once to provision it." % name,
    )


async def _commit_or_424(db: AsyncSession, table: str = "applied_control_history") -> None:
    """Commit, or answer 424 when the history table is not provisioned yet.

    Every write here appends an AppliedControlHistory row in the same
    transaction, so the INSERT only fails at COMMIT — which raised
    OperationalError straight out of the handler, i.e. a 500, and client.ts
    hard-redirects the SPA to /service-down on any 5xx: the user is ejected
    from the application instead of being told anything. The read paths
    already degrade; the writes did not (verified by renaming the table on a
    database copy: create/patch/validate/reject/delete all returned 500).

    Rolled back rather than retried without the history row: a change to the
    control register that leaves no trace is exactly what
    « les modifications sont historisées » forbids, so the honest answer is
    "not written, restart the backend", not "written, untraceable".
    """
    try:
        await db.commit()
    except (OperationalError, ProgrammingError) as exc:
        await db.rollback()
        if not _is_missing_table(exc):
            # Not a provisioning problem — a locked database, a full disk, a
            # constraint the driver reports as operational. Still a 424 rather
            # than the 5xx that would eject the user, but it must not send an
            # operator off to restart a backend whose tables are all present.
            logger.warning("applied_controls.write_failed: %s", exc)
            raise HTTPException(
                status_code=424,
                detail="The change could not be saved (database error). Nothing was written — "
                       "retry in a moment; if it persists, check the backend log.",
            )
        raise _table_not_ready(table, exc)


def _validate_fields(*, status: str | None = None, effort: str | None = None,
                     csf_function: str | None = None, eta: str | None = None,
                     expiration: str | None = None,
                     validation_status: str | None = None) -> None:
    """Reject values no reader of the register can interpret.

    Nothing checked these before. A control could be saved with status
    "actif" — which no filter, no badge and no dashboard bucket matches, so it
    disappears from every count while still being in the table — or with an
    expiration of "31/12/2026", which every obsolescence check silently skips
    (this module and check_control_expiration() both `continue` past a date
    they cannot parse), so the control would simply never alert. A measure
    that looks tracked and is not is exactly the failure this register exists
    to prevent.
    """
    if status is not None and status not in _STATUS_VALUES:
        raise HTTPException(422, f"status must be one of {list(_STATUS_VALUES)}")
    if validation_status is not None and validation_status not in _VALIDATION_VALUES:
        raise HTTPException(422, f"validation_status must be one of {list(_VALIDATION_VALUES)}")
    if effort not in (None, "") and effort not in _EFFORT_VALUES:
        raise HTTPException(422, f"effort must be one of {list(_EFFORT_VALUES)}")
    if csf_function not in (None, "") and csf_function not in _CSF_VALUES:
        raise HTTPException(422, f"csf_function must be one of {list(_CSF_VALUES)}")
    for field, value in (("eta", eta), ("expiration", expiration)):
        if value in (None, ""):
            continue
        if _parse_date(value) is None:
            raise HTTPException(422, f"{field} must be an ISO date (YYYY-MM-DD)")


async def _latest_evaluations(
    db: AsyncSession, tenant_id: str,
) -> tuple[dict[str, ControlEvaluation], bool]:
    """Newest effectiveness evaluation per control, in one pass.

    Same join data_io's applied-controls export already does, for the same
    reason: whoever reads the register immediately asks how well each measure
    works. Note this *reads* evaluations, it does not let anyone write one —
    scoring stays behind require_feature("control_effectiveness") in
    control_evaluation.py, which is untouched.

    Returns ``(latest_by_control_id, available)``. Degrades instead of raising:
    control_evaluations is one of the tables create_all() provisions at the
    next restart, and a server that has not restarted yet must still be able
    to list its controls — a 5xx here hard-redirects the SPA to
    /service-down. ``available`` is returned rather than inferred from an empty
    dict so a caller can tell "nothing has been evaluated" from "the scores
    could not be read", which are opposite reassurances.

    Every caller runs this as its last database statement, and the two write
    endpoints run it after their commit — deliberately: see the rollback note
    below.
    """
    try:
        rows = (await db.execute(
            select(ControlEvaluation)
            .where(ControlEvaluation.tenant_id == tenant_id)
            .order_by(ControlEvaluation.evaluated_at.desc().nullslast())
        )).scalars().all()
    except (OperationalError, ProgrammingError):
        # PostgreSQL aborts the whole transaction on a failed statement, so
        # without this the request's closing commit in get_db() would raise and
        # turn the graceful degrade back into the 5xx it exists to avoid.
        # Safe: nothing is pending here — the read-only callers have written
        # nothing and the two write endpoints have already committed.
        await db.rollback()
        logger.warning("applied_controls.evaluations_unavailable tenant=%s", tenant_id)
        return {}, False
    latest: dict[str, ControlEvaluation] = {}
    for ev in rows:
        latest.setdefault(ev.applied_control_id, ev)
    return latest, True


async def _assert_tenant_refs(db: AsyncSession, tenant_id: str,
                              *, risk_ids: list[str] | None = None,
                              scenario_ids: list[str] | None = None,
                              owner_id: str | None = None) -> None:
    """Refuse ids that belong to another organization (or to nothing at all).

    A control is a claimed mitigation and an assigned responsibility; both are
    read back by other modules (risks.py builds the residual-risk suggestion
    from risk_ids, the CSV export prints the owner), so an id from outside this
    tenant is either a leak of a foreign identifier or a link that resolves to
    nothing for everyone who looks at it.
    """
    if risk_ids:
        wanted = {r for r in risk_ids if r}
        found = {r[0] for r in (await db.execute(
            select(Risk.id).where(Risk.id.in_(wanted), Risk.tenant_id == tenant_id)
        )).all()}
        missing = wanted - found
        if missing:
            raise HTTPException(422, f"Unknown risk(s) for this organization: {sorted(missing)}")
    if scenario_ids:
        wanted = {s for s in scenario_ids if s}
        found = {s[0] for s in (await db.execute(
            select(RiskScenario.id).where(RiskScenario.id.in_(wanted),
                                          RiskScenario.tenant_id == tenant_id)
        )).all()}
        missing = wanted - found
        if missing:
            raise HTTPException(422, f"Unknown risk scenario(s) for this organization: {sorted(missing)}")
    if owner_id:
        owner = (await db.execute(
            select(User.id).where(User.id == owner_id, User.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if owner is None:
            raise HTTPException(422, "Owner is not a member of this organization")

class ACCreate(BaseModel):
    ref_id: str | None = None; name: str; description: str | None = None
    category: str | None = None; csf_function: str | None = None
    status: str = "planned"; eta: str | None = None; expiration: str | None = None
    effort: str | None = None; cost: float | None = None; recurring_cost: float | None = None
    framework_control_ids: list[str] = []; owner_id: str | None = None
    link: str | None = None; tags: list[str] = []
    # Risks from the register this control mitigates. The column has existed
    # since the "one or more risques OU scenarios" requirement, but no request
    # schema ever carried it, so it stayed [] on every row — which silently
    # emptied the direct-controls half of the residual-risk suggestion in
    # risks.py and the "linked_risks" column of the CSV export.
    risk_ids: list[str] = []
    # AppliedControlsPage's create modal has always sent risk_scenario_ids (its
    # MultiSelect of scenarios), and this schema never declared the field, so
    # pydantic dropped it: the picker wrote nothing, every new control came out
    # with risk_scenario_ids == [], and the "contrôle lié à un ou plusieurs
    # risques *ou scénarios*" link could only be created by a later PATCH that
    # no screen issues. Same omission the risk_ids field above was added for.
    risk_scenario_ids: list[str] = []

class ACUpdate(BaseModel):
    name: str | None = None; description: str | None = None
    category: str | None = None; csf_function: str | None = None
    # progress is a percentage everywhere it is read (the dashboard averages it,
    # the page prints it in a bar); -40 or 300 rendered happily and skewed the
    # average for the whole register.
    status: str | None = None; progress: int | None = Field(None, ge=0, le=100)
    eta: str | None = None; expiration: str | None = None
    effort: str | None = None; cost: float | None = None; recurring_cost: float | None = None
    framework_control_ids: list[str] | None = None; evidence_ids: list[str] | None = None
    risk_scenario_ids: list[str] | None = None; risk_ids: list[str] | None = None
    vulnerability_ids: list[str] | None = None
    owner_id: str | None = None; link: str | None = None; tags: list[str] | None = None


class LatestEvaluationOut(BaseModel):
    """The effectiveness result the register shows next to the control."""
    id: str
    performance_level: str
    score: int                       # the 0-10 sum of the five RFP criteria
    evaluated_at: datetime | None = None
    next_evaluation_at: datetime | None = None
    method: str | None = None
    evidence_ref: str | None = None
    audit_id: str | None = None
    remediation_status: str = "not_required"
    # True once next_evaluation_at is behind us: the score on screen no longer
    # describes the control as it stands.
    is_overdue: bool = False
    model_config = {"from_attributes": True}


class ACOut(BaseModel):
    id: str; tenant_id: str; ref_id: str | None; name: str; description: str | None
    category: str | None; csf_function: str | None; status: str; progress: int
    eta: str | None; expiration: str | None; effort: str | None
    cost: float | None; recurring_cost: float | None
    framework_control_ids: list; evidence_ids: list; risk_scenario_ids: list
    risk_ids: list
    vulnerability_ids: list; owner_id: str | None; link: str | None; tags: list
    validation_status: str; validated_by_id: str | None; validated_at: datetime | None
    validation_notes: str | None
    created_at: datetime; updated_at: datetime
    # --- Derived, never stored (objectif 5) ---
    # Days to the expiration date, negative once past; None when the control
    # carries no expiration at all. Computed rather than stored so it cannot go
    # stale between the write and the read.
    days_until_expiration: int | None = None
    # "deprecated" | "expired" | "expiring_soon" | None — what the badge says.
    obsolescence_state: str | None = None
    # The sign-off is older than the content it signed off on.
    validation_stale: bool = False
    latest_evaluation: LatestEvaluationOut | None = None
    model_config = {"from_attributes": True}


class ControlHistoryOut(BaseModel):
    id: str; applied_control_id: str; action: str; changes: dict
    control_ref_id: str | None = None; control_name: str | None = None
    note: str | None = None
    actor_id: str | None = None; actor_email: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class ControlValidationRequest(BaseModel):
    """Body for POST /{id}/validate and POST /{id}/reject — optional referent notes."""
    notes: str | None = None


def _obsolescence_state(control: AppliedControl, days: int | None) -> str | None:
    """Why this control is (or is about to be) obsolete, for the badge."""
    status = control.status.value if hasattr(control.status, "value") else control.status
    if status == ControlStatus.DEPRECATED.value:
        return "deprecated"
    if days is None:
        # An expiration nobody can parse is worse than none at all: the row
        # displays a renewal date while every expiry check silently skips it,
        # so the control will never alert. New writes are rejected by
        # _validate_fields(); rows written before that existed are surfaced
        # here instead of being quietly ignored.
        return "invalid_expiration" if control.expiration else None
    if days < 0:
        return "expired"
    if days <= EXPIRY_WINDOW_DAYS:
        return "expiring_soon"
    return None


def _validation_stale(control: AppliedControl) -> bool:
    """True when the referent's sign-off predates the control's last edit.

    Editing a validated control deliberately does NOT reset its validation —
    silently un-approving somebody's decision is its own kind of surprise, and
    the history row already records the edit. So the honest thing is to say
    the approval is older than what is now on screen and let a referent
    re-validate.
    """
    state = (control.validation_status.value if hasattr(control.validation_status, "value")
             else control.validation_status)
    if state != ControlValidationStatus.VALIDATED.value:
        return False
    validated_at, updated_at = _naive(control.validated_at), _naive(control.updated_at)
    if validated_at is None or updated_at is None:
        return False
    # A second of tolerance: validate() sets validated_at and the row's
    # onupdate=now() inside the same transaction, and the two can land
    # microseconds apart in either order.
    return (updated_at - validated_at).total_seconds() > 1


def _evaluation_out(evaluation: ControlEvaluation | None, now: datetime) -> LatestEvaluationOut | None:
    if evaluation is None:
        return None
    next_at = _naive(evaluation.next_evaluation_at)
    return LatestEvaluationOut(
        id=evaluation.id,
        performance_level=evaluation.performance_level,
        score=(evaluation.formalisme + evaluation.type_controle + evaluation.timing
               + evaluation.tracabilite + evaluation.quatre_yeux),
        evaluated_at=evaluation.evaluated_at,
        next_evaluation_at=evaluation.next_evaluation_at,
        method=evaluation.method,
        evidence_ref=evaluation.evidence_ref,
        audit_id=evaluation.audit_id,
        remediation_status=evaluation.remediation_status or "not_required",
        is_overdue=bool(next_at and next_at < now),
    )


def _out(control: AppliedControl, evaluation: ControlEvaluation | None = None, *,
         today: date | None = None, now: datetime | None = None) -> ACOut:
    """One register row, with everything objectif 5 asks to see on it."""
    now = now or _utcnow()
    today = today or now.date()
    row = ACOut.model_validate(control)
    row.days_until_expiration = _days_until(control.expiration, today)
    row.obsolescence_state = _obsolescence_state(control, row.days_until_expiration)
    row.validation_stale = _validation_stale(control)
    row.latest_evaluation = _evaluation_out(evaluation, now)
    return row


async def _attach_evaluations(db: AsyncSession, tenant_id: str,
                              rows: list[ACOut], now: datetime) -> bool:
    """Hang each row's latest evaluation on an already-materialised ACOut list.

    Order matters and is not stylistic: this runs *after* the ORM instances
    have been converted to Pydantic, never before. A failed read of
    control_evaluations rolls the session back (see _latest_evaluations), and
    a rollback EXPIRES every ORM instance still attached to that session — the
    next attribute access would emit a lazy SELECT from async context and
    raise MissingGreenlet, i.e. the very 5xx (and the /service-down ejection)
    this degradation exists to prevent. ACOut rows hold plain values and are
    immune. Returns whether the evaluations could be read at all.
    """
    latest, available = await _latest_evaluations(db, tenant_id)
    for row in rows:
        row.latest_evaluation = _evaluation_out(latest.get(row.id), now)
    return available

@router.get("", response_model=list[ACOut])
async def list_controls(
    response: Response,
    status: str | None = None,
    validation_status: str | None = None,
    expiring_within_days: int | None = Query(
        None, ge=0, le=3650,
        description="Only controls whose expiration falls within N days. "
                    "Already-expired ones are included, as in /assets/lifecycle/eol-soon.",
    ),
    include_evaluation: bool = Query(
        False, description="Attach each control's latest effectiveness evaluation.",
    ),
    limit: int = Query(1000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Bounded, with the total in X-Total-Count — see list_vulns.

    ``status`` / ``validation_status`` answer objectif 5's « leur état » (the
    two are independent: a control can be implemented and never signed off).
    ``expiring_within_days`` is the obsolescence filter.
    """
    # An empty query string is how a UI spells "no filter" (axios sends
    # ?status= for an unset <select>), and 422-ing it would turn the default
    # view of the register into an error. Blank is absent here; on a *write*
    # it stays a 422, because "" is not a status a row may hold.
    status = status or None
    validation_status = validation_status or None
    _validate_fields(status=status, validation_status=validation_status)
    q = select(AppliedControl).where(AppliedControl.tenant_id == tenant_id)
    if status: q = q.where(AppliedControl.status == status)
    if validation_status: q = q.where(AppliedControl.validation_status == validation_status)

    now = _utcnow()
    today = now.date()
    if expiring_within_days is None:
        total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
        rows = list((await db.execute(
            q.order_by(AppliedControl.created_at.desc()).offset(offset).limit(limit)
        )).scalars().all())
    else:
        # expiration is a String(20) holding whatever was typed, so the window
        # cannot be a SQL comparison — "2026-9-1" and "" sort as text, not as
        # dates, and a lexicographic <= would both miss real rows and match
        # junk. Narrow in SQL to the rows that carry an expiration at all, then
        # decide in Python with the same parser the notification job uses.
        candidates = list((await db.execute(
            q.where(AppliedControl.expiration.is_not(None), AppliedControl.expiration != "")
        )).scalars().all())
        matched = []
        for c in candidates:
            days = _days_until(c.expiration, today)
            if days is not None and days <= expiring_within_days:
                matched.append((days, c))
        matched.sort(key=lambda pair: (pair[0], pair[1].name or ""))  # most overdue first
        total = len(matched)
        rows = [c for _days, c in matched[offset: offset + limit]]

    response.headers["X-Total-Count"] = str(total)
    out_rows = [_out(c, today=today, now=now) for c in rows]
    if include_evaluation:
        # _attach_evaluations returns whether control_evaluations could be read
        # at all. Dropping it made "no evaluation recorded" and "the evaluations
        # could not be read" both arrive as latest_evaluation=null, so the
        # register had no way to tell a genuinely unscored control from a
        # degraded read. Surfaced as a header, like X-Total-Count above, and
        # named after the flag /obsolescence already returns in its body.
        available = await _attach_evaluations(db, tenant_id, out_rows, now)
        response.headers["X-Evaluations-Available"] = "true" if available else "false"
    return out_rows

@router.post("", response_model=ACOut, status_code=201)
async def create_control(
    body: ACCreate,
    db: AsyncSession = Depends(get_db),
    # A deployed security measure is not something any account should be able
    # to add, edit or remove. Validation was already restricted to the security
    # referent; the record itself was open to every authenticated user, which
    # made the gate on validation largely decorative.
    user: User = Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER, UserRole.SECURITY_ANALYST, UserRole.CONTROL_OWNER)),
    tenant_id: str = Depends(get_tenant_id),
):
    _validate_fields(status=body.status, effort=body.effort, csf_function=body.csf_function,
                     eta=body.eta, expiration=body.expiration)
    await _assert_tenant_refs(db, tenant_id, risk_ids=body.risk_ids,
                              scenario_ids=body.risk_scenario_ids, owner_id=body.owner_id)
    c = AppliedControl(tenant_id=tenant_id, ref_id=body.ref_id, name=body.name,
                       description=body.description, category=body.category, csf_function=body.csf_function,
                       status=body.status, eta=body.eta, expiration=body.expiration,
                       effort=body.effort, cost=body.cost, recurring_cost=body.recurring_cost,
                       framework_control_ids=body.framework_control_ids,
                       risk_ids=body.risk_ids, risk_scenario_ids=body.risk_scenario_ids,
                       owner_id=body.owner_id or user.id, link=body.link, tags=body.tags)
    db.add(c); await db.flush()
    registry.record(db, c, "created", actor=user,
                    changes=registry.diff({}, registry.snapshot(c)))
    await _commit_or_424(db); await db.refresh(c)
    return _out(c)


# ── Objectif 5: obsolescence alerts and the register-wide change feed ──────
# Both are declared BEFORE GET /{cid}. FastAPI matches routes in declaration
# order, so "/obsolescence" and "/history" registered after the id route would
# be swallowed by it and answered with 404 "Control not found" — the same
# ordering rule /control-evaluations/action-required documents.

class ObsolescenceItem(BaseModel):
    """One control that needs attention, with every reason it was flagged."""
    id: str; ref_id: str | None = None; name: str
    status: str; validation_status: str; owner_id: str | None = None
    expiration: str | None = None
    days_until_expiration: int | None = None
    # Any of: expired, expiring_soon, deprecated, invalid_expiration,
    # rejected_in_service, unverified, ineffective, evaluation_overdue,
    # never_evaluated.
    reasons: list[str] = []
    performance_level: str | None = None
    remediation_status: str | None = None
    last_evaluated_at: datetime | None = None
    next_evaluation_at: datetime | None = None
    model_config = {"from_attributes": True}


class ObsolescenceOut(BaseModel):
    window_days: int
    total_controls: int
    total_flagged: int
    counts: dict[str, int]
    # False when control_evaluations could not be read (a server that has not
    # restarted since the table was added): the effectiveness reasons are then
    # absent from the answer and the UI must say so rather than imply that
    # every control evaluated fine.
    evaluations_available: bool = True
    items: list[ObsolescenceItem]


# Worst first. An expired control is a mitigation the register is still
# counting that stopped existing; a never-evaluated one is only a gap in
# assurance.
_REASON_ORDER = (
    "expired", "rejected_in_service", "ineffective", "expiring_soon",
    "deprecated", "invalid_expiration", "evaluation_overdue", "unverified",
    "never_evaluated",
)


@router.get("/obsolescence", response_model=ObsolescenceOut)
async def obsolescence_alerts(
    window_days: int = Query(EXPIRY_WINDOW_DAYS, ge=1, le=365,
                             description="Warn this many days before expiry."),
    limit: int = Query(500, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """« Alertes sur les contrôles obsolètes » — the working alert list.

    One row per control that needs attention, carrying every reason:

    * expired / expiring_soon / deprecated / invalid_expiration — the
      control's own life. Same 30-day default window and same date parsing as
      check_control_expiration(), so this list and the notification a user
      received cannot contradict each other; invalid_expiration is the row
      whose renewal date neither of them can read, which would otherwise be
      an expiry that silently never fires.
    * rejected_in_service / unverified — in service (in_progress, implemented)
      for more than the grace period without a valid security-referent
      sign-off. "Un contrôle expiré **ou non vérifié**" — the second half is
      the more dangerous one, because everything reading the register counts
      an unverified control as a mitigation.
    * ineffective / evaluation_overdue / never_evaluated — its effectiveness.
      "Un suivi spécifique est mis en place pour les contrôles déclarés
      obsolètes, inefficaces ou non conformes."

    Read-only, so it is open to any authenticated member of the tenant — the
    same access the register itself has.
    """
    now = _utcnow()
    today = now.date()
    grace_cutoff = now - timedelta(days=UNVERIFIED_GRACE_DAYS)

    controls = list((await db.execute(
        select(AppliedControl).where(AppliedControl.tenant_id == tenant_id)
    )).scalars().all())

    # First pass: everything that can be decided from the control itself, read
    # off the ORM rows and copied into plain values BEFORE control_evaluations
    # is touched. That table may not exist yet, and the rollback that failure
    # forces would expire these instances mid-loop (see _attach_evaluations).
    total_controls = len(controls)
    candidates: list[tuple[ObsolescenceItem, bool]] = []   # (item, in_service_and_old_enough)
    for c in controls:
        status = c.status.value if hasattr(c.status, "value") else c.status
        validation = (c.validation_status.value if hasattr(c.validation_status, "value")
                      else (c.validation_status or ControlValidationStatus.PENDING.value))
        days = _days_until(c.expiration, today)
        reasons: list[str] = []

        if status == ControlStatus.DEPRECATED.value:
            reasons.append("deprecated")
        if days is None:
            # A renewal date the parser cannot read is an expiry that will
            # never fire — an untracked control that looks tracked.
            if c.expiration:
                reasons.append("invalid_expiration")
        elif days < 0:
            reasons.append("expired")
        elif days <= window_days:
            reasons.append("expiring_soon")

        created_at = _naive(c.created_at)
        # In service and past the grace period: a measure recorded last week is
        # not "unverified", it is new, and a control planned for next quarter
        # has nothing to evaluate yet. Flagging either would drown the real ones.
        assessable = (status in IN_SERVICE_STATUSES
                      and (created_at is None or created_at <= grace_cutoff))
        if assessable:
            if validation == ControlValidationStatus.REJECTED.value:
                reasons.append("rejected_in_service")
            elif validation != ControlValidationStatus.VALIDATED.value:
                reasons.append("unverified")

        candidates.append((ObsolescenceItem(
            id=c.id, ref_id=c.ref_id, name=c.name, status=status,
            validation_status=validation, owner_id=c.owner_id,
            expiration=c.expiration, days_until_expiration=days, reasons=reasons,
        ), assessable))

    # Now the effectiveness half. Read last, and the availability flag is kept:
    # announcing zero ineffective controls because the table is missing would be
    # a fabricated reassurance, and this endpoint exists so that nobody is
    # reassured by accident.
    latest, evaluations_available = await _latest_evaluations(db, tenant_id)

    items: list[ObsolescenceItem] = []
    counts: dict[str, int] = {r: 0 for r in _REASON_ORDER}
    for item, assessable in candidates:
        ev = latest.get(item.id)
        if evaluations_available:
            if ev is None:
                if assessable:
                    item.reasons.append("never_evaluated")
            else:
                if ev.performance_level == NON_PERFORMANT or (
                    ev.remediation_status in ("open", "in_progress")
                ):
                    item.reasons.append("ineffective")
                next_at = _naive(ev.next_evaluation_at)
                if next_at is not None and next_at < now:
                    item.reasons.append("evaluation_overdue")
                item.performance_level = ev.performance_level
                item.remediation_status = ev.remediation_status
                item.last_evaluated_at = ev.evaluated_at
                item.next_evaluation_at = ev.next_evaluation_at

        if not item.reasons:
            continue
        for reason in item.reasons:
            counts[reason] = counts.get(reason, 0) + 1
        items.append(item)

    def _rank(item: ObsolescenceItem) -> tuple:
        worst = min((_REASON_ORDER.index(r) for r in item.reasons
                     if r in _REASON_ORDER), default=len(_REASON_ORDER))
        # Then most overdue first; controls with no date sort after those with one.
        return (worst, item.days_until_expiration if item.days_until_expiration is not None else 10**6,
                item.name or "")

    items.sort(key=_rank)
    return ObsolescenceOut(
        window_days=window_days,
        total_controls=total_controls,
        total_flagged=len(items),
        counts=counts,
        evaluations_available=evaluations_available,
        items=items[:limit],
    )


@router.get("/history", response_model=list[ControlHistoryOut])
async def list_register_history(
    response: Response,
    action: str | None = None,
    control_id: str | None = None,
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """« Historique des modifications visible » for the whole register, newest first.

    GET /{cid}/history answers the same question for one control; somebody
    opening the register wants its recent changes without having to guess
    which control to click first — including changes to controls that have
    since been deleted, which is why this reads the history table directly
    instead of joining back to applied_controls.
    """
    if action and action not in CONTROL_ACTIONS:
        raise HTTPException(422, f"action must be one of {list(CONTROL_ACTIONS)}")
    q = select(AppliedControlHistory).where(AppliedControlHistory.tenant_id == tenant_id)
    if action: q = q.where(AppliedControlHistory.action == action)
    if control_id: q = q.where(AppliedControlHistory.applied_control_id == control_id)
    try:
        total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
        rows = list((await db.execute(
            q.order_by(AppliedControlHistory.created_at.desc()).offset(offset).limit(limit)
        )).scalars().all())
    except (OperationalError, ProgrammingError) as exc:
        # Empty would be a lie here — it would assert that nothing has ever
        # been changed in the register — so this one degrades to an explicit
        # 424 the operator can act on rather than to [].
        # Rolled back first: PostgreSQL aborts the whole transaction on a
        # failed statement, so without this get_db()'s closing commit raises
        # and the 424 becomes the 5xx it exists to avoid.
        await db.rollback()
        raise _table_not_ready("applied_control_history", exc)
    response.headers["X-Total-Count"] = str(total)
    return [ControlHistoryOut.model_validate(r) for r in rows]


@router.get("/{cid}", response_model=ACOut)
async def get_control(cid: str, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user), tenant_id: str = Depends(get_tenant_id)):
    """One control, always carrying its latest effectiveness evaluation.

    Unconditional here (unlike the list, which asks for it) — this is the
    detail view a referent validates from, and « résultats des évaluations
    d'efficacité » is precisely what that decision rests on.
    """
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c: raise HTTPException(404, "Control not found")
    row = _out(c)
    await _attach_evaluations(db, tenant_id, [row], _utcnow())
    return row

@router.patch("/{cid}", response_model=ACOut)
async def update_control(
    cid: str,
    body: ACUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER, UserRole.SECURITY_ANALYST, UserRole.CONTROL_OWNER)),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c: raise HTTPException(404, "Control not found")
    _validate_fields(status=body.status, effort=body.effort, csf_function=body.csf_function,
                     eta=body.eta, expiration=body.expiration)
    await _assert_tenant_refs(db, tenant_id, risk_ids=body.risk_ids,
                              scenario_ids=body.risk_scenario_ids, owner_id=body.owner_id)
    before = registry.snapshot(c)
    # exclude_unset tells an omitted field from one explicitly sent as null.
    # The old loop skipped every None, so a field could only ever be replaced,
    # never cleared — and a mistyped expiration that keeps firing "control
    # EXPIRED" alerts could not be removed, only swapped for another date.
    provided = body.model_dump(exclude_unset=True)
    for f in ["name","description","category","csf_function","status","progress","eta","expiration",
              "effort","cost","recurring_cost","framework_control_ids","evidence_ids",
              "risk_scenario_ids","risk_ids","vulnerability_ids","owner_id","link","tags"]:
        if f not in provided: continue
        v = provided[f]
        # A null on a field the column declares NOT NULL (name, status,
        # progress, the JSON link lists) stays a no-op rather than an
        # IntegrityError — a 5xx there would eject the user to /service-down.
        if v is None and f not in _CLEARABLE_FIELDS: continue
        setattr(c, f, v)
    changes = registry.diff(before, registry.snapshot(c))
    if changes:
        registry.record(db, c, registry.action_for(changes), actor=user, changes=changes)
    await _commit_or_424(db); await db.refresh(c)
    # The effectiveness result travels with the row here as it does on GET,
    # validate and reject. Without it a PATCH answered latest_evaluation=null
    # for a control that HAS been evaluated, so a page that splices the
    # response back into its list — the ordinary way to avoid a refetch —
    # blanked the « résultats des évaluations » column on every save.
    row = _out(c)
    await _attach_evaluations(db, tenant_id, [row], _utcnow())
    return row

@router.delete("/{cid}", status_code=204)
async def delete_control(
    cid: str,
    reason: str = Query(..., min_length=3, description="Required justification for deleting this applied control"),
    db: AsyncSession = Depends(get_db),
    # Deletion is narrower than editing: removing a control removes a claimed
    # mitigation from every risk that counted on it.
    user: User = Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
):
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c: raise HTTPException(404, "Control not found")
    # This read happens first, while the session holds nothing pending: it
    # touches control_evaluations, which a server that has not restarted since
    # the table was added does not have, and the rollback that failure forces
    # would otherwise discard the history entry and the delete below (and
    # expire `c`, whose next attribute access would raise MissingGreenlet).
    try:
        orphans = list((await db.execute(
            select(ControlEvaluation).where(
                ControlEvaluation.applied_control_id == c.id,
                ControlEvaluation.tenant_id == tenant_id,
            )
        )).scalars().all())
    except (OperationalError, ProgrammingError):
        await db.rollback()
        logger.warning("applied_controls.evaluations_unavailable tenant=%s", tenant_id)
        orphans = []
        # The rollback expired every instance in THIS session — the control and
        # the acting user both came out of it (get_current_user shares the
        # request's session). Reloaded with an awaited refresh: a plain
        # attribute access on an expired instance emits a lazy SELECT from
        # async context and raises MissingGreenlet, which is the very 5xx —
        # and the /service-down ejection — this guard exists to avoid. Caught
        # by renaming control_evaluations away on a database copy.
        await db.refresh(c)
        await db.refresh(user)
    # Both reads that this handler needs are issued before the first history
    # row is queued. Once one is pending, ANY later SELECT autoflushes it, so a
    # missing applied_control_history raises out of that innocent-looking read
    # instead of out of the commit — where _commit_or_424 could still turn it
    # into a 424. Reordered after exactly that turned up as a 500 on a database
    # copy with the table renamed away.
    scenarios = (await db.execute(
        select(RiskScenario).where(
            RiskScenario.tenant_id == tenant_id,
            cast(RiskScenario.applied_control_ids, String).ilike(f'%"{c.id}"%'),
        )
    )).scalars().all()
    control_name = c.name
    # Recorded before the delete, with the full final state: once the row is
    # gone this entry is the only evidence the control ever existed.
    #
    # Spelled out field by field rather than as diff(snapshot, {}): diff()
    # iterates its *after* argument, so diff(state, {}) is {} — every deletion
    # entry in the register was being written with an EMPTY change set, and the
    # one row that has to stand in for the control after it is gone recorded
    # nothing but its name. « Les suppressions sont historisées pour assurer la
    # traçabilité » is not satisfied by an entry that says only that something
    # was deleted. Same {"field": {"from": …, "to": …}} shape every other entry
    # uses, so a reader (and the frontend history drawer) needs no special case;
    # fields that held nothing are omitted, exactly as diff() omits unchanged ones.
    registry.record(db, c, "deleted", actor=user,
                    changes={field: {"from": value, "to": None}
                             for field, value in registry.snapshot(c).items()
                             if value is not None and value != "" and value != []},
                    note=reason)
    # Remove this control's effectiveness evaluations with it. There is no FK
    # cascade, and an evaluation whose control no longer exists is not history —
    # it is a live row that keeps appearing in the evaluation list and, if its
    # follow-up was still open, in the action-required queue, pointing at
    # nothing. The record that the control existed and was evaluated is kept in
    # applied_control_history, which is where it belongs.
    if orphans:
        # Copy the scores into the history entry BEFORE dropping the rows. The
        # deletion entry above only carries the control's own fields, so without
        # this the fact that the control was assessed — and what it scored, on
        # what evidence, with what follow-up still open — disappeared with it.
        # An effectiveness assessment is exactly what an auditor asks to see
        # after the fact.
        registry.record(
            db, c, "updated", actor=user,
            changes={"control_evaluations": {
                "from": [
                    {"evaluated_at": ev.evaluated_at.isoformat() if ev.evaluated_at else None,
                     "performance_level": ev.performance_level,
                     "score": (ev.formalisme + ev.type_controle + ev.timing
                               + ev.tracabilite + ev.quatre_yeux),
                     "method": ev.method, "evidence_ref": ev.evidence_ref,
                     "audit_id": ev.audit_id,
                     "remediation_status": ev.remediation_status,
                     "evaluated_by_id": ev.evaluated_by_id}
                    for ev in orphans
                ],
                "to": [],
            }},
            note=f"Removed {len(orphans)} effectiveness evaluation(s) with the control.",
        )
    for ev in orphans:
        await db.delete(ev)

    # Detach the control from any scenario that listed it. There is no FK on
    # RiskScenario.applied_control_ids either, so without this a scenario goes
    # on claiming a mitigating control that no longer exists — which overstates
    # its treatment, and is worse than the link simply being absent.
    detached = []
    for sc in scenarios:
        if c.id in (sc.applied_control_ids or []):
            # Reassign rather than mutate: SQLAlchemy does not track in-place
            # edits to a JSON column.
            sc.applied_control_ids = [x for x in sc.applied_control_ids if x != c.id]
            detached.append(sc.ref_id or sc.name)
    if detached:
        registry.record(
            db, c, "updated", actor=user,
            changes={"detached_from_scenarios": {"from": detached, "to": []}},
            note=f"Removed as a mitigation from {len(detached)} scenario(s) on deletion.",
        )

    await db.delete(c); await _commit_or_424(db)

    # The generic ActivityLogMiddleware only records {method, path} for every mutating
    # request — it can't see query params, so the deletion reason wouldn't otherwise be
    # captured anywhere. Write an explicit entry to the same hash-chained log with the
    # reason included, reusing the existing activity_chain service (no new subsystem).
    try:
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=user.id,
            user_email=user.email,
            action="delete",
            entity_type="applied_control",
            entity_id=cid,
            entity_name=control_name,
            details={"reason": reason},
        ))
    except Exception:
        pass


@router.get("/{cid}/history", response_model=list[ControlHistoryOut])
async def get_control_history(
    cid: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Everything that has happened to this control, newest first.

    Scoped on the history rows rather than by loading the control first,
    because the entry that matters most is the one written for a control that
    no longer exists.

    (ControlHistoryOut is declared with the other schemas at the top of the
    file: GET /history, the register-wide feed, has to be registered before
    GET /{cid} and therefore needs the model already defined.)
    """
    try:
        rows = list((await db.execute(
            select(AppliedControlHistory)
            .where(AppliedControlHistory.tenant_id == tenant_id,
                   AppliedControlHistory.applied_control_id == cid)
            .order_by(AppliedControlHistory.created_at.desc())
        )).scalars().all())
    except (OperationalError, ProgrammingError) as exc:
        # applied_control_history is created by create_all() at the next
        # restart. An empty list would assert that nothing has ever happened to
        # this control, which is the opposite of what a traceability view is
        # for — so say what is actually wrong, as a 424 rather than a 5xx that
        # would eject the user to /service-down. Rolled back first, for the
        # same PostgreSQL reason as the register-wide feed above.
        await db.rollback()
        raise _table_not_ready("applied_control_history", exc)
    return [ControlHistoryOut.model_validate(r) for r in rows]


# ── Security-referent validation workflow (Elite Pack) ─────────────────────
# A control's implementation status (planned/in_progress/...) says nothing
# about whether a security referent has actually reviewed and signed off on
# it. These two endpoints add that formal approval gate — restricted to the
# same security-referent role tuple used for vulnerability mutations
# (CISO / risk_manager; tenant_admin and super_admin auto-pass via
# require_roles()). Mirrors the shape of the Vulnerability validation
# workflow (POST /vulnerabilities/{id}/validate) and the VendorContract CISO
# approve/reject workflow.

@router.post("/{cid}/validate", response_model=ACOut)
async def validate_control(
    cid: str,
    body: ControlValidationRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Security-referent approval — marks the control as formally validated."""
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Control not found")
    previous = c.validation_status
    c.validation_status = ControlValidationStatus.VALIDATED.value
    c.validated_by_id = current_user.id
    c.validated_at = _utcnow()
    if body.notes is not None:
        c.validation_notes = body.notes
    registry.record(
        db, c, "validated", actor=current_user,
        changes={"validation_status": {"from": previous, "to": c.validation_status}},
        note=body.notes,
    )
    await _commit_or_424(db); await db.refresh(c)
    row = _out(c)
    await _attach_evaluations(db, tenant_id, [row], _utcnow())
    return row


@router.post("/{cid}/reject", response_model=ACOut)
async def reject_control(
    cid: str,
    body: ControlValidationRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.CISO, UserRole.RISK_MANAGER))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Security-referent rejection — sends the control back for rework."""
    r = await db.execute(select(AppliedControl).where(AppliedControl.id == cid, AppliedControl.tenant_id == tenant_id))
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Control not found")
    previous = c.validation_status
    c.validation_status = ControlValidationStatus.REJECTED.value
    c.validated_by_id = current_user.id
    c.validated_at = _utcnow()
    if body.notes is not None:
        c.validation_notes = body.notes
    registry.record(
        db, c, "rejected", actor=current_user,
        changes={"validation_status": {"from": previous, "to": c.validation_status}},
        note=body.notes,
    )
    await _commit_or_424(db); await db.refresh(c)
    row = _out(c)
    await _attach_evaluations(db, tenant_id, [row], _utcnow())
    return row
