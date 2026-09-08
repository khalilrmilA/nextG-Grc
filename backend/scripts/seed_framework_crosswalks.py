"""Crosswalks entre référentiels bancaires — STB objectif 1, « référentiel centralisé ».

« Une même exigence issue de plusieurs sources doit être rapprochable. » Measured
on the live database before this script: 199 crosswalk pairs on 93 controls out
of 4 537 — 2 % of the corpus — and every one of them authored in a single
direction, from ISO/IEC 27001 outwards. Opening a SOC 2 or a PCI DSS requirement
showed no equivalent at all, so the consolidation the tender asks for existed for
one framework and one direction.

This script does two separate things, both idempotent and both merge-only:

1. **ISO-hub crosswalks for the frameworks a Tunisian bank is actually assessed
   on** — PCI DSS 4.0, SWIFT CSP and DORA, each mapped onto ISO/IEC 27001:2022
   (clauses and Annexe A). ISO is used as the hub on purpose: n frameworks need
   n mappings to a hub instead of n² to each other, and every pair is then
   reachable through it. Mappings are written in BOTH directions, so the
   correspondence is visible from whichever requirement the assessor opened.

2. **``--mirror``** (on by default) makes the crosswalks that ALREADY exist
   symmetric. That part authors nothing: for every pair A→B already stored, it
   ensures B→A. It is what makes the existing ISO→SOC 2 / NIST CSF work show up
   on the SOC 2 and NIST CSF screens.

Honesty about the mappings
--------------------------
A crosswalk is an **indicative correspondence, not an equivalence opinion**: a
control marked conforme on one side is not automatically conforme on the other,
and this is never a substitute for a mapping validated by the assessor. Each
entry below maps a requirement to the one to three ISO controls that carry the
same obligation; where the correspondence is not clear the requirement is left
unmapped rather than mapped approximately — a wrong crosswalk in a bank's
referential is worse than a missing one.

Two DORA articles are deliberately absent: art. 32 and 33 organise the European
supervisory oversight of critical ICT providers. They bind the ESAs, not the
assessed entity, so they have no ISMS counterpart. (Same rule as the Tunisian
corpus seed, which omits the articles creating the ANSI.)

The source ids used are those of THIS corpus, which paraphrases some of the
frameworks it ships — SWIFT control titles here do not follow the official CSCF
numbering, for instance. Mappings therefore follow the title an assessor reads on
screen, which is what this corpus actually contains.

Usage:
    cd backend && venv/bin/python -m scripts.seed_framework_crosswalks
    cd backend && venv/bin/python -m scripts.seed_framework_crosswalks --apply
    cd backend && venv/bin/python -m scripts.seed_framework_crosswalks --no-mirror --apply

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
Safe to re-run: an existing pair is never duplicated and nothing is ever removed,
so a crosswalk authored through the API survives untouched. The flip side, stated
plainly: a correspondence listed here that an assessor deletes through the API
comes back the next time this runs — it is a seed, not a synchronisation. Remove
the entry from the table above as well when a mapping is rejected.
"""
import argparse
import json
import os
import sqlite3
import sys

# The hub. Everything below is mapped onto this framework's control ids.
HUB = "ISO27001"

