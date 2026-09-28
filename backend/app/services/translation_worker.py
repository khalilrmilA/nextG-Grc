"""Background worker: keeps SYSTEM content translated into en/fr/ar, automatically.

Every cycle it walks the registry (app.services.translation_sources) in priority
order, collects the (text, target language) pairs that have no cached
translation yet, and translates at most TRANSLATION_WORKER_MAX_TEXTS of them.
New rows — a feed item fetched overnight, a regulatory update, a built-in
framework imported next month — are simply missing pairs on the next cycle, so
nothing has to be run by hand.

Singleton. Production runs 2 uvicorn workers, each of which starts this loop at
boot. Only the process that holds an exclusive flock on a lock file (keyed by
DATABASE_URL, in the OS temp dir) runs cycles; the lock is held for the life of
the process and released by the kernel when it exits, at which point the other
worker takes over on its next attempt. On a platform without fcntl (Windows dev,
single worker) the loop just runs.

Never crashes the app: every cycle is wrapped, an unreachable model triggers an
exponential back-off (capped at 1 h), and a text the model keeps rejecting is
parked for a day instead of blocking the queue.

Environment (all optional):
  ENABLE_TRANSLATION_WORKER=0          disable the loop entirely
  TRANSLATION_WORKER_INTERVAL_S=300    sleep between cycles when nothing is pending
  TRANSLATION_WORKER_BUSY_INTERVAL_S=60  sleep between cycles while a backlog remains
  TRANSLATION_WORKER_MAX_TEXTS=64      model translations per cycle (the Ollama budget)
  TRANSLATION_WORKER_START_DELAY_S=90  delay after boot before the first cycle
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import tempfile
import time
from pathlib import Path

from sqlalchemy import delete, select

from app.core.config import settings
from app.services.content_translation import (
    detect_language, needs_translation, source_hash, store, targets_for, translate_texts,
)
from app.services.translation_sources import TranslationSource, sources_by_priority

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default))))
    except ValueError:
        return default


INTERVAL_S = _env_int("TRANSLATION_WORKER_INTERVAL_S", 300)
BUSY_INTERVAL_S = _env_int("TRANSLATION_WORKER_BUSY_INTERVAL_S", 60)
MAX_TEXTS = _env_int("TRANSLATION_WORKER_MAX_TEXTS", 64)
START_DELAY_S = _env_int("TRANSLATION_WORKER_START_DELAY_S", 90)
MAX_BACKOFF_S = 3600
PARK_AFTER_FAILURES = 3
PARK_FOR_S = 24 * 3600

def _db_key() -> str:
    """Stable per-database key for the lock/status file names. For SQLite it is
    the resolved file path, so the read-only status script (which opens the same
    file through a ``file:...?mode=ro`` URI) finds the server's status file."""
    url = str(getattr(settings, "DATABASE_URL", ""))
    if url.startswith("sqlite") and ":///" in url:
        path = url.split(":///", 1)[1].split("?", 1)[0]
        if path.startswith("file:"):
            path = path[5:]
        url = os.path.abspath(path)
    return hashlib.sha256(url.encode()).hexdigest()[:12]


_KEY = _db_key()
LOCK_PATH = Path(os.getenv("TRANSLATION_WORKER_LOCK") or
                 Path(tempfile.gettempdir()) / f"grceye-translation-{_KEY}.lock")
STATUS_PATH = Path(os.getenv("TRANSLATION_WORKER_STATUS") or
                   Path(tempfile.gettempdir()) / f"grceye-translation-{_KEY}.status.json")

_LOCK_FD: int | None = None
_WAKE: asyncio.Event | None = None
# (source hash, target lang) -> (failures, last failure time). Per process, which
# is fine: only the lock holder translates.
_FAILS: dict[tuple[str, str], tuple[int, float]] = {}


# ── Singleton ─────────────────────────────────────────────────────────────────

def acquire_singleton(path: Path | None = None) -> bool:
    """True when THIS process owns the translation loop (idempotent)."""
    global _LOCK_FD
    if _LOCK_FD is not None:
        return True
    try:
        import fcntl
    except ImportError:   # Windows: one worker, no contention
        return True
    try:
        fd = os.open(path or LOCK_PATH, os.O_RDWR | os.O_CREAT, 0o600)
    except OSError as exc:
        logger.warning("translation worker: cannot open lock file (%s) — not running here", exc)
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return False
    try:
        os.ftruncate(fd, 0)
        os.write(fd, str(os.getpid()).encode("ascii"))
    except OSError:
        pass
    _LOCK_FD = fd
    return True


