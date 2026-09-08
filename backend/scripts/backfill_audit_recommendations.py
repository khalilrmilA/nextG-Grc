"""Lift legacy finding recommendations into tracked rows — STB objectif 7.

« Suivi des recommandations issues des audits jusqu'à leur clôture » treats a
recommendation as the tracked object: it has an owner, a due date, a status and a
closure. Until now it was a single free-text column on AuditFinding
(``audit_findings.recommendation``), so one constat could not carry several
recommendations, none of them had its own owner or échéance, and none could be
closed independently of the finding.

``audit_recommendations`` (models/audit_recommendation.py) is that missing child
table. This script populates it from what already exists, so the recommendation
dashboard is not empty on the day it ships.

**The legacy column is not touched.** It stays on the finding and is treated as
the summary, exactly as the model docstring says — nothing that reads it today
changes behaviour, and a re-run is a no-op because a finding that already has
rows is skipped.

Splitting policy (deliberately conservative)
--------------------------------------------
One constat routinely yields several distinct actions, and that is the whole
reason for the child table. But the legacy text is prose, and splitting prose
badly produces recommendations that read as nonsense to a bank reviewer — worse
than one honest blob. So the text is split **only** on explicit enumeration:
line breaks, ``- ``/``• ``/``* `` bullets, or ``1.``/``1)`` numbering.

Prose containing a semicolon very often *is* two actions ("Étendre la revue aux
comptes à privilèges ; tracer la validation par le RSSI"), but a semicolon is
also ordinary French punctuation. Those cases are **reported, not split** — pass
``--split-on-semicolon`` to opt in after reading the report.

Usage:
    cd backend && venv/bin/python -m scripts.backfill_audit_recommendations
    cd backend && venv/bin/python -m scripts.backfill_audit_recommendations --apply
    cd backend && venv/bin/python -m scripts.backfill_audit_recommendations --split-on-semicolon --apply

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
"""
import argparse
import os
import re
import sqlite3
import sys
import uuid

# Explicit enumeration only. `^` is per-line because a bullet mid-sentence is a
# dash, not a list item.
_ENUMERATION = re.compile(r"(?m)^\s*(?:[-–—•*]|\(?\d{1,2}[.)])\s+")

# FindingStatus (models/audit.py) -> RECOMMENDATION_STATUSES (models/audit_recommendation.py).
# `accepted` means the management accepted the risk instead of acting, so the
# recommendation was in fact not retained — 'rejected' is the honest terminal
# state, and a closure_note is written so nobody reads it as "we refused to look".
STATUS_MAP = {
    "open": "pending",
    "in_remediation": "in_progress",
    "remediated": "closed",
    "closed": "closed",
    "accepted": "rejected",
}
ACCEPTED_NOTE = (
    "Repris automatiquement : le constat d'origine était au statut « accepté » — "
    "le risque a été accepté par le management, la recommandation n'a pas été retenue."
)
# A recommandation created here as already closed inherits that closure from the
# finding, and the finding may carry no closure date and no closure author at all
# (closed_at/closed_by_id are new columns and are NULL on every legacy row). A
# closed line with nobody behind it is exactly the traceability hole objectif 7
# exists to remove, so the provenance is written into closure_note instead of
# being left to be discovered.
# The stored FindingStatus is an English token; the note is read by a French
# assessor, so it is labelled rather than pasted in raw.
STATUS_LABEL_FR = {
    "open": "ouvert",
    "in_remediation": "en cours de remédiation",
    "remediated": "remédié",
    "closed": "clôturé",
    "accepted": "accepté",
}
CLOSED_NOTE = (
    "Repris automatiquement : clôture héritée du constat d'origine (statut « {st} »)."
)
CLOSED_NOTE_NO_ACTOR = (
    " Ni date ni auteur de clôture n'étaient enregistrés sur le constat — à confirmer "
    "par le responsable du suivi."
)

