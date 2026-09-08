"""Auditor ↔ auditee exchange — STB objectif 5, « Possibilité de commenter et
échanger avec les audités ».

What existed: one overwritable free-text box per finding (`remediation_notes`)
and one per control (`auditor_note`). No author, no timestamp, no history, no
addressee, no reply — which is a notepad, not an exchange.

What this module adds, on the AuditComment table:

* a **thread** — every message keeps its author, its time and its `parent_id`,
  so a question and its answer stay attached to each other;
* three **anchors** — an engagement, a finding, or one line of a checklist —
  because « commenter » in an audit means commenting on a specific point;
* **is_internal**, which is what makes opening the thread to the auditee safe:
  the audit team's working notes stay on their side of the wall;
* a **notification** to the people the message is actually for, so a
  non-conformity is not something the auditee discovers by accident.

Access rules, and why they are written by hand instead of with `require_roles`:

* ``require_roles`` auto-passes tenant_admin/super_admin and knows nothing about
  *which* engagement a person was assigned to. An auditor — the role most likely
  to be an outsider (``users.is_external``) — must reach the engagements they
  were given and no others, so that check is explicit.
* Conversely the auditee is, by construction, *not* a member of the audit team
  and often holds no GRC role at all. Gating posting behind a role list would
  make « échanger avec les audités » impossible. Any active member of the tenant
  may therefore read the shared thread and answer in it; only the audit team may
  write, or read, an internal note.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.core.database import get_db
from app.models.audit import Audit, AuditFinding
from app.models.audit_collaboration import AuditComment
from app.models.compliance import ComplianceAssessment, ControlAssessment
from app.models.auditor_assignment import AuditorAssignment
from app.models.notification import Notification, NotificationStatus, NotificationType
from app.models.user import User, UserRole
from app.services.authz import get_effective_roles

router = APIRouter()

# Roles that supervise the whole tenant. Someone holding one of these is never
# restricted to assigned engagements, even if they also hold `auditor`.
ORG_WIDE_AUDIT_ROLES = {
    UserRole.SUPER_ADMIN.value,
    UserRole.TENANT_ADMIN.value,
    UserRole.CISO.value,
    UserRole.COMPLIANCE_MANAGER.value,
    UserRole.RISK_MANAGER.value,
}

# Roles that are *the audit team* — the side of the wall internal notes live on.
# risk_manager is deliberately absent: they read the register, they do not
# conduct the engagement.
AUDIT_TEAM_ROLES = {
    UserRole.SUPER_ADMIN.value,
    UserRole.TENANT_ADMIN.value,
    UserRole.CISO.value,
    UserRole.COMPLIANCE_MANAGER.value,
}


# ---------------------------------------------------------------------------
# Access helpers — also imported by endpoints/audit_grids.py
# ---------------------------------------------------------------------------
# These live here rather than in a shared service module because the two files
# that need them are the only two that exist for this feature; keeping one
# definition beats copying twenty lines into both and letting them drift.
async def auditor_is_assigned(
    db: AsyncSession, user: User, tenant_id: str, audit: Audit
) -> bool:
    """True when this auditor was actually given this engagement.

    Two shapes of assignment count, because ``auditor_assignments`` grew an
    ``audit_id`` only recently: the engagement itself, and (legacy) the
    compliance assessment the engagement covers.
    """
    if audit.lead_auditor_id == user.id:
        return True
    clauses = [AuditorAssignment.audit_id == audit.id]
    if audit.assessment_id:
        clauses.append(AuditorAssignment.assessment_id == audit.assessment_id)
    found = (await db.execute(
        select(AuditorAssignment.id).where(
            AuditorAssignment.auditor_id == user.id,
            AuditorAssignment.tenant_id == tenant_id,
            AuditorAssignment.is_active == True,  # noqa: E712
            or_(*clauses),
        ).limit(1)
    )).first()
    return found is not None


async def can_access_audit(
    db: AsyncSession, user: User, tenant_id: str, audit: Audit
) -> bool:
    """May this user see this engagement at all? (Tenant already checked.)

    Everyone in the tenant already sees the audit register today, so narrowing
    that here would be a regression. The one profile that must be narrowed is
    the auditor: an external firm's account has no business reading engagements
    it was not appointed to.
    """
    roles = await get_effective_roles(user, db)
    if roles & ORG_WIDE_AUDIT_ROLES:
        return True
    if UserRole.AUDITOR.value in roles:
        return await auditor_is_assigned(db, user, tenant_id, audit)
    return True


async def is_audit_team(
    db: AsyncSession, user: User, audit: Audit | None
) -> bool:
    """May this user see and write the audit team's internal notes?

    An auditor qualifies only for engagements they reached, which
    ``can_access_audit`` has already established by the time this is called.
    """
    roles = await get_effective_roles(user, db)
    if roles & AUDIT_TEAM_ROLES:
        return True
    if audit is not None and audit.lead_auditor_id == user.id:
        return True
    return UserRole.AUDITOR.value in roles


async def load_audit(db: AsyncSession, tenant_id: str, audit_id: str) -> Audit:
    audit = (await db.execute(
        select(Audit).where(
            Audit.id == audit_id,
            Audit.tenant_id == tenant_id,
            Audit.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if audit is None:
        raise HTTPException(404, "Audit not found")
    return audit


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class CommentCreate(BaseModel):
    body: str
    audit_id: str | None = None
    finding_id: str | None = None
    control_assessment_id: str | None = None
    parent_id: str | None = None
    is_internal: bool = False


class CommentUpdate(BaseModel):
    body: str


class CommentOut(BaseModel):
    id: str
    audit_id: str | None
    finding_id: str | None
    control_assessment_id: str | None
    parent_id: str | None
    author_id: str
    author_name: str | None
    author_email: str | None
    author_is_external: bool
    body: str | None            # None once deleted — the row survives, the words do not
    is_internal: bool
    is_deleted: bool
    created_at: datetime
    edited_at: datetime | None


class CommentThreadOut(BaseModel):
    items: list[CommentOut]
    total: int
    # Lets the client decide whether to offer the "internal note" toggle at all,
    # instead of showing it and having the POST rejected.
    viewer_is_audit_team: bool


class PendingThreadOut(BaseModel):
    """One exchange waiting on the current user — the « constats à traiter » feed."""

    comment_id: str
    audit_id: str | None
    audit_title: str | None
    finding_id: str | None
    finding_title: str | None
    control_assessment_id: str | None
    author_id: str
    author_name: str | None
    excerpt: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Anchor resolution
# ---------------------------------------------------------------------------
class _Anchor:
    """Where a comment hangs, plus everything the caller needs about it."""

    def __init__(self, audit: Audit | None, finding: AuditFinding | None,
                 control_assessment: ControlAssessment | None,
                 assessment: ComplianceAssessment | None):
        self.audit = audit
        self.finding = finding
        self.control_assessment = control_assessment
        self.assessment = assessment

    def columns(self) -> tuple[str | None, str | None, str | None]:
        """(audit_id, finding_id, control_assessment_id) as they must be stored.

        The finer anchor (a finding, a checklist line) is always set, and the
        engagement is set ALONGSIDE it whenever one is known.

        That is not a cosmetic denormalisation: ``endpoints/audits.py`` writes
        this same table and its thread endpoints
        (``GET/POST /audits/{id}/comments``) filter and validate on
        ``audit_id == audit_id``. A message stored with ``audit_id`` NULL is
        invisible there and cannot be replied to from there — the two halves of
        the same conversation would silently diverge. Writing both keeps one
        record of the exchange whichever endpoint posted it.

        The engagement-level thread stays separate all the same: `filter_clause`
        requires the two finer columns to be NULL, so a finding's messages never
        leak into it.
        """
        audit_id = self.audit.id if self.audit else None
        if self.finding is not None:
            return audit_id, self.finding.id, None
        if self.control_assessment is not None:
            return audit_id, None, self.control_assessment.id
        return audit_id, None, None

    def filter_clause(self):
        if self.finding is not None:
            return AuditComment.finding_id == self.finding.id
        if self.control_assessment is not None:
            return AuditComment.control_assessment_id == self.control_assessment.id
        # Explicitly exclusive, so a row written before this rule existed (or by
        # a future caller that sets two columns) cannot leak into this thread.
        return and_(
            AuditComment.audit_id == self.audit.id,
            AuditComment.finding_id.is_(None),
            AuditComment.control_assessment_id.is_(None),
        )


def _same_thread(parent: AuditComment, anchor: _Anchor) -> bool:
    """Is `parent` a message of the thread `anchor` designates?

    Compared thread by thread rather than by raw column tuple, because
    endpoints/audits.py writes the same table and a row it created may carry a
    different combination of anchor columns for the very same thread.
    """
    if anchor.finding is not None:
        return parent.finding_id == anchor.finding.id
    if anchor.control_assessment is not None:
        return parent.control_assessment_id == anchor.control_assessment.id
    return (
        parent.audit_id == (anchor.audit.id if anchor.audit else None)
        and parent.finding_id is None
        and parent.control_assessment_id is None
    )


async def may_reach_assessment(
    db: AsyncSession, user: User, tenant_id: str, assessment: ComplianceAssessment
) -> bool:
    """May this user reach a checklist line of this assessment?

    A control-assessment thread is not always covered by an engagement (today
    `audits.assessment_id` is NULL on every live audit), so without this an
    auditor account — the profile most likely to belong to an outside firm —
    reached every checklist thread of the tenant, internal audit-team notes
    included, with no assignment at all. The rule mirrors
    endpoints/auditor_portal.py: an auditor sees an assessment only when an
    active AuditorAssignment names it.
    """
    roles = await get_effective_roles(user, db)
    if roles & ORG_WIDE_AUDIT_ROLES:
        return True
    if UserRole.AUDITOR.value not in roles:
        # An auditee / control owner of the tenant reads their own checklist.
        return True
    found = (await db.execute(
        select(AuditorAssignment.id).where(
            AuditorAssignment.auditor_id == user.id,
            AuditorAssignment.tenant_id == tenant_id,
            AuditorAssignment.assessment_id == assessment.id,
            AuditorAssignment.is_active == True,  # noqa: E712
        ).limit(1)
    )).first()
    return found is not None


async def _resolve_anchor(
    db: AsyncSession, user: User, tenant_id: str,
    audit_id: str | None, finding_id: str | None, control_assessment_id: str | None,
) -> _Anchor:
    """Validate the anchor, its tenant, and the caller's right to reach it.

    Exactly one anchor is accepted. Allowing two would make the thread ambiguous:
    the same row would appear under a finding and under its engagement, and
    `filter_clause` would have to guess which one the reader meant.
    """
    given = [x for x in (audit_id, finding_id, control_assessment_id) if x]
    if len(given) != 1:
        raise HTTPException(
            422, "Provide exactly one of audit_id, finding_id or control_assessment_id"
        )

    if finding_id:
        finding = (await db.execute(
            select(AuditFinding).where(AuditFinding.id == finding_id)
        )).scalar_one_or_none()
        if finding is None:
            raise HTTPException(404, "Finding not found")
        audit = await load_audit(db, tenant_id, finding.audit_id)
        if not await can_access_audit(db, user, tenant_id, audit):
            raise HTTPException(403, "You are not assigned to this audit")
        return _Anchor(audit, finding, None, None)

    if control_assessment_id:
        row = (await db.execute(
            select(ControlAssessment, ComplianceAssessment)
            .join(ComplianceAssessment,
                  ComplianceAssessment.id == ControlAssessment.assessment_id)
            .where(ControlAssessment.id == control_assessment_id,
                   ComplianceAssessment.tenant_id == tenant_id)
        )).first()
        if row is None:
            raise HTTPException(404, "Control assessment not found")
        ca, assessment = row
        # A checklist line may be commented inside an engagement or outside one;
        # when an engagement covers this assessment, its access rules apply.
        audit = (await db.execute(
            select(Audit).where(
                Audit.assessment_id == assessment.id,
                Audit.tenant_id == tenant_id,
                Audit.deleted_at.is_(None),
            ).limit(1)
        )).scalar_one_or_none()
        if audit is not None:
            if not await can_access_audit(db, user, tenant_id, audit):
                raise HTTPException(403, "You are not assigned to this audit")
        elif not await may_reach_assessment(db, user, tenant_id, assessment):
            raise HTTPException(403, "Not assigned to this assessment")
        return _Anchor(audit, None, ca, assessment)

    audit = await load_audit(db, tenant_id, audit_id or "")
    if not await can_access_audit(db, user, tenant_id, audit):
        raise HTTPException(403, "You are not assigned to this audit")
    return _Anchor(audit, None, None, None)


def _to_out(comment: AuditComment, author: User | None) -> CommentOut:
    deleted = comment.deleted_at is not None
    return CommentOut(
        id=comment.id,
        audit_id=comment.audit_id,
        finding_id=comment.finding_id,
        control_assessment_id=comment.control_assessment_id,
        parent_id=comment.parent_id,
        author_id=comment.author_id,
        author_name=(f"{author.first_name} {author.last_name}".strip() if author else None),
        author_email=author.email if author else None,
        # An external auditor's remarks read differently from a colleague's; the
        # reader is entitled to know which they are looking at.
        author_is_external=bool(getattr(author, "is_external", False)) if author else False,
        body=None if deleted else comment.body,
        is_internal=comment.is_internal,
        is_deleted=deleted,
        created_at=comment.created_at,
        edited_at=comment.edited_at,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("", response_model=CommentThreadOut)
async def list_comments(
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    audit_id: str | None = None,
    finding_id: str | None = None,
    control_assessment_id: str | None = None,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """One thread, oldest first, with internal notes filtered out for the auditee.

    Deleted messages are returned as tombstones (``is_deleted``, no body) rather
    than dropped: a reply whose parent vanished would render as an orphan, and
    hiding that a message was withdrawn is itself a distortion of the record.
    """
    anchor = await _resolve_anchor(
        db, current_user, tenant_id, audit_id, finding_id, control_assessment_id
    )
    team = await is_audit_team(db, current_user, anchor.audit)

    q = select(AuditComment, User).outerjoin(
        User, User.id == AuditComment.author_id
    ).where(AuditComment.tenant_id == tenant_id, anchor.filter_clause())
    cq = select(func.count(AuditComment.id)).where(
        AuditComment.tenant_id == tenant_id, anchor.filter_clause()
    )
    if not team:
        q = q.where(AuditComment.is_internal == False)      # noqa: E712
        cq = cq.where(AuditComment.is_internal == False)    # noqa: E712

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(AuditComment.created_at, AuditComment.id).limit(limit).offset(offset)
    )).all()
    return CommentThreadOut(
        items=[_to_out(c, a) for c, a in rows],
        total=total,
        viewer_is_audit_team=team,
    )


@router.post("", response_model=CommentOut, status_code=201)
async def create_comment(
    body: CommentCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Post a message — a remark, a question to the auditee, or their answer."""
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(422, "body is required")

    anchor = await _resolve_anchor(
        db, current_user, tenant_id, body.audit_id, body.finding_id, body.control_assessment_id
    )
    team = await is_audit_team(db, current_user, anchor.audit)
    if body.is_internal and not team:
        raise HTTPException(403, "Only the audit team can post an internal note")

    anchor_cols = anchor.columns()
    parent = None
    if body.parent_id:
        parent = (await db.execute(
            select(AuditComment).where(
                AuditComment.id == body.parent_id, AuditComment.tenant_id == tenant_id
            )
        )).scalar_one_or_none()
        if parent is None:
            raise HTTPException(404, "Parent comment not found")
        # A reply must stay on the thread it answers, or the anchor filters lie.
        if not _same_thread(parent, anchor):
            raise HTTPException(422, "The parent comment belongs to a different thread")
        # Replying in the open to an internal note would leak it by quotation.
        if parent.is_internal and not body.is_internal:
            raise HTTPException(422, "A reply to an internal note must itself be internal")

    comment = AuditComment(
        tenant_id=tenant_id,
        audit_id=anchor_cols[0],
        finding_id=anchor_cols[1],
        control_assessment_id=anchor_cols[2],
        parent_id=parent.id if parent else None,
        author_id=current_user.id,
        body=text,
        is_internal=bool(body.is_internal),
    )
    db.add(comment)
    await db.flush()

    if not comment.is_internal:
        # The whole point of objectif 5: the other side is *told*. An internal
        # note notifies nobody — it is the audit team talking to itself.
        await _notify_counterparties(db, tenant_id, current_user, anchor, comment, parent)

    await db.commit()
    await db.refresh(comment)
    return _to_out(comment, current_user)


