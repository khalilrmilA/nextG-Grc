"""Cross-worker shared state — Redis-backed, with an in-process fallback.

Production runs uvicorn with 2 workers and the on-prem stack can run several
backend replicas, so any state held in a module-level ``set``/``dict`` is
per-process. That made two things quietly wrong:

- a refresh token revoked on worker A stayed redeemable on worker B,
- the unauthenticated public-chat / public-contact IP rate limits allowed N
  requests *per worker* instead of N overall.

(``app/core/ai_quota.py`` has the same per-worker split but is deliberately
left alone: it is reached from a synchronous call path, and its limit is a
10M-token/day valve on a free local model, so counting it twice changes
nothing anyone can feel.)

This module keeps that state in Redis when one is reachable, which is what
``docker-compose.onprem.yml`` already provisions and what ``REDIS_URL``
already points at for Celery.

Two rules hold everywhere below:

**Never fail a request because Redis is unhappy.** Every helper falls back to
the in-process behaviour this code had before, so single-worker dev without a
Redis, and a Redis outage in production, both keep working — just without
cross-worker visibility, exactly as before this module existed. A degraded
rate limit is better than a 500.

**Everything expires.** The in-process stores this replaces grew forever:
revoked jtis were never evicted, and the public rate limiters accumulated one
list per IP that was only pruned if that same IP came back. Every key written
here carries a TTL, and the fallback purges on access.
"""
from __future__ import annotations

import logging
import time

from app.core.config import settings

logger = logging.getLogger(__name__)

# Key prefix so this app's keys can't collide with Celery's on a shared Redis.
_PREFIX = "grceye:"

# --- in-process fallback -----------------------------------------------------
# {key: (value, expires_at_epoch)}. Only touched when Redis is unavailable.
_LOCAL: dict[str, tuple[int, float]] = {}


def _local_purge(now: float) -> None:
    """Drop expired fallback entries. Cheap: this dict only fills up while
    Redis is down, and every entry has a TTL."""
    for key in [k for k, (_, exp) in _LOCAL.items() if exp <= now]:
        _LOCAL.pop(key, None)


# --- redis client ------------------------------------------------------------
# Created lazily on first use and reused. After a failed connection we stop
# retrying for _RETRY_AFTER_SECONDS rather than latching off permanently, so a
# Redis restart under the on-prem stack heals on its own instead of leaving the
# worker degraded until someone restarts the backend. Probing on every single
# request while Redis is down would cost a connect timeout per request, hence
# the cooldown.
_RETRY_AFTER_SECONDS = 60
_client = None
_retry_after = 0.0


async def _redis():
    """Return a connected async Redis client, or None to use the fallback."""
    global _client, _retry_after
    if _client is not None:
        return _client
    if time.monotonic() < _retry_after:
        return None
    try:
        from redis import asyncio as aioredis  # dependency: redis[hiredis]

        client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        await client.ping()
    except Exception as exc:  # no redis package, bad URL, refused, timeout…
        _retry_after = time.monotonic() + _RETRY_AFTER_SECONDS
        logger.warning(
            "Shared state falling back to in-process storage (%s). Token "
            "revocation and public rate limits are per-worker until Redis is "
            "reachable; retrying in %ds.",
            exc.__class__.__name__,
            _RETRY_AFTER_SECONDS,
        )
        return None
    _client = client
    return _client


def reset_for_tests() -> None:
    """Forget the cached client/fallback so a test can re-probe Redis."""
    global _client, _retry_after
    _client = None
    _retry_after = 0.0
    _LOCAL.clear()


# --- flags (used for token revocation) ---------------------------------------

async def mark(key: str, ttl_seconds: int) -> None:
    """Record ``key`` as set for ``ttl_seconds``. Idempotent."""
    ttl = max(1, int(ttl_seconds))
    client = await _redis()
    if client is not None:
        try:
            await client.set(_PREFIX + key, "1", ex=ttl)
            return
        except Exception:
            logger.warning("Redis write failed for %s; using local fallback", key)
    now = time.time()
    _local_purge(now)
    _LOCAL[key] = (1, now + ttl)


async def is_marked(key: str) -> bool:
    """Whether ``mark(key)`` was called (on any worker) and hasn't expired."""
    client = await _redis()
    if client is not None:
        try:
            return bool(await client.exists(_PREFIX + key))
        except Exception:
            logger.warning("Redis read failed for %s; using local fallback", key)
    now = time.time()
    entry = _LOCAL.get(key)
    if entry is None:
        return False
    if entry[1] <= now:
        _LOCAL.pop(key, None)
        return False
    return True


# --- counters (used for AI quota and public rate limits) ---------------------

async def incr(key: str, amount: int, ttl_seconds: int) -> int:
    """Add ``amount`` to ``key`` and return the new total.

    The TTL is applied only when the key is first created (``EXPIRE NX``), so
    the counter expires a fixed window after it started rather than sliding
    forward on every hit — a caller who keeps hitting a limit can never push
    its own window out forever.

    This is a **fixed** window, where the limiters it replaced kept a sliding
    one. The known trade-off is a boundary burst: someone can spend a full
    allowance at the end of one window and another at the start of the next,
    i.e. up to 2x the nominal rate across that seam. That is accepted here
    deliberately — the two callers are a public chat box and a contact form,
    where a short burst is cheap, and a fixed window is what buys the atomic,
    self-expiring, cross-worker count that the sliding version could not give.
    """
    ttl = max(1, int(ttl_seconds))
    client = await _redis()
    if client is not None:
        try:
            full = _PREFIX + key
            pipe = client.pipeline()
            pipe.incrby(full, amount)
            pipe.expire(full, ttl, nx=True)   # nx: don't extend an open window
            total, _ = await pipe.execute()
            return int(total)
        except Exception:
            logger.warning("Redis incr failed for %s; using local fallback", key)
    now = time.time()
    _local_purge(now)
    value, expires = _LOCAL.get(key, (0, now + ttl))
    if expires <= now:
        value, expires = 0, now + ttl
    value += amount
    _LOCAL[key] = (value, expires)
    return value


async def get_count(key: str) -> int:
    """Current value of a counter, or 0 if unset/expired."""
    client = await _redis()
    if client is not None:
        try:
            raw = await client.get(_PREFIX + key)
            return int(raw) if raw else 0
        except Exception:
            logger.warning("Redis read failed for %s; using local fallback", key)
    now = time.time()
    entry = _LOCAL.get(key)
    if entry is None:
        return 0
    if entry[1] <= now:
        _LOCAL.pop(key, None)
        return 0
    return entry[0]
