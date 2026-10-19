"""Framework management endpoints.

The AI control-suggestion endpoint (POST /builder/ai-suggestions) runs on the shared AI
foundation: an expert system prompt + output schema from ``app.services.ai_prompts`` (task
"framework_builder"), a validated structured call from ``ai_structured`` (schema validation,
a semantic consistency check, one repair retry), transport + untrusted-text delimiting +
deterministic decoding + quota metering from ``ai_provider`` (tenant BYO-AI honoured), and
request-language resolution from ``ai_locale`` (Accept-Language en|fr|ar). Only Ollama is
ever called, and only through ``ai_provider``. A failed or still-inconsistent reply surfaces
as an explicit HTTP 424 (never a 5xx — client.ts hard-redirects the SPA to /service-down on
any 5xx) — never a silently invented suggestion set.

Referential classification (STB objectif 1 — « Chaque exigence est classée par source
(norme/réglementation), domaine, type, et applicabilité »). A framework carries
``source_type`` (norme | reglementation | loi | politique_interne); a control carries
``domain`` (controlled vocabulary), ``requirement_type`` (exigence | recommandation |
mesure) and ``is_mandatory``; applicability is per-tenant and lives in
``control_applicability`` because built-in control rows are shared across every tenant.
All four are returned on the responses AND accepted as filters — a classification nobody
can filter on is not a classification. Each of them is nullable and a NULL is never
bucketed into a value: an unclassified control behaves exactly as it did before the
columns existed, which is what keeps the 4 537 live control rows working untouched.

``POST /import`` (multipart csv | xlsx | yaml) upserts controls by (framework_id,
control_id) with a two-pass parent resolution, because « mise à jour manuelle ou import
automatisé possible » cannot be met by a bank typing four thousand requirements by hand.

Requirement text is resolved into the caller's language through ``control_translations``
and falls back per field to the stored text, so the corpus itself — not only the chrome
around it — reads in French and Arabic.
"""
import asyncio
import csv
import hashlib
import io
import json
import logging
import re
from datetime import datetime

import yaml
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy import delete, func, or_, select, update
from pydantic import BaseModel, field_validator
from typing import Annotated

from app.core.config import settings
from app.core.database import get_db
from app.core import ai_quota
from app.core.security_utils import assert_safe_upload_name
from app.models.activity_log import ActivityLog
from app.models.control_applicability import APPLICABILITY_VALUES, ControlApplicability
from app.models.control_translation import SUPPORTED_LANGS, ControlTranslation
from app.models.framework import Framework, FrameworkControl, ControlCategory, ControlRequirement, FrameworkStatus, FrameworkControlVersion
from app.models.org_unit import BusinessProcess, OrgEntity
from app.api.v1.dependencies import get_current_user, get_tenant_id, get_current_user_optional, get_tenant_id_optional
from app.api.v1.dependencies.auth import require_roles
from app.models.user import User, UserRole
from app.workers.tasks.notifications import notify_framework_new, notify_framework_updated
from app.services import ai_chunking, ai_prompts, ai_provider
from app.services.activity_chain import chain_and_add
from app.services.ai_locale import failure_message, get_request_language
from app.services.content_translation import get_display_language, localize_fields
from app.services.ai_structured import AiResult, ai_structured

# ── Controlled vocabularies (STB objectif 1) ─────────────────────────────────
#
# What a framework *is*. Only these four values are accepted; a framework whose
# source_type is still NULL is unclassified and is never guessed at.
SOURCE_TYPES = ("norme", "reglementation", "loi", "politique_interne")

# What a single line of a referential *is*: a binding requirement, a recommendation,
# or a concrete control/mesure.
REQUIREMENT_TYPES = ("exigence", "recommandation", "mesure")

# The bucket the facets report a NULL under. It is a filter value as well as a label:
# every facet the register draws has to be clickable, and "unclassified" is the largest
# bucket by far until scripts/backfill_framework_source_type.py and
# scripts/backfill_control_domain.py have been run — with a residue afterwards, since
# both scripts leave a value they cannot map NULL on purpose. Without this the reader
# sees "unclassified 3 871", clicks it and gets nothing back.
UNCLASSIFIED = "unclassified"


def _classification_clause(column, value: str):
    """Match a classification column, treating "unclassified" as "the column is NULL".

    Comparison is case-insensitive on both sides, so a backfill's display casing
    ("Norme") and a client's slug ("norme") select the same rows.
    """
    if value.strip().lower() == UNCLASSIFIED:
        return column.is_(None)
    return func.lower(column) == value.strip().lower()

# ControlCategory is a str-enum whose NAMES and VALUES deliberately disagree
# (POLICY = "POLICY" but ORGANIZATIONAL = "Organizational"), and the seeded corpus
# stores the VALUES, mostly lower-cased: 'organizational' on 1 819 rows against
# 'ORGANIZATIONAL' on 56. The old `_VALID_CATEGORIES = {c.name for c in ControlCategory}`
# therefore compared an upper-cased input against NAMES only, so a correctly spelled
# "Organizational" was accepted but stored upper-cased (splitting the domain again),
# and — worse — normalize_category's fallback wrote the literal 'TECHNICAL', a string
# that is not a member of the enum at all under either spelling. Every unrecognised
# category silently became an invalid value.
#
# Lookup is now case-folded across names *and* values and resolves to the canonical
# VALUE, which is what the rest of the corpus already holds.
_CATEGORY_BY_KEY: dict[str, str] = {}
for _cat in ControlCategory:
    _CATEGORY_BY_KEY[_cat.name.upper()] = _cat.value
    _CATEGORY_BY_KEY[_cat.value.upper()] = _cat.value
# Kept under its original name: other code in this module tests membership with it.
_VALID_CATEGORIES = set(_CATEGORY_BY_KEY)

# The controlled vocabulary `domain` is validated against — the same set
# scripts/backfill_control_domain.py maps the 157 raw `category` values onto.
DOMAIN_VALUES = tuple(sorted({c.value for c in ControlCategory}))

router = APIRouter()
logger = logging.getLogger(__name__)


def canonical_category(value: str | None) -> str | None:
    """Map free text onto the canonical ControlCategory VALUE, else keep the caller's text.

    Unrecognised text is preserved (trimmed to the column width) rather than replaced by
    an invented label: `category` is documented as uncontrolled free text — `domain` is
    the controlled vocabulary — and silently relabelling a bank's own wording as
    'TECHNICAL' is worse than keeping what they wrote.
    """
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    key = raw.upper().replace(" ", "_").replace("&", "AND")
    return _CATEGORY_BY_KEY.get(key) or _CATEGORY_BY_KEY.get(raw.upper()) or raw[:50]


def canonical_domain(value: str | None) -> str | None:
    """Resolve `domain` against the controlled vocabulary. Raises ValueError otherwise.

    Strict where `category` is lenient: `domain` exists precisely so that a
    cross-framework "show me everything in this domaine" filter returns one bucket per
    domain instead of 157 case variants. Nothing writes this column today, so a strict
    validator cannot regress live data.
    """
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    key = raw.upper().replace(" ", "_").replace("&", "AND")
    resolved = _CATEGORY_BY_KEY.get(key) or _CATEGORY_BY_KEY.get(raw.upper())
    if not resolved:
        raise ValueError("domain must be one of: %s" % ", ".join(DOMAIN_VALUES))
    return resolved


def canonical_choice(value: str | None, allowed: tuple[str, ...], field: str) -> str | None:
    """Case-fold a value into one of `allowed`. Raises ValueError otherwise."""
    if value is None:
        return None
    raw = str(value).strip().lower().replace(" ", "_").replace("-", "_")
    if not raw:
        return None
    if raw not in allowed:
        raise ValueError("%s must be one of: %s" % (field, ", ".join(allowed)))
    return raw


def canonical_mapped_controls(value) -> list[dict]:
    """Normalise a crosswalk into the exact shape the corpus already stores.

    Live rows are ``[{"framework": "SOC2-TYPE2", "control": "CC1.1"}, ...]`` (93 controls
    carry one today), so an *editable* crosswalk has to keep producing that and nothing
    else — otherwise get_control_crosswalk starts handing the UI two incompatible shapes.
    A "FW:CONTROL" string and a JSON string are also accepted, because that is what a
    CSV/XLSX column realistically contains.
    """
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if text.startswith("["):
            try:
                value = json.loads(text)
            except Exception:
                raise ValueError("mapped_controls: not valid JSON")
            items = list(value) if isinstance(value, list) else [value]
        else:
            items = [p for p in re.split(r"[;\n]", text) if p.strip()]
    elif isinstance(value, (list, tuple)):
        items = list(value)
    else:
        raise ValueError("mapped_controls must be a list")

    out: list[dict] = []
    for item in items:
        if isinstance(item, dict):
            fw_ref = str(item.get("framework") or item.get("framework_short_name") or "").strip()
            ctrl_ref = str(item.get("control") or item.get("control_id") or "").strip()
        else:
            text = str(item).strip()
            if not text:
                continue
            fw_ref, _, ctrl_ref = text.partition(":")
            fw_ref, ctrl_ref = fw_ref.strip(), ctrl_ref.strip()
        if not fw_ref or not ctrl_ref:
            raise ValueError(
                'each mapping needs a framework and a control — {"framework": "ISO27001", '
                '"control": "A.5.1"} or "ISO27001:A.5.1"'
            )
        out.append({"framework": fw_ref[:100], "control": ctrl_ref[:100]})

    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for mapping in out:
        key = (mapping["framework"].lower(), mapping["control"].lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(mapping)
    return deduped


def _ai_failure_detail(res: AiResult, lang: str) -> str:
    """"<localised sentence> (<kind>: <admin-safe detail>)" for an HTTPException(424, ...)."""
    return "%s (%s)" % (res.user_message(lang), res.failure_detail())


async def _get_visible_framework(
    db: AsyncSession, framework_id: str, tenant_id: str | None, user: User
) -> Framework:
    """Fetch a framework the caller is allowed to READ: built-in, or owned by their tenant.

    Read access here used to be "any framework id at all", so one tenant could read
    another tenant's custom referential — including a fork carrying that bank's own
    wording — simply by knowing its id. super_admin keeps platform-wide read so the admin
    console does not regress. 404 rather than 403 on a foreign framework: existence of
    another tenant's referential is itself information.
    """
    result = await db.execute(select(Framework).where(Framework.id == framework_id))
    fw = result.scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")
    if not fw.is_builtin and fw.tenant_id != tenant_id and user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=404, detail="Framework not found")
    return fw


async def _translations_for_framework(
    db: AsyncSession, framework_id: str, lang: str | None
) -> dict[str, ControlTranslation]:
    """{control.id: ControlTranslation} for one framework in the caller's language.

    Returns {} for English (the corpus is stored in English — an 'en' row would be a
    rewrite, not a translation) and {} when the table does not exist yet:
    control_translations is created by create_all() at the next restart, and until then
    the referential must keep serving its original text rather than 500 (client.ts hard-
    redirects the SPA to /service-down on any 5xx).
    """
    code = (lang or "en").split("-")[0].strip().lower()
    if code == "en" or code not in SUPPORTED_LANGS:
        return {}
    try:
        rows = (await db.execute(
            select(ControlTranslation)
            .join(FrameworkControl, FrameworkControl.id == ControlTranslation.control_id)
            .where(FrameworkControl.framework_id == framework_id, ControlTranslation.lang == code)
        )).scalars().all()
    except (OperationalError, ProgrammingError):
        logger.debug("frameworks.translations.unavailable framework=%s lang=%s", framework_id, code)
        return {}
    return {row.control_id: row for row in rows}


async def _translations_for_controls(
    db: AsyncSession, control_ids: list[str], lang: str | None
) -> dict[str, ControlTranslation]:
    """{control.id: ControlTranslation} for an explicit set of controls.

    Used by the cross-framework register, where the page is a handful of rows drawn from
    many frameworks: resolving per *framework* there would pull every translated row of
    every framework the page touches (thousands, once the corpus is translated) to
    decorate a hundred. Same English/missing-table tolerance as the per-framework helper.
    """
    code = (lang or "en").split("-")[0].strip().lower()
    if code == "en" or code not in SUPPORTED_LANGS or not control_ids:
        return {}
    try:
        rows = (await db.execute(
            select(ControlTranslation).where(
                ControlTranslation.control_id.in_(control_ids),
                ControlTranslation.lang == code,
            )
        )).scalars().all()
    except (OperationalError, ProgrammingError):
        logger.debug("frameworks.translations.unavailable lang=%s", code)
        return {}
    return {row.control_id: row for row in rows}


async def _applicability_for_controls(
    db: AsyncSession, control_ids: list[str], tenant_id: str | None
) -> dict[str, ControlApplicability]:
    """{control.id: ControlApplicability} — this tenant's organisation-wide decisions,
    for an explicit set of controls (the cross-framework register's page).

    Same scope rule and same missing-table tolerance as _applicability_for_framework.
    """
    if not tenant_id or not control_ids:
        return {}
    try:
        rows = (await db.execute(
            select(ControlApplicability).where(
                ControlApplicability.tenant_id == tenant_id,
                ControlApplicability.control_id.in_(control_ids),
                ControlApplicability.org_entity_id.is_(None),
                ControlApplicability.business_process_id.is_(None),
            )
        )).scalars().all()
    except (OperationalError, ProgrammingError):
        logger.debug("frameworks.applicability.unavailable (register page)")
        return {}
    return {row.control_id: row for row in rows}


