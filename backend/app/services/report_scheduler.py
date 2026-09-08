"""Scheduled-report engine (Elite Pack).

Generates one of the built-in PDF reports on a recurring cadence and emails it to a
list of recipients. Designed to actually fire in the production topology, which runs
uvicorn under pm2 with NO Redis/Celery-beat:

- `run_due_schedules` claims each due schedule with an optimistic UPDATE conditioned
  on its current `next_run_at`, so even with 2 uvicorn workers (or a Celery beat also
  running) exactly one runner delivers a given occurrence — no double-send.
- `start_report_scheduler` is an in-process asyncio loop launched from the app lifespan;
  `generate_scheduled_reports` (Celery task) calls the same claim path when beat exists.

Three properties the STB tender requires and this file is responsible for:

**The approval gate holds on the automated path too.** A schedule may target one
engagement (``report_type = "audit:<audit_id>"``), and sending an audit report is
a *diffusion*: it is refused unless that engagement's report_status is approved or
issued. A gate that only lives in the HTTP handler is not a control — the mailer
is precisely the channel that bypasses screens.

**Delivery is recorded.** Every send writes a ReportDistribution row, the same row
the manual `/audits/{id}/report/distribute` writes, so « à qui le rapport a-t-il
été diffusé, et quand ? » is answerable for scheduled mail too — the activity log
cannot answer it, because a scheduled e-mail has no HTTP request behind it.

**Reports are archived, not just posted.** What was mailed is persisted with its
digest, so the copy in a recipient's inbox can be compared with the one on file.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.audit import Audit
from app.models.report_distribution import ReportDistribution
from app.models.report_schedule import ReportSchedule, ReportFrequency
from app.models.stored_file_version import StoredFileVersion
from app.models.tenant import Tenant
from app.services import file_integrity
from app.services.ai_locale import normalize_language, tenant_locale
from app.services.report_generator import (
    archive_report,
    generate_report,
    report_type_name,
    REPORT_GENERATORS,
)
from app.services.email_service import send_report_email

logger = logging.getLogger(__name__)

REPORT_TYPES = set(REPORT_GENERATORS.keys())  # executive, risk, compliance, vendor, audit
POLL_SECONDS = 300  # in-process loop cadence

# A schedule may target one engagement rather than a tenant-wide aggregate. Kept
# as a prefix on the existing report_type column rather than a new column: the
# schema migration for this release is closed, and a prefixed value is
# self-describing and backward compatible (every existing row is a bare type).
ENGAGEMENT_PREFIX = "audit:"

# The states in which an engagement's report may leave the building. Mirrors
# endpoints/audits.py's download and distribute gates — the same rule, enforced
# on the channel that has no screen in front of it.
DISTRIBUTABLE_REPORT_STATUSES = ("approved", "issued")

# Covering text for the mail itself. The attachment is localised by the
# generator; a French report arriving under an English subject line is still an
# English artefact as far as a recipient's mailbox is concerned.
_MAIL = {
    "en": {
        "subject": "[{org}] {report} — {stamp}",
        "body": "Your scheduled report « {report} » is attached.",
        "audit_subject": "[{org}] Audit report — {audit}",
        "audit_body": "The approved audit report for '{audit}' is attached.",
    },
    "fr": {
        "subject": "[{org}] {report} — {stamp}",
        "body": "Votre rapport planifié « {report} » est en pièce jointe.",
        "audit_subject": "[{org}] Rapport d'audit — {audit}",
        "audit_body": "Le rapport d'audit validé pour « {audit} » est en pièce jointe.",
    },
    "ar": {
        "subject": "[{org}] {report} — {stamp}",
        "body": "تقريرك المجدول «{report}» مرفق بهذه الرسالة.",
        "audit_subject": "[{org}] تقرير التدقيق — {audit}",
        "audit_body": "تقرير التدقيق المعتمد لـ «{audit}» مرفق بهذه الرسالة.",
    },
}


def _utcnow() -> datetime:
    """Naive UTC, matching how the rest of the app stores timestamps."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _mail_text(lang: str, key: str, **fmt) -> str:
    table = _MAIL.get(lang) or _MAIL["en"]
    return (table.get(key) or _MAIL["en"][key]).format(**fmt)