# {source framework short_name: {source control_id: [hub control_id, ...]}}
#
# PCI DSS 4.0 — the corpus ships the 12 requirement families at the sub-
# requirement level (1.1 … 12.10).
PCI_DSS = {
    "1.1":  ["a.5.1", "a.8.20"],
    "1.2":  ["a.8.20", "a.8.9"],
    "1.3":  ["a.8.20", "a.8.22"],
    "1.4":  ["a.8.20", "a.8.21", "a.8.22"],
    "1.5":  ["a.8.1", "a.6.7"],
    "2.1":  ["a.5.37", "a.8.9"],
    "2.2":  ["a.8.9"],
    "2.3":  ["a.8.20", "a.8.21"],
    "3.1":  ["a.5.1", "a.5.12"],
    "3.2":  ["a.5.12", "a.8.10"],
    "3.3":  ["a.8.10", "a.8.11"],
    "3.4":  ["a.8.11", "a.8.3"],
    "3.5":  ["a.8.24", "a.8.11"],
    "3.6":  ["a.8.24"],
    "3.7":  ["a.8.24"],
    "4.1":  ["a.5.1", "a.8.24"],
    "4.2":  ["a.8.24", "a.5.14"],
    "5.1":  ["a.5.1", "a.8.7"],
    "5.2":  ["a.8.7"],
    "5.3":  ["a.8.7", "a.8.16"],
    "5.4":  ["a.8.7", "a.6.3"],
    "6.1":  ["a.5.1", "a.8.8"],
    "6.2":  ["a.8.25", "a.8.28"],
    "6.3":  ["a.8.8"],
    "6.4":  ["a.8.26", "a.8.8"],
    "6.5":  ["a.8.32", "a.8.31"],
    "7.1":  ["a.5.15"],
    "7.2":  ["a.5.15", "a.8.3"],
    "7.3":  ["a.5.18", "a.8.3"],
    "8.1":  ["a.5.16"],
    "8.2":  ["a.5.16", "a.5.18"],
    "8.3":  ["a.5.17", "a.8.5"],
    "8.4":  ["a.8.5"],
    "8.5":  ["a.8.5"],
    "8.6":  ["a.5.17", "a.8.2"],
    "9.1":  ["a.5.1", "a.7.1"],
    "9.2":  ["a.7.1", "a.7.2"],
    "9.3":  ["a.7.2", "a.7.6"],
    "9.4":  ["a.7.10", "a.7.14"],
    "9.5":  ["a.7.8", "a.7.4"],
    "10.1": ["a.5.1", "a.8.15"],
    "10.2": ["a.8.15"],
    "10.3": ["a.8.15", "a.5.33"],
    "10.4": ["a.8.16"],
    "10.5": ["a.8.15", "a.5.33"],
    "10.6": ["a.8.17"],
    "10.7": ["a.8.16", "a.5.25"],
    "11.1": ["a.5.1", "a.8.8"],
    "11.2": ["a.5.9", "a.8.16"],
    "11.3": ["a.8.8"],
    "11.4": ["a.8.8", "a.8.29"],
    "11.5": ["a.8.16"],
    "11.6": ["a.8.16", "a.8.32"],
    "12.1": ["a.5.1"],
    "12.2": ["a.5.10"],
    "12.3": ["6.1.2", "6.1.3"],
    "12.4": ["a.5.36", "a.5.31"],
    "12.5": ["4.3", "a.5.9"],
    "12.6": ["a.6.3"],
    "12.7": ["a.6.1"],
    "12.8": ["a.5.19", "a.5.20"],
    "12.9": ["a.5.20", "a.5.22"],
    "12.10": ["a.5.24", "a.5.26"],
}

# SWIFT Customer Security Programme — mapped from the titles this corpus ships.
SWIFT_CSP = {
    "1.1":   ["a.8.22"],
    "1.2":   ["a.8.2"],
    "1.3a":  ["a.8.9"],
    "1.3b":  ["a.8.9"],
    "1.4":   ["a.8.20", "a.8.23"],
    "1.5a":  ["a.8.9", "a.8.20"],
    "1.5b":  ["a.8.24", "a.5.14"],
    "1.6":   ["a.8.5", "a.8.24"],
    "2.1":   ["a.5.14", "a.8.24"],
    "2.2":   ["a.8.8"],
    "2.3":   ["a.8.9"],
    "2.4a":  ["a.5.14", "a.8.24"],
    "2.4b":  ["a.5.14", "a.8.21"],
    "2.5a":  ["a.8.24", "a.5.14"],
    "2.6":   ["a.8.5", "a.8.24"],
    "2.7":   ["a.8.8"],
    "2.8a":  ["a.5.19", "a.5.21"],
    "2.9":   ["a.5.3", "a.8.16"],
    "2.11a": ["a.5.15", "a.5.3"],
    "3.1":   ["a.8.15", "a.8.16"],
    "3.2":   ["a.6.3"],
    "3.3":   ["a.8.8", "a.8.29"],
    "4.1":   ["a.5.6", "a.5.27"],
    "4.2":   ["a.5.7"],
    "5.1":   ["a.5.16", "a.5.18"],
    "5.2":   ["a.5.17"],
    "5.3a":  ["a.5.17", "a.8.5"],
    "5.4":   ["a.7.1", "a.7.2"],
    "6.1":   ["a.8.7"],
    "6.2":   ["a.8.19", "a.8.9"],
    "6.3":   ["a.5.33", "a.8.16"],
    "7.1":   ["6.1.2", "6.1.3"],
    "7.2":   ["a.5.35", "9.2"],
    "7.3a":  ["a.5.19", "a.5.21"],
    "7.4a":  ["6.1.2", "a.5.29"],
}