async def _notify_counterparties(
    db: AsyncSession, tenant_id: str, author: User,
    anchor: _Anchor, comment: AuditComment, parent: AuditComment | None,
) -> None:
    """Alert the people this message is actually addressed to.

    Recipients are derived from the anchor rather than asked for, so an auditor
    cannot forget to name the auditee: the owner of the finding, the lead
    auditor, the owner of the checklist line, and whoever is already in the
    thread. Rows are added to the CALLER's session and committed by it — an
    isolated session cannot write while this request holds SQLite's write lock.
    """
    recipients: set[str] = set()
    if anchor.finding is not None:
        if anchor.finding.remediation_owner_id:
            recipients.add(anchor.finding.remediation_owner_id)
    if anchor.control_assessment is not None:
        if anchor.control_assessment.owner_id:
            recipients.add(anchor.control_assessment.owner_id)
    if anchor.assessment is not None and anchor.assessment.lead_assessor_id:
        recipients.add(anchor.assessment.lead_assessor_id)
    if anchor.audit is not None and anchor.audit.lead_auditor_id:
        recipients.add(anchor.audit.lead_auditor_id)
    if parent is not None:
        recipients.add(parent.author_id)
    recipients.discard(author.id)
    if not recipients:
        return

    users = (await db.execute(
        select(User).where(
            User.id.in_(recipients),
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
        )
    )).scalars().all()

    subject = (
        anchor.finding.title if anchor.finding is not None
        else (anchor.audit.title if anchor.audit is not None else "")
    )
    excerpt = comment.body[:180]
    author_name = f"{author.first_name} {author.last_name}".strip() or author.email
    for u in users:
        db.add(Notification(
            tenant_id=tenant_id, user_id=u.id,
            # There is no audit_comment member on NotificationType and models are
            # frozen for this change, so the kind is carried in `data` and the
            # wording in the i18n keys. SYSTEM is the honest bucket meanwhile.
            type=NotificationType.SYSTEM, status=NotificationStatus.UNREAD,
            title="New audit comment",
            message=f"{author_name} commented on '{subject}': {excerpt}",
            title_key="notifications.audit_comment.title",
            message_key="notifications.audit_comment.message",
            params={"author": author_name, "subject": subject, "excerpt": excerpt},
            data={
                "entity_type": "audit_comment",
                "entity_id": comment.id,
                "audit_id": anchor.audit.id if anchor.audit is not None else None,
                "finding_id": comment.finding_id,
                "control_assessment_id": comment.control_assessment_id,
                "severity": "info",
            },
        ))