async def _applicability_for_framework(
    db: AsyncSession, framework_id: str, tenant_id: str | None
) -> dict[str, ControlApplicability]:
    """{control.id: ControlApplicability} — the tenant's ORGANISATION-WIDE decisions only.

    Perimeter-scoped rows (org_entity_id / business_process_id set) are deliberately left
    out of the list view: a control can carry several of them and there is no single
    correct one to show against a row. They are returned in full by
    GET /{fw}/controls/{id}/applicability. Same missing-table tolerance as
    _translations_for_framework.
    """
    if not tenant_id:
        return {}
    try:
        rows = (await db.execute(
            select(ControlApplicability)
            .join(FrameworkControl, FrameworkControl.id == ControlApplicability.control_id)
            .where(
                FrameworkControl.framework_id == framework_id,
                ControlApplicability.tenant_id == tenant_id,
                ControlApplicability.org_entity_id.is_(None),
                ControlApplicability.business_process_id.is_(None),
            )
        )).scalars().all()
    except (OperationalError, ProgrammingError):
        logger.debug("frameworks.applicability.unavailable framework=%s", framework_id)
        return {}
    return {row.control_id: row for row in rows}


class FrameworkResponse(BaseModel):
    id: str
    name: str
    short_name: str
    version: str
    description: str | None
    issuing_body: str | None
    applicable_regions: list
    applicable_industries: list
    status: str
    is_builtin: bool
    control_count: int = 0
    # STB objectif 1 — « classée par source (norme/réglementation) ». NULL on a framework
    # nobody has classified yet; the frontend used to guess this from an 18-entry lookup
    # that matched 7 of 79 built-ins.
    source_type: str | None = None
    # Lineage of a tenant fork, so /upstream-diff can tell a customised copy from the
    # built-in it was cloned from.
    cloned_from_framework_id: str | None = None
    # Machine translation of a built-in framework's name/description into the
    # caller's language (content_translations). Additive: the stored text is kept
    # in original_*; ``?original=1`` (edit screens) switches the overlay off.
    translated: bool = False
    translation_official: bool = False
    original_name: str | None = None
    original_description: str | None = None

    model_config = {"from_attributes": True}


class ControlResponse(BaseModel):
    id: str
    framework_id: str
    control_id: str
    title: str
    description: str | None
    guidance: str | None
    category: str | None
    parent_id: str | None
    sort_order: int
    mapped_controls: list
    tags: list

    # ── STB objectif 1: the classification of a single exigence ───────────────
    # Read straight off the control row.
    domain: str | None = None
    requirement_type: str | None = None
    is_mandatory: bool = False
    # Read off the parent Framework — filled in by the routes that have it loaded
    # (_control_response). A bare ControlResponse.model_validate(control) still works and
    # simply leaves them None, which is what the builder/browse paths do.
    source_type: str | None = None
    source_name: str | None = None
    source_short_name: str | None = None
    issuing_body: str | None = None
    # The tenant's own organisation-wide applicability decision, if one was recorded.
    # None means "not decided yet" — it is NOT silently reported as applicable.
    applicability: str | None = None
    applicability_justification: str | None = None
    # Set only when title/description/guidance above were overlaid with a translation;
    # `translation_source` says whether a human or a machine produced it, which an
    # auditor is entitled to know.
    lang: str | None = None
    translation_source: str | None = None
    # Machine translation (content_translations) for the fields no human translation
    # covered. original_* carry the stored text; ``?original=1`` switches it off.
    translated: bool = False
    translation_official: bool = False
    original_title: str | None = None
    original_description: str | None = None
    original_guidance: str | None = None

    model_config = {"from_attributes": True}


def _control_response(
    control: FrameworkControl,
    framework: Framework | None = None,
    translation: ControlTranslation | None = None,
    applicability: ControlApplicability | None = None,
) -> ControlResponse:
    """ControlResponse plus the classification a bare control row cannot carry.

    Every overlay is optional: called with framework/translation/applicability all None
    this returns exactly what ``ControlResponse.model_validate(control)`` returned before.
    The translation falls back FIELD BY FIELD, because a partial translation (a title but
    no guidance) is the normal state of a corpus being translated incrementally.
    """
    resp = ControlResponse.model_validate(control)
    if framework is not None:
        resp.source_type = framework.source_type
        resp.source_name = framework.name
        resp.source_short_name = framework.short_name
        resp.issuing_body = framework.issuing_body
    if translation is not None:
        if (translation.title or "").strip():
            resp.title = translation.title
        if (translation.description or "").strip():
            resp.description = translation.description
        if (translation.guidance or "").strip():
            resp.guidance = translation.guidance
        resp.lang = translation.lang
        resp.translation_source = translation.source
    if applicability is not None:
        resp.applicability = applicability.applicability
        resp.applicability_justification = applicability.justification
    return resp


async def _machine_localize_controls(db: AsyncSession, lang: str, pairs) -> None:
    """Overlay machine translations on ControlResponse objects (or their dumps) for
    each field still showing the stored text — a human ControlTranslation always wins.
    ``pairs`` are (response, FrameworkControl). No-op for "" (``?original=1``)."""
    entries = []
    for resp, control in pairs:
        fields = {}
        for f in ("title", "description", "guidance"):
            stored = getattr(control, f, None)
            current = resp.get(f) if isinstance(resp, dict) else getattr(resp, f, None)
            if stored and current == stored:
                fields[f] = stored
        if fields:
            entries.append((resp, fields))
    await localize_fields(db, lang, entries)


async def _localize_frameworks(db: AsyncSession, lang: str, pairs) -> None:
    """(FrameworkResponse, Framework) pairs: name/description in the caller's language."""
    await localize_fields(db, lang, [
        (resp, {"name": fw.name, "description": fw.description or ""}) for resp, fw in pairs])


class ControlVersionResponse(BaseModel):
    """A past snapshot of a control's editable fields (RFP: suivi des modifications
    réglementaires avec historique — see FrameworkControlVersion's docstring)."""
    id: str
    control_id: str
    version_number: int
    title: str
    description: str | None
    guidance: str | None
    category: str | None
    tags: list
    changed_by_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[FrameworkResponse])
async def list_frameworks(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User | None, Depends(get_current_user_optional)],
    tenant_id: Annotated[str | None, Depends(get_tenant_id_optional)],
    source_type: Annotated[str | None, Query(description="norme | reglementation | loi | politique_interne | unclassified")] = None,
    q: Annotated[str | None, Query(description="Free-text match on name / short_name / issuing_body")] = None,
    lang: Annotated[str, Depends(get_display_language)] = "en",
):
    """List all available frameworks (built-in + tenant custom). Public for registration step.

    ``?source_type=`` is the « classée par source » filter: without a server-side filter
    the norme / réglementation / loi / politique interne distinction exists only in the
    reader's head. A framework whose source_type is still NULL is never bucketed into one
    of the four on a guess: it answers only to ``?source_type=unclassified``, the same
    string the facet lists it under, so the bucket is clickable.
    """
    # The tenant clause is added only when there IS a tenant: this route is public
    # for the registration step, and `Framework.tenant_id == None` renders as
    # `tenant_id IS NULL`, which would publish any non-built-in framework whose
    # tenant_id was never set to an unauthenticated caller. None exist today; the
    # guard is so that one created tomorrow is not silently world-readable.
    visible = (Framework.is_builtin == True)  # noqa: E712
    if tenant_id:
        visible = visible | (Framework.tenant_id == tenant_id)
    stmt = select(Framework).where(visible)
    if source_type:
        stmt = stmt.where(_classification_clause(Framework.source_type, source_type))
    if q:
        like = "%%%s%%" % q.strip().lower()
        stmt = stmt.where(or_(
            func.lower(Framework.name).like(like),
            func.lower(Framework.short_name).like(like),
            func.lower(func.coalesce(Framework.issuing_body, "")).like(like),
        ))
    frameworks = list((await db.execute(stmt.order_by(Framework.name))).scalars().all())

    # One grouped COUNT rather than a per-framework SELECT of every row: the previous loop
    # loaded ~4 500 full control rows on every call — including on the public registration
    # step — just to produce 95 integers.
    counts: dict[str, int] = {}
    if frameworks:
        counts = {
            fid: int(n) for fid, n in (await db.execute(
                select(FrameworkControl.framework_id, func.count())
                .where(FrameworkControl.framework_id.in_([f.id for f in frameworks]))
                .group_by(FrameworkControl.framework_id)
            )).all()
        }

    responses = []
    for fw in frameworks:
        resp = FrameworkResponse.model_validate(fw)
        resp.control_count = counts.get(fw.id, 0)
        responses.append(resp)
    await _localize_frameworks(db, lang, zip(responses, frameworks))

    return responses


# ── Custom Framework Builder Endpoints (must come BEFORE /{framework_id}) ──

class BrowseControlsResponse(BaseModel):
    """Controls grouped by source framework."""
    framework_id: str
    framework_name: str
    framework_short_name: str
    controls: list[ControlResponse]


class AISuggestionsRequest(BaseModel):
    """Request AI to suggest controls based on industry/region/use case."""
    industry: str
    region: str | None = None
    use_case: str | None = None
    selected_control_ids: list[str] = []


class AISuggestion(BaseModel):
    """A single AI control suggestion (ai_prompts "framework_builder" task)."""
    title: str
    description: str
    category: str
    rationale: str
    priority: str
    # Additive: traceability to a real published clause (schema field "source_reference" /
    # "source_confidence") and which already-selected control this complements. Absent when
    # the model did not supply them (both are optional in FRAMEWORK_BUILDER_SCHEMA).
    source_reference: str | None = None
    source_confidence: float | None = None
    complements: str | None = None


class AISuggestionsResponse(BaseModel):
    """AI-generated control suggestions."""
    suggestions: list[AISuggestion]
    rationale: str
    # Additive: e.g. a prompt-injection attempt spotted in the untrusted use-case text.
    warnings: list[str] = []


class CustomControlInput(BaseModel):
    """A control to include in the custom framework."""
    control_id: str
    title: str
    description: str | None = None
    category: str | None = None
    source_framework: str | None = None
    # STB objectif 1 — a control built here is classified like any other.
    domain: str | None = None
    requirement_type: str | None = None
    is_mandatory: bool = False

    @field_validator("domain", mode="before")
    @classmethod
    def normalize_domain(cls, v: str | None) -> str | None:
        return canonical_domain(v)

    @field_validator("requirement_type", mode="before")
    @classmethod
    def normalize_requirement_type(cls, v: str | None) -> str | None:
        return canonical_choice(v, REQUIREMENT_TYPES, "requirement_type")


class BuildCustomFrameworkRequest(BaseModel):
    """Request to build a custom framework from selected controls."""
    name: str
    short_name: str
    version: str = "1.0"
    description: str | None = None
    issuing_body: str | None = None
    applicable_regions: list[str] = []
    applicable_industries: list[str] = []
    source_type: str | None = None
    controls: list[CustomControlInput]

    @field_validator("source_type", mode="before")
    @classmethod
    def normalize_source_type(cls, v: str | None) -> str | None:
        return canonical_choice(v, SOURCE_TYPES, "source_type")