# DORA (Règlement (UE) 2022/2554) — the articles that bind the financial entity.
DORA = {
    "art.5":  ["5.1", "5.3"],
    "art.6":  ["6.1.1", "6.1.2", "6.1.3"],
    "art.7":  ["a.8.6", "a.8.27"],
    "art.8":  ["a.5.9", "6.1.2"],
    "art.9":  ["a.5.15", "a.8.20", "a.8.24"],
    "art.10": ["a.8.16"],
    "art.11": ["a.5.26", "a.5.29", "a.5.30"],
    "art.12": ["a.8.13", "a.5.30"],
    "art.13": ["a.5.27", "10.1"],
    "art.14": ["7.4", "a.5.26"],
    "art.15": ["6.1.1"],
    "art.17": ["a.5.24", "a.5.26"],
    "art.18": ["a.5.25"],
    "art.19": ["a.6.8", "a.5.5"],
    "art.20": ["a.5.5"],
    "art.21": ["a.5.5"],
    "art.24": ["a.8.29", "a.5.30"],
    "art.25": ["a.8.29", "a.8.8"],
    "art.26": ["a.8.29", "a.8.8"],
    "art.27": ["a.5.19"],
    "art.28": ["a.5.19", "a.5.21", "a.5.22"],
    "art.29": ["a.5.21", "6.1.2"],
    "art.30": ["a.5.20"],
    "art.31": ["a.5.21"],
    "art.45": ["a.5.6", "a.5.7"],
}

