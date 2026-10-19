"""Import the 8 Saudi regulatory frameworks in their official EN + AR wording.

    cd backend && venv/bin/python -m scripts.import_saudi_frameworks [--dry-run]

Source of truth: ``app/frameworks/data/saudi/<key>.json`` — extracted verbatim from the
regulators' own publications (NCA, SAMA, SDAIA/BOE; see each file's ``framework.sources``
and the matching ``<key>.report.md``). Nothing here is paraphrased or machine-translated.

Storage:
* English text is the stored text of ``frameworks`` / ``framework_controls`` (as for every
  other built-in).
* The official Arabic goes into ``content_translations`` (lang "ar", engine
  ``official:<short_name>``), keyed by the hash of the English text it translates — the
  same cache the display layer already overlays on every page for Arabic readers.
  ``content_translation.lookup`` prefers an ``official:`` row over a machine one, the
  translation worker never re-translates a hash that already has a row, and the API marks
  such text ``translation_official`` so the UI labels it "Official text", not
  "Auto-translated".
* Cross-framework links go into ``mapped_controls`` ONLY where the regulator itself states
  them (an NCA subsidiary control "with reference to ECC 1-8-1", an official mapping
  annex). Each link carries ``basis`` and ``official: true``. The reverse link is written
  on the target so the crosswalk can be walked from either side. References to ECC-1:2018
  are translated to ECC-2:2024 through ECC-2's own Appendix C table where it gives one.

Idempotent: frameworks are upserted by short_name, controls by (framework, control_id);
controls no longer in the JSON are deleted only if nothing references them. Takes an
online backup of the DB first (backups/). The superseded paraphrased records (ECC-1,
ECC-2 and SAMA CSF of the early seed) are kept — a tenant has a live assessment on one —
but marked deprecated and renamed "(superseded)".
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
DATA = os.path.join(HERE, "app", "frameworks", "data", "saudi")
DB = os.environ.get("GRC_DB_PATH") or os.path.join(HERE, "grc_dev.db")

ORDER = ["ecc2", "ccc2", "dcc", "cscc", "otcc", "tcc", "sama", "pdpl"]
ECC1, ECC2 = "nca-ecc-1-2018", "nca-ecc-2-2024"

REGIONS = ["Saudi Arabia", "GCC"]
INDUSTRIES = {
    "nca-ecc-2-2024": ["Government", "Critical National Infrastructure"],
    "nca-ccc-2-2024": ["Cloud Service Providers", "Government", "Critical National Infrastructure"],
    "nca-dcc-1-2022": ["Government", "Critical National Infrastructure"],
    "nca-cscc-1-2019": ["Government", "Critical National Infrastructure"],
    "nca-otcc-1-2022": ["Energy", "Utilities", "Manufacturing", "Critical National Infrastructure"],
    "nca-tcc-1-2021": ["Government", "Critical National Infrastructure"],
    "sama-csf-1-0": ["Finance", "Banking", "Insurance"],
    "sdaia-pdpl": ["all"],
}
# The paraphrased early-seed records these replace (by id: their short_names differ).
SUPERSEDED = {
    "fedcd8f4-a79d-408c-9acf-deff19830ce6": "nca-ecc-2-2024",   # ksa-ecc   (ECC-1:2018)
    "c1aa436b-62a4-4741-96aa-3d394e56e01c": "nca-ecc-2-2024",   # nca-ecc-2024
    "a029f525-06ba-4b84-bcf1-3871a554053d": "sama-csf-1-0",     # sama-csf
}
SUPERSEDED_SUFFIX = " (superseded)"

TITLE_MAX = 500


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")


def h(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def clip(text: str, n: int = TITLE_MAX) -> str:
    text = " ".join(text.split()) if len(text) > n else text
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def backup(path: str) -> str:
    outdir = os.path.join(HERE, "backups")
    os.makedirs(outdir, exist_ok=True)
    dst = os.path.join(outdir, f"grc_dev-pre-saudi-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.db")
    src, bck = sqlite3.connect(path), sqlite3.connect(dst)
    try:
        with bck:
            src.backup(bck)
    finally:
        bck.close()
        src.close()
    return dst


def load() -> list[dict]:
    docs = []
    for key in ORDER:
        p = os.path.join(DATA, f"{key}.json")
        if not os.path.exists(p):
            print(f"  ! missing {p} — skipped")
            continue
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        d["_key"] = key
        docs.append(d)
    return docs


def ecc_map(docs: list[dict]) -> dict[str, tuple[str | None, str]]:
    """ECC-1:2018 id -> (ECC-2:2024 id or None if deleted, how we know).

    From ECC-2's Appendix C (the regulator's change table) plus, for every id the
    appendix does not touch, the same number where it still exists in ECC-2 with the
    same requirement (``ecc1_to_ecc2_idmap``; NCA does not state this retention in so
    many words — the basis says so on every link)."""
    for d in docs:
        if d["framework"]["short_name"] != ECC2:
            continue
        out: dict[str, tuple[str | None, str]] = {}
        for r in d.get("ecc1_to_ecc2_idmap") or []:
            if r.get("ecc1"):
                b = str(r.get("basis") or "")
                same = str(r.get("ecc2") or "") == str(r["ecc1"])
                how = ("per ECC-2:2024 Appendix C" if b.startswith("Appendix C") else
                       "number retained in ECC-2:2024" if same else
                       "renumbering inferred from the text, not stated by NCA")
                out[str(r["ecc1"])] = (str(r["ecc2"]) if r.get("ecc2") else None, how)
        for r in d.get("ecc1_to_ecc2") or []:   # the appendix rows themselves win
            if r.get("ecc1"):
                out[str(r["ecc1"])] = (str(r["ecc2"]) if r.get("ecc2") else None, "per ECC-2:2024 Appendix C")
        return out
    return {}


def build_links(docs: list[dict], e1to2: dict[str, tuple[str | None, str]]) -> dict[tuple[str, str], list[dict]]:
    """{(short_name, control_id): [mapped_controls entries]} — forward + reverse, official only."""
    ids = {(d["framework"]["short_name"], str(c["control_id"])) for d in docs for c in d["controls"]}
    links: dict[tuple[str, str], list[dict]] = {}

    def add(src, tgt, basis):
        lst = links.setdefault(src, [])
        entry = {"framework": tgt[0], "control": tgt[1], "basis": basis, "official": True}
        if not any(e["framework"] == tgt[0] and e["control"] == tgt[1] for e in lst):
            lst.append(entry)

    unresolved = 0
    for d in docs:
        sn = d["framework"]["short_name"]
        for c in d["controls"]:
            for r in c.get("refs") or []:
                fw, ctl = str(r.get("framework") or ""), str(r.get("control") or "")
                basis = str(r.get("basis") or "control text")
                if not fw or not ctl:
                    continue
                if fw == ECC1:
                    mapped, how = e1to2.get(ctl, (None, ""))
                    if mapped and (ECC2, mapped) in ids:
                        basis = (f"{basis}; the regulator cites ECC-1:2018 {ctl}, "
                                 + (f"{how}" if mapped == ctl else f"now ECC-2:2024 {mapped} ({how})"))
                        fw, ctl = ECC2, mapped
                    else:
                        unresolved += 1
                src = (sn, str(c["control_id"]))
                add(src, (fw, ctl), basis)
                if (fw, ctl) in ids:
                    add((fw, ctl), src, f"reverse: {sn} {c['control_id']} — {basis}")
    if unresolved:
        print(f"  · {unresolved} ECC-1:2018 references kept as nca-ecc-1-2018 (control deleted in ECC-2:2024)")
    return links


def upsert_translation(cur, entity_type, entity_id, field, en, ar, engine) -> None:
    if not en or not ar or en == ar:
        return
    cur.execute(
        "SELECT id FROM content_translations WHERE entity_type=? AND entity_id=? AND lang='ar' AND field=?",
        (entity_type, entity_id, field))
    row = cur.fetchone()
    if row:
        cur.execute("UPDATE content_translations SET source_hash=?, text=?, engine=?, updated_at=? WHERE id=?",
                    (h(en), ar, engine, now(), row[0]))
    else:
        cur.execute(
            "INSERT INTO content_translations (id, entity_type, entity_id, lang, field, source_hash, text, engine,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), entity_type, entity_id, "ar", field, h(en), ar, engine, now(), now()))


def import_doc(cur, d: dict, links) -> dict:
    fw = d["framework"]
    sn = fw["short_name"]
    engine = f"official:{sn}"
    cur.execute("SELECT id FROM frameworks WHERE short_name=? AND is_builtin=1 AND tenant_id IS NULL", (sn,))
    row = cur.fetchone()
    fid = row[0] if row else str(uuid.uuid4())
    vals = (fw["name"], sn, fw["version"], fw.get("description"), fw.get("issuing_body"),
            json.dumps(REGIONS), json.dumps(INDUSTRIES.get(sn, [])), "active",
            fw.get("source_type") or "reglementation")
    if row:
        cur.execute("UPDATE frameworks SET name=?, short_name=?, version=?, description=?, issuing_body=?,"
                    " applicable_regions=?, applicable_industries=?, status=?, source_type=?, updated_at=?"
                    " WHERE id=?", (*vals, now(), fid))
    else:
        cur.execute("INSERT INTO frameworks (name, short_name, version, description, issuing_body,"
                    " applicable_regions, applicable_industries, status, source_type, is_builtin, tenant_id,"
                    " id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,NULL,?,?,?)",
                    (*vals, fid, now(), now()))
    upsert_translation(cur, "framework", fid, "name", fw["name"], fw.get("name_ar"), engine)
    upsert_translation(cur, "framework", fid, "description", fw.get("description"), fw.get("description_ar"), engine)

    cur.execute("SELECT control_id, id FROM framework_controls WHERE framework_id=?", (fid,))
    existing = dict(cur.fetchall())
    by_cid: dict[str, str] = {}
    stats = {"inserted": 0, "updated": 0, "deleted": 0, "ar_fields": 0}
    controls = d["controls"]
    for i, c in enumerate(controls):
        cid = str(c["control_id"])
        by_cid[cid] = existing.get(cid) or str(uuid.uuid4())

    for i, c in enumerate(controls):
        cid = str(c["control_id"])
        pk = by_cid[cid]
        level = c.get("level") or "control"
        en_title = c.get("title") or c.get("title_ar") or cid
        en_desc = c.get("description")
        title = clip(en_title)
        # A clipped title keeps the full clause in description (spec: description = full text).
        if title != en_title and not en_desc:
            en_desc = en_title
        tags = [f"level:{level}", "official-text"]
        if c.get("applicability"):
            tags.append(f"applicability:{c['applicability']}")
        parent = by_cid.get(str(c["parent_id"])) if c.get("parent_id") else None
        rtype = "exigence" if level in ("control", "subcontrol", "article") else None
        row = (title, en_desc, c.get("guidance"), clip(c.get("domain") or "", 50) or None, parent,
               int(c.get("sort_order") or i + 1), json.dumps(links.get((sn, cid), []), ensure_ascii=False),
               json.dumps(tags), rtype)
        if cid in existing:
            cur.execute("UPDATE framework_controls SET title=?, description=?, guidance=?, category=?, parent_id=?,"
                        " sort_order=?, mapped_controls=?, tags=?, requirement_type=?, updated_at=? WHERE id=?",
                        (*row, now(), pk))
            stats["updated"] += 1
        else:
            cur.execute("INSERT INTO framework_controls (title, description, guidance, category, parent_id,"
                        " sort_order, mapped_controls, tags, requirement_type, framework_id, control_id, id,"
                        " is_mandatory, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)",
                        (*row, fid, cid, pk, now(), now()))
            stats["inserted"] += 1
        for field, en, ar in (("title", title, c.get("title_ar")),
                              ("description", en_desc, c.get("description_ar")),
                              ("guidance", c.get("guidance"), c.get("guidance_ar"))):
            if field == "title" and ar and title != en_title:
                ar = clip(ar)   # the Arabic title follows the same clipping as the English one
            if en and ar:
                upsert_translation(cur, "framework_control", pk, field, en, ar, engine)
                stats["ar_fields"] += 1

    stale = [pk for cid, pk in existing.items() if cid not in by_cid]
    for pk in stale:
        cur.execute("SELECT COUNT(*) FROM control_assessments WHERE control_id=?", (pk,))
        if cur.fetchone()[0]:
            print(f"  ! {sn}: stale control {pk} is assessed — kept")
            continue
        cur.execute("UPDATE framework_controls SET parent_id=NULL WHERE parent_id=?", (pk,))
        cur.execute("DELETE FROM content_translations WHERE entity_type='framework_control' AND entity_id=?", (pk,))
        cur.execute("DELETE FROM framework_controls WHERE id=?", (pk,))
        stats["deleted"] += 1
    stats["id"] = fid
    return stats


def retire(cur, replacement_ids: dict[str, str]) -> None:
    for old_id, new_sn in SUPERSEDED.items():
        cur.execute("SELECT name, status FROM frameworks WHERE id=?", (old_id,))
        row = cur.fetchone()
        if not row or new_sn not in replacement_ids:
            continue
        name = row[0] if row[0].endswith(SUPERSEDED_SUFFIX) else row[0] + SUPERSEDED_SUFFIX
        cur.execute("UPDATE frameworks SET status='deprecated', name=?, updated_at=? WHERE id=?",
                    (name, now(), old_id))
        print(f"  · retired {old_id[:8]} → {name}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="run everything in a transaction, then roll back")
    args = ap.parse_args()

    docs = load()
    if not docs:
        print("nothing to import")
        return 1
    if not args.dry_run:
        print(f"backup: {backup(DB)}")
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys=ON")
    cur = con.cursor()
    try:
        links = build_links(docs, ecc_map(docs))
        ids = {}
        for d in docs:
            st = import_doc(cur, d, links)
            ids[d["framework"]["short_name"]] = st.pop("id")
            print(f"  {d['framework']['short_name']:<18} {st}")
        retire(cur, ids)
        if args.dry_run:
            con.rollback()
            print("dry run — rolled back")
        else:
            con.commit()
            print("committed")
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
