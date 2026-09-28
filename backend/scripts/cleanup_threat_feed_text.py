"""Clean the text of feed-imported threats, and find SANS Stormcast podcast rows.

Before the ingest cleanup (app.services.threat_feeds.clean_feed_text), feed
titles and descriptions were stored verbatim, so the Threat Library showed raw
entities (``&#x3f;``, ``&#x2b;``, double-encoded ``&&#x23&#x3b;x26&#x3b;``) and
dozens of "ISC Stormcast For <day>" podcast episodes as threats.

What it does
  (a) decodes entities / strips HTML tags / collapses whitespace in
      threats.name + threats.description of FEED-IMPORTED threats only (rule in
      app.services.threat_translation), and in threat_watch_items.title/summary
      (all feed content). A cleaned name that would collide with another row on
      the unique (tenant_id, ref_id, name) index is left alone and reported.
  (b) lists feed threats that are Stormcast podcast episodes and, only with
      --apply --delete-podcasts, deletes those nothing references. References
      are found by scanning every text/JSON column of every other table for the
      threat id (risk_scenarios.threat_ids, threat_watch_items.promoted_threat_id,
      adopted_from_id, scenario versions, ...). Referenced rows are kept and
      reported. Log-only mentions (threat_history, activity logs, notifications)
      do not block. A "deleted" threat_history entry is written for each delete.
  (c) with --apply --dismiss-watch-podcasts, marks Stormcast items that are
      still 'new' in the threat watch as 'dismissed' (kept, not deleted).

Usage (from backend/):
    python -m scripts.cleanup_threat_feed_text                    # dry run
    python -m scripts.cleanup_threat_feed_text --apply            # fix text
    python -m scripts.cleanup_threat_feed_text --apply --delete-podcasts --dismiss-watch-podcasts
    GRC_DB_PATH=/path/copy.db python -m scripts.cleanup_threat_feed_text
Idempotent: a second --apply run changes nothing.
"""
import argparse
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.services.threat_feeds import clean_feed_text, is_podcast_item  # noqa: E402
from app.services.threat_translation import PROMOTED_NOTE, looks_like_feed_threat  # noqa: E402

# Tables whose mention of a threat id is a log line, not a live link.
LOG_TABLES = {"threat_history", "activity_logs", "activity_log", "notifications", "content_translations"}


def _db_path() -> str:
    return os.environ.get("GRC_DB_PATH") or os.path.join(BACKEND_DIR, "grc_dev.db")


