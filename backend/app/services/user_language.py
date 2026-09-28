"""Which language a given user reads — for text the server writes on its own.

Inside a request the answer is the ``Accept-Language`` header the SPA sends
(``ai_locale.get_request_language``). Outside one — a relance e-mail, a
scheduled report, the Celery digest — there is no header, so the answer is, in
order:

1. the user's last-seen UI language (``user_locales``, recorded by
   :func:`remember_request_language` from the notification feed the SPA polls);
2. the tenant's locale (``tenants.settings["locale"]`` or
   ``settings["notifications"]["language"]``);
3. English.

Everything here is best-effort and never raises: a language lookup must not be
the reason a mail or a feed request fails.
"""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_locale import UserLocale
from app.services.ai_locale import language_from_accept, normalize_language, tenant_locale

logger = logging.getLogger(__name__)

SUPPORTED = ("en", "fr", "ar")

# user_id -> language already persisted, per worker. Only a *change* costs a
# write; a stale entry after the other worker recorded a different value costs
# at most one redundant upsert.
_seen: dict[str, str] = {}


def header_language(request) -> str | None:
    """The language the request explicitly asked for, or None when it did not say.

    Distinct from ``get_request_language``, which defaults to English: an absent
    header must not overwrite a user's remembered French with "en".
    """
    try:
        header = request.headers.get("accept-language") if request is not None else None
    except Exception:  # noqa: BLE001
        return None
    return language_from_accept(header) if header else None


async def remember_request_language(db: AsyncSession, user_id: str, request) -> None:
    """Record the user's UI language if the request states one and it changed.

    Commits its own write (the feed endpoints that call this are otherwise
    read-only). Swallows every error: before the next restart's create_all()
    the table may not exist yet, and that must cost nothing but the memory.
    """
    lang = header_language(request)
    if not lang or not user_id or _seen.get(user_id) == lang:
        return
    try:
        row = (await db.execute(
            select(UserLocale).where(UserLocale.user_id == user_id)
        )).scalar_one_or_none()
        if row is None:
            db.add(UserLocale(user_id=user_id, language=lang, seen_at=datetime.utcnow()))
        elif row.language != lang:
            row.language = lang
            row.seen_at = datetime.utcnow()
        else:
            _seen[user_id] = lang
            return
        await db.commit()
        _seen[user_id] = lang
    except Exception as exc:  # noqa: BLE001 — table missing, lock timeout, ...
        logger.debug("user language not recorded for %s: %s", user_id, exc)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass


async def stored_user_language(db: AsyncSession, user_id: str | None) -> str | None:
    """The user's remembered UI language, or None."""
    if not user_id:
        return None
    try:
        row = (await db.execute(
            select(UserLocale.language).where(UserLocale.user_id == user_id)
        )).scalar_one_or_none()
    except Exception as exc:  # noqa: BLE001 — table not created yet
        logger.debug("user language lookup failed for %s: %s", user_id, exc)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None
    return normalize_language(row) if row else None


def tenant_language(tenant) -> str | None:
    """A tenant's configured language, or None when it has not set one.

    Accepts ``locale: "fr"``, ``locale: {"language": "fr"}`` and
    ``notifications: {"language": "fr"}`` — the shapes PATCH /tenants/settings
    can already write.
    """
    code = normalize_language(tenant_locale(tenant)) if tenant is not None else None
    if code:
        return code
    raw = getattr(tenant, "settings", None) or {}
    notif_cfg = raw.get("notifications") if isinstance(raw, dict) else None
    if isinstance(notif_cfg, dict):
        for candidate in (notif_cfg.get("language"), notif_cfg.get("lang")):
            code = normalize_language(candidate)
            if code:
                return code
    return None


async def recipient_language(db: AsyncSession, user_id: str | None, tenant=None,
                             *, tenant_id: str | None = None) -> str:
    """The language to write to this user in: remembered UI language → tenant → en."""
    code = await stored_user_language(db, user_id)
    if code:
        return code
    if tenant is None and tenant_id:
        try:
            from app.models.tenant import Tenant
            tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
        except Exception:  # noqa: BLE001
            tenant = None
    return tenant_language(tenant) or "en"


async def language_for_email(db: AsyncSession, email: str | None, tenant=None) -> str:
    """Same chain for a bare e-mail address (scheduled-report recipients).

    An address that belongs to a platform user gets that user's language; an
    external address gets the tenant's.
    """
    user_id = None
    if email:
        try:
            from app.models.user import User
            user_id = (await db.execute(
                select(User.id).where(User.email == email.strip().lower())
            )).scalar_one_or_none()
        except Exception:  # noqa: BLE001
            user_id = None
    return await recipient_language(db, user_id, tenant)