# REC-007 -> 7. Only this exact shape is ours; any other ref_code was authored by
# a user and is simply treated as taken.
_REF_CODE = re.compile(r"REC-(\d+)")


def _closure_note(status: str, finding_status: str, closed_at, closed_by_id) -> str | None:
    """Why this backfilled row is already in a terminal state."""
    if status == "rejected":
        return ACCEPTED_NOTE
    if status == "closed":
        note = CLOSED_NOTE.format(
            st=STATUS_LABEL_FR.get(finding_status, finding_status or "clôturé"))
        if not closed_at and not closed_by_id:
            note += CLOSED_NOTE_NO_ACTOR
        return note
    return None

# Progress is defined by the model as derived from the linked action items. A
# backfilled row has none, so anything other than 0/100 would be invented.
PROGRESS_BY_STATUS = {"closed": 100}


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def split_recommendation(text: str, split_semicolons: bool) -> list[str]:
    """Break a legacy recommendation blob into individual recommendations."""
    raw = (text or "").strip()
    if not raw:
        return []

    # 1. explicit line breaks
    parts = [p.strip() for p in re.split(r"[\r\n]+", raw) if p.strip()]

    # 2. explicit bullets / numbering inside a single line
    expanded: list[str] = []
    for part in parts:
        if _ENUMERATION.search(part):
            expanded.extend(p.strip() for p in _ENUMERATION.split(part) if p.strip())
        else:
            expanded.append(part)
    parts = expanded

    # 3. semicolons, only when the operator asked for it
    if split_semicolons:
        parts = [p.strip(" ;") for chunk in parts for p in chunk.split(";") if p.strip(" ;")]

    return [p for p in (x.strip() for x in parts) if p]


def looks_multi(text: str) -> bool:
    """Would --split-on-semicolon change this row? Used for the report only."""
    return ";" in (text or "")


