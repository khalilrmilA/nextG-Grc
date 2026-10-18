"""Self-test for the automatic EN/FR/AR translation of system content.

Covers: source-language detection, source-aware translation (a French BQ-*
threat translated into EN + AR and returned untouched to a French reader), the
background worker (picks up a newly inserted row on its next cycle, bounded per
cycle, back-off when the model is unreachable, singleton across workers), the
on-demand CVE queue (bounded, deduplicated), localisation of framework controls
(framework detail + compliance assessment detail), and the edit/clone safety
(clone copies ORIGINAL text; ``?original=1`` returns stored text to edit forms).

The model is always mocked (httpx.MockTransport) — no network. The DB part runs
in-process (httpx ASGITransport) on a temp COPY of the database named in
GRC_TEST_DB_PATH (itself a snapshot copy — never point it at the live file).

Usage (from backend/):
    venv/bin/python scripts/selftest_auto_translation.py
    GRC_TEST_DB_PATH=/path/to/snapshot-copy.db venv/bin/python scripts/selftest_auto_translation.py
"""
import asyncio
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import traceback
import uuid
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_TMP = tempfile.mkdtemp(prefix="autotr-")
_API_DB = None
if os.environ.get("GRC_TEST_DB_PATH"):
    _API_DB = os.path.join(_TMP, "api.db")
    shutil.copyfile(os.environ["GRC_TEST_DB_PATH"], _API_DB)
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_API_DB}"
# Never touch the real lock/status files of a running server.
os.environ["TRANSLATION_WORKER_LOCK"] = os.path.join(_TMP, "worker.lock")
os.environ["TRANSLATION_WORKER_STATUS"] = os.path.join(_TMP, "worker.status.json")
for _k in ("ENABLE_THREAT_SCHEDULER", "ENABLE_TRANSLATION_WORKER"):
    os.environ[_k] = "0"

import httpx  # noqa: E402

from app.services import content_translation as CT  # noqa: E402
from app.services import translation_worker as W  # noqa: E402
from app.services.translation_sources import TranslationSource  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
CASES: list = []


def case(fn):
    def run():
        try:
            r = fn()
            if asyncio.iscoroutine(r):
                asyncio.run(r)
            RESULTS.append((fn.__name__, True, ""))
        except Exception:  # noqa: BLE001
            RESULTS.append((fn.__name__, False, traceback.format_exc()))
    run.__name__ = fn.__name__
    CASES.append(run)
    return run


# ── Mock model ────────────────────────────────────────────────────────────────

_PREFIX = {"French": "[FR] ", "English": "[EN] ", "Modern Standard Arabic": "ترجمة: "}


def _ollama(content: str) -> httpx.Response:
    return httpx.Response(200, json={"message": {"role": "assistant", "content": content},
                                     "done": True, "done_reason": "stop"})


def mock_model(calls: list | None = None):
    """Answers every batch with '<prefix> text', the prefix naming the target."""
    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        system = body["messages"][0]["content"]
        target = next(name for name in _PREFIX if f"into {name}." in system)
        source = system.split("Translate each input item from ", 1)[1].split(" into ", 1)[0]
        if calls is not None:
            calls.append((source, target))
        items = json.loads(body["messages"][-1]["content"].split("\n", 1)[1])
        return _ollama(json.dumps({"translations": [
            {"i": it["i"], "t": _PREFIX[target] + it["text"]} for it in items]}, ensure_ascii=False))
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def dead_model(calls: list):
    def handler(req):
        calls.append(1)
        raise httpx.ConnectError("refused", request=req)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ── Pure cases ────────────────────────────────────────────────────────────────

@case
def test_detect_language():
    d = CT.detect_language
    assert d("Rançongiciel sur le système d'information") == "fr"
    assert d("Exploitation d’une faille sur un service exposé (banque en ligne)") == "fr"
    assert d("Gestion des incidents") == "fr"
    assert d("Adversaries may abuse the Windows command shell for execution.") == "en"
    assert d("Security of System Documentation") == "en"
    assert d("تهديد مكتوب يدويا") == "ar"
    assert d("Phishing") == "en"                        # undecidable -> default
    assert d("Phishing", default="fr") == "fr"
    assert CT.targets_for("fr") == ("en", "ar")
    assert CT.targets_for("en") == ("fr", "ar")