@router.get("/builder/browse-controls", response_model=list[BrowseControlsResponse])
async def browse_controls_by_framework(
    framework_ids: str | None = None,
    domain: str | None = Query(None, description="Filter the browsed controls by domaine"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Browse controls from one or more existing frameworks.

    Visibility is the same rule as list_frameworks (built-in or tenant-owned): an explicit
    ``framework_ids`` list used to be honoured verbatim, so a caller could read another
    tenant's forked referential by pasting its id in here.
    """
    visible = (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id)  # noqa: E712
    if framework_ids:
        ids_list = [i.strip() for i in framework_ids.split(",") if i.strip()]
        fw_result = await db.execute(
            select(Framework).where(Framework.id.in_(ids_list), visible)
        )
    else:
        fw_result = await db.execute(
            select(Framework).where(Framework.is_builtin == True).order_by(Framework.name)  # noqa: E712
        )
    frameworks = fw_result.scalars().all()

    result = []
    for fw in frameworks:
        stmt = select(FrameworkControl).where(FrameworkControl.framework_id == fw.id)
        if domain:
            stmt = stmt.where(func.lower(FrameworkControl.domain) == domain.strip().lower())
        controls_result = await db.execute(stmt.order_by(FrameworkControl.sort_order))
        controls = list(controls_result.scalars().all())
        result.append(BrowseControlsResponse(
            framework_id=fw.id,
            framework_name=fw.name,
            framework_short_name=fw.short_name,
            controls=[_control_response(c, fw) for c in controls],
        ))

    return result


@router.post("/builder/ai-suggestions", response_model=AISuggestionsResponse)
async def get_ai_control_suggestions(
    body: AISuggestionsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_request_language),
):
    """AI-suggested controls for the custom Framework Builder ("framework_builder" task).

    Runs on the shared AI foundation (see module docstring). A failed call, or a reply that
    still fails the schema / duplicate-title / source-reference consistency check after one
    repair retry, is surfaced as HTTP 424 with an honest, localised reason — never a silently
    invented suggestion set (the old "greedy-regex JSON recovery -> generic 500" behaviour is
    gone).
    """
    ai_quota.check_quota_or_raise(current_user.id)

    # Already-selected controls: restricted to frameworks visible to this tenant (built-in or
    # tenant-owned — same visibility rule as list_frameworks) so a stray/foreign id cannot pull
    # another tenant's control text into the prompt. The rich id+title+description context is
    # packed by token budget instead of a hard 30-row, title-only cut, so "avoid similar
    # controls" has real signal; the true total is always reported even when not every row gets
    # the rich treatment, and every title (not just the rich subset) is still surfaced to the
    # model in compact form so the duplicate-title check below never demands the impossible.
    ids = list(dict.fromkeys(str(i).strip() for i in body.selected_control_ids if str(i).strip()))[:200]
    selected: list[FrameworkControl] = []
    if ids:
        ctrl_result = await db.execute(
            select(FrameworkControl)
            .join(Framework, Framework.id == FrameworkControl.framework_id)
            .where(
                FrameworkControl.id.in_(ids),
                (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id),  # noqa: E712
            )
        )
        selected = list(ctrl_result.scalars().all())

    def _render_selected(c: FrameworkControl) -> str:
        cid = ai_provider.clean_field(c.control_id, 60) or "?"
        title = ai_provider.clean_field(c.title, 160)
        desc = ai_provider.clean_field(c.description or "", 200)
        line = "- %s: %s" % (cid, title)
        return "%s — %s" % (line, desc) if desc else line

    # Titles only, for the duplicate/collision consistency check (ai_prompts.consistency_issues
    # compares case-folded titles). This IS the check's `allowed_values`, so every title in it
    # must also be visible to the model in the prompt below — otherwise the check can fail on a
    # collision the model had no way to avoid, and (being a `check=` callback replayed verbatim
    # on the repair retry) the second attempt has no better chance either. Cleaned the same way
    # `_render_selected` cleans titles, so the two agree on the exact string.
    selected_titles = list(dict.fromkeys(
        ai_provider.clean_field(c.title, 160) for c in selected if c.title
    ))

    shown: list[FrameworkControl] = []
    if selected:
        groups = ai_chunking.chunk_items(selected, ai_chunking.CONTROL_BATCH_TOKENS, _render_selected)
        shown = groups[0] if groups else selected
    selected_body = "\n".join(_render_selected(c) for c in shown)
    if len(selected) > len(shown):
        # The rich id+title+description block above is token-budget-limited and a large-but-
        # ordinary selection (the browse step lets a user pull in 100+ controls; ids are capped
        # at 200) can exceed it well before every control is detailed. Titles alone are far
        # cheaper to render than full lines, so — mirroring compliance.py's clause_coverage
        # pattern, where the check's allow-list and the prompt's allow-list are always the same
        # set — the FULL remaining title set (exactly what `selected_titles` above enforces) is
        # always appended in compact form, not just summarised as "+N more not shown".
        shown_titles = {ai_provider.clean_field(c.title, 160) for c in shown if c.title}
        remaining_titles = [t for t in selected_titles if t not in shown_titles]
        selected_body += (
            "\n- (+%d more controls not detailed above; ALL of their titles are listed next so "
            "you can still avoid duplicating them)\n"
            "OTHER ALREADY-SELECTED TITLES (do not propose a new or near-equal title to any of "
            "these either):\n- %s"
        ) % (len(selected) - len(shown), "\n- ".join(remaining_titles) if remaining_titles else "(none)")
    selected_lines = (
        ai_provider.delimit_untrusted(selected_body, "ALREADY SELECTED CONTROLS", max_len=len(selected_body) + 1)
        if selected_body else "(none)"
    )

    use_case_text = (body.use_case or "").strip()
    use_case_block = (
        ai_provider.delimit_untrusted(use_case_text, "USE CASE", max_len=len(use_case_text) + 1)
        if use_case_text else "USE CASE: not provided"
    )

    # industry/region are free text on the wire (the frontend's <select> is UI-only, not
    # a server-side constraint) — clean_field() only single-lines and length-caps, it does
    # not neutralise fence look-alikes or mark the text as data-not-instructions, so it must
    # not be treated as trusted context (same class of bug already fixed for Framework.name
    # in compliance.py and feed titles in regulatory.py).
    industry_text = ai_provider.clean_field(body.industry, 100)
    region_text = ai_provider.clean_field(body.region, 100)
    industry_block = (
        ai_provider.delimit_untrusted(industry_text, "INDUSTRY", max_len=len(industry_text) + 1)
        if industry_text else "not stated"
    )
    region_block = (
        ai_provider.delimit_untrusted(region_text, "REGION", max_len=len(region_text) + 1)
        if region_text else "Global"
    )

    task = "framework_builder"
    try:
        system = ai_prompts.system_prompt(task, lang=lang)
        user = ai_prompts.render_user_prompt(
            task,
            industry=industry_block,
            region=region_block,
            use_case_block=use_case_block,
            selected_count=len(selected),
            shown_count=len(shown),
            selected_lines=selected_lines,
        )
        d = ai_prompts.task_defaults(task)
        res: AiResult = await ai_structured(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            ai_prompts.task_schema(task), schema_in_prompt=False,   # system_prompt already carries the schema
            check=lambda data: ai_prompts.consistency_issues(task, data, allowed_values=selected_titles),
            user_id=current_user.id, tenant_id=tenant_id, db=db, task="frameworks.ai_suggestions",
            **ai_provider.decoding(d["preset"], temperature=d["temperature"]),
        )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — never a 5xx: the SPA redirects to /service-down
        logger.exception("framework.ai_suggest.error tenant=%s", tenant_id)
        raise HTTPException(status_code=424,
                            detail="%s (error: framework suggestion generation failed unexpectedly)" % failure_message("error", lang))

    if not res.ok:
        logger.warning("framework.ai_suggest.failed tenant=%s kind=%s attempts=%d: %s",
                       tenant_id, res.kind, res.attempts, res.error)
        raise HTTPException(status_code=424, detail=_ai_failure_detail(res, lang))

    data = ai_prompts.apply_fixups(task, res.data)

    return AISuggestionsResponse(
        suggestions=[AISuggestion(**s) for s in (data.get("suggestions") or [])],
        rationale=data.get("rationale") or "",
        warnings=list(data.get("warnings") or []),
    )


@router.post("/builder/create", response_model=FrameworkResponse, status_code=status.HTTP_201_CREATED)
async def build_custom_framework(
    body: BuildCustomFrameworkRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a new custom framework with the provided list of controls."""
    if not body.controls:
        raise HTTPException(status_code=400, detail="At least one control is required")

    fw = Framework(
        name=body.name,
        short_name=body.short_name,
        version=body.version,
        description=body.description or f"Custom framework with {len(body.controls)} controls",
        issuing_body=body.issuing_body or "Custom",
        applicable_regions=body.applicable_regions,
        applicable_industries=body.applicable_industries,
        is_builtin=False,
        tenant_id=tenant_id,
        status=FrameworkStatus.ACTIVE,
        source_type=body.source_type,
    )
    db.add(fw)
    await db.flush()

    for idx, ctrl_input in enumerate(body.controls):
        # canonical_category() resolves against the enum's VALUES as well as its NAMES and
        # keeps unrecognised wording instead of dropping it. The old inline check compared
        # an upper-cased input against NAMES only, so a control browsed straight out of
        # ISO 27002 ("Organizational") was stored upper-cased and anything else lost its
        # category entirely.
        category_value = canonical_category(ctrl_input.category)

        control = FrameworkControl(
            framework_id=fw.id,
            control_id=ctrl_input.control_id,
            title=ctrl_input.title,
            description=ctrl_input.description,
            category=category_value,
            domain=ctrl_input.domain,
            requirement_type=ctrl_input.requirement_type,
            is_mandatory=ctrl_input.is_mandatory,
            sort_order=idx,
            mapped_controls=[],
            tags=[ctrl_input.source_framework] if ctrl_input.source_framework else [],
        )
        db.add(control)

    await db.commit()
    await db.refresh(fw)

    try:
        notify_framework_new.delay(fw.id, body.name)
    except Exception:
        pass

    resp = FrameworkResponse.model_validate(fw)
    resp.control_count = len(body.controls)
    return resp


@router.get("/{framework_id}", response_model=FrameworkResponse)
async def get_framework(
    framework_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_display_language),
):
    fw = await _get_visible_framework(db, framework_id, tenant_id, current_user)
    count_result = await db.execute(
        select(func.count()).where(FrameworkControl.framework_id == framework_id)
    )
    resp = FrameworkResponse.model_validate(fw)
    resp.control_count = count_result.scalar_one()
    await _localize_frameworks(db, lang, [(resp, fw)])
    return resp


@router.get("/{framework_id}/controls", response_model=list[ControlResponse])
async def get_framework_controls(
    framework_id: str,
    domain: str | None = Query(None, description="STB « classée par domaine » — controlled vocabulary, or unclassified"),
    requirement_type: str | None = Query(None, description="exigence | recommandation | mesure | unclassified"),
    is_mandatory: bool | None = Query(None, description="Only mandatory (or only optional) requirements"),
    applicability: str | None = Query(None, description="applicable | not_applicable | partially_applicable"),
    q: str | None = Query(None, description="Free-text match on control_id / title / description"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_display_language),
):
    """Get all controls for a framework, classified and in the caller's language.

    Every response row carries its source (from the parent framework), its domaine, its
    type, whether it is mandatory, and the tenant's organisation-wide applicability
    decision — the four axes STB objectif 1 asks a requirement to be classified on — and
    each of them is also a query filter.

    ``?applicability=`` matches only requirements where a decision was actually recorded:
    a control nobody has ruled on comes back with applicability=null and is not silently
    counted as applicable.

    Requirement text is overlaid with a ``control_translations`` row for the caller's
    Accept-Language when one exists, falling back field by field to the stored English.
    """
    fw = await _get_visible_framework(db, framework_id, tenant_id, current_user)

    stmt = select(FrameworkControl).where(FrameworkControl.framework_id == framework_id)
    if domain:
        stmt = stmt.where(_classification_clause(FrameworkControl.domain, domain))
    if requirement_type:
        stmt = stmt.where(_classification_clause(FrameworkControl.requirement_type, requirement_type))
    if is_mandatory is not None:
        stmt = stmt.where(FrameworkControl.is_mandatory == is_mandatory)
    if q:
        like = "%%%s%%" % q.strip().lower()
        stmt = stmt.where(or_(
            func.lower(FrameworkControl.control_id).like(like),
            func.lower(FrameworkControl.title).like(like),
            func.lower(func.coalesce(FrameworkControl.description, "")).like(like),
        ))
    result = await db.execute(stmt.order_by(FrameworkControl.sort_order, FrameworkControl.control_id))
    controls = list(result.scalars().all())

    # Two set-based lookups for the whole framework rather than one per control — and
    # both degrade to {} if their table has not been created yet (see the helpers).
    translations = await _translations_for_framework(db, framework_id, lang)
    decisions = await _applicability_for_framework(db, framework_id, tenant_id)

    rows = [
        _control_response(c, fw, translations.get(c.id), decisions.get(c.id))
        for c in controls
    ]
    # Fields no human translation covered: the machine translation, if cached.
    # The edit screen calls this with ?original=1 (lang == "") and gets stored text.
    await _machine_localize_controls(db, lang, zip(rows, controls))
    if applicability:
        wanted = applicability.strip().lower()
        rows = [r for r in rows if (r.applicability or "") == wanted]
    return rows


@router.get("/{framework_id}/controls/{control_id}/crosswalk")
async def get_control_crosswalk(
    framework_id: str,
    control_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_display_language),
):
    """
    Get cross-framework mappings for a control.
    Returns all equivalent controls in other frameworks.

    ``resolved`` walks each {framework, control} pair back to a real control row visible
    to this tenant, so "la même exigence issue de plusieurs sources" is a link the caller
    can follow rather than a pair of strings. A pair that resolves to nothing (a framework
    this tenant does not have) is still listed in ``mapped_to``, never dropped.
    """
    fw = await _get_visible_framework(db, framework_id, tenant_id, current_user)
    result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.framework_id == framework_id,
            FrameworkControl.id == control_id,
        )
    )
    control = result.scalar_one_or_none()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")

    mappings = list(control.mapped_controls or [])
    resolved: list[dict] = []
    resolved_rows: list[FrameworkControl] = []
    if mappings:
        wanted_fw = {str(m.get("framework") or "").strip().lower() for m in mappings if isinstance(m, dict)}
        wanted_ctrl = {str(m.get("control") or "").strip().lower() for m in mappings if isinstance(m, dict)}
        wanted_fw.discard("")
        wanted_ctrl.discard("")
        if wanted_fw and wanted_ctrl:
            rows = (await db.execute(
                select(FrameworkControl, Framework)
                .join(Framework, Framework.id == FrameworkControl.framework_id)
                .where(
                    func.lower(Framework.short_name).in_(wanted_fw),
                    func.lower(FrameworkControl.control_id).in_(wanted_ctrl),
                    (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id),  # noqa: E712
                )
            )).all()
            index = {
                (str(f.short_name or "").lower(), str(c.control_id or "").lower()): (c, f)
                for c, f in rows
            }
            for m in mappings:
                if not isinstance(m, dict):
                    continue
                key = (str(m.get("framework") or "").lower(), str(m.get("control") or "").lower())
                hit = index.get(key)
                if hit:
                    resolved.append(_control_response(hit[0], hit[1]).model_dump())
                    resolved_rows.append(hit[0])

    main = _control_response(control, fw)
    await _machine_localize_controls(db, lang, [(main, control), *zip(resolved, resolved_rows)])
    return {
        "control": main,
        "mapped_to": mappings,
        "resolved": resolved,
    }


# ─── Custom Framework Builder ──────────────────────────────────────────────────


class FrameworkCreate(BaseModel):
    name: str
    short_name: str
    version: str = "1.0"
    description: str | None = None
    issuing_body: str | None = None
    applicable_regions: list[str] = []
    applicable_industries: list[str] = []
    source_type: str | None = None

    @field_validator("source_type", mode="before")
    @classmethod
    def normalize_source_type(cls, v: str | None) -> str | None:
        return canonical_choice(v, SOURCE_TYPES, "source_type")