def release_singleton() -> None:
    global _LOCK_FD
    if _LOCK_FD is not None:
        try:
            os.close(_LOCK_FD)
        except OSError:
            pass
        _LOCK_FD = None


def nudge() -> bool:
    """Wake the loop early (e.g. right after a feed fetch). Only effective in the
    process that runs the loop; elsewhere the next cycle picks the rows up."""
    if _WAKE is not None and _LOCK_FD is not None:
        _WAKE.set()
        return True
    return False


# ── Status (shared through a file: the status endpoint may be served by the
#    worker that does NOT run the loop) ───────────────────────────────────────

def _write_status(data: dict) -> None:
    try:
        tmp = STATUS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, default=str))
        os.replace(tmp, STATUS_PATH)
    except OSError:
        pass


def read_worker_status() -> dict:
    try:
        return json.loads(STATUS_PATH.read_text())
    except (OSError, ValueError):
        return {}


# ── One cycle ─────────────────────────────────────────────────────────────────

def _parked(h: str, tgt: str, now: float) -> bool:
    n, last = _FAILS.get((h, tgt), (0, 0.0))
    if n >= PARK_AFTER_FAILURES and now - last < PARK_FOR_S:
        return True
    if n >= PARK_AFTER_FAILURES:
        _FAILS.pop((h, tgt), None)   # a day has passed: try again
    return False


async def existing_pairs(db) -> set[tuple[str, str]]:
    from app.models.content_translation import ContentTranslation as CT
    return {(h, lang) for h, lang in (await db.execute(
        select(CT.source_hash, CT.lang).distinct())).all()}


async def queued_requests(db) -> dict[tuple[str, str], set[str]]:
    from app.models.content_translation import ContentTranslationRequest as Q
    out: dict[tuple[str, str], set[str]] = {}
    try:
        for et, eid, lang in (await db.execute(select(Q.entity_type, Q.entity_id, Q.lang))).all():
            out.setdefault((et, eid), set()).add(lang)
    except Exception:   # noqa: BLE001 — table not created yet
        await db.rollback()
    return out


def wanted_pairs(source: TranslationSource, rows, queue=None):
    """Yield (entity_id, field, text, hash, src, tgt) for every pair a source wants."""
    for eid, fields in rows:
        allowed = queue.get((source.entity_type, eid)) if (source.on_demand and queue is not None) else None
        if source.on_demand and not allowed:
            continue
        for field, text in fields.items():
            if not needs_translation(text):
                continue
            h = source_hash(text)
            src = detect_language(text, source.default_lang)
            for tgt in targets_for(src):
                if allowed is not None and tgt not in allowed:
                    continue
                yield eid, field, text, h, src, tgt