def feed_threats(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    rows = conn.execute(
        "SELECT id, tenant_id, ref_id, name, description, is_builtin FROM threats "
        "WHERE is_builtin = 0 AND tenant_id IS NOT NULL"
    ).fetchall()
    cand = [r for r in rows if looks_like_feed_threat(r["ref_id"], r["name"], bool(r["is_builtin"]), r["tenant_id"])]
    manual = {
        tid for tid, note in conn.execute("SELECT threat_id, note FROM threat_history WHERE action = 'created'")
        if not (note or "").startswith(PROMOTED_NOTE)
    }
    return [r for r in cand if r["id"] not in manual]


def find_references(conn: sqlite3.Connection, ids: set[str]) -> dict[str, list[str]]:
    """{threat id: ["table.column", ...]} for every non-log mention outside the row itself."""
    refs: dict[str, list[str]] = {i: [] for i in ids}
    if not ids:
        return refs
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    for table in tables:
        if table in LOG_TABLES:
            continue
        cols = [c[1] for c in conn.execute(f'PRAGMA table_info("{table}")')
                if not c[2] or any(k in c[2].upper() for k in ("CHAR", "TEXT", "JSON", "CLOB"))]
        if not cols:
            continue
        sel = ", ".join(f'"{c}"' for c in cols)
        for row in conn.execute(f'SELECT {sel} FROM "{table}"'):
            if table == "threats" and row[cols.index("id")] in ids:
                row = [v for c, v in zip(cols, row) if c != "id"]
                cnames = [c for c in cols if c != "id"]
            else:
                cnames = cols
            for col, val in zip(cnames, row):
                if isinstance(val, str) and len(val) >= 36:
                    for tid in ids:
                        if tid in val:
                            refs[tid].append(f"{table}.{col}")
    return refs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--delete-podcasts", action="store_true",
                    help="with --apply: delete unreferenced Stormcast podcast threats")
    ap.add_argument("--dismiss-watch-podcasts", action="store_true",
                    help="with --apply: mark Stormcast podcast items still 'new' in the threat watch as dismissed")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args(argv)

    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"[{mode}] {path}")

    # ── (a) text cleanup ──────────────────────────────────────────────────────
    feed = feed_threats(conn)
    taken = {(r[0], r[1], r[2]) for r in conn.execute("SELECT tenant_id, ref_id, name FROM threats")}
    changed = collisions = 0
    for r in feed:
        name = clean_feed_text(r["name"])[:500] or r["name"]
        desc = clean_feed_text(r["description"], multiline=True) if r["description"] else r["description"]
        if name == r["name"] and desc == r["description"]:
            continue
        if name != r["name"] and (r["tenant_id"], r["ref_id"], name) in taken:
            collisions += 1
            print(f"  skip (would duplicate an existing row): {r['ref_id']} {name[:70]!r}")
            continue
        changed += 1
        if args.verbose:
            print(f"  threat {r['ref_id']}: {r['name'][:60]!r} -> {name[:60]!r}")
        if args.apply:
            conn.execute("UPDATE threats SET name = ?, description = ? WHERE id = ?", (name, desc, r["id"]))
            taken.discard((r["tenant_id"], r["ref_id"], r["name"]))
            taken.add((r["tenant_id"], r["ref_id"], name))
    print(f"feed-imported threats: {len(feed)}; text cleaned: {changed}; skipped (collision): {collisions}")

    wchanged = 0
    watch = conn.execute("SELECT id, title, summary FROM threat_watch_items").fetchall()
    for w in watch:
        title = clean_feed_text(w["title"])[:500] or w["title"]
        summary = clean_feed_text(w["summary"], multiline=True) if w["summary"] else w["summary"]
        if title == w["title"] and summary == w["summary"]:
            continue
        wchanged += 1
        if args.apply:
            conn.execute("UPDATE threat_watch_items SET title = ?, summary = ? WHERE id = ?",
                         (title, summary, w["id"]))
    print(f"threat watch items: {len(watch)}; text cleaned: {wchanged}")
    watch_pods = [w for w in watch if is_podcast_item(w["title"])]
    new_pods = [w["id"] for w in watch_pods
                if conn.execute("SELECT status FROM threat_watch_items WHERE id = ?", (w["id"],)).fetchone()[0] == "new"]
    print(f"threat watch items that are Stormcast podcasts: {len(watch_pods)} ({len(new_pods)} still 'new')")
    if args.apply and args.dismiss_watch_podcasts:
        # Dismissed, not deleted: the watch keeps what was considered.
        conn.executemany("UPDATE threat_watch_items SET status = 'dismissed' WHERE id = ? AND status = 'new'",
                         [(i,) for i in new_pods])
        print(f"dismissed watch podcast items: {len(new_pods)}")

    # ── (b) Stormcast podcast threats ─────────────────────────────────────────
    pods = [r for r in feed if is_podcast_item(r["name"])]
    refs = find_references(conn, {r["id"] for r in pods})
    referenced = [r for r in pods if refs[r["id"]]]
    free = [r for r in pods if not refs[r["id"]]]
    print(f"Stormcast podcast threats: {len(pods)}; referenced (kept): {len(referenced)}; "
          f"unreferenced: {len(free)}")
    for r in referenced:
        print(f"  KEEP {r['id']} {r['ref_id']} {r['name'][:50]!r} <- {sorted(set(refs[r['id']]))}")
    if args.verbose:
        for r in free:
            print(f"  podcast {r['id']} {r['ref_id']} {r['name'][:60]!r}")

    deleted = 0
    if args.apply and args.delete_podcasts:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        for r in free:
            conn.execute(
                "INSERT INTO threat_history (id, threat_id, tenant_id, threat_ref_id, threat_name, action, "
                "changes, note, actor_id, actor_email, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, 'deleted', ?, ?, NULL, NULL, ?, ?)",
                (str(uuid.uuid4()), r["id"], r["tenant_id"], r["ref_id"], r["name"][:500],
                 json.dumps({"name": {"from": r["name"], "to": None}}),
                 "Removed by cleanup_threat_feed_text: SANS ISC Stormcast podcast episode, not a threat.",
                 now, now),
            )
            if _has_table(conn, "content_translations"):
                conn.execute("DELETE FROM content_translations WHERE entity_type = 'threat' AND entity_id = ?",
                             (r["id"],))
            conn.execute("DELETE FROM threats WHERE id = ?", (r["id"],))
            deleted += 1
        print(f"deleted podcast threats: {deleted}")
    elif args.delete_podcasts:
        print("(--delete-podcasts has no effect without --apply)")

    if args.apply:
        conn.commit()
    conn.close()
    if not args.apply:
        print("Dry run — nothing written. Re-run with --apply.")
    return 0


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


if __name__ == "__main__":
    raise SystemExit(main())
