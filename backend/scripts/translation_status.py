"""Read-only report of the automatic content translation (translation_worker).

Prints, per registered source and target language, how many (text, language)
pairs exist, how many are translated and how many are still missing, the size
of the on-demand CVE queue, and the last cycle the background worker recorded.
Opens the database READ-ONLY (SQLite URI mode=ro); writes nothing.

Usage (from backend/):
    venv/bin/python -m scripts.translation_status            # backend/grc_dev.db
    GRC_DB_PATH=/path/to/copy.db venv/bin/python -m scripts.translation_status
    ... --json                                                # machine-readable
Same numbers as GET /api/v1/admin/translations/status (super admin).
"""
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


async def _run(as_json: bool) -> int:
    from app.core.database import AsyncSessionLocal
    from app.services.translation_worker import compute_status

    async with AsyncSessionLocal() as db:
        st = await compute_status(db)
    if as_json:
        print(json.dumps(st, indent=1, default=str))
        return 0
    print(f"{'source':20} {'prio':>4} {'lang':>4} {'total':>7} {'done':>7} {'missing':>7}")
    for key, s in st["sources"].items():
        if "error" in s:
            print(f"{key:20} ERROR {s['error']}")
            continue
        langs = s["by_lang"] or {"-": {"total": 0, "translated": 0, "missing": 0}}
        for lang, c in sorted(langs.items()):
            print(f"{key:20} {s['priority']:>4} {lang:>4} {c['total']:>7} {c['translated']:>7} {c['missing']:>7}")
    t = st["totals"]
    print(f"{'TOTAL (bulk sources)':20} {'':>4} {'':>4} {t['total']:>7} {t['translated']:>7} {t['missing']:>7}")
    print(f"on-demand queue (CVE): {st.get('queue_size')}")
    cfg = st["config"]
    print(f"worker config: every {cfg['interval_s']}s idle / {cfg['busy_interval_s']}s with backlog, "
          f"<= {cfg['max_texts_per_cycle']} texts per cycle")
    w = st.get("worker") or {}
    last = w.get("last_cycle")
    if last:
        age = int(time.time() - float(last.get("started_at") or 0))
        print(f"last cycle ({age}s ago, pid {w.get('pid')}): planned={last.get('planned')} "
              f"translated={last.get('translated')} unreachable={last.get('unreachable')} "
              f"duration={last.get('duration_s')}s by_source={last.get('by_source')}")
    else:
        print("last cycle: none recorded on this host yet (status file in the OS temp dir)")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    path = os.path.abspath(os.environ.get("GRC_DB_PATH") or os.path.join(BACKEND_DIR, "grc_dev.db"))
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    # Read-only connection; must be set before app.core.config is imported.
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///file:{path}?mode=ro&uri=true"
    os.environ.setdefault("ENABLE_THREAT_SCHEDULER", "0")
    return asyncio.run(_run(args.json))


if __name__ == "__main__":
    raise SystemExit(main())