async def run_cycle(*, max_texts: int | None = None, session_factory=None, client=None,
                    sources: list[TranslationSource] | None = None) -> dict:
    """Translate at most ``max_texts`` missing (text, language) pairs, highest
    priority first. Returns a summary. Never raises."""
    max_texts = MAX_TEXTS if max_texts is None else max_texts
    started = time.time()
    summary: dict = {"started_at": started, "planned": 0, "translated": 0, "stored": 0,
                     "by_source": {}, "unreachable": False, "failed_batches": 0,
                     "backlog_remaining": False, "error": None}
    try:
        if session_factory is None:
            from app.core.database import AsyncSessionLocal as session_factory
        engine = getattr(settings, "OLLAMA_CHAT_MODEL", None)
        now = time.time()
        async with session_factory() as db:
            existing = await existing_pairs(db)
            queue = await queued_requests(db)
            # (src, tgt) -> {hash: [(entity_type, entity_id, field)]}
            plan: dict[tuple[str, str], dict[str, list[tuple[str, str, str]]]] = {}
            texts: dict[str, str] = {}
            prep: dict[str, object] = {}
            origin: dict[tuple[str, str], str] = {}
            count = 0
            for source in (sources or sources_by_priority()):
                if count >= max_texts:
                    summary["backlog_remaining"] = True
                    break
                try:
                    rows = await source.rows(db)
                except Exception as exc:   # noqa: BLE001 — one source must not stop the others
                    logger.warning("translation worker: source %s failed: %s", source.key, exc)
                    await db.rollback()
                    continue
                for eid, field, text, h, src, tgt in wanted_pairs(source, rows, queue):
                    if (h, tgt) in existing or _parked(h, tgt, now):
                        continue
                    bucket = plan.setdefault((src, tgt), {})
                    if h not in bucket:
                        if count >= max_texts:
                            summary["backlog_remaining"] = True
                            continue
                        count += 1
                        bucket[h] = []
                        origin[(h, tgt)] = source.key
                        summary["by_source"].setdefault(source.key, 0)
                        summary["by_source"][source.key] += 1
                    bucket[h].append((source.entity_type, eid, field))
                    texts[h] = text
                    prep[h] = source.prepare
            await db.commit()   # no read transaction held across model calls
            summary["planned"] = count

            report: dict = {}
            for (src, tgt), by_hash in plan.items():
                if report.get("unreachable"):
                    break
                hashes = list(by_hash)
                send = [(prep[h](texts[h]) if prep.get(h) else texts[h]) for h in hashes]
                out = await translate_texts(send, tgt, source_lang=src, client=client, report=report)
                summary["translated"] += len(out)
                for idx, h in enumerate(hashes):
                    if idx in out:
                        _FAILS.pop((h, tgt), None)
                        existing.add((h, tgt))
                        for et, eid, field in by_hash[h]:
                            await store(db, entity_type=et, entity_id=eid, lang=tgt, field=field,
                                        src_hash=h, text=out[idx], engine=engine)
                            summary["stored"] += 1
                    elif not report.get("unreachable"):
                        n, _ = _FAILS.get((h, tgt), (0, 0.0))
                        _FAILS[(h, tgt)] = (n + 1, time.time())
                await db.commit()
            summary["unreachable"] = bool(report.get("unreachable"))
            summary["failed_batches"] = report.get("failed_batches", 0)

            # Drop on-demand requests that are satisfied (or cannot be): the entity
            # is gone, or every text it has is translated / parked.
            if queue:
                await _prune_queue(db, queue, existing, now)
    except Exception as exc:   # noqa: BLE001 — never let a cycle escape
        logger.exception("translation worker: cycle failed: %s", exc)
        summary["error"] = str(exc)[:300]
    summary["duration_s"] = round(time.time() - started, 2)
    return summary


async def _prune_queue(db, queue, existing, now) -> None:
    from app.models.content_translation import ContentTranslationRequest as Q
    try:
        for source in sources_by_priority():
            if not source.on_demand:
                continue
            rows = dict(await source.rows(db))
            done: list[tuple[str, str]] = []
            for (et, eid), langs in queue.items():
                if et != source.entity_type:
                    continue
                for lang in langs:
                    fields = rows.get(eid)
                    if fields is None:
                        done.append((eid, lang))
                        continue
                    pending = [
                        1 for f, text, h, src, tgt in (
                            (f, t, source_hash(t), detect_language(t, source.default_lang), lang)
                            for f, t in fields.items() if needs_translation(t))
                        if tgt != src and (h, tgt) not in existing and not _parked(h, tgt, now)
                    ]
                    if not pending:
                        done.append((eid, lang))
            for eid, lang in done:
                await db.execute(delete(Q).where(Q.entity_type == source.entity_type,
                                                 Q.entity_id == eid, Q.lang == lang))
        await db.commit()
    except Exception as exc:   # noqa: BLE001
        logger.warning("translation worker: queue prune failed: %s", exc)
        await db.rollback()


# ── Status for the admin endpoint / script ────────────────────────────────────