def is_supported_report_type(value: str) -> bool:
    """True for a tenant-wide type or a well-formed engagement target.

    endpoints/report_schedules.py validates through this function, so an
    ``audit:<audit_id>`` schedule can be created from the API and reaches the
    approval gate in _deliver. It also resolves the audit at creation time; the
    only shape check that belongs here is the prefix itself.
    """
    if value in REPORT_TYPES:
        return True
    return value.startswith(ENGAGEMENT_PREFIX) and len(value) > len(ENGAGEMENT_PREFIX)


def engagement_id(report_type: str) -> str | None:
    """The audit id a schedule targets, or None for a tenant-wide report."""
    if report_type and report_type.startswith(ENGAGEMENT_PREFIX):
        return report_type[len(ENGAGEMENT_PREFIX):] or None
    return None


def compute_next_run(schedule: ReportSchedule, now: datetime) -> datetime:
    """Next UTC datetime this schedule should fire, strictly after `now` (naive UTC)."""
    hour = int(schedule.hour or 0) % 24
    if schedule.frequency == ReportFrequency.DAILY:
        candidate = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate
    if schedule.frequency == ReportFrequency.WEEKLY:
        target_dow = int(schedule.day_of_week or 0) % 7
        candidate = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        days_ahead = (target_dow - candidate.weekday()) % 7
        candidate += timedelta(days=days_ahead)
        if candidate <= now:
            candidate += timedelta(days=7)
        return candidate
    # MONTHLY — clamp day to 28 so every month is valid.
    dom = min(max(int(schedule.day_of_month or 1), 1), 28)
    candidate = now.replace(day=dom, hour=hour, minute=0, second=0, microsecond=0)
    if candidate <= now:
        month = 1 if candidate.month == 12 else candidate.month + 1
        year = candidate.year + (1 if candidate.month == 12 else 0)
        candidate = candidate.replace(year=year, month=month)
    return candidate


def _schedule_language(tenant: Tenant | None) -> str:
    """Language for a scheduled report — the tenant's, else English.

    A schedule has no recipient to ask (they are bare e-mail addresses, not
    users), so the tenant's own locale is the only signal available. It falls
    back to English exactly as ai_locale does everywhere else.
    """
    return normalize_language(tenant_locale(tenant)) or "en"


async def _current_report_version(db: AsyncSession, audit: Audit) -> StoredFileVersion | None:
    """The file-version row for the PDF currently on an engagement.

    Same lookup endpoints/audits.py uses, so a scheduled distribution names the
    same version number a manual one would.
    """
    try:
        return (await db.execute(
            select(StoredFileVersion)
            .where(StoredFileVersion.parent_type == "audit",
                   StoredFileVersion.parent_id == audit.id,
                   StoredFileVersion.entity_type == "audit_report",
                   StoredFileVersion.status == file_integrity.CURRENT)
            .order_by(StoredFileVersion.version_number.desc()).limit(1)
        )).scalars().first()
    except SQLAlchemyError as exc:  # noqa: BLE001
        logger.warning("scheduled report: version lookup failed (%s)", exc.__class__.__name__)
        return None