@router.patch("/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: str,
    body: CommentUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Correct your own message. Nobody edits anyone else's — including an admin.

    Rewriting another person's words in an audit record is falsification, not
    administration, which is why there is no elevated path here.
    """
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(422, "body is required")
    comment = (await db.execute(
        select(AuditComment).where(
            AuditComment.id == comment_id, AuditComment.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if comment is None:
        raise HTTPException(404, "Comment not found")
    if comment.deleted_at is not None:
        raise HTTPException(409, "This comment was withdrawn")
    if comment.author_id != current_user.id:
        raise HTTPException(403, "You can only edit your own comment")

    comment.body = text
    comment.edited_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(comment)
    return _to_out(comment, current_user)


@router.delete("/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Withdraw a message. Soft: `deleted_at` is set, the row and its replies stay.

    The author may withdraw their own; the audit's leadership may withdraw any
    message on their engagement (a wrongly-published internal note has to be
    retractable by someone).
    """
    comment = (await db.execute(
        select(AuditComment).where(
            AuditComment.id == comment_id, AuditComment.tenant_id == tenant_id
        )
    )).scalar_one_or_none()
    if comment is None:
        raise HTTPException(404, "Comment not found")
    if comment.deleted_at is not None:
        return

    audit = None
    if comment.audit_id:
        audit = (await db.execute(
            select(Audit).where(Audit.id == comment.audit_id, Audit.tenant_id == tenant_id)
        )).scalar_one_or_none()
    elif comment.finding_id:
        finding = (await db.execute(
            select(AuditFinding).where(AuditFinding.id == comment.finding_id)
        )).scalar_one_or_none()
        if finding is not None:
            audit = (await db.execute(
                select(Audit).where(Audit.id == finding.audit_id, Audit.tenant_id == tenant_id)
            )).scalar_one_or_none()

    roles = await get_effective_roles(current_user, db)
    may_moderate = bool(roles & AUDIT_TEAM_ROLES) or (
        audit is not None and audit.lead_auditor_id == current_user.id
    )
    if comment.author_id != current_user.id and not may_moderate:
        raise HTTPException(403, "You can only withdraw your own comment")

    comment.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.get("/pending", response_model=list[PendingThreadOut])
async def pending_for_me(
    current_user: Annotated[User, Depends(get_current_user)],
    tenant_id: Annotated[str, Depends(get_tenant_id)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, ge=1, le=200),
):
    """« Constats à traiter » — shared messages awaiting an answer from me.

    A message counts as pending when it is on a finding I own, on any finding of
    an engagement I lead, or on an engagement I lead; it is not mine; it is not
    internal; and I have not replied under it. That last condition is the whole
    difference between a to-do list and a feed, and the "any finding of an
    engagement I lead" clause is what makes the feed work in the auditee→auditor
    direction: an answer to a constat is anchored on the finding, so an
    audit_id-only match never saw one.
    """
    # Findings I own, and engagements I lead — the two ways a message is "for me".
    my_finding_ids = set((await db.execute(
        select(AuditFinding.id)
        .join(Audit, Audit.id == AuditFinding.audit_id)
        .where(Audit.tenant_id == tenant_id,
               Audit.deleted_at.is_(None),
               AuditFinding.remediation_owner_id == current_user.id)
    )).scalars().all())
    my_audit_ids = (await db.execute(
        select(Audit.id).where(Audit.tenant_id == tenant_id,
                               Audit.deleted_at.is_(None),
                               Audit.lead_auditor_id == current_user.id)
    )).scalars().all()
    # The answer to a constat is anchored on the FINDING, not on the engagement,
    # so matching only on audit_id left the lead auditor's own feed permanently
    # empty — the auditee→auditor half of « échanger avec les audités ». Every
    # finding of an engagement I lead is therefore mine to answer too, whichever
    # endpoint wrote the row and whether or not it filled audit_id in.
    if my_audit_ids:
        my_finding_ids |= set((await db.execute(
            select(AuditFinding.id).where(AuditFinding.audit_id.in_(list(my_audit_ids)))
        )).scalars().all())
    if not my_finding_ids and not my_audit_ids:
        return []

    targets = []
    if my_finding_ids:
        targets.append(AuditComment.finding_id.in_(sorted(my_finding_ids)))
    if my_audit_ids:
        # Engagement-level messages only; a finding's messages are caught above.
        targets.append(and_(AuditComment.audit_id.in_(list(my_audit_ids)),
                            AuditComment.finding_id.is_(None)))

    # "I already replied under it" — an EXISTS on my own replies, in SQL, so the
    # feed does not degrade as the threads grow.
    reply_alias = AuditComment.__table__.alias("my_reply")
    answered = select(reply_alias.c.id).where(
        reply_alias.c.parent_id == AuditComment.id,
        reply_alias.c.author_id == current_user.id,
        reply_alias.c.deleted_at.is_(None),
    ).exists()

    rows = (await db.execute(
        select(AuditComment, User, Audit, AuditFinding)
        .outerjoin(User, User.id == AuditComment.author_id)
        .outerjoin(AuditFinding, AuditFinding.id == AuditComment.finding_id)
        .outerjoin(Audit, Audit.id == func.coalesce(AuditComment.audit_id, AuditFinding.audit_id))
        .where(
            AuditComment.tenant_id == tenant_id,
            AuditComment.is_internal == False,      # noqa: E712
            AuditComment.deleted_at.is_(None),
            AuditComment.author_id != current_user.id,
            or_(*targets),
            ~answered,
        )
        .order_by(AuditComment.created_at.desc())
        .limit(limit)
    )).all()

    return [
        PendingThreadOut(
            comment_id=c.id,
            audit_id=c.audit_id or (f.audit_id if f is not None else None),
            audit_title=a.title if a is not None else None,
            finding_id=c.finding_id,
            finding_title=f.title if f is not None else None,
            control_assessment_id=c.control_assessment_id,
            author_id=c.author_id,
            author_name=(f"{u.first_name} {u.last_name}".strip() if u else None),
            excerpt=(c.body or "")[:200],
            created_at=c.created_at,
        )
        for c, u, a, f in rows
    ]