@case
async def test_translate_texts_is_source_aware():
    calls: list = []
    async with mock_model(calls) as c:
        out = await CT.translate_texts(["Déni de service distribué sur les services en ligne"], "en",
                                       source_lang="fr", client=c)
        same = await CT.translate_texts(["texte"], "fr", source_lang="fr", client=c)
    assert out == {0: "[EN] Déni de service distribué sur les services en ligne"}, out
    assert calls == [("French", "English")], calls
    assert same == {}                                   # never "translate" into the source language


@case
def test_next_wait_backoff():
    w1, f1 = W.next_wait({"unreachable": True}, 0)
    w2, f2 = W.next_wait({"unreachable": True}, f1)
    w9, _ = W.next_wait({"unreachable": True}, 30)
    assert (f1, f2) == (1, 2) and w2 == 2 * w1 and w9 == W.MAX_BACKOFF_S, (w1, w2, w9)
    assert W.next_wait({"backlog_remaining": True}, 5) == (W.BUSY_INTERVAL_S, 0)
    assert W.next_wait({}, 5) == (W.INTERVAL_S, 0)


@case
async def test_singleton_second_worker_does_not_run():
    import fcntl
    W.release_singleton()
    fd = os.open(W.LOCK_PATH, os.O_RDWR | os.O_CREAT, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)     # "the other uvicorn worker" owns the loop
    ran: list = []

    async def fake_cycle(**_kw):
        ran.append(1)
        return {"planned": 0, "translated": 0, "stored": 0, "by_source": {}, "unreachable": False,
                "backlog_remaining": False, "error": None, "duration_s": 0}
    orig_cycle, orig_delay, orig_env = W.run_cycle, W.START_DELAY_S, os.environ["ENABLE_TRANSLATION_WORKER"]
    W.run_cycle, W.START_DELAY_S = fake_cycle, 0
    os.environ["ENABLE_TRANSLATION_WORKER"] = "1"
    try:
        assert W.acquire_singleton() is False
        task = asyncio.create_task(W.start_translation_worker())
        await asyncio.sleep(0.3)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert ran == [], "the worker without the lock ran a cycle"
        os.close(fd)                                    # the owner exits: the kernel frees the lock
        task = asyncio.create_task(W.start_translation_worker())
        await asyncio.sleep(0.3)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert ran == [1], ran                          # took over, ran once, now sleeping
        assert W._LOCK_FD is None                       # released on cancellation
    finally:
        W.run_cycle, W.START_DELAY_S = orig_cycle, orig_delay
        os.environ["ENABLE_TRANSLATION_WORKER"] = orig_env
        W.release_singleton()


# ── Database / API cases (temp copy of GRC_TEST_DB_PATH) ──────────────────────

def _src(key, entity_type, fields, rows, priority=0):
    async def fn(_db):
        return rows
    return TranslationSource(key, entity_type, priority, fields, fn)