async def _engagement_payload(db: AsyncSession, tenant_id: str, audit_id: str):
    """(pdf_bytes, filename, audit, version) for an approved engagement report.

    Raises PermissionError when the report may not be distributed — the caller
    turns that into a refusal recorded on the schedule, so an operator can see
    *why* nothing was sent rather than assuming the mailer is broken.
    """
    audit = (await db.execute(
        select(Audit).where(
            Audit.id == audit_id,
            Audit.tenant_id == tenant_id,
            Audit.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if audit is None:
        raise PermissionError("audit not found for this tenant")
    if (audit.report_status or "draft") not in DISTRIBUTABLE_REPORT_STATUSES:
        # This is the requirement, not a nicety: « validation … avant diffusion ».
        raise PermissionError(f"report not approved (status={audit.report_status or 'draft'})")
    if not audit.report_url:
        raise PermissionError("no report has been generated for this audit")

    full = Path(settings.UPLOADS_DIR) / audit.report_url
    version = await _current_report_version(db, audit)
    status, _actual = file_integrity.verify_file(full, version.file_sha256 if version is not None else None)
    if status in (file_integrity.MISSING, file_integrity.UNREADABLE):
        raise PermissionError(f"approved report file is {status}")
    if status == file_integrity.MODIFIED:
        # The approval was given to specific bytes. Different bytes are a
        # different document and have not been validated.
        raise PermissionError("approved report failed its integrity check")

    pdf_bytes = full.read_bytes()
    filename = (version.file_name if version is not None else None) or f"audit-report-{audit.id}.pdf"
    return pdf_bytes, filename, audit, version


async def _record_distribution(
    db: AsyncSession,
    *,
    tenant_id: str,
    recipients: list[str],
    report_kind: str,
    file_name: str | None,
    sha256: str | None,
    report_version: int,
    audit_id: str | None = None,
    note: str | None = None,
) -> None:
    """Log one act of diffusion. Best effort — never costs the delivery.

    report_distributions is a new table; until create_all() builds it at the next
    restart the insert fails, and a mail that went out uncatalogued is still
    better than a mail that never went out.
    """
    try:
        db.add(ReportDistribution(
            tenant_id=tenant_id, audit_id=audit_id, report_kind=report_kind,
            file_name=file_name, sha256=sha256, report_version=report_version,
            channel="email", recipients=", ".join(recipients), note=note,
            distributed_by_id=None,  # a scheduler has no human actor
            distributed_at=_utcnow(),
        ))
        await db.commit()
    except SQLAlchemyError as exc:  # noqa: BLE001
        await db.rollback()
        logger.warning("scheduled report: distribution row not written (%s)", exc.__class__.__name__)


async def _deliver(db: AsyncSession, schedule: ReportSchedule) -> tuple[bool, str]:
    """Generate the report and email it to every recipient. Returns (ok, status)."""
    if not is_supported_report_type(schedule.report_type or ""):
        return False, f"unknown report_type {schedule.report_type}"
    recipients = [r for r in (schedule.recipients or []) if r]
    if not recipients:
        return False, "no recipients"

    # Read the schedule's own fields into locals up front. A failed insert later
    # forces a rollback, and rollback expires every instance in the session
    # regardless of expire_on_commit — a plain attribute read after that would
    # try an implicit lazy load, which async SQLAlchemy cannot perform.
    sched_id, sched_name = schedule.id, schedule.name
    tenant_id, report_type = schedule.tenant_id, schedule.report_type
    created_by_id = schedule.created_by_id

    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    tenant_name = getattr(tenant, "name", None) or "Organization"
    lang = _schedule_language(tenant)
    stamp = datetime.utcnow().strftime("%Y-%m-%d")

    audit_id = engagement_id(report_type)
    if audit_id:
        # ── Engagement report: gated on approval, sent as the approved bytes ──
        try:
            pdf_bytes, filename, audit, version = await _engagement_payload(db, tenant_id, audit_id)
        except PermissionError as exc:
            logger.info("Scheduled report %s refused: %s", sched_id, exc)
            return False, f"refused: {exc}"[:250]
        subject = _mail_text(lang, "audit_subject", org=tenant_name, audit=audit.title)
        body = _mail_text(lang, "audit_body", audit=audit.title)
        sha256 = version.file_sha256 if version is not None else file_integrity.sha256_bytes(pdf_bytes)
        report_version = version.version_number if version is not None else 1
        kind = "audit"
    else:
        # ── Tenant-wide aggregate: a management summary, produced fresh ───────
        # These carry no approval object to gate on (there is no per-report
        # workflow for an aggregate); the gate above is what the requirement
        # attaches to, and it is on the engagement report that is actually the
        # « livrable d'audit ».
        try:
            pdf_bytes = await generate_report(report_type, db, tenant_id, tenant_name, lang)
        except Exception as exc:  # noqa: BLE001 — report failure, don't crash the loop
            logger.error("Scheduled report generation failed (%s): %s", sched_id, exc)
            return False, f"generation error: {exc}"[:250]
        filename = f"{report_type}-report-{stamp}-{lang}.pdf"
        # The covering text names the report the way the attachment does. Using
        # the raw type key produced "Rapport risk — …" on a French schedule (and
        # dropped the ".title()" the English subject used to have).
        report_label = report_type_name(report_type, lang)
        subject = _mail_text(lang, "subject", org=tenant_name, report=report_label, stamp=stamp)
        body = _mail_text(lang, "body", report=report_label)
        # Archive before sending: a scheduled report used to exist only inside
        # somebody's mailbox, so nothing could be produced later to show what
        # had actually been circulated.
        archived = await archive_report(
            db, tenant_id=tenant_id, report_type=report_type,
            pdf_bytes=pdf_bytes, lang=lang, generated_by_id=created_by_id,
            note=f"scheduled:{sched_id} lang={lang}",
        )
        sha256 = archived.file_sha256 if archived is not None else file_integrity.sha256_bytes(pdf_bytes)
        report_version = archived.version_number if archived is not None else 1
        if archived is not None and archived.file_name:
            filename = archived.file_name
        kind = report_type

    sent = 0
    delivered_to: list[str] = []
    for email in recipients:
        if await send_report_email(to_email=email, subject=subject, pdf_bytes=pdf_bytes,
                                   filename=filename, body_text=body):
            sent += 1
            delivered_to.append(email)

    if delivered_to:
        await _record_distribution(
            db, tenant_id=tenant_id, recipients=delivered_to, report_kind=kind,
            file_name=filename, sha256=sha256, report_version=report_version,
            audit_id=audit_id, note=f"schedule:{sched_name or sched_id} lang={lang}",
        )

    return (sent > 0), f"sent {sent}/{len(recipients)} at {datetime.utcnow().isoformat(timespec='seconds')}"


async def run_schedule_now(db: AsyncSession, schedule: ReportSchedule) -> tuple[bool, str]:
    """Deliver a schedule immediately (manual 'run now') without touching its cadence.

    Goes through _deliver, so the approval gate applies to the manual trigger
    exactly as it does to the cadence — a "run now" button must not be a way
    around a validation control.
    """
    ok, status = await _deliver(db, schedule)
    schedule.last_run_at = datetime.utcnow()
    schedule.last_status = status
    await db.commit()
    return ok, status


async def run_due_schedules(db: AsyncSession) -> dict:
    """Deliver every schedule whose next_run_at has passed, claiming each atomically."""
    now = datetime.utcnow()
    rows = (await db.execute(
        select(ReportSchedule).where(
            ReportSchedule.enabled == True,  # noqa: E712
            ReportSchedule.next_run_at.isnot(None),
            ReportSchedule.next_run_at <= now,
        )
    )).scalars().all()

    delivered = 0
    for sched in rows:
        prev_next = sched.next_run_at
        new_next = compute_next_run(sched, now)
        # Optimistic claim: only the runner whose UPDATE still matches the old
        # next_run_at wins; everyone else gets rowcount 0 and skips.
        claim = await db.execute(
            update(ReportSchedule)
            .where(ReportSchedule.id == sched.id, ReportSchedule.next_run_at == prev_next)
            .values(next_run_at=new_next)
        )
        await db.commit()
        if claim.rowcount != 1:
            continue
        await db.refresh(sched)
        ok, status = await _deliver(db, sched)
        sched.last_run_at = now
        sched.last_status = status
        await db.commit()
        if ok:
            delivered += 1

    return {"due": len(rows), "delivered": delivered, "checked_at": now.isoformat(timespec="seconds")}


async def start_report_scheduler() -> None:
    """In-process loop: every POLL_SECONDS, deliver any due schedules.

    Disabled with ENABLE_REPORT_SCHEDULER=0. Safe under multiple workers because
    run_due_schedules claims each occurrence atomically.

    The flag is read through notification_generator._env_flag, not os.getenv:
    pydantic-settings never exports anything to os.environ and nothing in the
    app calls load_dotenv, so ENABLE_REPORT_SCHEDULER=0 written into
    backend/.env.local — the only place an operator can edit without touching
    PM2 — was read by nobody and this loop started anyway. One implementation,
    imported rather than copied, so the two schedulers cannot drift on how a
    quoted value or a trailing comment is parsed. Imported lazily because the
    generator module pulls in most of the model layer.
    """
    from app.services.notification_generator import _env_flag

    if _env_flag("ENABLE_REPORT_SCHEDULER") == "0":
        logger.warning("Report scheduler DISABLED via ENABLE_REPORT_SCHEDULER=0")
        return
    logger.info("Report scheduler started (poll every %ss)", POLL_SECONDS)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await run_due_schedules(db)
            if result["delivered"]:
                logger.info("Scheduled reports delivered: %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.error("Report scheduler tick failed: %s", exc)
        await asyncio.sleep(POLL_SECONDS)