def _title_of(item: str) -> str:
    """A short label for the list view; the full text stays in `description`."""
    first = re.split(r"(?<=[.!?])\s", item.strip(), maxsplit=1)[0].strip()
    candidate = first if 10 <= len(first) <= 160 else item.strip()
    return candidate if len(candidate) <= 200 else candidate[:197].rstrip() + "…"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--split-on-semicolon", action="store_true",
                    help="also split prose on ';' — read the dry-run report first")
    ap.add_argument("--apply", action="store_true", help="write; otherwise dry run")
    args = ap.parse_args(argv)

    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    known = {r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "audit_recommendations" not in known:
        print("ERROR: table `audit_recommendations` does not exist yet.")
        print("       It is created by create_all() — restart the backend once, then re-run.")
        conn.close()
        return 2

    fcols = {r[1] for r in cur.execute("PRAGMA table_info(audit_findings)").fetchall()}
    # closed_at/closed_by_id come from migrate_add_stb_audit_columns.py; without
    # them a closed recommendation simply carries no closure timestamp.
    has_closure = {"closed_at", "closed_by_id"} <= fcols

    select_closure = ", f.closed_at, f.closed_by_id" if has_closure else ", NULL, NULL"
    findings = cur.execute(
        "SELECT f.id, f.audit_id, a.tenant_id, f.title, f.severity, f.status, "
        f"f.recommendation, f.remediation_owner_id, f.due_date{select_closure} "
        "FROM audit_findings f JOIN audits a ON a.id = f.audit_id "
        "ORDER BY a.id, f.created_at"
    ).fetchall()

    already = {r[0] for r in cur.execute(
        "SELECT DISTINCT finding_id FROM audit_recommendations WHERE finding_id IS NOT NULL"
    ).fetchall()}

    # Continue each audit's numbering rather than restarting it. Counting the
    # existing rows is NOT enough: a recommendation deleted through the API, or
    # one created there with its own ref_code, makes COUNT(*) land on a code that
    # is already in use, and two lines of a bank's audit file would then share the
    # reference an action plan is tracked by. Read the codes actually taken, carry
    # on from the highest REC-nnn, and skip anything already used.
    used_codes: dict[str, set[str]] = {}
    next_seq: dict[str, int] = {}
    for audit_id, code in cur.execute(
        "SELECT audit_id, ref_code FROM audit_recommendations"
    ).fetchall():
        codes = used_codes.setdefault(audit_id, set())
        next_seq.setdefault(audit_id, 1)
        if not code:
            continue
        code = str(code).strip()
        codes.add(code)
        hit = _REF_CODE.fullmatch(code)
        if hit:
            next_seq[audit_id] = max(next_seq[audit_id], int(hit.group(1)) + 1)

    planned: list[tuple] = []
    skipped_empty = 0
    skipped_done = 0
    unmapped_status: dict[str, int] = {}
    multi_hint: list[str] = []

    for (fid, audit_id, tenant_id, ftitle, severity, fstatus, rec,
         owner_id, due_date, closed_at, closed_by_id) in findings:
        if fid in already:
            skipped_done += 1
            continue
        items = split_recommendation(rec, args.split_on_semicolon)
        if not items:
            skipped_empty += 1
            continue
        if len(items) == 1 and not args.split_on_semicolon and looks_multi(items[0]):
            multi_hint.append(f"{(ftitle or '')[:60]}  ::  {items[0][:110]}")

        key = str(fstatus or "").lower()
        status = STATUS_MAP.get(key)
        if status is None:
            # Never guess a status: an unknown one becomes 'pending' (the safe,
            # visible bucket) and is reported so the mapping can be extended.
            unmapped_status[key] = unmapped_status.get(key, 0) + 1
            status = "pending"

        for item in items:
            codes = used_codes.setdefault(audit_id, set())
            seq = next_seq.get(audit_id, 1)
            while f"REC-{seq:03d}" in codes:
                seq += 1
            ref_code = f"REC-{seq:03d}"
            codes.add(ref_code)
            next_seq[audit_id] = seq + 1
            planned.append((
                str(uuid.uuid4()), tenant_id, audit_id, fid,
                ref_code, _title_of(item), item,
                (severity or None), status, owner_id, due_date,
                PROGRESS_BY_STATUS.get(status, 0),
                closed_at if status == "closed" else None,
                closed_by_id if status == "closed" else None,
                _closure_note(status, key, closed_at, closed_by_id),
            ))

    print(f"{len(findings)} finding(s) across the whole platform")
    print(f"   {skipped_done:4} already backfilled (skipped)")
    print(f"   {skipped_empty:4} with no recommendation text (skipped)")
    print(f"   {len(planned):4} recommendation row(s) to create\n")

    for row in planned:
        print(f"   {row[4]}  [{row[8]:<11}] {row[5][:88]}")

    if multi_hint:
        print(f"\n{len(multi_hint)} recommendation(s) contain a ';' and were NOT split.")
        print("Review them; if they really are several actions, re-run with --split-on-semicolon:")
        for h in multi_hint:
            print(f"   {h}")

    if unmapped_status:
        print("\nUNMAPPED finding statuses (defaulted to 'pending' — extend STATUS_MAP):")
        for k, n in sorted(unmapped_status.items()):
            print(f"   {k!r}: {n}")

    if not planned:
        print("\nNothing to do.")
        conn.close()
        return 0
    if not args.apply:
        print("\nDry run — re-run with --apply to write.")
        conn.close()
        return 0

    cur.executemany(
        "INSERT INTO audit_recommendations "
        "(id, tenant_id, audit_id, finding_id, ref_code, title, description, priority, "
        " status, owner_id, due_date, progress, closed_at, closed_by_id, closure_note) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        planned,
    )
    conn.commit()
    conn.close()
    print(f"\nCreated {len(planned)} recommendation(s).")
    print("audit_findings.recommendation is unchanged and remains the summary.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