async def _db_cases():
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal, Base, engine
    import app.models  # noqa: F401
    from app.main import app
    from app.models.content_translation import ContentTranslation, ContentTranslationRequest
    from app.services.translation_sources import SOURCES

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    raw = sqlite3.connect(_API_DB)
    q1 = lambda sql, *a: raw.execute(sql, a).fetchone()  # noqa: E731

    tr = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def login(email, pw):
        r = await tr.post("/api/v1/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, r.text
        return r.json()["access_token"]

    ciso = await login("admin@demo.com", "demo123")
    sadm = await login("superadmin@platform.com", "super123")

    def H(tok, lang=None):
        h = {"Authorization": f"Bearer {tok}"}
        if lang:
            h["Accept-Language"] = lang
        return h

    # 1. French BQ threat -> EN + AR by the worker; FR reader gets it untouched.
    bq_id, bq_name, bq_desc = q1("SELECT id, name, description FROM threats WHERE ref_id='BQ-TEC-01'")
    mitre_id, mitre_name, mitre_desc = q1(
        "SELECT id, name, description FROM threats WHERE is_builtin=1 AND ref_id LIKE 'T1%' ORDER BY ref_id LIMIT 1")
    # The snapshot may come from a live DB where the worker already translated these
    # two; clear them (on the temp copy) so the cycle below has exactly 8 texts to do.
    # Lookup is by text hash, so clear by hash (other rows may share the same text).
    from app.services.content_translation import source_hash as _sh
    for _txt in (bq_name, bq_desc, mitre_name, mitre_desc):
        if _txt:
            raw.execute("DELETE FROM content_translations WHERE source_hash = ?", (_sh(_txt),))
    raw.commit()
    threat_src = _src("t", "threat", ("name", "description"),
                      [(bq_id, {"name": bq_name, "description": bq_desc}),
                       (mitre_id, {"name": mitre_name, "description": mitre_desc})])
    calls: list = []
    async with mock_model(calls) as c:
        s = await W.run_cycle(max_texts=100, client=c, sources=[threat_src])
    assert s["planned"] == 8 and s["translated"] == 8 and not s["unreachable"], s
    assert ("French", "English") in calls and ("French", "Modern Standard Arabic") in calls
    assert ("French", "French") not in calls and ("English", "English") not in calls

    async def threat(lang, tid):
        r = await tr.get("/api/v1/threats", headers=H(ciso, lang))
        assert r.status_code == 200, r.text
        return next(t for t in r.json() if t["id"] == tid)
    en, ar, fr = await threat("en", bq_id), await threat("ar", bq_id), await threat("fr", bq_id)
    assert en["translated"] and en["name"] == "[EN] " + bq_name and en["original_name"] == bq_name, en
    assert ar["translated"] and ar["name"].startswith("ترجمة: "), ar
    assert fr["translated"] is False and fr["name"] == bq_name and fr["original_name"] is None, fr
    m_fr, m_en = await threat("fr", mitre_id), await threat("en", mitre_id)
    assert m_fr["translated"] and m_fr["name"] == "[FR] " + mitre_name
    assert m_en["translated"] is False and m_en["name"] == mitre_name
    r = await tr.get("/api/v1/threats?original=1", headers=H(ciso, "ar"))
    assert next(t for t in r.json() if t["id"] == bq_id)["name"] == bq_name   # stored text on request

    # 2. The worker picks up a NEW row on its next cycle (regulatory feed item).
    tenant = q1("SELECT tenant_id FROM users WHERE email='admin@demo.com'")[0]
    reg_src = next(s for s in SOURCES if s.key == "regulatory_update")
    async with mock_model() as c:
        await W.run_cycle(max_texts=1000, client=c, sources=[reg_src])      # drain the existing backlog
        new_id = str(uuid.uuid4())
        raw.execute(
            "INSERT INTO regulatory_updates (id, tenant_id, title, description, source, impact, status, url, "
            "affected_frameworks, affected_controls, action_items, notes, created_at, updated_at) VALUES "
            "(?,?,?,?,?,'medium','new',?, '[]','[]','[]',?,datetime('now'),datetime('now'))",
            (new_id, tenant, "New supervisory guidance on cloud outsourcing",
             "The authority published guidance that affects outsourcing controls.", "UK NCSC",
             "https://example.org/x", "AI triage rationale: relevant (confidence 0.90)"))
        manual_id = str(uuid.uuid4())
        raw.execute(
            "INSERT INTO regulatory_updates (id, tenant_id, title, description, source, impact, status, url, "
            "affected_frameworks, affected_controls, action_items, created_at, updated_at) VALUES "
            "(?,?,?,?,NULL,'medium','new',NULL,'[]','[]','[]',datetime('now'),datetime('now'))",
            (manual_id, tenant, "New supervisory guidance on cloud outsourcing", "Typed by our compliance team."))
        raw.commit()
        s2 = await W.run_cycle(max_texts=1000, client=c, sources=[reg_src])
    assert s2["by_source"].get("regulatory_update") == 4, s2      # the new row's 2 texts x (fr, ar)
    async with AsyncSessionLocal() as db:
        got = (await db.execute(select(ContentTranslation.entity_id).where(
            ContentTranslation.entity_type == "regulatory_update"))).scalars().all()
    assert new_id in got and manual_id not in got
    r = await tr.get("/api/v1/regulatory", headers=H(ciso, "fr"))
    regs = {u["id"]: u for u in r.json()}
    assert regs[new_id]["translated"] and regs[new_id]["title"].startswith("[FR] ")
    # Same title text, but typed by hand: never shown translated.
    assert regs[manual_id]["translated"] is False and regs[manual_id]["title"] == regs[new_id]["original_title"]

    # 3. Framework + controls: detail view and assessment detail are localised.
    asmt_id, fw_id = q1(
        "SELECT a.id, a.framework_id FROM compliance_assessments a WHERE a.tenant_id=? AND "
        "(SELECT count(*) FROM control_assessments c WHERE c.assessment_id=a.id) > 0 LIMIT 1", tenant)
    ctrl_rows = raw.execute(
        "SELECT id, title, COALESCE(description,''), COALESCE(guidance,'') FROM framework_controls WHERE framework_id=?",
        (fw_id,)).fetchall()
    fw_name, fw_desc = q1("SELECT name, COALESCE(description,'') FROM frameworks WHERE id=?", fw_id)
    fw_src = _src("fw", "framework", ("name", "description"), [(fw_id, {"name": fw_name, "description": fw_desc})])
    ctl_src = _src("ctl", "framework_control", ("title", "description", "guidance"),
                   [(cid, {"title": t, "description": d, "guidance": g}) for cid, t, d, g in ctrl_rows])
    # As above: drop any live translations of these texts from the temp copy first.
    for _cid, _t, _d, _g in ctrl_rows:
        for _txt in (_t, _d, _g):
            if _txt:
                raw.execute("DELETE FROM content_translations WHERE source_hash = ?", (_sh(_txt),))
    for _txt in (fw_name, fw_desc):
        if _txt:
            raw.execute("DELETE FROM content_translations WHERE source_hash = ?", (_sh(_txt),))
    raw.commit()
    async with mock_model() as c:
        await W.run_cycle(max_texts=2000, client=c, sources=[fw_src, ctl_src])
    r = await tr.get(f"/api/v1/frameworks/{fw_id}/controls", headers=H(ciso, "fr"))
    ctrls = r.json()
    assert r.status_code == 200 and ctrls and all(x["translated"] for x in ctrls), r.text[:300]
    assert all(x["title"].startswith("[FR] ") and x["original_title"] == x["title"][5:] for x in ctrls)
    r = await tr.get(f"/api/v1/frameworks/{fw_id}", headers=H(ciso, "ar"))
    assert r.json()["translated"] and r.json()["original_name"] == fw_name
    r = await tr.get(f"/api/v1/compliance/assessments/{asmt_id}", headers=H(ciso, "fr"))
    assert r.status_code == 200, r.text[:300]
    det = r.json()
    assert det["control_assessments"] and all(ca["translated"] and ca["control_title"].startswith("[FR] ")
                                               for ca in det["control_assessments"]), det["control_assessments"][:1]
    assert det["framework_name"] == "[FR] " + fw_name and det["original_framework_name"] == fw_name
    r = await tr.get(f"/api/v1/compliance/assessments/{asmt_id}", headers=H(ciso, "en"))
    assert all(not ca["translated"] for ca in r.json()["control_assessments"])

    # 4. Clone copies the ORIGINAL text even when requested by a French reader, and
    #    the edit screen (?original=1) gets stored text back.
    r = await tr.post(f"/api/v1/frameworks/{fw_id}/clone", headers=H(ciso, "fr"), json={})
    assert r.status_code == 201, r.text[:300]
    clone_id = r.json()["id"]
    assert r.json()["name"].startswith(fw_name.split(" ")[0]) and "[FR]" not in r.json()["name"]
    cloned = dict(raw.execute("SELECT control_id, title FROM framework_controls WHERE framework_id=?",
                              (clone_id,)).fetchall())
    originals = dict(raw.execute("SELECT control_id, title FROM framework_controls WHERE framework_id=?",
                                 (fw_id,)).fetchall())
    assert cloned == originals and not any("[FR]" in t for t in cloned.values())
    r = await tr.get(f"/api/v1/frameworks/{clone_id}/controls", headers=H(ciso, "fr"))
    assert all(x["translated"] for x in r.json())         # unchanged clone text: same translation (hash)
    r = await tr.get(f"/api/v1/frameworks/{clone_id}/controls?original=1", headers=H(ciso, "fr"))
    edit_rows = r.json()
    assert all(not x["translated"] and x["title"] == originals[x["control_id"]] for x in edit_rows)
    r = await tr.get(f"/api/v1/frameworks/{clone_id}?original=1", headers=H(ciso, "fr"))
    assert r.json()["translated"] is False and "[FR]" not in r.json()["name"]
    # Save the edit form as loaded: nothing translated reaches the stored row.
    row = edit_rows[0]
    r = await tr.patch(f"/api/v1/frameworks/{clone_id}/controls/{row['id']}", headers=H(ciso, "fr"),
                       json={"title": row["title"], "description": row.get("description"),
                             "guidance": row.get("guidance")})
    assert r.status_code == 200, r.text[:300]
    assert q1("SELECT title FROM framework_controls WHERE id=?", row["id"])[0] == originals[row["control_id"]]

    # 5. CVE on demand: a French page queues at most 50, deduplicated; the worker
    #    serves the queue and the next view is translated.
    async with AsyncSessionLocal() as db:
        await db.execute(ContentTranslationRequest.__table__.delete())
        await db.commit()
    r = await tr.get("/api/v1/cve?page_size=120", headers=H(sadm, "fr"))
    assert r.status_code == 200, r.text[:300]
    page = r.json()
    qn = q1("SELECT count(*) FROM content_translation_requests WHERE entity_type='cve' AND lang='fr'")[0]
    assert len(page) == 120 and qn == 50, (len(page), qn)
    r = await tr.get("/api/v1/cve?page_size=120", headers=H(sadm, "fr"))
    assert q1("SELECT count(*) FROM content_translation_requests")[0] == 50       # deduplicated
    r = await tr.get("/api/v1/cve?page_size=120", headers=H(sadm, "en"))
    assert q1("SELECT count(*) FROM content_translation_requests")[0] == 50       # English source: nothing
    cve_src = next(s for s in SOURCES if s.key == "cve")
    # The snapshot may already hold Arabic CVE translations made by the live worker,
    # so "a French request produces no Arabic" is checked as "no new Arabic".
    ar_before = q1("SELECT count(*) FROM content_translations WHERE entity_type='cve' AND lang='ar'")[0]
    async with mock_model() as c:
        s5 = await W.run_cycle(max_texts=500, client=c, sources=[cve_src])
    assert s5["by_source"].get("cve", 0) >= 50, s5
    assert q1("SELECT count(*) FROM content_translation_requests")[0] == 0         # served and pruned
    assert q1("SELECT count(*) FROM content_translations WHERE entity_type='cve' AND lang='ar'")[0] == ar_before
    r = await tr.get("/api/v1/cve?page_size=120", headers=H(sadm, "fr"))
    trans = [x for x in r.json() if x["translated"]]
    assert len(trans) >= 50 and all(x["description"].startswith("[FR] ") for x in trans)
    one = trans[0]
    r = await tr.get(f"/api/v1/cve/{one['cve_id']}", headers=H(sadm, "fr"))
    assert r.json()["translated"] and r.json()["original_description"] == one["original_description"]

    # 6. Model unreachable: the cycle reports it, raises nothing, stores nothing,
    #    and does not count the texts as failures (they are retried later).
    W._FAILS.clear()
    before = q1("SELECT count(*) FROM content_translations")[0]
    hits: list = []
    new_threat = _src("t2", "threat", ("name",), [(str(uuid.uuid4()), {"name": "Brand new catalogue threat name"})])
    async with dead_model(hits) as c:
        s6 = await W.run_cycle(max_texts=10, client=c, sources=[new_threat])
    assert s6["unreachable"] and s6["error"] is None and s6["stored"] == 0, s6
    assert q1("SELECT count(*) FROM content_translations")[0] == before
    assert len(hits) <= 2 and not W._FAILS, (len(hits), W._FAILS)

    # 7. Status endpoint: super admin only, counts per source/lang.
    r = await tr.get("/api/v1/admin/translations/status", headers=H(ciso))
    assert r.status_code == 403
    r = await tr.get("/api/v1/admin/translations/status", headers=H(sadm))
    st = r.json()
    assert r.status_code == 200 and "framework_control" in st["sources"] and st["totals"]["total"] > 0, st
    await tr.aclose()
    raw.close()


@case
def test_db_and_api():
    if _API_DB is None:
        print("  (skipped: set GRC_TEST_DB_PATH to a snapshot copy to run the DB/API cases)")
        return
    asyncio.run(_db_cases())


def main() -> int:
    for run in CASES:
        run()
    failed = 0
    for name, ok, tb in RESULTS:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            failed += 1
            print(tb)
    print(f"\n{len(RESULTS) - failed}/{len(RESULTS)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