class ControlCreate(BaseModel):
    control_id: str
    title: str
    description: str | None = None
    guidance: str | None = None
    category: str | None = None
    domain: str | None = None
    requirement_type: str | None = None
    is_mandatory: bool = False
    parent_id: str | None = None
    tags: list[str] = []
    mapped_controls: list = []

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v: str | None) -> str | None:
        # Was: upper-case, compare against enum NAMES, and fall back to the literal
        # 'TECHNICAL' — which is not a ControlCategory under either spelling, so every
        # unrecognised category was stored as an invalid value. See canonical_category().
        return canonical_category(v)

    @field_validator("domain", mode="before")
    @classmethod
    def normalize_domain(cls, v: str | None) -> str | None:
        return canonical_domain(v)

    @field_validator("requirement_type", mode="before")
    @classmethod
    def normalize_requirement_type(cls, v: str | None) -> str | None:
        return canonical_choice(v, REQUIREMENT_TYPES, "requirement_type")

    @field_validator("mapped_controls", mode="before")
    @classmethod
    def normalize_mapped_controls(cls, v) -> list[dict]:
        return canonical_mapped_controls(v)


class ControlUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    guidance: str | None = None
    # `category` had NO validator at all on the update path, so a PATCH could write any
    # string straight onto the column that POST was (badly) guarding.
    category: str | None = None
    domain: str | None = None
    requirement_type: str | None = None
    is_mandatory: bool | None = None
    tags: list[str] | None = None
    # Writable crosswalk: the mapping between « la même exigence issue de plusieurs
    # sources » was previously read-only, seeded on 93 of 4 537 controls and impossible
    # to extend without a database script.
    mapped_controls: list | None = None

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v: str | None) -> str | None:
        return canonical_category(v)

    @field_validator("domain", mode="before")
    @classmethod
    def normalize_domain(cls, v: str | None) -> str | None:
        return canonical_domain(v)

    @field_validator("requirement_type", mode="before")
    @classmethod
    def normalize_requirement_type(cls, v: str | None) -> str | None:
        return canonical_choice(v, REQUIREMENT_TYPES, "requirement_type")

    @field_validator("mapped_controls", mode="before")
    @classmethod
    def normalize_mapped_controls(cls, v):
        return None if v is None else canonical_mapped_controls(v)


class FrameworkUpdate(BaseModel):
    name: str | None = None
    short_name: str | None = None
    version: str | None = None
    description: str | None = None
    issuing_body: str | None = None
    applicable_regions: list[str] | None = None
    applicable_industries: list[str] | None = None
    source_type: str | None = None

    @field_validator("source_type", mode="before")
    @classmethod
    def normalize_source_type(cls, v: str | None) -> str | None:
        return canonical_choice(v, SOURCE_TYPES, "source_type")


class CloneFrameworkRequest(BaseModel):
    name: str | None = None
    short_name: str | None = None


class RequirementCreate(BaseModel):
    requirement_text: str
    level: str = "must"   # must / should / may


async def _get_tenant_framework(
    db: AsyncSession, framework_id: str, tenant_id: str
) -> Framework:
    """Fetch a tenant-owned framework. Raises 404 or 403 as appropriate."""
    result = await db.execute(select(Framework).where(Framework.id == framework_id))
    fw = result.scalar_one_or_none()
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")
    if fw.is_builtin or fw.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot modify a built-in or another tenant's framework")
    return fw


