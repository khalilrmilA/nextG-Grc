"""Seed the built-in conformity scale — STB objectif 2, « grille d'évaluation personnalisable ».

`compliance_scales` is created by create_all() at the next restart and is then a
table with **zero rows**. That is a known failure mode in this codebase: a feature
whose only data path is "an admin will create one" ships empty, the picker on the
assessment screen has nothing to offer, and the capability is undemonstrable even
though the code behind it is correct. Risk matrices had exactly this problem.

GET /compliance-scales also materialises this row on first use, so the scale is
not *only* reachable through this script. Running it makes the row exist before
anybody opens the screen (and before the first migration of an assessment onto a
scale), under the id and name that endpoint uses — see SCALE_ID below.

This inserts the one scale the tender describes — conforme / partiellement
conforme / non conforme, plus « non applicable » which every bank adds — as a
**built-in** row: ``tenant_id`` NULL, ``is_builtin`` true, ``is_default`` true, so
it is shared across tenants and read-only, exactly like the built-in frameworks
and the built-in risk matrix.

The level definitions are imported from ``app.models.compliance_scale`` rather
than restated here. Restating them would let the seeded row and the code's own
DEFAULT_SCALE_LEVELS drift apart, and the score formula reads `weight` from the
row — a drifted copy would silently mis-score assessments.

Nothing is migrated onto this scale. Assessments keep ``scale_id`` NULL and keep
scoring through the legacy ControlStatus enum, so all 51 live assessments are
untouched; a scale only applies once somebody points an assessment at it.

Usage:
    cd backend && venv/bin/python -m scripts.seed_default_compliance_scale
    cd backend && venv/bin/python -m scripts.seed_default_compliance_scale --apply

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
Safe to re-run: matches on the existing built-in row and never overwrites it,
whether that row was written here or materialised by the endpoint.
"""
import json
import os
import sqlite3
import sys

from app.models.compliance_scale import DEFAULT_SCALE_LEVELS

# The endpoint materialises the same built-in row on first use, under a FIXED id
# and name (endpoints/compliance_scales.py::_ensure_builtin), because the feature
# must not depend on a script having been run. Whichever path runs first wins, so
# they have to agree: seeding a random uuid under a different name would give two
# installations two different identities for the one shared scale, and the id the
# code names would exist on neither. Imported, not restated, so they cannot drift;
# the literals are only a fallback for running this against a snapshot with no app
# importable.
try:
    from app.api.v1.endpoints.compliance_scales import (
        BUILTIN_SCALE_ID as SCALE_ID,
        BUILTIN_SCALE_NAME as SCALE_NAME,
    )
except Exception:  # pragma: no cover - offline/snapshot use
    SCALE_ID = "builtin-compliance-scale-default"
    SCALE_NAME = "Échelle de conformité STB (par défaut)"

SCALE_DESCRIPTION = (
    "Grille standard conforme / partiellement conforme / non conforme, complétée "
    "par « non applicable ». Fournie avec la plateforme, partagée entre organisations "
    "et non modifiable — dupliquez-la pour définir votre propre grille."
)


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def main(apply: bool) -> int:
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    # create_all() builds this table at the next backend restart. Running before
    # that is not an error the operator should have to decode from a traceback.
    known = {r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "compliance_scales" not in known:
        print("ERROR: table `compliance_scales` does not exist yet.")
        print("       It is created by create_all() — restart the backend once, then re-run.")
        conn.close()
        return 2

    cols = {r[1] for r in cur.execute("PRAGMA table_info(compliance_scales)").fetchall()}
    missing = {"tenant_id", "name", "levels", "is_default", "is_builtin", "is_active"} - cols
    if missing:
        print(f"ERROR: compliance_scales is missing expected columns: {sorted(missing)}")
        conn.close()
        return 2

    existing = cur.execute(
        "SELECT id, name, is_default FROM compliance_scales "
        "WHERE tenant_id IS NULL AND is_builtin = 1"
    ).fetchall()

    print(f"Built-in scale to seed: {SCALE_NAME!r} — {len(DEFAULT_SCALE_LEVELS)} levels")
    for lvl in DEFAULT_SCALE_LEVELS:
        weight = "—" if lvl.get("weight") is None else f"{lvl['weight']:.2f}"
        gap = "ouvre un écart" if lvl.get("counts_as_gap") else "n'ouvre pas d'écart"
        print(f"   {lvl['key']:<24} poids={weight:<5} {gap:<20} legacy={lvl.get('legacy_status')}")

    if existing:
        print(f"\n{len(existing)} built-in scale(s) already present — nothing to do:")
        for sid, name, is_default in existing:
            print(f"   {sid}  {name!r}  is_default={bool(is_default)}")
        conn.close()
        return 0

    if not apply:
        print("\nDry run — re-run with --apply to write.")
        conn.close()
        return 0

    cur.execute(
        "INSERT INTO compliance_scales "
        "(id, tenant_id, name, description, levels, is_default, is_builtin, is_active, created_by_id) "
        "VALUES (?, NULL, ?, ?, ?, 1, 1, 1, NULL)",
        (
            SCALE_ID,
            SCALE_NAME,
            SCALE_DESCRIPTION,
            json.dumps(DEFAULT_SCALE_LEVELS, ensure_ascii=False),
        ),
    )
    conn.commit()
    conn.close()
    print("\nSeeded 1 built-in conformity scale (shared, read-only).")
    print("Existing assessments are unaffected: they keep scale_id NULL and the legacy formula.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
