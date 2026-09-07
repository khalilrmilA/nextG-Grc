"""Threat Library — the threat register, its profiles, and the feeds behind it.

Structure of the register (RFP module 4):

* Built-in threats are a shared, read-only catalogue (MITRE ATT&CK and the
  seeded library). A tenant **adopts** one to bring it into its own register,
  which is what makes it profilable — the requirement asks every active threat
  to carry a complete validated profile, and a row shared across tenants
  cannot carry one tenant's assessment.
* Every new threat enters pending and is validated before it counts as part of
  the register.
* A profile is *edited* (draft) and separately *validated* by a security lead,
  and is revisited on a cadence. Editing a validated profile returns it to
  draft, because a sign-off applies to what was signed off.
* Every one of those acts is written to ThreatHistory with before/after values.
"""
from datetime import date, datetime, timezone
from typing import Annotated
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import String, cast, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_utils import assert_assets_in_tenant
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.api.v1.dependencies.features import require_feature
from app.models.user import User, UserRole
from app.models.threat import Threat, ThreatCategory, ThreatType
from app.models.threat_history import ThreatHistory
from app.models.vulnerability import Vulnerability
from app.services.threat_feeds import fetch_all_threat_feeds, stable_ref
from app.services import threat_registry as registry

router = APIRouter()

PROBABILITY_LEVELS = ("rare", "peu_probable", "possible", "probable", "quasiment_certain")
SEVERITY_LEVELS = ("mineur", "notable", "fort", "tres_fort", "critique")
THREAT_TYPES = tuple(t.value for t in ThreatType)

# Who may sign a threat profile off. "Validé par les responsables de la
# sécurité" is a named requirement, and the profile endpoint used to be gated
# only by the Elite feature flag — any user in an entitled tenant could stamp a
# profile as reviewed.
SECURITY_LEADS = (UserRole.CISO, UserRole.RISK_MANAGER)

# ── MITRE ATT&CK source ────────────────────────────────────────────────────────
MITRE_ATTACK_URL = "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _mitre_phase_to_category(name: str) -> str:
    name_lower = name.lower()
    if any(k in name_lower for k in ("phishing", "spearphish", "social engineering", "pretexting")):
        return ThreatCategory.SOCIAL_ENGINEERING.value
    if any(k in name_lower for k in ("supply chain", "compromise software", "trusted relationship")):
        return ThreatCategory.SUPPLY_CHAIN.value
    if any(k in name_lower for k in ("insider", "abuse elevation", "valid accounts")):
        return ThreatCategory.INSIDER_THREAT.value
    return ThreatCategory.CYBER_ATTACK.value


# ── Schemas ────────────────────────────────────────────────────────────────────

class ThreatCreate(BaseModel):
    ref_id: str
    name: str
    description: str | None = None
    category: str = "cyber_attack"
    typical_threat_actors: list[str] = []
    typical_attack_vectors: list[str] = []
    affected_assets: list[str] = []
    mitre_ids: list[str] = []
    threat_type: str | None = None
    # `require_validation` used to be here, defaulting to False, so a threat
    # created through the API went straight into the register. The requirement
    # is unconditional — "toute nouvelle menace doit faire l'objet d'une
    # validation avant intégration définitive" — so every new threat now starts
    # pending and the opt-out is gone. An unknown field is ignored by pydantic,
    # so a client still sending it is unaffected.


class ThreatUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    typical_threat_actors: list[str] | None = None
    typical_attack_vectors: list[str] | None = None
    affected_assets: list[str] | None = None
    mitre_ids: list[str] | None = None
    threat_type: str | None = None
    review_frequency_months: int | None = None


class ThreatProfileUpdate(BaseModel):
    origin: str | None = None
    objectives: str | None = None
    aggravating_factors: str | None = None
    occurrence_conditions: str | None = None
    estimated_frequency: str | None = None
    mode_operatoire: str | None = None
    probability_level: str | None = None
    severity_level: str | None = None
    threat_type: str | None = None
    linked_asset_ids: list[str] | None = None
    linked_vulnerability_ids: list[str] | None = None
    review_frequency_months: int | None = None


