"""Backfill FR/AR machine translations of feed-imported threat text.

Translates name/description of feed-imported threats (rule in
app.services.threat_translation — never tenant-authored or built-in ones) and,
unless --no-watch, title/summary of threat-watch items, into French and Arabic
through the configured model (settings.OLLAMA_BASE_URL / OLLAMA_CHAT_MODEL).
Results go to the content_translations table (created here if the app has not
been restarted since the table was added). Already-translated text is skipped,
so re-running only does what is left; --limit bounds one run.

Run scripts/cleanup_threat_feed_text.py --apply FIRST: translations are keyed by
the hash of the stored English text, so cleaning the text afterwards would make
every translation stale (they would be redone, at the model's cost).

Usage (from backend/):
    python -m scripts.translate_threat_feed_items                   # dry run: counts only
    python -m scripts.translate_threat_feed_items --apply --limit 50
    python -m scripts.translate_threat_feed_items --apply --lang ar --no-watch
    GRC_DB_PATH=/path/copy.db python -m scripts.translate_threat_feed_items ...
"""
import argparse
import asyncio
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _db_path() -> str:
    return os.environ.get("GRC_DB_PATH") or os.path.join(BACKEND_DIR, "grc_dev.db")


async def _run(args) -> int:
    from sqlalchemy import inspect, select

    from app.core.database import AsyncSessionLocal, engine
    from app.models.content_translation import ContentTranslation
    from app.services.content_translation import lookup, needs_translation, source_hash
    from app.services.threat_translation import (
        feed_threat_rows, translate_pending_feed_content, watch_rows,
    )

    print(f"database: {engine.url.render_as_string(hide_password=True)}")
    async with engine.begin() as conn:
        exists = await conn.run_sync(lambda c: inspect(c).has_table("content_translations"))
        if not exists and args.apply:
            await conn.run_sync(lambda c: ContentTranslation.__table__.create(c, checkfirst=True))
            exists = True
            print("created table content_translations")

    langs = [args.lang] if args.lang else ["fr", "ar"]
    async with AsyncSessionLocal() as db:
        sets = {"threat": await feed_threat_rows(db)}
        if not args.no_watch:
            sets["threat_watch"] = await watch_rows(db)
        for etype, rows in sets.items():
            hashes = {source_hash(v) for _, f in rows for v in f.values() if needs_translation(v)}
            for lang in langs:
                done = len(await lookup(db, lang, hashes)) if exists else 0
                print(f"{etype}: {len(rows)} rows, {len(hashes)} distinct texts to translate, "
                      f"{lang}: {done} already translated, {len(hashes) - done} missing")

    if not args.apply:
        print("Dry run — no model calls, nothing written. Re-run with --apply [--limit N].")
        return 0

    stats = await translate_pending_feed_content(
        max_texts=args.limit, langs=langs, include_watch=not args.no_watch)
    print("run:", stats)

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(ContentTranslation).order_by(ContentTranslation.created_at.desc()).limit(500)
        )).scalars().all()
        seen: set = set()
        for r in rows:
            if (r.source_hash, r.lang) in seen or len(seen) >= args.examples:
                continue
            seen.add((r.source_hash, r.lang))
            print(f"  [{r.lang}] {r.entity_type}/{r.field}: {r.text[:140]}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="call the model and write translations")
    ap.add_argument("--limit", type=int, default=100,
                    help="max distinct texts per language and entity type in this run (default 100)")
    ap.add_argument("--lang", choices=["fr", "ar"], help="only this language (default: both)")
    ap.add_argument("--no-watch", action="store_true", help="threat register only, skip threat-watch items")
    ap.add_argument("--examples", type=int, default=6, help="print this many recent translations")
    args = ap.parse_args(argv)

    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    # Must be set before app.core.config is imported; env vars beat the .env files.
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{os.path.abspath(path)}"
    print(f"[{'APPLY' if args.apply else 'DRY RUN'}] {path}")
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