async def compute_status(db) -> dict:
    """Per source and target language: total / translated / missing pairs, plus
    the on-demand queue size. Read-only."""
    from sqlalchemy import func
    from app.models.content_translation import ContentTranslationRequest as Q
    existing = await existing_pairs(db)
    queue = await queued_requests(db)
    out: dict = {"sources": {}, "totals": {"total": 0, "translated": 0, "missing": 0}}
    for source in sources_by_priority():
        per: dict = {}
        try:
            rows = await source.rows(db)
        except Exception as exc:   # noqa: BLE001
            await db.rollback()
            out["sources"][source.key] = {"error": str(exc)[:200]}
            continue
        seen: set[tuple[str, str]] = set()
        for _eid, _f, _t, h, _src, tgt in wanted_pairs(source, rows, queue):
            if (h, tgt) in seen:
                continue
            seen.add((h, tgt))
            s = per.setdefault(tgt, {"total": 0, "translated": 0, "missing": 0})
            s["total"] += 1
            if (h, tgt) in existing:
                s["translated"] += 1
            else:
                s["missing"] += 1
        entry = {"priority": source.priority, "entity_type": source.entity_type,
                 "on_demand": source.on_demand, "rows": len(rows), "by_lang": per}
        if source.on_demand:
            entry["note"] = "translated when viewed in fr/ar; counts cover the queued rows only"
        out["sources"][source.key] = entry
        if not source.on_demand:
            for s in per.values():
                for k in ("total", "translated", "missing"):
                    out["totals"][k] += s[k]
    try:
        out["queue_size"] = int((await db.execute(select(func.count()).select_from(Q))).scalar_one())
    except Exception:   # noqa: BLE001
        await db.rollback()
        out["queue_size"] = None
    out["worker"] = read_worker_status()
    out["config"] = {"interval_s": INTERVAL_S, "busy_interval_s": BUSY_INTERVAL_S,
                     "max_texts_per_cycle": MAX_TEXTS,
                     "enabled": os.getenv("ENABLE_TRANSLATION_WORKER", "1") != "0"}
    return out


# ── The loop ──────────────────────────────────────────────────────────────────

def next_wait(summary: dict, failures: int) -> tuple[int, int]:
    """(seconds to sleep, consecutive unreachable count) after a cycle. An
    unreachable model doubles the wait each time, from the idle interval up to
    MAX_BACKOFF_S; a backlog shortens it to the busy interval."""
    if summary.get("unreachable"):
        failures += 1
        return min(max(INTERVAL_S, 60) * (2 ** (failures - 1)), MAX_BACKOFF_S), failures
    return (BUSY_INTERVAL_S if summary.get("backlog_remaining") else INTERVAL_S), 0


async def _sleep(seconds: float) -> None:
    global _WAKE
    if _WAKE is None:
        _WAKE = asyncio.Event()
    try:
        await asyncio.wait_for(_WAKE.wait(), timeout=max(1.0, seconds))
    except asyncio.TimeoutError:
        pass
    _WAKE.clear()


async def start_translation_worker() -> None:
    """Long-running coroutine started from the app lifespan. Cancel on shutdown."""
    global _WAKE
    if os.getenv("ENABLE_TRANSLATION_WORKER", "1") == "0":
        logger.info("Translation worker disabled via ENABLE_TRANSLATION_WORKER=0")
        return
    _WAKE = asyncio.Event()
    await asyncio.sleep(START_DELAY_S)
    failures = 0
    try:
        while True:
            try:
                if not acquire_singleton():
                    # The other uvicorn worker owns the loop. Check again later in
                    # case it went away (the kernel frees its lock when it exits).
                    await asyncio.sleep(max(INTERVAL_S, 60))
                    continue
                summary = await run_cycle()
                wait, failures = next_wait(summary, failures)
                if summary["unreachable"]:
                    logger.warning("translation worker: model unreachable, backing off %ds", wait)
                if summary["planned"] or summary["unreachable"] or summary["error"]:
                    logger.info("translation worker cycle: planned=%d translated=%d stored=%d by_source=%s "
                                "unreachable=%s duration=%ss",
                                summary["planned"], summary["translated"], summary["stored"],
                                summary["by_source"], summary["unreachable"], summary["duration_s"])
                _write_status({"pid": os.getpid(), "last_cycle": summary,
                               "consecutive_unreachable": failures,
                               "next_cycle_at": time.time() + wait})
                await _sleep(wait)
            except asyncio.CancelledError:
                raise
            except Exception as exc:   # noqa: BLE001 — never let the loop die
                logger.exception("translation worker error: %s", exc)
                await asyncio.sleep(max(INTERVAL_S, 60))
    finally:
        release_singleton()