class ThreatHistoryOut(BaseModel):
    id: str; threat_id: str; action: str; changes: dict
    threat_ref_id: str | None = None; threat_name: str | None = None
    note: str | None = None
    actor_id: str | None = None; actor_email: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class ThreatOut(BaseModel):
    id: str; ref_id: str; name: str; description: str | None
    category: str; typical_threat_actors: list; typical_attack_vectors: list
    affected_assets: list; mitre_ids: list; is_builtin: bool; is_pending: bool
    origin: str | None = None
    objectives: str | None = None
    aggravating_factors: str | None = None
    occurrence_conditions: str | None = None
    estimated_frequency: str | None = None
    mode_operatoire: str | None = None
    probability_level: str | None = None
    severity_level: str | None = None
    last_reviewed_at: str | None = None
    linked_asset_ids: list = []
    linked_vulnerability_ids: list = []

    # Classification and profile governance.
    threat_type: str | None = None
    # True when the type shown was derived from the category rather than stated.
    # A default is not an assessment, and the register should not present one as
    # though a person chose it.
    threat_type_derived: bool = False
    profile_status: str = "draft"
    validated_at: str | None = None
    validated_by_id: str | None = None
    review_frequency_months: int = 12
    next_review_due: str | None = None
    review_overdue: bool = False
    # Which parts of the mandatory documentation are still blank, and whether
    # any remain. This is what turns "chaque menace active doit disposer d'un
    # profil complet" into something the screen can show and validation enforce.
    profile_missing: list[str] = []
    profile_complete: bool = False
    adopted_from_id: str | None = None
    # A built-in is shared across tenants, so it can never carry one tenant's
    # profile. It has to be adopted first.
    can_profile: bool = False

    created_at: datetime
    model_config = {"from_attributes": True}

    # Builtin threat rows (and older seeded rows) predate these JSON list columns, so
    # they come back NULL. Coerce NULL -> [] so serialization never 500s the endpoint.
    @field_validator(
        "typical_threat_actors", "typical_attack_vectors", "affected_assets", "mitre_ids",
        "linked_asset_ids", "linked_vulnerability_ids", mode="before",
    )
    @classmethod
    def _none_to_list(cls, v):
        return v if isinstance(v, list) else ([] if v is None else v)


class ImportOut(BaseModel):
    imported: int
    skipped: int
    message: str


class FetchOut(BaseModel):
    created: int
    skipped: int
    message: str
    names: list[str]


def _view(threat: Threat) -> ThreatOut:
    """ThreatOut with the derived fields the register needs to be readable."""
    item = ThreatOut.model_validate(threat)
    resolved_type, derived = registry.effective_type(threat)
    item.threat_type = resolved_type
    item.threat_type_derived = derived
    item.review_overdue = registry.review_is_overdue(threat)
    item.profile_missing = registry.profile_gaps(threat)
    item.profile_complete = not item.profile_missing
    item.can_profile = not threat.is_builtin
    return item


async def _assert_links_in_tenant(
    db: AsyncSession, tenant_id: str, asset_ids: list[str] | None,
    vulnerability_ids: list[str] | None,
) -> None:
    """Every linked asset and vulnerability must be a real one this tenant owns.

    The profile endpoint stored these id lists verbatim, so a typo silently
    produced a threat linked to nothing and a forged id linked it across
    tenants. The requirement makes these links load-bearing for the risk
    analysis, which is exactly when they need to be real.
    """
    if asset_ids:
        await assert_assets_in_tenant(db, asset_ids, tenant_id, field_name="linked_asset_ids")
    if vulnerability_ids:
        rows = (await db.execute(
            select(Vulnerability.id).where(
                Vulnerability.tenant_id == tenant_id, Vulnerability.id.in_(list(vulnerability_ids))
            )
        )).all()
        found = {r[0] for r in rows}
        missing = [v for v in vulnerability_ids if v not in found]
        if missing:
            raise HTTPException(422, f"Unknown vulnerability id(s) for this tenant: {', '.join(missing)}")