@router.post("/{framework_id}/clone", response_model=FrameworkResponse, status_code=status.HTTP_201_CREATED)
async def clone_framework(
    framework_id: str,
    body: CloneFrameworkRequest = CloneFrameworkRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Fork any framework (built-in or custom) into a tenant-owned editable copy.
    Duplicates the framework metadata, all controls (preserving parent/child links),
    and all requirements.
    """
    # Visibility, not just existence: forking used to accept any framework id, which
    # copied another tenant's customised referential into this one.
    src = await _get_visible_framework(db, framework_id, tenant_id, current_user)

    new_fw = Framework(
        name=body.name or f"{src.name} (Custom)",
        short_name=body.short_name or f"{src.short_name}-CUSTOM",
        version=src.version,
        description=src.description,
        issuing_body=src.issuing_body,
        applicable_regions=list(src.applicable_regions or []),
        applicable_industries=list(src.applicable_industries or []),
        is_builtin=False,
        tenant_id=tenant_id,
        status=FrameworkStatus.ACTIVE,
        # A fork of ISO 27001 is still a norme — the classification is a property of the
        # standard, not of who holds the copy.
        source_type=src.source_type,
        # Lineage. Without it a customised copy is indistinguishable from a
        # from-scratch framework and can never be compared against, or re-synced from,
        # the built-in it came from (GET /upstream-diff, POST /upstream-sync).
        cloned_from_framework_id=src.id,
    )
    db.add(new_fw)
    await db.flush()

    src_controls_result = await db.execute(
        select(FrameworkControl)
        .where(FrameworkControl.framework_id == src.id)
        .order_by(FrameworkControl.sort_order)
    )
    src_controls = list(src_controls_result.scalars().all())

    pairs: list[tuple[FrameworkControl, FrameworkControl]] = []
    for src_ctrl in src_controls:
        new_ctrl = FrameworkControl(
            framework_id=new_fw.id,
            control_id=src_ctrl.control_id,
            title=src_ctrl.title,
            description=src_ctrl.description,
            guidance=src_ctrl.guidance,
            category=src_ctrl.category,
            domain=src_ctrl.domain,
            requirement_type=src_ctrl.requirement_type,
            parent_id=None,  # remap below
            sort_order=src_ctrl.sort_order,
            mapped_controls=list(src_ctrl.mapped_controls or []),
            tags=list(src_ctrl.tags or []),
            is_mandatory=src_ctrl.is_mandatory,
        )
        db.add(new_ctrl)
        pairs.append((src_ctrl, new_ctrl))

    await db.flush()
    id_map = {src_ctrl.id: new_ctrl.id for src_ctrl, new_ctrl in pairs}
    for src_ctrl, new_ctrl in pairs:
        if src_ctrl.parent_id and src_ctrl.parent_id in id_map:
            new_ctrl.parent_id = id_map[src_ctrl.parent_id]

    if pairs:
        src_ids = [s.id for s, _ in pairs]
        reqs_result = await db.execute(
            select(ControlRequirement).where(ControlRequirement.control_id.in_(src_ids))
        )
        for src_req in reqs_result.scalars().all():
            db.add(ControlRequirement(
                control_id=id_map[src_req.control_id],
                requirement_text=src_req.requirement_text,
                requirement_level=src_req.requirement_level,
            ))

    await db.commit()
    await db.refresh(new_fw)

    resp = FrameworkResponse.model_validate(new_fw)
    resp.control_count = len(pairs)
    return resp


@router.patch("/{framework_id}", response_model=FrameworkResponse)
async def update_framework(
    framework_id: str,
    body: FrameworkUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Update tenant-owned framework metadata (name, short_name, etc.)."""
    fw = await _get_tenant_framework(db, framework_id, tenant_id)

    if body.name is not None:                  fw.name = body.name
    if body.short_name is not None:            fw.short_name = body.short_name
    if body.version is not None:               fw.version = body.version
    if body.description is not None:           fw.description = body.description
    if body.issuing_body is not None:          fw.issuing_body = body.issuing_body
    if body.applicable_regions is not None:    fw.applicable_regions = body.applicable_regions
    if body.applicable_industries is not None: fw.applicable_industries = body.applicable_industries
    if body.source_type is not None:           fw.source_type = body.source_type

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

    count_result = await db.execute(
        select(func.count()).where(FrameworkControl.framework_id == framework_id)
    )
    resp = FrameworkResponse.model_validate(fw)
    resp.control_count = count_result.scalar_one()
    return resp


@router.post("", response_model=FrameworkResponse, status_code=status.HTTP_201_CREATED)
async def create_framework(
    body: FrameworkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a custom (tenant-owned) framework."""
    fw = Framework(
        name=body.name,
        short_name=body.short_name,
        version=body.version,
        description=body.description,
        issuing_body=body.issuing_body,
        applicable_regions=body.applicable_regions,
        applicable_industries=body.applicable_industries,
        is_builtin=False,
        tenant_id=tenant_id,
        status=FrameworkStatus.DRAFT,
        source_type=body.source_type,
    )
    db.add(fw)
    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    resp = FrameworkResponse.model_validate(fw)
    resp.control_count = 0

    # Best-effort notification — broker may be unavailable in dev (no Redis).
    try:
        notify_framework_new.delay(fw.id, body.name)
    except Exception:
        pass

    return resp


@router.post("/{framework_id}/controls", response_model=ControlResponse, status_code=status.HTTP_201_CREATED)
async def add_control(
    framework_id: str,
    body: ControlCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Add a control to a custom framework."""
    fw = await _get_tenant_framework(db, framework_id, tenant_id)

    count_result = await db.execute(
        select(func.count()).where(FrameworkControl.framework_id == framework_id)
    )
    sort_order = count_result.scalar_one()

    control = FrameworkControl(
        framework_id=framework_id,
        control_id=body.control_id,
        title=body.title,
        description=body.description,
        guidance=body.guidance,
        category=body.category,
        domain=body.domain,
        requirement_type=body.requirement_type,
        is_mandatory=body.is_mandatory,
        parent_id=body.parent_id,
        tags=body.tags,
        sort_order=sort_order,
        mapped_controls=body.mapped_controls,
    )
    db.add(control)
    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    # With the parent framework, so a freshly created requirement reports its source the
    # same way every other row of the referential does.
    return _control_response(control, fw)


@router.patch("/{framework_id}/controls/{control_db_id}", response_model=ControlResponse)
async def update_control(
    framework_id: str,
    control_db_id: str,
    body: ControlUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Update a control on a tenant-owned framework."""
    await _get_tenant_framework(db, framework_id, tenant_id)

    result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )
    control = result.scalar_one_or_none()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")

    # Snapshot the PRE-edit state before applying any change, but only if a
    # snapshotted field is actually about to change — a PATCH that touches
    # nothing (or only fields we don't version) shouldn't create version noise.
    changing = (
        (body.title is not None and body.title != control.title)
        or (body.description is not None and body.description != control.description)
        or (body.guidance is not None and body.guidance != control.guidance)
        or (body.category is not None and body.category != control.category)
        or (body.tags is not None and body.tags != control.tags)
    )
    if changing:
        last = (
            await db.execute(
                select(func.max(FrameworkControlVersion.version_number)).where(
                    FrameworkControlVersion.control_id == control.id
                )
            )
        ).scalar_one()
        db.add(FrameworkControlVersion(
            control_id=control.id,
            version_number=(last or 0) + 1,
            title=control.title,
            description=control.description,
            guidance=control.guidance,
            category=control.category,
            tags=control.tags,
            changed_by_id=current_user.id,
        ))

    if body.title is not None:
        control.title = body.title
    if body.description is not None:
        control.description = body.description
    if body.guidance is not None:
        control.guidance = body.guidance
    if body.category is not None:
        control.category = body.category
    if body.tags is not None:
        control.tags = body.tags
    # Classification + crosswalk. These four are NOT part of the version snapshot above:
    # FrameworkControlVersion has no column for them, and inventing one would mean
    # touching the model layer. Their changes are still attributable through the
    # hash-chained activity trail written by ActivityLogMiddleware.
    if body.domain is not None:
        control.domain = body.domain
    if body.requirement_type is not None:
        control.requirement_type = body.requirement_type
    if body.is_mandatory is not None:
        control.is_mandatory = body.is_mandatory
    if body.mapped_controls is not None:
        control.mapped_controls = body.mapped_controls

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

    # Get framework name for notification
    fw_result = await db.execute(
        select(Framework).where(Framework.id == framework_id)
    )
    fw = fw_result.scalar_one_or_none()
    if fw:
        # Best-effort notification — broker may be unavailable in dev (no Redis).
        try:
            notify_framework_updated.delay(fw.id, fw.name)
        except Exception:
            pass

    return _control_response(control, fw)


@router.get("/{framework_id}/controls/{control_db_id}/versions", response_model=list[ControlVersionResponse])
async def list_control_versions(
    framework_id: str,
    control_db_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Edit history for a control on a tenant-owned framework, newest first.

    Read access is broader than edit access (any authenticated tenant member,
    not CISO-only) — same asymmetry as everywhere else GET vs. PATCH is split
    in this file. Built-in frameworks are never editable, so they never have
    version rows; ``_get_tenant_framework`` 403s a built-in/foreign framework
    the same way ``update_control`` does, so history can't leak cross-tenant.
    """
    await _get_tenant_framework(db, framework_id, tenant_id)

    control_result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )
    if control_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Control not found")

    result = await db.execute(
        select(FrameworkControlVersion)
        .where(FrameworkControlVersion.control_id == control_db_id)
        .order_by(FrameworkControlVersion.version_number.desc())
    )
    return list(result.scalars().all())


async def _delete_control_rows(db: AsyncSession, control_ids: list[str]) -> None:
    """Remove everything that hangs off a set of controls, deepest first.

    Every one of these FKs is NOT NULL and none of the relationships declares a
    delete cascade, so letting the ORM handle it makes SQLAlchemy try to NULL the
    child columns and raise IntegrityError — a 5xx, which client.ts turns into a
    hard redirect to /service-down. The rows are therefore removed explicitly.

    ``control_applicability`` and ``control_translations`` are created by
    create_all() at the next restart; on a backend that has not restarted yet the
    tables are simply absent, which must not make a delete fail. Each is wrapped
    on its own so one missing table does not skip the other.

    CALLER CONTRACT: the recovery from a missing table is ``db.rollback()``, and a
    rollback EXPIRES every ORM instance in the session — including the one
    ``get_current_user`` loaded. A caller must therefore read every attribute it
    still needs (actor id/email, the row's own identity) into plain locals BEFORE
    calling this, and must not write anything before it either. Reading an expired
    instance afterwards raises MissingGreenlet, which is a 5xx.
    """
    if not control_ids:
        return
    # The two possibly-absent tables go FIRST: a missing table fails the whole
    # transaction and the only way back is a rollback, so nothing that matters
    # may have been written yet when that happens. Each is tried on its own so
    # one missing table does not skip the other.
    for model in (ControlApplicability, ControlTranslation):
        try:
            await db.execute(delete(model).where(model.control_id.in_(control_ids)))
            await db.flush()
        except (OperationalError, ProgrammingError):
            await db.rollback()
    await db.execute(
        delete(ControlRequirement).where(ControlRequirement.control_id.in_(control_ids))
    )
    await db.execute(
        delete(FrameworkControlVersion).where(FrameworkControlVersion.control_id.in_(control_ids))
    )


async def _framework_dependents(db: AsyncSession, framework_id: str) -> dict[str, int]:
    """Recorded work that would be orphaned by deleting this framework.

    ``compliance_assessments.framework_id`` and ``audits.framework_id`` are the
    two places a framework is cited by something that has its own history
    (control assessments, gaps, findings). Deleting underneath them leaves an
    assessment pointing at a framework that no longer exists and control
    assessments pointing at controls that no longer exist — the register would
    still list it and every read of it would fail.
    """
    from app.models.audit import Audit
    from app.models.compliance import ComplianceAssessment, ComplianceGap, ControlAssessment

    assessments = (await db.execute(
        select(func.count(ComplianceAssessment.id))
        .where(ComplianceAssessment.framework_id == framework_id)
    )).scalar() or 0
    audits = (await db.execute(
        select(func.count(Audit.id)).where(
            Audit.framework_id == framework_id, Audit.deleted_at.is_(None)
        )
    )).scalar() or 0
    # An evaluation or a gap is recorded against a CONTROL, and control_assessments
    # .control_id / compliance_gaps.control_id are plain columns with no cascade —
    # so a framework whose own id nothing cites can still be carrying recorded work
    # through its controls, and deleting it leaves those rows pointing at nothing.
    # On today's data every such row belongs to an assessment of the same framework
    # (so the first count already catches it), but nothing in the schema guarantees
    # that, and DELETE /{fw}/controls/{id} already refuses exactly this.
    evaluated = (await db.execute(
        select(func.count(ControlAssessment.id))
        .join(FrameworkControl, FrameworkControl.id == ControlAssessment.control_id)
        .where(FrameworkControl.framework_id == framework_id)
    )).scalar() or 0
    gaps = (await db.execute(
        select(func.count(ComplianceGap.id))
        .join(FrameworkControl, FrameworkControl.id == ComplianceGap.control_id)
        .where(FrameworkControl.framework_id == framework_id)
    )).scalar() or 0
    return {
        "assessments": int(assessments),
        "audits": int(audits),
        "evaluations": int(evaluated),
        "gaps": int(gaps),
    }


@router.delete("/{framework_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_framework(
    framework_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Delete a tenant-owned custom framework and all its controls.

    Refused while an assessment, an engagement, a recorded control evaluation or a
    gap is still built on it or on one of its controls: that work carries its own
    history, and none of it survives the framework it was recorded against.
    Retire the framework
    (``PATCH /{id}`` -> status) instead of erasing the basis of a past audit.
    """
    fw = await _get_tenant_framework(db, framework_id, tenant_id)

    blockers = await _framework_dependents(db, fw.id)
    if any(blockers.values()):
        raise HTTPException(
            status_code=409,
            detail=(
                "%d assessment(s), %d audit(s), %d recorded evaluation(s) and %d gap(s) "
                "are built on this framework. Delete or re-point them first — removing "
                "it would strip the meaning from every evaluation recorded against its "
                "controls."
                % (
                    blockers["assessments"], blockers["audits"],
                    blockers["evaluations"], blockers["gaps"],
                )
            ),
        )

    control_ids = list((await db.execute(
        select(FrameworkControl.id).where(FrameworkControl.framework_id == fw.id)
    )).scalars().all())
    # Read off every ORM attribute this handler still needs BEFORE the deletes:
    # `fw` becomes a deleted instance, and _delete_control_rows rolls back (and so
    # EXPIRES the whole session, `current_user` included) on a backend where
    # control_applicability / control_translations do not exist yet. Reading an
    # expired instance from async code raises MissingGreenlet -> 5xx, which is the
    # very failure this endpoint was fixed to stop producing.
    trace = {"id": fw.id, "short_name": fw.short_name, "name": fw.name, "version": fw.version}
    actor_id, actor_email = current_user.id, current_user.email

    await _delete_control_rows(db, control_ids)
    # parent_id is a self-FK inside this same set, and it is nullable, so the
    # whole generation goes in one statement.
    await db.execute(delete(FrameworkControl).where(FrameworkControl.framework_id == trace["id"]))
    # Deleted by id rather than by instance: after the rollback above `fw` may be
    # expired, and ORM delete() would re-SELECT it to cascade over relationships
    # whose rows this function has already removed.
    await db.execute(delete(Framework).where(Framework.id == trace["id"]))
    await db.commit()

    # Afterwards this entry is the only evidence the framework existed and on
    # whose authority it was withdrawn.
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id,
        user_id=actor_id,
        user_email=actor_email,
        action="delete",
        entity_type="framework",
        entity_id=trace["id"],
        entity_name=trace["short_name"],
        details={"name": trace["name"], "version": trace["version"], "controls": len(control_ids)},
    ))


@router.delete("/{framework_id}/controls/{control_db_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_control(
    framework_id: str,
    control_db_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Delete a control from a tenant-owned framework."""
    await _get_tenant_framework(db, framework_id, tenant_id)

    result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )
    control = result.scalar_one_or_none()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")

    # Same rule as the framework itself: a control that has been evaluated or has
    # produced a gap cannot be removed — the evaluation and the gap both point at
    # this row and would outlive it.
    from app.models.compliance import ComplianceGap, ControlAssessment

    evaluated = (await db.execute(
        select(func.count(ControlAssessment.id))
        .where(ControlAssessment.control_id == control.id)
    )).scalar() or 0
    gaps = (await db.execute(
        select(func.count(ComplianceGap.id)).where(ComplianceGap.control_id == control.id)
    )).scalar() or 0
    if evaluated or gaps:
        raise HTTPException(
            status_code=409,
            detail=(
                "Control %s carries %d recorded evaluation(s) and %d gap(s); it cannot be deleted."
                % (control.control_id, int(evaluated), int(gaps))
            ),
        )

    # Children first: control_requirements and framework_control_versions are
    # NOT NULL FKs with no delete cascade, so the ORM would try to NULL them and
    # raise IntegrityError instead of deleting the control.
    #
    # Same rule as delete_framework: _delete_control_rows may roll back (and expire
    # the session) when control_applicability / control_translations do not exist
    # yet, so the row's identity is read into a local first and every statement
    # below is written against that local, not against the ORM instance.
    target_id = control.id
    await _delete_control_rows(db, [target_id])
    # A sub-control would be left pointing at a parent that no longer exists;
    # parent_id is nullable, so it is promoted rather than deleted.
    await db.execute(
        update(FrameworkControl)
        .where(FrameworkControl.parent_id == target_id)
        .values(parent_id=None)
    )
    await db.execute(delete(FrameworkControl).where(FrameworkControl.id == target_id))
    await db.commit()


@router.post("/{framework_id}/controls/{control_db_id}/requirements", status_code=status.HTTP_201_CREATED)
async def add_requirement(
    framework_id: str,
    control_db_id: str,
    body: RequirementCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Add a requirement to a control on a tenant-owned framework."""
    await _get_tenant_framework(db, framework_id, tenant_id)

    result = await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Control not found")

    req = ControlRequirement(
        control_id=control_db_id,
        requirement_text=body.requirement_text,
        requirement_level=body.level,
    )
    db.add(req)
    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    return {"id": req.id, "control_id": req.control_id, "text": req.requirement_text, "level": req.requirement_level}




# ─── Referential import — STB objectif 1, « ou import automatisé possible » ────
#
# Before this endpoint the only way into the referential was the control-by-control
# editor: « mise à jour manuelle ou import automatisé possible » was unmet in every
# format, and a bank cannot type four thousand requirements by hand.

_IMPORT_FORMATS = ("csv", "xlsx", "yaml")

# The generic upload cap is settings.MAX_UPLOAD_SIZE_MB (2 MB on this deployment), sized
# for a single evidence document. A referential is a different animal — ISO 27002 plus a
# set of BCT circulaires is thousands of rows of text — and refusing it at 2 MB would
# leave this clause unmet for exactly the corpus it exists for. The disk-side reasons for
# the small cap do not apply here: the file is parsed in memory and never written to the
# uploads volume. 8 MB is still a hard ceiling, and _IMPORT_MAX_ROWS bounds the work
# regardless of how well the file compresses.
_IMPORT_MAX_MB = max(settings.MAX_UPLOAD_SIZE_MB, 8)
_IMPORT_MAX_ROWS = 20000
_IMPORT_MAX_ERRORS = 200

# Column aliases, in priority order per field. "control_id" is tried before the bare "id"
# on purpose: a CSV exported from this API carries the database UUID in `id` and the real
# clause reference in `control_id`, while a hand-written YAML (and the built-in framework
# files under /frameworks) uses `id` for the clause reference.
_IMPORT_ALIASES: dict[str, tuple[str, ...]] = {
    "control_id":       ("control_id", "ref_id", "reference", "ref", "code", "clause", "article", "identifiant", "id"),
    "title":            ("title", "titre", "name", "nom", "libelle", "intitule", "exigence", "requirement"),
    "description":      ("description", "desc", "texte", "text", "contenu", "content", "enonce"),
    "guidance":         ("guidance", "guide", "conseil", "implementation", "mise_en_oeuvre", "help"),
    "category":         ("category", "categorie", "theme"),
    "domain":           ("domain", "domaine"),
    "requirement_type": ("requirement_type", "type_exigence", "type"),
    "is_mandatory":     ("is_mandatory", "mandatory", "obligatoire"),
    "parent_control_id": ("parent_control_id", "parent_ref", "parent_id", "parent", "rattachement"),
    "sort_order":       ("sort_order", "order", "ordre", "position"),
    "tags":             ("tags", "tag", "mots_cles", "keywords"),
    "mapped_controls":  ("mapped_controls", "crosswalk", "mapping", "correspondances", "equivalences"),
    "requirements":     ("requirements", "exigences"),
}


def _detect_import_format(fmt: str | None, filename: str) -> str:
    """Explicit ``format`` field wins; otherwise infer from the extension."""
    if fmt and fmt.strip():
        chosen = fmt.strip().lower()
        chosen = {"yml": "yaml", "excel": "xlsx", "xls": "xlsx"}.get(chosen, chosen)
        if chosen not in _IMPORT_FORMATS:
            raise HTTPException(400, "format must be one of: %s" % ", ".join(_IMPORT_FORMATS))
        return chosen
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in ("yaml", "yml"):
        return "yaml"
    if ext in ("xlsx", "xlsm"):
        return "xlsx"
    if ext in ("csv", "tsv", "txt"):
        return "csv"
    raise HTTPException(
        400,
        "Unrecognised file type '%s' — upload csv, xlsx or yaml, or set the 'format' field explicitly"
        % (ext or filename or "?"),
    )


def _norm_header(key) -> str:
    """Header cell -> lookup key. Strips the UTF-8 BOM Excel writes on the first column."""
    return str(key or "").strip().lstrip("\ufeff").lower().replace(" ", "_").replace("-", "_")


def _map_row(raw: dict) -> dict:
    """Resolve one source row onto our field names through _IMPORT_ALIASES."""
    normalised: dict[str, object] = {}
    for key, value in raw.items():
        nk = _norm_header(key)
        if nk and nk not in normalised:
            normalised[nk] = value
    mapped: dict[str, object] = {}
    for field, aliases in _IMPORT_ALIASES.items():
        for alias in aliases:
            if alias in normalised:
                mapped[field] = normalised[alias]
                break
    return mapped


def _rows_from_csv(raw: bytes) -> list[dict]:
    """CSV -> rows. Sniffs the delimiter: a French Excel export is ';'-separated."""
    text = raw.decode("utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except Exception:
        dialect = csv.excel
    return [row for row in csv.DictReader(io.StringIO(text), dialect=dialect)]


def _rows_from_xlsx(raw: bytes) -> list[dict]:
    """First worksheet -> rows, row 1 being the header."""
    try:
        from openpyxl import load_workbook
    except Exception:  # noqa: BLE001 — an explicit 400 beats a 5xx (client.ts /service-down)
        raise HTTPException(400, "xlsx import is unavailable on this server — save the sheet as CSV and re-upload")
    try:
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, "Invalid xlsx file: %s" % exc)
    try:
        ws = wb[wb.sheetnames[0]]
        header: list[str] = []
        rows: list[dict] = []
        for index, row in enumerate(ws.iter_rows(values_only=True)):
            values = ["" if v is None else str(v).strip() for v in row]
            if index == 0:
                header = values
                continue
            if not any(values):
                continue
            rows.append({
                header[i]: values[i]
                for i in range(min(len(header), len(values)))
                if header[i]
            })
            if len(rows) > _IMPORT_MAX_ROWS:
                break
        return rows
    finally:
        wb.close()


def _rows_from_yaml(raw: bytes) -> tuple[list[dict], dict]:
    """YAML -> (rows, framework metadata).

    Accepts the shape the built-in framework files already use
    (``{framework: {...}, controls: [...]}``, see app/frameworks/loader.py), a bare
    ``{controls: [...]}``, and a plain list — so a file that seeds a built-in can be
    pushed through the API unchanged. safe_load only: never load().
    """
    try:
        data = yaml.safe_load(raw.decode("utf-8", errors="replace"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, "Invalid YAML: %s" % exc)
    meta: dict = {}
    if isinstance(data, dict):
        raw_meta = data.get("framework")
        meta = raw_meta if isinstance(raw_meta, dict) else {}
        items = data.get("controls") or data.get("requirements") or data.get("exigences") or []
    elif isinstance(data, list):
        items = data
    else:
        raise HTTPException(400, "YAML must be a list of controls, or {framework: {...}, controls: [...]}")
    if not isinstance(items, list):
        raise HTTPException(400, "'controls' must be a list")
    return [item for item in items if isinstance(item, dict)], meta


def _coerce_bool(value, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "y", "oui", "o", "vrai", "x", "obligatoire", "mandatory")


def _coerce_tags(value) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, (list, tuple)):
        return [str(t).strip() for t in value if str(t).strip()]
    text = str(value).strip()
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [str(t).strip() for t in parsed if str(t).strip()]
        except Exception:  # noqa: BLE001 — fall through to the separator split
            pass
    return [t.strip() for t in re.split(r"[;,]", text) if t.strip()]


def _would_cycle(
    child_key: str,
    parent_key: str,
    proposed: dict[str, str],
    by_key: dict[str, "FrameworkControl"],
    key_by_id: dict[str, str],
) -> bool:
    """True if attaching child_key under parent_key closes a loop.

    Walks the ancestor chain, preferring the parent this very file proposes over the one
    currently in the database (the file is what is about to win). A cycle in a control
    tree is not a cosmetic problem: every renderer of the referential recurses on it.
    Every index it needs is passed in — nothing is kept in module state, because two
    imports can be in flight at once in one worker.
    """
    seen: set[str] = set()
    cursor: str | None = parent_key
    depth = 0
    while cursor and depth < 100:
        if cursor == child_key or cursor in seen:
            return True
        seen.add(cursor)
        depth += 1
        nxt = proposed.get(cursor)
        if nxt is None:
            node = by_key.get(cursor)
            nxt = key_by_id.get(node.parent_id) if node is not None and node.parent_id else None
        cursor = (str(nxt).strip().lower() or None) if nxt else None
    return False


@router.post("/import")
async def import_framework_controls(
    file: UploadFile = File(...),
    framework_id: str | None = Form(None),
    format: str | None = Form(None),
    name: str | None = Form(None),
    short_name: str | None = Form(None),
    version: str = Form("1.0"),
    source_type: str | None = Form(None),
    issuing_body: str | None = Form(None),
    description: str | None = Form(None),
    dry_run: bool = Form(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Import a referential (norme, réglementation, loi or politique interne) from a file.

    ``multipart/form-data``: ``file`` plus either ``framework_id`` (import into an
    existing tenant-owned framework) or ``name`` + ``short_name`` (create one). Formats:
    **csv**, **xlsx**, **yaml** — inferred from the extension unless ``format`` says
    otherwise.

    Recognised columns (aliases in ``_IMPORT_ALIASES``, French headers included):
    ``control_id`` (required), ``title`` (required), ``description``, ``guidance``,
    ``category``, ``domain``, ``requirement_type``, ``is_mandatory``,
    ``parent_control_id``, ``sort_order``, ``tags``, ``mapped_controls``.

    Rows are **upserted on (framework_id, control_id)**, so re-importing a corrected file
    updates in place instead of duplicating the corpus — the operation a bank actually
    performs when a regulator republishes a circular. Parents are resolved in a **second
    pass**, against the framework's whole control set, so a child may appear before its
    parent in the file and may also attach to a parent that is already in the referential.
    Every row that changes a versioned field leaves a FrameworkControlVersion snapshot, so
    an import is as traceable as a hand edit.

    Only **tenant-owned** frameworks can be written: built-in rows are shared by every
    tenant on the platform, so correcting ISO 27001 means cloning it first (the Customize
    flow) and importing into the clone. ``dry_run=true`` validates and reports without
    committing anything.
    """
    safe_name = assert_safe_upload_name(file.filename, field_name="file")
    fmt = _detect_import_format(format, safe_name)

    max_bytes = _IMPORT_MAX_MB * 1024 * 1024
    # Refuse on the declared part size BEFORE reading: `await file.read()` on an
    # unbounded body pulls the whole thing into this worker's memory (Starlette only
    # spools to a temp file past 1 MB, and read() materialises it again), and there are
    # two workers on this box. Starlette does not always populate `size`, so the read
    # itself is still bounded below.
    declared = getattr(file, "size", None)
    if declared is not None and declared > max_bytes:
        raise HTTPException(413, "File exceeds the %d MB referential import limit" % _IMPORT_MAX_MB)
    raw = await file.read(max_bytes + 1)
    if not raw:
        raise HTTPException(400, "The uploaded file is empty")
    if len(raw) > max_bytes:
        raise HTTPException(413, "File exceeds the %d MB referential import limit" % _IMPORT_MAX_MB)
    # The file is parsed in memory and never written to the uploads volume, so there is no
    # stored artefact for services/file_integrity to version. The digest below is what
    # makes the import attestable: the activity trail records exactly which bytes were
    # applied, and re-hashing the source file years later proves it.
    file_sha256 = hashlib.sha256(raw).hexdigest()

    # Parsing runs OFF the event loop. openpyxl on a 20 000-row workbook (and, to a lesser
    # degree, csv/yaml on megabytes of text) is seconds of pure CPU; doing it inline in an
    # `async def` freezes every other request this worker is serving, and there are only
    # two workers. HTTPExceptions raised inside the parsers propagate through to_thread
    # unchanged.
    meta: dict = {}
    if fmt == "yaml":
        rows, meta = await asyncio.to_thread(_rows_from_yaml, raw)
    elif fmt == "xlsx":
        rows = await asyncio.to_thread(_rows_from_xlsx, raw)
    else:
        rows = await asyncio.to_thread(_rows_from_csv, raw)

    if not rows:
        raise HTTPException(400, "No data rows found in the file")
    if len(rows) > _IMPORT_MAX_ROWS:
        raise HTTPException(413, "File has %d rows; the import limit is %d" % (len(rows), _IMPORT_MAX_ROWS))

    try:
        source_type_value = canonical_choice(source_type, SOURCE_TYPES, "source_type")
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    framework_created = False
    if framework_id:
        fw = await _get_tenant_framework(db, framework_id, tenant_id)
        if source_type_value:
            fw.source_type = source_type_value
    else:
        fw_name = (name or meta.get("name") or "").strip()
        fw_short = (short_name or meta.get("short_name") or meta.get("ref_id") or "").strip()
        if not fw_name or not fw_short:
            raise HTTPException(
                400,
                "Creating a framework on import needs both 'name' and 'short_name' "
                "(or a 'framework:' block in the YAML). Pass 'framework_id' to import into an existing one.",
            )
        fw = Framework(
            name=fw_name[:255],
            short_name=fw_short[:50],
            version=(str(meta.get("version") or version or "1.0"))[:50],
            description=(description or meta.get("description") or None),
            issuing_body=(issuing_body or meta.get("issuing_body") or meta.get("provider") or None),
            applicable_regions=list(meta.get("applicable_regions") or []),
            applicable_industries=list(meta.get("applicable_industries") or []),
            is_builtin=False,
            tenant_id=tenant_id,
            status=FrameworkStatus.ACTIVE,
            source_type=source_type_value,
        )
        db.add(fw)
        await db.flush()
        framework_created = True

    # Captured before any commit/rollback below: a rollback expires every ORM attribute
    # (expire_on_commit=False only covers commit), so reading fw.id afterwards would fire
    # a lazy refresh outside the greenlet and blow up the dry-run path.
    fw_id, fw_name = fw.id, fw.name

    existing_rows = (await db.execute(
        select(FrameworkControl).where(FrameworkControl.framework_id == fw.id)
    )).scalars().all()
    by_key: dict[str, FrameworkControl] = {
        str(c.control_id).strip().lower(): c for c in existing_rows if c.control_id
    }
    next_sort = max([int(c.sort_order or 0) for c in existing_rows], default=-1) + 1

    created = updated = unchanged = requirements_created = 0
    # Counted in full, retained up to a cap: one message per row on a 20 000-row file is
    # a list this worker has to hold and serialise, and the response only ever shows the
    # first _IMPORT_MAX_ERRORS anyway.
    errors: list[str] = []
    warnings: list[str] = []
    error_count = warning_count = 0

    def add_error(message: str) -> None:
        nonlocal error_count
        error_count += 1
        if len(errors) < _IMPORT_MAX_ERRORS:
            errors.append(message)

    def add_warning(message: str) -> None:
        nonlocal warning_count
        warning_count += 1
        if len(warnings) < _IMPORT_MAX_ERRORS:
            warnings.append(message)

    parent_refs: dict[str, str] = {}
    # CSV/XLSX row 1 is the header, so the first data row a human sees is row 2. YAML
    # items are not preceded by a header, so they start at 1. Error messages have to line
    # up with what the user has open.
    start = 1 if fmt == "yaml" else 2

    for offset, raw_row in enumerate(rows):
        line = start + offset
        mapped = _map_row(raw_row if isinstance(raw_row, dict) else {})

        ref = str(mapped.get("control_id") or "").strip()
        if not ref:
            add_error("Row %d: control_id is required" % line)
            continue
        if len(ref) > 50:
            add_error("Row %d: control_id '%s…' exceeds 50 characters" % (line, ref[:20]))
            continue
        title = str(mapped.get("title") or "").strip()
        if not title:
            add_error("Row %d (%s): title is required" % (line, ref))
            continue
        if len(title) > 500:
            add_warning("Row %d (%s): title truncated to 500 characters" % (line, ref))
            title = title[:500]

        category = canonical_category(mapped.get("category"))
        # `domain` and `requirement_type` are CLASSIFICATION, and their column aliases are
        # ambiguous by necessity (a bare "type" column means requirement type in one
        # referential and control nature in another). An unrecognised value therefore
        # leaves the field NULL — which already means "unclassified" everywhere that
        # reads it — and is reported as a warning. Rejecting the requirement itself
        # because a metadata column used another vocabulary would fail a whole corpus on
        # a column the importer does not even need.
        try:
            domain = canonical_domain(mapped.get("domain"))
        except ValueError as exc:
            domain = None
            add_warning("Row %d (%s): %s — imported without a domaine" % (line, ref, exc))
        try:
            req_type = canonical_choice(mapped.get("requirement_type"), REQUIREMENT_TYPES, "requirement_type")
        except ValueError as exc:
            req_type = None
            add_warning("Row %d (%s): %s — imported without a type" % (line, ref, exc))
        # The crosswalk is different: it is data the author explicitly supplied, and
        # silently discarding a mapping would leave the referential claiming a
        # correspondence it does not hold. A malformed one fails its row.
        try:
            crosswalk = canonical_mapped_controls(mapped.get("mapped_controls"))
        except ValueError as exc:
            add_error("Row %d (%s): %s" % (line, ref, exc))
            continue

        desc = mapped.get("description")
        desc = str(desc).strip() if desc not in (None, "") else None
        guidance = mapped.get("guidance")
        guidance = str(guidance).strip() if guidance not in (None, "") else None
        tags = _coerce_tags(mapped.get("tags"))
        mandatory = _coerce_bool(mapped.get("is_mandatory"), default=False)

        key = ref.lower()
        parent_ref = str(mapped.get("parent_control_id") or "").strip()
        if parent_ref:
            parent_refs[key] = parent_ref

        control = by_key.get(key)
        if control is None:
            control = FrameworkControl(
                framework_id=fw.id,
                control_id=ref,
                title=title,
                description=desc,
                guidance=guidance,
                category=category,
                domain=domain,
                requirement_type=req_type,
                is_mandatory=mandatory,
                sort_order=next_sort,
                mapped_controls=crosswalk,
                tags=tags,
            )
            next_sort += 1
            db.add(control)
            by_key[key] = control
            created += 1

            # Nested requirements, as the built-in YAML files carry them. New controls
            # only: re-importing must not multiply a control's requirement list.
            for entry in (mapped.get("requirements") or []) if isinstance(mapped.get("requirements"), list) else []:
                if isinstance(entry, dict):
                    text = str(entry.get("text") or entry.get("requirement_text") or "").strip()
                    level = str(entry.get("level") or entry.get("requirement_level") or "must").strip().lower()
                else:
                    text, level = str(entry).strip(), "must"
                if not text:
                    continue
                db.add(ControlRequirement(
                    control=control,
                    requirement_text=text,
                    requirement_level=level if level in ("must", "should", "may") else "must",
                ))
                requirements_created += 1
            continue

        # Update in place. Only fields actually present in the file are applied, so a
        # two-column correction file cannot blank out guidance the referential already has.
        changing = (
            title != control.title
            or (desc is not None and desc != control.description)
            or (guidance is not None and guidance != control.guidance)
            or (category is not None and category != control.category)
        )
        if changing:
            last = (await db.execute(
                select(func.max(FrameworkControlVersion.version_number))
                .where(FrameworkControlVersion.control_id == control.id)
            )).scalar_one()
            db.add(FrameworkControlVersion(
                control_id=control.id,
                version_number=(last or 0) + 1,
                title=control.title,
                description=control.description,
                guidance=control.guidance,
                category=control.category,
                tags=control.tags,
                changed_by_id=current_user.id,
            ))

        touched = changing
        control.title = title
        if desc is not None:
            control.description = desc
        if guidance is not None:
            control.guidance = guidance
        if category is not None:
            control.category = category
        if domain is not None and domain != control.domain:
            control.domain = domain
            touched = True
        if req_type is not None and req_type != control.requirement_type:
            control.requirement_type = req_type
            touched = True
        if mapped.get("is_mandatory") not in (None, "") and mandatory != control.is_mandatory:
            control.is_mandatory = mandatory
            touched = True
        if tags and tags != list(control.tags or []):
            control.tags = tags
            touched = True
        if crosswalk and crosswalk != list(control.mapped_controls or []):
            control.mapped_controls = crosswalk
            touched = True

        if touched:
            updated += 1
        else:
            unchanged += 1

    await db.flush()

    # ── Pass 2: parent/child ───────────────────────────────────────────────────
    # Resolved against the framework's FULL control set (not only the rows in this file)
    # and after the flush, so a child can name a parent that appears later in the file, a
    # parent that was already in the referential, or one created moments ago.
    key_by_id = {c.id: k for k, c in by_key.items() if c.id}
    parents_linked = 0
    for child_key, parent_ref in parent_refs.items():
        child = by_key.get(child_key)
        parent = by_key.get(parent_ref.strip().lower())
        if child is None:
            continue
        if parent is None:
            add_error("Control %s: parent '%s' is not in this framework" % (child.control_id, parent_ref))
            continue
        if parent is child:
            add_error("Control %s: cannot be its own parent" % child.control_id)
            continue
        if _would_cycle(child_key, parent_ref.strip().lower(), parent_refs, by_key, key_by_id):
            add_error("Control %s: parent '%s' would create a cycle" % (child.control_id, parent_ref))
            continue
        if child.parent_id != parent.id:
            child.parent_id = parent.id
            parents_linked += 1

    # A file whose every row failed must not leave a framework behind. Without this the
    # import that a bank got wrong (wrong delimiter, wrong sheet, headers this importer
    # does not recognise) silently adds an empty referential to the list, which then has
    # to be hunted down and deleted — and, worse, would be offered for selection during
    # registration. Reported as 422 with the same per-row errors a dry run gives.
    if not dry_run and framework_created and created == 0 and updated == 0 and unchanged == 0:
        await db.rollback()
        raise HTTPException(
            422,
            "No requirement could be read from this file (%d row(s) read, %d rejected), so no "
            "framework was created. Check the delimiter and the column headers. First problems: %s"
            % (len(rows), error_count, " | ".join(errors[:5]) or "no recognisable control_id/title column"),
        )

    if dry_run:
        # Nothing is kept: the caller gets the same counts and the same error list they
        # would get from the real run, which is how a bank validates a 4 000-row file
        # before it touches the referential.
        await db.rollback()
    else:
        # Commit here rather than relying on get_db()'s teardown: that runs after
        # ActivityLogMiddleware, which opens its own connection for the audit
        # entry and would wait on the write lock this session still holds.
        await db.commit()
        await chain_and_add(db, ActivityLog(
            tenant_id=tenant_id,
            user_id=current_user.id,
            user_email=current_user.email,
            action="import",
            entity_type="framework",
            entity_id=fw_id,
            entity_name=fw_name,
            details={
                "format": fmt,
                "file_name": safe_name,
                "file_sha256": file_sha256,
                "framework_created": framework_created,
                "created": created,
                "updated": updated,
                "unchanged": unchanged,
                "parents_linked": parents_linked,
                "requirements_created": requirements_created,
                "errors": error_count,
                "warnings": warning_count,
            },
        ))
        # Best-effort notification — broker may be unavailable in dev (no Redis).
        try:
            (notify_framework_new if framework_created else notify_framework_updated).delay(fw_id, fw_name)
        except Exception:
            pass

    return {
        # A dry run that would have created the framework has rolled it away again, so it
        # reports no id rather than one that points at nothing.
        "framework_id": None if (dry_run and framework_created) else fw_id,
        "framework_name": fw_name,
        "framework_created": framework_created and not dry_run,
        "format": fmt,
        "dry_run": dry_run,
        "total_rows": len(rows),
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "parents_linked": parents_linked,
        "requirements_created": requirements_created,
        "file_sha256": file_sha256,
        "errors": errors,
        "error_count": error_count,
        "errors_truncated": max(0, error_count - len(errors)),
        "warnings": warnings,
        "warning_count": warning_count,
        "warnings_truncated": max(0, warning_count - len(warnings)),
    }


# ─── Cross-framework register — STB objectif 1, « référentiel centralisé » ─────


class ControlSearchResponse(BaseModel):
    """A page of the referential, with the facet counts a filter bar needs."""
    total: int
    limit: int
    offset: int
    items: list[ControlResponse]
    facets: dict


@router.get("/controls/search", response_model=ControlSearchResponse)
async def search_controls(
    source_type: str | None = Query(None, description="norme | reglementation | loi | politique_interne | unclassified"),
    domain: str | None = Query(None, description="Controlled domaine, or unclassified"),
    requirement_type: str | None = Query(None, description="exigence | recommandation | mesure | unclassified"),
    is_mandatory: bool | None = Query(None),
    framework_id: str | None = Query(None, description="Restrict to one framework"),
    q: str | None = Query(None, description="Free-text match on control_id / title / description"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
    lang: str = Depends(get_display_language),
):
    """Search every requirement this tenant can see, across all of its frameworks.

    This is the « centralisé » half of objectif 1 on the framework corpus: one query that
    spans normes, réglementations, lois and politiques internes at once, filtered on the
    four classification axes, instead of opening one framework at a time. Each row carries
    the source it came from, so the result reads as a register rather than a pile.

    Scope is the same as list_frameworks — built-in frameworks plus this tenant's own.
    ``facets`` counts the whole filtered set (not just the returned page). Each facet is
    computed with every OTHER filter applied but WITHOUT its own, which is what makes it
    usable as a filter bar: counted with its own filter on, "domaine" collapses to the one
    bucket already selected and the reader can no longer see — or reach — the others.
    """
    visible = (Framework.is_builtin == True) | (Framework.tenant_id == tenant_id)  # noqa: E712
    # Keyed by the axis each clause constrains, so a facet can drop its own.
    clauses: dict[str, object] = {"_scope": visible}
    if framework_id:
        clauses["framework_id"] = FrameworkControl.framework_id == framework_id
    if source_type:
        clauses["source_type"] = _classification_clause(Framework.source_type, source_type)
    if domain:
        clauses["domain"] = _classification_clause(FrameworkControl.domain, domain)
    if requirement_type:
        clauses["requirement_type"] = _classification_clause(FrameworkControl.requirement_type, requirement_type)
    if is_mandatory is not None:
        clauses["is_mandatory"] = FrameworkControl.is_mandatory == is_mandatory
    if q:
        like = "%%%s%%" % q.strip().lower()
        clauses["q"] = or_(
            func.lower(FrameworkControl.control_id).like(like),
            func.lower(FrameworkControl.title).like(like),
            func.lower(func.coalesce(FrameworkControl.description, "")).like(like),
        )
    conditions = list(clauses.values())

    base = (
        select(FrameworkControl, Framework)
        .join(Framework, Framework.id == FrameworkControl.framework_id)
        .where(*conditions)
    )
    total = (await db.execute(
        select(func.count())
        .select_from(FrameworkControl)
        .join(Framework, Framework.id == FrameworkControl.framework_id)
        .where(*conditions)
    )).scalar_one()

    rows = (await db.execute(
        base.order_by(Framework.short_name, FrameworkControl.sort_order, FrameworkControl.control_id)
        .limit(limit).offset(offset)
    )).all()

    async def _facet(axis: str, column) -> dict:
        where = [c for key, c in clauses.items() if key != axis]
        result = (await db.execute(
            select(column, func.count())
            .select_from(FrameworkControl)
            .join(Framework, Framework.id == FrameworkControl.framework_id)
            .where(*where)
            .group_by(column)
        )).all()
        # NULL is reported under UNCLASSIFIED rather than dropped: how much of the
        # corpus is still unclassified is exactly what a bank needs to see — and that
        # bucket is a filter value too, so clicking it narrows to exactly these rows.
        return {(value or UNCLASSIFIED): int(count) for value, count in result}

    facets = {
        "source_type": await _facet("source_type", Framework.source_type),
        "domain": await _facet("domain", FrameworkControl.domain),
        "requirement_type": await _facet("requirement_type", FrameworkControl.requirement_type),
    }

    # One lookup each for exactly the controls on this page. Resolving per framework
    # instead would fetch every translated (or decided) row of every framework the page
    # touches in order to decorate a hundred.
    page_ids = [c.id for c, _fw in rows]
    translations = await _translations_for_controls(db, page_ids, lang)
    # The register reports the same applicability decision the framework view shows;
    # without this the same requirement read "not decided" here and "not applicable"
    # there. Perimeter-scoped rows are left out for the same reason as in the list view.
    decisions = await _applicability_for_controls(db, page_ids, tenant_id)

    items = [
        _control_response(c, fw, translations.get(c.id), decisions.get(c.id))
        for c, fw in rows
    ]
    await _machine_localize_controls(db, lang, [(item, c) for item, (c, _fw) in zip(items, rows)])
    return ControlSearchResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=items,
        facets=facets,
    )


# ─── Applicabilité — STB objectif 1, « et applicabilité » ──────────────────────


class ApplicabilityResponse(BaseModel):
    id: str
    tenant_id: str
    control_id: str
    org_entity_id: str | None
    business_process_id: str | None
    applicability: str
    justification: str | None
    decided_by_id: str | None
    decided_at: datetime | None
    review_date: str | None

    model_config = {"from_attributes": True}


class ApplicabilityUpsert(BaseModel):
    """Set applicability for a requirement, organisation-wide or on one perimeter."""
    applicability: str
    justification: str | None = None
    org_entity_id: str | None = None
    business_process_id: str | None = None
    review_date: str | None = None

    @field_validator("applicability", mode="before")
    @classmethod
    def normalize_applicability(cls, v: str) -> str:
        value = canonical_choice(v, tuple(APPLICABILITY_VALUES), "applicability")
        if not value:
            raise ValueError("applicability is required")
        return value


async def _get_visible_control(
    db: AsyncSession, framework_id: str, control_db_id: str, tenant_id: str | None, user: User
) -> tuple[Framework, FrameworkControl]:
    """(framework, control) for a control the caller may read, else 404."""
    fw = await _get_visible_framework(db, framework_id, tenant_id, user)
    control = (await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )).scalar_one_or_none()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")
    return fw, control


def _table_not_ready(name: str) -> HTTPException:
    """424, not 500: client.ts hard-redirects the SPA to /service-down on any 5xx.

    ``control_applicability`` / ``control_translations`` are created by create_all() at
    the next backend restart. Until that restart these routes cannot work, and saying so
    plainly beats a stack trace and a bounced session.
    """
    return HTTPException(
        status_code=424,
        detail="The %s table has not been created yet — restart the backend once to provision it." % name,
    )


@router.get("/{framework_id}/controls/{control_db_id}/applicability")
async def get_control_applicability(
    framework_id: str,
    control_db_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """This tenant's applicability decisions for one requirement.

    ``organisation_wide`` is the decision that applies unless a perimeter overrides it;
    ``scoped`` holds the per-entity / per-process decisions. ``is_mandatory`` is echoed
    because a mandatory requirement can never be excluded, and the UI has to know that
    before it offers the option.
    """
    _fw, control = await _get_visible_control(db, framework_id, control_db_id, tenant_id, current_user)
    try:
        rows = list((await db.execute(
            select(ControlApplicability).where(
                ControlApplicability.tenant_id == tenant_id,
                ControlApplicability.control_id == control.id,
            )
        )).scalars().all())
    except (OperationalError, ProgrammingError):
        raise _table_not_ready("control_applicability")

    org_wide = next(
        (r for r in rows if r.org_entity_id is None and r.business_process_id is None), None
    )
    return {
        "control_id": control.id,
        "control_ref": control.control_id,
        "is_mandatory": control.is_mandatory,
        "organisation_wide": ApplicabilityResponse.model_validate(org_wide) if org_wide else None,
        "scoped": [
            ApplicabilityResponse.model_validate(r)
            for r in rows if r.org_entity_id is not None or r.business_process_id is not None
        ],
    }


@router.put("/{framework_id}/controls/{control_db_id}/applicability", response_model=ApplicabilityResponse)
async def set_control_applicability(
    framework_id: str,
    control_db_id: str,
    body: ApplicabilityUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Record whether a requirement applies to this organisation, and on what perimeter.

    Leaving both scope ids empty states it organisation-wide; setting exactly one scopes
    it to a département or a processus (objectif 2 evaluates « des processus, départements
    ou systèmes », so applicability has to be expressible on the same perimeters).

    Two refusals, both of them things an auditor will ask about:
      * ``not_applicable`` without a justification — an exclusion nobody wrote down is an
        exclusion nobody can defend. This is the check the compliance AI already applies to
        its own not_applicable verdicts (ai_prompts); a human deciding the same thing was
        held to a lower standard than the model until now.
      * ``not_applicable`` on a control flagged ``is_mandatory`` — the model documents
        mandatory controls as "cannot be marked as N/A — they must be implemented".
    """
    _fw, control = await _get_visible_control(db, framework_id, control_db_id, tenant_id, current_user)

    justification = (body.justification or "").strip() or None
    if body.applicability == "not_applicable":
        if not justification or len(justification) < 10:
            raise HTTPException(
                422,
                "A not_applicable decision needs a written justification (at least 10 characters) — "
                "an auditor will ask why this requirement was excluded.",
            )
        if control.is_mandatory:
            raise HTTPException(
                422,
                "Control %s is mandatory and cannot be marked not_applicable." % control.control_id,
            )

    if body.org_entity_id and body.business_process_id:
        raise HTTPException(422, "Scope the decision to an org entity OR a business process, not both")

    # Both perimeters are tenant-owned rows; validating them here stops a decision being
    # filed against another tenant's département.
    if body.org_entity_id:
        found = (await db.execute(
            select(OrgEntity.id).where(OrgEntity.id == body.org_entity_id, OrgEntity.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if not found:
            raise HTTPException(404, "Org entity not found")
    if body.business_process_id:
        found = (await db.execute(
            select(BusinessProcess.id).where(
                BusinessProcess.id == body.business_process_id,
                BusinessProcess.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if not found:
            raise HTTPException(404, "Business process not found")

    # One row per (tenant, control, perimeter): re-deciding replaces the decision rather
    # than stacking a second one the reader would have to choose between.
    scope = [
        ControlApplicability.org_entity_id == body.org_entity_id if body.org_entity_id
        else ControlApplicability.org_entity_id.is_(None),
        ControlApplicability.business_process_id == body.business_process_id if body.business_process_id
        else ControlApplicability.business_process_id.is_(None),
    ]
    try:
        row = (await db.execute(
            select(ControlApplicability).where(
                ControlApplicability.tenant_id == tenant_id,
                ControlApplicability.control_id == control.id,
                *scope,
            )
        )).scalar_one_or_none()
    except (OperationalError, ProgrammingError):
        raise _table_not_ready("control_applicability")

    previous = row.applicability if row else None
    if row is None:
        row = ControlApplicability(
            tenant_id=tenant_id,
            control_id=control.id,
            org_entity_id=body.org_entity_id,
            business_process_id=body.business_process_id,
        )
        db.add(row)
    row.applicability = body.applicability
    row.justification = justification
    row.review_date = body.review_date
    row.decided_by_id = current_user.id
    row.decided_at = datetime.utcnow()

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()

    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        entity_type="control_applicability",
        entity_id=row.id,
        entity_name=control.control_id,
        details={
            "framework_id": framework_id,
            "control_id": control.id,
            "from": previous,
            "to": row.applicability,
            "justification": justification,
            "org_entity_id": row.org_entity_id,
            "business_process_id": row.business_process_id,
        },
    ))
    return ApplicabilityResponse.model_validate(row)


# ─── Traductions — STB transversal, « exploitable en français et en arabe » ────


class TranslationResponse(BaseModel):
    id: str
    control_id: str
    lang: str
    title: str | None
    description: str | None
    guidance: str | None
    source: str | None

    model_config = {"from_attributes": True}


class TranslationUpsert(BaseModel):
    title: str | None = None
    description: str | None = None
    guidance: str | None = None
    source: str | None = "human"


@router.get("/{framework_id}/controls/{control_db_id}/translations", response_model=list[TranslationResponse])
async def list_control_translations(
    framework_id: str,
    control_db_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Every stored translation of one requirement (all languages)."""
    _fw, control = await _get_visible_control(db, framework_id, control_db_id, tenant_id, current_user)
    try:
        rows = (await db.execute(
            select(ControlTranslation)
            .where(ControlTranslation.control_id == control.id)
            .order_by(ControlTranslation.lang)
        )).scalars().all()
    except (OperationalError, ProgrammingError):
        raise _table_not_ready("control_translations")
    return list(rows)


@router.put("/{framework_id}/controls/{control_db_id}/translations/{lang}", response_model=TranslationResponse)
async def upsert_control_translation(
    framework_id: str,
    control_db_id: str,
    lang: str,
    body: TranslationUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Write the French or Arabic text of a requirement on a TENANT-OWNED framework.

    Restricted to tenant-owned frameworks on purpose: control_translations has no
    tenant_id (a translation of ISO A.5.1 is the same sentence for everyone), so a write
    against a shared built-in control would publish this bank's wording to every other
    tenant on the platform. The STB flow is Customize → Edit → translate, which forks the
    framework first; built-in translations ship from seed scripts run by the platform.
    """
    code = (lang or "").split("-")[0].strip().lower()
    if code not in SUPPORTED_LANGS:
        raise HTTPException(422, "lang must be one of: %s" % ", ".join(SUPPORTED_LANGS))

    await _get_tenant_framework(db, framework_id, tenant_id)
    control = (await db.execute(
        select(FrameworkControl).where(
            FrameworkControl.id == control_db_id,
            FrameworkControl.framework_id == framework_id,
        )
    )).scalar_one_or_none()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")

    if not ((body.title or "").strip() or (body.description or "").strip() or (body.guidance or "").strip()):
        raise HTTPException(422, "A translation needs at least one of title, description or guidance")

    try:
        row = (await db.execute(
            select(ControlTranslation).where(
                ControlTranslation.control_id == control.id,
                ControlTranslation.lang == code,
            )
        )).scalar_one_or_none()
    except (OperationalError, ProgrammingError):
        raise _table_not_ready("control_translations")

    if row is None:
        row = ControlTranslation(control_id=control.id, lang=code)
        db.add(row)
    row.title = (body.title or "").strip() or None
    row.description = (body.description or "").strip() or None
    row.guidance = (body.guidance or "").strip() or None
    row.source = (body.source or "human").strip()[:30]

    await db.flush()
    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    return TranslationResponse.model_validate(row)


# ─── Lineage — STB objectif 1, « mise à jour manuelle […] possible » ───────────


class UpstreamSyncRequest(BaseModel):
    adopt_new: bool = True
    update_unmodified: bool = True


async def _locally_edited_control_ids(db: AsyncSession, control_ids: list[str]) -> set[str]:
    """Controls a human has edited since the fork.

    A FrameworkControlVersion row written by update_control always carries the editor's
    id; the snapshots this sync writes carry changed_by_id = NULL. That distinction is
    what lets a re-sync leave a bank's own wording alone while still refreshing the
    clauses it never touched — without adding a column to the model layer.
    """
    if not control_ids:
        return set()
    rows = (await db.execute(
        select(FrameworkControlVersion.control_id)
        .where(
            FrameworkControlVersion.control_id.in_(control_ids),
            FrameworkControlVersion.changed_by_id.isnot(None),
        )
        .distinct()
    )).scalars().all()
    return set(rows)


@router.get("/{framework_id}/upstream-diff")
async def get_upstream_diff(
    framework_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Compare a forked framework against the built-in it was cloned from.

    A tenant fork used to be a dead end: ISO 27001 could be customised but never re-synced,
    so when the built-in corpus was corrected the fork silently drifted. ``cloned_from_
    framework_id`` (set by POST /{id}/clone) makes the comparison possible; this route
    reports what upstream added, what it changed, and what exists only in the fork.
    """
    fw = await _get_visible_framework(db, framework_id, tenant_id, current_user)
    if not fw.cloned_from_framework_id:
        raise HTTPException(
            400,
            "This framework was not cloned from another one, so there is no upstream to compare against.",
        )
    upstream = (await db.execute(
        select(Framework).where(Framework.id == fw.cloned_from_framework_id)
    )).scalar_one_or_none()
    if not upstream:
        raise HTTPException(404, "The upstream framework this copy was cloned from no longer exists")

    local = {
        str(c.control_id).strip().lower(): c
        for c in (await db.execute(
            select(FrameworkControl).where(FrameworkControl.framework_id == fw.id)
        )).scalars().all() if c.control_id
    }
    remote = {
        str(c.control_id).strip().lower(): c
        for c in (await db.execute(
            select(FrameworkControl).where(FrameworkControl.framework_id == upstream.id)
        )).scalars().all() if c.control_id
    }

    edited = await _locally_edited_control_ids(db, [c.id for c in local.values()])

    added, removed, modified = [], [], []
    for key, up in remote.items():
        if key not in local:
            added.append({"control_id": up.control_id, "title": up.title})
    for key, mine in local.items():
        if key not in remote:
            removed.append({"control_id": mine.control_id, "title": mine.title})
            continue
        up = remote[key]
        fields = [
            f for f in ("title", "description", "guidance", "category")
            if (getattr(up, f) or "") != (getattr(mine, f) or "")
        ]
        if fields:
            modified.append({
                "control_id": mine.control_id,
                "fields": fields,
                "locally_edited": mine.id in edited,
                "upstream_title": up.title,
                "local_title": mine.title,
            })

    return {
        "framework_id": fw.id,
        "upstream_framework_id": upstream.id,
        "upstream_name": upstream.name,
        "upstream_version": upstream.version,
        "counts": {
            "added_upstream": len(added),
            "only_in_this_copy": len(removed),
            "modified": len(modified),
            "locally_edited": sum(1 for m in modified if m["locally_edited"]),
        },
        # Capped: a diff against a 1 500-control standard is a report, not a payload.
        "added_upstream": added[:500],
        "only_in_this_copy": removed[:500],
        "modified": modified[:500],
    }


@router.post("/{framework_id}/upstream-sync")
async def sync_from_upstream(
    framework_id: str,
    body: UpstreamSyncRequest = UpstreamSyncRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.CISO, UserRole.COMPLIANCE_MANAGER)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Pull upstream corrections into a fork WITHOUT overwriting the tenant's own edits.

    * ``adopt_new`` — add controls upstream has that this copy does not.
    * ``update_unmodified`` — refresh the text of controls nobody here has edited
      (see _locally_edited_control_ids). A control a human touched is never overwritten:
      it is reported by /upstream-diff and left for a person to reconcile.

    Nothing is ever deleted. A control removed upstream stays in the fork — a bank may
    legitimately keep a clause its regulator retired.
    """
    fw = await _get_tenant_framework(db, framework_id, tenant_id)
    if not fw.cloned_from_framework_id:
        raise HTTPException(400, "This framework was not cloned from another one")
    upstream = (await db.execute(
        select(Framework).where(Framework.id == fw.cloned_from_framework_id)
    )).scalar_one_or_none()
    if not upstream:
        raise HTTPException(404, "The upstream framework this copy was cloned from no longer exists")

    local_rows = list((await db.execute(
        select(FrameworkControl).where(FrameworkControl.framework_id == fw.id)
    )).scalars().all())
    local = {str(c.control_id).strip().lower(): c for c in local_rows if c.control_id}
    remote_rows = list((await db.execute(
        select(FrameworkControl)
        .where(FrameworkControl.framework_id == upstream.id)
        .order_by(FrameworkControl.sort_order)
    )).scalars().all())

    edited = await _locally_edited_control_ids(db, [c.id for c in local_rows])
    next_sort = max([int(c.sort_order or 0) for c in local_rows], default=-1) + 1
    adopted = refreshed = skipped_edited = 0

    for up in remote_rows:
        key = str(up.control_id or "").strip().lower()
        if not key:
            continue
        mine = local.get(key)
        if mine is None:
            if not body.adopt_new:
                continue
            new_ctrl = FrameworkControl(
                framework_id=fw.id,
                control_id=up.control_id,
                title=up.title,
                description=up.description,
                guidance=up.guidance,
                category=up.category,
                domain=up.domain,
                requirement_type=up.requirement_type,
                is_mandatory=up.is_mandatory,
                sort_order=next_sort,
                mapped_controls=list(up.mapped_controls or []),
                tags=list(up.tags or []),
            )
            next_sort += 1
            db.add(new_ctrl)
            local[key] = new_ctrl
            adopted += 1
            continue

        if not body.update_unmodified:
            continue
        differs = any(
            (getattr(up, f) or "") != (getattr(mine, f) or "")
            for f in ("title", "description", "guidance", "category")
        )
        if not differs:
            continue
        if mine.id in edited:
            skipped_edited += 1
            continue

        # Snapshot with changed_by_id = None: this is a machine refresh, not a human edit,
        # and marking it as one would make the control look "locally edited" to the next
        # sync and freeze it forever.
        last = (await db.execute(
            select(func.max(FrameworkControlVersion.version_number))
            .where(FrameworkControlVersion.control_id == mine.id)
        )).scalar_one()
        db.add(FrameworkControlVersion(
            control_id=mine.id,
            version_number=(last or 0) + 1,
            title=mine.title,
            description=mine.description,
            guidance=mine.guidance,
            category=mine.category,
            tags=mine.tags,
            changed_by_id=None,
        ))
        mine.title = up.title
        mine.description = up.description
        mine.guidance = up.guidance
        mine.category = up.category
        refreshed += 1

    # Second pass for the parent links of newly adopted controls, for the same reason the
    # import needs one: a parent may itself have been adopted moments ago.
    await db.flush()
    upstream_key_by_id = {c.id: str(c.control_id or "").strip().lower() for c in remote_rows}
    for up in remote_rows:
        key = str(up.control_id or "").strip().lower()
        mine = local.get(key)
        if mine is None or mine.parent_id is not None or not up.parent_id:
            continue
        parent_key = upstream_key_by_id.get(up.parent_id)
        parent = local.get(parent_key) if parent_key else None
        if parent is not None and parent is not mine:
            mine.parent_id = parent.id

    # Commit here rather than relying on get_db()'s teardown: that runs after
    # ActivityLogMiddleware, which opens its own connection for the audit
    # entry and would wait on the write lock this session still holds.
    await db.commit()
    await chain_and_add(db, ActivityLog(
        tenant_id=tenant_id,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        entity_type="framework",
        entity_id=fw.id,
        entity_name=fw.name,
        details={
            "upstream_sync": True,
            "upstream_framework_id": upstream.id,
            "adopted": adopted,
            "refreshed": refreshed,
            "skipped_locally_edited": skipped_edited,
        },
    ))

    return {
        "framework_id": fw.id,
        "upstream_framework_id": upstream.id,
        "adopted": adopted,
        "refreshed": refreshed,
        "skipped_locally_edited": skipped_edited,
    }