CATALOGUE = {
    "pci-dss": PCI_DSS,
    "swift-csp": SWIFT_CSP,
    "DORA": DORA,
}


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def _key(framework: str, control: str) -> tuple[str, str]:
    """How the crosswalk resolver compares a pair (endpoints/frameworks.py)."""
    return (str(framework or "").strip().lower(), str(control or "").strip().lower())


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--no-mirror", dest="mirror", action="store_false",
                    help="do not make the crosswalks that already exist symmetric")
    ap.add_argument("--apply", action="store_true", help="write; otherwise dry run")
    ap.set_defaults(mirror=True)
    args = ap.parse_args(argv)

    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    # Only built-in, shared frameworks: a tenant's own fork carries its own
    # crosswalks and must not be rewritten by a platform seed.
    rows = cur.execute(
        "SELECT fc.id, f.short_name, fc.control_id, fc.mapped_controls "
        "FROM framework_controls fc JOIN frameworks f ON f.id = fc.framework_id "
        "WHERE f.is_builtin = 1 AND f.tenant_id IS NULL"
    ).fetchall()

    # (framework, control) -> row id, and the pairs each row already holds.
    row_of: dict[tuple[str, str], str] = {}
    short_of: dict[str, str] = {}          # lower short_name -> stored spelling
    current: dict[str, list[dict]] = {}
    for row_id, short_name, control_id, mapped in rows:
        row_of[_key(short_name, control_id)] = row_id
        short_of.setdefault(str(short_name).lower(), short_name)
        try:
            current[row_id] = [m for m in json.loads(mapped or "[]") if isinstance(m, dict)]
        except (TypeError, ValueError):
            # A malformed blob is left exactly as it is: this script adds
            # correspondences, it does not repair data it did not write.
            current[row_id] = []

    # Desired pairs, both directions. A pair whose either end does not exist in
    # this database is reported, never written — a crosswalk pointing at nothing
    # is what made the existing ones invisible.
    wanted: dict[str, list[tuple[str, str]]] = {}
    unresolved: list[str] = []
    authored = 0

    def want(src_fw: str, src_ctrl: str, dst_fw: str, dst_ctrl: str) -> None:
        src = row_of.get(_key(src_fw, src_ctrl))
        dst = row_of.get(_key(dst_fw, dst_ctrl))
        if src is None or dst is None:
            unresolved.append(
                f"{src_fw}:{src_ctrl} -> {dst_fw}:{dst_ctrl} "
                f"({'source' if src is None else 'target'} not found)")
            return
        wanted.setdefault(src, []).append(
            (short_of.get(dst_fw.lower(), dst_fw), dst_ctrl))
        wanted.setdefault(dst, []).append(
            (short_of.get(src_fw.lower(), src_fw), src_ctrl))

    for framework, mapping in CATALOGUE.items():
        for control_id, targets in mapping.items():
            for target in targets:
                authored += 1
                want(framework, control_id, HUB, target)

    mirrored = 0
    if args.mirror:
        for row_id, short_name, control_id, _mapped in rows:
            for m in current.get(row_id, []):
                other = row_of.get(_key(m.get("framework"), m.get("control")))
                if other is None:
                    continue
                mirrored += 1
                wanted.setdefault(other, []).append((short_name, control_id))

    # Merge: append what is missing, in order, never remove, never reorder.
    changes: list[tuple[str, list[dict], int]] = []
    for row_id, pairs in wanted.items():
        existing = current.get(row_id, [])
        have = {_key(m.get("framework"), m.get("control")) for m in existing}
        merged = list(existing)
        added = 0
        for fw, ctrl in pairs:
            k = _key(fw, ctrl)
            if k in have:
                continue
            have.add(k)
            merged.append({"framework": fw, "control": ctrl})
            added += 1
        if added:
            changes.append((row_id, merged, added))

    label = {rid: (sn, cid) for rid, sn, cid, _m in rows}
    total_pairs = sum(a for _r, _m, a in changes)
    print(f"{authored} authored correspondence(s) across {len(CATALOGUE)} framework(s), "
          f"hub = {HUB}")
    if args.mirror:
        print(f"{mirrored} existing pair(s) considered for mirroring "
              f"(reverse direction of crosswalks already stored)")
    print(f"\n{len(changes)} control row(s) to update, {total_pairs} new pair(s):")
    for row_id, merged, added in sorted(changes, key=lambda c: label[c[0]]):
        sn, cid = label[row_id]
        print(f"   {sn:<12} {cid:<10} +{added:<3} -> {len(merged)} total")

    if unresolved:
        print(f"\nNOT WRITTEN — {len(unresolved)} pair(s) whose endpoints do not exist here:")
        for u in unresolved:
            print(f"   {u}")
        print("   A crosswalk must point at a real control or it resolves to nothing.")

    if not changes:
        print("\nNothing to write — every correspondence is already recorded.")
        conn.close()
        return 0
    if not args.apply:
        print("\nDry run — re-run with --apply to write.")
        conn.close()
        return 0

    for row_id, merged, _added in changes:
        cur.execute(
            "UPDATE framework_controls SET mapped_controls = ? WHERE id = ?",
            (json.dumps(merged, ensure_ascii=False), row_id),
        )
    conn.commit()
    conn.close()
    print(f"\nWrote {total_pairs} correspondence(s) onto {len(changes)} control(s).")
    print("Crosswalks are indicative: a control conforme on one side is not")
    print("automatically conforme on the other. Nothing was removed or reordered.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