def _validate_profile_values(body: ThreatProfileUpdate) -> None:
    if body.probability_level and body.probability_level not in PROBABILITY_LEVELS:
        raise HTTPException(422, f"probability_level must be one of {PROBABILITY_LEVELS}")
    if body.severity_level and body.severity_level not in SEVERITY_LEVELS:
        raise HTTPException(422, f"severity_level must be one of {SEVERITY_LEVELS}")
    if body.threat_type and body.threat_type not in THREAT_TYPES:
        raise HTTPException(422, f"threat_type must be one of {THREAT_TYPES}")


# ── CRUD endpoints ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[ThreatOut])
async def list_threats(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    category: str | None = None,
    threat_type: str | None = None,
    probability_level: str | None = None,
    severity_level: str | None = None,
    review_overdue: bool | None = None,
):
    """The register: built-in catalogue plus this tenant's own, validated threats.

    Classifiable by the four families the requirement names and by the
    probability and severity scales, which is what makes the register usable
    for prioritisation rather than just a list."""
    if threat_type and threat_type not in THREAT_TYPES:
        raise HTTPException(422, f"threat_type must be one of {THREAT_TYPES}")
    if probability_level and probability_level not in PROBABILITY_LEVELS:
        raise HTTPException(422, f"probability_level must be one of {PROBABILITY_LEVELS}")
    if severity_level and severity_level not in SEVERITY_LEVELS:
        raise HTTPException(422, f"severity_level must be one of {SEVERITY_LEVELS}")

    q = select(Threat).where(
        ((Threat.is_builtin == True) | (Threat.tenant_id == tenant_id)),  # noqa: E712
        Threat.is_pending == False,  # noqa: E712
    )
    if category:
        q = q.where(Threat.category == category)
    if probability_level:
        q = q.where(Threat.probability_level == probability_level)
    if severity_level:
        q = q.where(Threat.severity_level == severity_level)
    if review_overdue:
        q = q.where(
            Threat.next_review_due.isnot(None),
            Threat.next_review_due < date.today().isoformat(),
        )
    items = [_view(t) for t in (await db.execute(q.order_by(Threat.ref_id))).scalars().all()]
    if threat_type:
        # Filtered after the query because a threat with no stated type still
        # belongs to the family its category implies — excluding those would
        # make the filter lie about the register's contents.
        items = [i for i in items if i.threat_type == threat_type]
    return items


@router.post("", response_model=ThreatOut, status_code=201)
async def create_threat(
    body: ThreatCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    if body.threat_type and body.threat_type not in THREAT_TYPES:
        raise HTTPException(422, f"threat_type must be one of {THREAT_TYPES}")
    t = Threat(ref_id=body.ref_id, name=body.name, description=body.description,
               category=body.category, typical_threat_actors=body.typical_threat_actors,
               typical_attack_vectors=body.typical_attack_vectors, affected_assets=body.affected_assets,
               mitre_ids=body.mitre_ids, threat_type=body.threat_type,
               is_builtin=False, is_pending=True,
               tenant_id=tenant_id)
    db.add(t)
    try:
        await db.flush()   # assign the id the history row refers to
    except IntegrityError:
        # The unique (tenant_id, ref_id, name) index. Without this the caller
        # gets a 500 and no idea why; the register already holds this one.
        await db.rollback()
        raise HTTPException(
            409,
            f"A threat with reference {body.ref_id!r} and this name is already in your register.",
        )
    registry.record(db, t, "created", actor=current_user, changes=registry.diff({}, registry.snapshot(t)),
                    note="Awaiting validation before it enters the register.")
    await db.commit()
    await db.refresh(t)
    return _view(t)


async def _get_tenant_threat(tid: str, tenant_id: str, db: AsyncSession) -> Threat:
    """Fetch a tenant-owned, editable threat (built-ins are read-only)."""
    r = await db.execute(select(Threat).where(
        Threat.id == tid, Threat.tenant_id == tenant_id, Threat.is_builtin == False))  # noqa: E712
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Threat not found or is built-in (read-only)")
    return t


@router.put("/{tid}", response_model=ThreatOut)
async def update_threat(
    tid: str,
    body: ThreatUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Edit a tenant-owned threat (built-in threats stay read-only)."""
    t = await _get_tenant_threat(tid, tenant_id, db)
    if body.threat_type and body.threat_type not in THREAT_TYPES:
        raise HTTPException(422, f"threat_type must be one of {THREAT_TYPES}")
    before = registry.snapshot(t)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(t, field, value)
    changes = registry.diff(before, registry.snapshot(t))
    note = None
    # typical_attack_vectors is part of the mandatory profile but lives on the
    # main record, so it is edited through here. Without this, clearing the
    # attack vectors on a validated threat would leave a profile that is
    # simultaneously "validated" and incomplete.
    if changes and t.profile_status == "validated" and any(
        field in registry.PROFILE_FIELDS for field in changes
    ):
        t.profile_status = "draft"
        t.validated_at = None
        t.validated_by_id = None
        note = "Profile content edited after validation — returned to draft."
    if changes:
        registry.record(db, t, "updated", actor=current_user, changes=changes, note=note)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Another threat in your register already has this reference and name.")
    await db.refresh(t)
    return _view(t)


@router.put("/{tid}/profile", response_model=ThreatOut)
async def update_threat_profile(
    tid: str,
    body: ThreatProfileUpdate,
    current_user: Annotated[User, Depends(require_feature("threat_profiles"))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Edit the threat profile: origin, objectives, occurrence scenario, vectors,
    aggravating factors, and the normalised probability / severity scales.

    Editing is not validating. This used to stamp ``last_reviewed_at`` and
    ``reviewed_by_id`` on every save, so a typo fix was indistinguishable from a
    security lead signing the profile off — and the endpoint was gated only by
    the Elite feature flag, so anyone in an entitled tenant could apply that
    stamp. Sign-off is now its own act (POST /{id}/profile/validate) with its
    own role gate, and editing a validated profile returns it to draft.
    """
    _validate_profile_values(body)
    t = await _get_tenant_threat(tid, tenant_id, db)
    await _assert_links_in_tenant(db, tenant_id, body.linked_asset_ids, body.linked_vulnerability_ids)

    before = registry.snapshot(t)
    was_validated = t.profile_status == "validated"
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(t, field, value)
    changes = registry.diff(before, registry.snapshot(t))

    note = None
    if changes and was_validated:
        t.profile_status = "draft"
        t.validated_at = None
        t.validated_by_id = None
        note = "Edited after validation — returned to draft and needs signing off again."
    if changes:
        registry.record(db, t, "profile_updated", actor=current_user, changes=changes, note=note)
    await db.commit()
    await db.refresh(t)
    return _view(t)


@router.delete("/{tid}", status_code=204)
async def delete_threat(
    tid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    r = await db.execute(select(Threat).where(Threat.id == tid, Threat.tenant_id == tenant_id, Threat.is_builtin == False))  # noqa: E712
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Threat not found or is built-in")
    # Recorded before the delete, with the full final state: once the row is
    # gone this history entry is the only evidence the threat ever existed.
    registry.record(db, t, "deleted", actor=current_user,
                    changes=registry.diff(registry.snapshot(t), {}))
    await db.delete(t)
    await db.commit()


# ── Adoption, validation, periodic review, history ────────────────────────────

@router.post("/{tid}/adopt", response_model=ThreatOut, status_code=201)
async def adopt_threat(
    tid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Bring a built-in threat into this tenant's own register so it can be profiled.

    Built-in threats are one shared, read-only catalogue: 691 rows visible to
    every tenant. That makes them impossible to profile — the assessment,
    the linked assets, the probability and severity are one organisation's
    judgement, and there is nowhere on a shared row to put them. So the
    register could never satisfy "chaque menace active doit disposer d'un
    profil complet" for the bulk of what it displays.

    Adopting copies the catalogue entry into a tenant-owned threat, keeping a
    pointer back to the original. The same pattern the framework library
    already uses for "Customize". Idempotent: adopting twice returns the copy
    that already exists rather than making a second one.

    The copy is not pending. Choosing a threat out of the curated catalogue,
    through a role-gated action, *is* the validation the intake rule asks for —
    unlike a feed item, which arrives unexamined.
    """
    source = (await db.execute(
        select(Threat).where(Threat.id == tid, Threat.is_builtin == True)  # noqa: E712
    )).scalar_one_or_none()
    if source is None:
        raise HTTPException(404, "Built-in threat not found")

    existing = (await db.execute(select(Threat).where(
        Threat.tenant_id == tenant_id, Threat.adopted_from_id == source.id
    ))).scalar_one_or_none()
    if existing is not None:
        return _view(existing)

    copy = Threat(
        ref_id=source.ref_id, name=source.name, description=source.description,
        category=source.category,
        typical_threat_actors=list(source.typical_threat_actors or []),
        typical_attack_vectors=list(source.typical_attack_vectors or []),
        affected_assets=list(source.affected_assets or []),
        mitre_ids=list(source.mitre_ids or []),
        threat_type=source.threat_type,
        is_builtin=False, is_pending=False, tenant_id=tenant_id,
        adopted_from_id=source.id,
    )
    db.add(copy)
    try:
        await db.flush()
    except IntegrityError:
        # The tenant already has a threat with this reference and name that it
        # did not adopt (created by hand, or ingested from a feed).
        await db.rollback()
        raise HTTPException(
            409,
            f"Your register already contains a threat with reference {source.ref_id!r} and this name. "
            f"Edit that one instead of adopting a second copy.",
        )
    registry.record(db, copy, "adopted", actor=current_user,
                    changes={"adopted_from_id": {"from": None, "to": source.id}},
                    note=f"Copied from the built-in catalogue entry {source.ref_id}.")
    await db.commit()
    await db.refresh(copy)
    return _view(copy)


@router.post("/{tid}/profile/validate", response_model=ThreatOut)
async def validate_threat_profile(
    tid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(*SECURITY_LEADS))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Sign a threat profile off. CISO / risk manager only.

    Refuses an incomplete profile and names what is missing: a sign-off on a
    profile with no occurrence scenario or no severity is a sign-off on
    nothing, and the requirement is explicit that the documentation carries a
    minimum. Signing also starts the review clock.
    """
    t = await _get_tenant_threat(tid, tenant_id, db)
    missing = registry.profile_gaps(t)
    if missing:
        raise HTTPException(
            422,
            f"The profile is incomplete and cannot be validated. Still missing: {', '.join(missing)}",
        )

    before = {"profile_status": t.profile_status, "next_review_due": t.next_review_due}
    t.profile_status = "validated"
    t.validated_by_id = current_user.id
    t.validated_at = registry.utc_now_iso()
    t.last_reviewed_at = t.validated_at
    t.reviewed_by_id = current_user.id
    registry.schedule_next_review(t)
    registry.record(
        db, t, "profile_validated", actor=current_user,
        changes=registry.diff(before, {"profile_status": t.profile_status,
                                       "next_review_due": t.next_review_due}),
        note=f"Next review due {t.next_review_due} ({t.review_frequency_months} months).",
    )
    await db.commit()
    await db.refresh(t)
    return _view(t)


class ReviewRequest(BaseModel):
    note: str | None = None


@router.post("/{tid}/profile/review", response_model=ThreatOut)
async def review_threat_profile(
    tid: str,
    body: ReviewRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(*SECURITY_LEADS))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Record a periodic review that found nothing to change, and reset the clock.

    The requirement asks for the profile to be revisited as the context, the
    threat watch or observed incidents evolve. Without this, "I looked and it
    still holds" leaves no trace, and the only way to clear an overdue review
    would be to edit the profile — which would be a false record.
    """
    t = await _get_tenant_threat(tid, tenant_id, db)
    before = {"last_reviewed_at": t.last_reviewed_at, "next_review_due": t.next_review_due}
    t.last_reviewed_at = registry.utc_now_iso()
    t.reviewed_by_id = current_user.id
    registry.schedule_next_review(t)
    registry.record(
        db, t, "reviewed", actor=current_user,
        changes=registry.diff(before, {"last_reviewed_at": t.last_reviewed_at,
                                       "next_review_due": t.next_review_due}),
        note=body.note or "Reviewed; no change required.",
    )
    await db.commit()
    await db.refresh(t)
    return _view(t)


@router.get("/{tid}/history", response_model=list[ThreatHistoryOut])
async def get_threat_history(
    tid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Everything that has happened to this threat, newest first.

    Scoped by tenant on the history rows themselves rather than by loading the
    threat first, because the most important entry is the one written for a
    threat that no longer exists.
    """
    rows = (await db.execute(
        select(ThreatHistory)
        .where(ThreatHistory.tenant_id == tenant_id, ThreatHistory.threat_id == tid)
        .order_by(ThreatHistory.created_at.desc())
    )).scalars().all()
    return [ThreatHistoryOut.model_validate(r) for r in rows]


# ── MITRE ATT&CK one-time import ───────────────────────────────────────────────

@router.post("/import-mitre", response_model=ImportOut)
async def import_mitre(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Bulk-import all MITRE ATT&CK Enterprise techniques (one-time seed)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(MITRE_ATTACK_URL)
        if resp.status_code != 200:
            raise HTTPException(502, "Failed to fetch MITRE ATT&CK data")
        data = resp.json()

    techniques = [
        o for o in data.get("objects", [])
        if o.get("type") == "attack-pattern"
        and not o.get("revoked")
        and not o.get("x_mitre_deprecated")
    ]

    existing_result = await db.execute(select(Threat.ref_id).where(Threat.is_builtin == True))  # noqa: E712
    existing_ids = {r[0] for r in existing_result.all()}

    imported = 0
    skipped = 0
    for tech in techniques:
        ext_refs = tech.get("external_references", [])
        mitre_id = next(
            (e.get("external_id") for e in ext_refs if e.get("external_id", "").startswith("T")),
            None,
        )
        if not mitre_id or mitre_id in existing_ids:
            skipped += 1
            continue

        phases = [p.get("phase_name", "") for p in tech.get("kill_chain_phases", [])]
        category = _mitre_phase_to_category(tech.get("name", ""))
        desc = (tech.get("description") or "")[:1000]

        t = Threat(
            ref_id=mitre_id,
            name=tech.get("name", "")[:500],
            description=desc,
            category=category,
            typical_threat_actors=[],
            typical_attack_vectors=phases[:4],
            affected_assets=[],
            mitre_ids=[mitre_id],
            is_builtin=True,
            is_pending=False,
            tenant_id=None,
        )
        db.add(t)
        existing_ids.add(mitre_id)
        imported += 1

    await db.commit()
    return ImportOut(
        imported=imported,
        skipped=skipped,
        message=f"Imported {imported} MITRE ATT&CK techniques. {skipped} already existed.",
    )


# ── Ongoing threat feed ────────────────────────────────────────────────────────

@router.post("/fetch-news", response_model=FetchOut)
async def fetch_threat_news(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Fetch latest threats from CISA KEV, SANS ISC, and opensourcemalware.com."""
    raw = await fetch_all_threat_feeds()

    if not raw:
        return FetchOut(created=0, skipped=0, message="Could not reach any threat feed.", names=[])

    # Skip duplicates (by ref_id for KEV, by name for RSS items)
    existing_refs = await db.execute(select(Threat.ref_id).where(
        (Threat.is_builtin == True) | (Threat.tenant_id == tenant_id)  # noqa: E712
    ))
    existing_ref_set = {r[0].lower() for r in existing_refs.all()}
    existing_names = await db.execute(select(Threat.name).where(
        (Threat.is_builtin == True) | (Threat.tenant_id == tenant_id)  # noqa: E712
    ))
    existing_name_set = {r[0].lower() for r in existing_names.all()}

    new_items = [
        it for it in raw
        if it["name"].lower() not in existing_name_set
        and (not it["ref_id"] or it["ref_id"].lower() not in existing_ref_set)
    ]

    if not new_items:
        return FetchOut(created=0, skipped=len(raw), message="No new threats found — all items already in your library.", names=[])

    created_names: list[str] = []
    for item in new_items:
        ref = stable_ref(item)
        t = Threat(
            ref_id=ref,
            name=item["name"],
            description=item.get("description") or None,
            category=item.get("category", ThreatCategory.CYBER_ATTACK.value),
            typical_threat_actors=item.get("typical_threat_actors", []),
            typical_attack_vectors=item.get("typical_attack_vectors", []),
            affected_assets=[],
            mitre_ids=[],
            is_builtin=False,
            is_pending=True,
            tenant_id=tenant_id,
        )
        # Each insert in its own savepoint: the unique (tenant_id, name)
        # constraint is what actually stops the feed duplicating itself, and one
        # collision must skip that item rather than abort the whole batch.
        try:
            async with db.begin_nested():
                db.add(t)
                await db.flush()
        except IntegrityError:
            continue
        registry.record(db, t, "created", actor=current_user,
                        note=f"Ingested from the {item.get('source', 'threat')} feed; awaiting validation.")
        created_names.append(item["name"])

    await db.commit()
    skipped = len(raw) - len(new_items)
    return FetchOut(
        created=len(created_names),
        skipped=skipped,
        message=f"Fetched {len(raw)} items. {len(created_names)} new threats pending your review.",
        names=created_names,
    )


# ── Approve / Reject pending threats ──────────────────────────────────────────

@router.get("/pending", response_model=list[ThreatOut])
async def list_pending(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Return all threats pending approval for this tenant."""
    q = select(Threat).where(Threat.tenant_id == tenant_id, Threat.is_pending == True)  # noqa: E712
    return [_view(t) for t in (await db.execute(q.order_by(Threat.created_at.desc()))).scalars().all()]


@router.post("/{tid}/approve", response_model=ThreatOut)
async def approve_threat(
    tid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    """Validate an intake candidate into the register."""
    r = await db.execute(select(Threat).where(Threat.id == tid, Threat.tenant_id == tenant_id))
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Threat not found")
    if t.is_pending:
        t.is_pending = False
        registry.record(db, t, "approved", actor=current_user,
                        changes={"is_pending": {"from": True, "to": False}})
    await db.commit()
    await db.refresh(t)
    return _view(t)


@router.delete("/{tid}/reject", status_code=204)
async def reject_threat(
    tid: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_roles(UserRole.SECURITY_ANALYST, UserRole.CISO))],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
):
    r = await db.execute(select(Threat).where(Threat.id == tid, Threat.tenant_id == tenant_id))
    t = r.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Threat not found")
    # A refusal at intake is a decision worth keeping: it is the record of a
    # threat that was considered and deliberately not integrated.
    registry.record(db, t, "rejected", actor=current_user,
                    changes=registry.diff(registry.snapshot(t), {}))
    await db.delete(t)
    await db.commit()
