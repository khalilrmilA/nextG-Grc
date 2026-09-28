"""Self-test for threat-feed text hygiene, the Stormcast filter, the FR/AR
translation service and the localised /threats API.

Pure parts need no database and no network (the model is an httpx.MockTransport).
The API part runs in-process (httpx ASGITransport) against a COPY of a database
you name; it is skipped when GRC_TEST_DB_PATH is unset. That file is copied
again to a temp file, so even the named copy is not modified.

Usage (from backend/):
    venv/bin/python scripts/selftest_threat_feed_i18n.py
    GRC_TEST_DB_PATH=/path/to/snapshot-copy.db venv/bin/python scripts/selftest_threat_feed_i18n.py
Prints PASS/FAIL per case and exits non-zero on any failure.
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

_API_DB = None
if os.environ.get("GRC_TEST_DB_PATH"):
    # Must happen before anything imports app.core.config.
    _tmpdir = tempfile.mkdtemp(prefix="threatfx-")
    _API_DB = os.path.join(_tmpdir, "api.db")
    shutil.copyfile(os.environ["GRC_TEST_DB_PATH"], _API_DB)
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_API_DB}"
    os.environ.setdefault("ENABLE_THREAT_SCHEDULER", "0")

import httpx  # noqa: E402

from app.services import content_translation as CT  # noqa: E402
from app.services.threat_feeds import _fetch_sans_isc, clean_feed_text, is_podcast_item  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


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


CASES: list = []


# ── Cleanup ───────────────────────────────────────────────────────────────────

@case
def test_entities_single_and_double_encoded():
    assert clean_feed_text("What Web Shells are Attackers Looking for&#x3f;") == "What Web Shells are Attackers Looking for?"
    assert clean_feed_text("Powershell &#x2b; Graph &#x2b; Entra") == "Powershell + Graph + Entra"
    assert clean_feed_text("Let&amp;#x27;s go &amp;amp; see") == "Let's go & see"      # double-encoded
    assert clean_feed_text("&amp;amp;lt;b&amp;amp;gt;") == ""                            # triple -> a <b> tag, stripped


@case
def test_broken_pipeline_entities_and_mojibake():
    raw = ("report,&&#x23&#x3b;x26&#x3b;&#x23&#x3b;xc2&#x3b;&&#x23&#x3b;x26&#x3b;&#x23&#x3b;xa0&#x3b;"
           "\"When\" ShinyHunters&&#x23&#x3b;x26&#x3b;&#x23&#x3b;39&#x3b; con")
    assert clean_feed_text(raw) == "report, \"When\" ShinyHunters' con", clean_feed_text(raw)
    assert clean_feed_text("called &#xe2;&#x80;&#x9c;cbmj.JS&#xe2;&#x80;&#x9d;") == "called “cbmj.JS”"


@case
def test_tags_whitespace_and_literal_placeholders():
    assert clean_feed_text("<p>Hello <b>world</b></p>\n\n  <br/>again") == "Hello world again"
    assert clean_feed_text("<p>One</p><p>Two</p>", multiline=True) == "One\n\nTwo"
    # Not HTML: an OSM payload note's placeholder must survive.
    assert clean_feed_text("lookup for <identifier>.evil.co") == "lookup for <identifier>.evil.co"
    assert clean_feed_text("café — déjà “vu” عربي") == "café — déjà “vu” عربي"


@case
def test_cleanup_is_idempotent():
    for s in ("a &#x3f; <i>b</i>", "x&&#x23&#x3b;x26&#x3b;&#x23&#x3b;39&#x3b;y", "plain", "", None):
        once = clean_feed_text(s, multiline=True)
        assert clean_feed_text(once, multiline=True) == once


# ── Stormcast filter ──────────────────────────────────────────────────────────

@case
def test_stormcast_is_filtered_real_diaries_are_not():
    assert is_podcast_item("ISC Stormcast For Monday, August 17th, 2026 https://isc.sans.edu/podcastdetail/10054, (Mon, Aug 17th)")
    assert is_podcast_item("isc stormcast for friday", None)
    assert is_podcast_item("Stormcast episode", "https://isc.sans.edu/podcastdetail/1")
    for diary in ("Scans for EncystPHP Webshell, (Mon, Apr 13th)",
                  "Microsoft Patch Tuesday August 2026, (Tue, Aug 11th)",
                  "Malware Disguised as a Podcast App Steals Credentials, (Wed, Aug 19th)",
                  "Obfuscated JavaScript or Nothing, (Thu, Apr 9th)"):
        assert not is_podcast_item(diary, "https://isc.sans.edu/diary/12345"), diary


@case
async def test_sans_fetcher_drops_podcasts_and_cleans_text():
    rss = """<?xml version="1.0"?><rss><channel>
      <item><title>ISC Stormcast For Monday, April 13th, 2026 https://isc.sans.edu/podcastdetail/9888, (Mon, Apr 13th)</title>
            <link>https://isc.sans.edu/podcastdetail/9888</link><description></description></item>
      <item><title>What Web Shells are Attackers Looking for&amp;#x3f;, (Tue, Apr 7th)</title>
            <link>https://isc.sans.edu/diary/32868</link>
            <description>&lt;p&gt;Webshells remain &amp;#x2b; popular&lt;/p&gt;</description></item>
    </channel></rss>"""
    transport = httpx.MockTransport(lambda req: httpx.Response(200, text=rss))
    async with httpx.AsyncClient(transport=transport) as client:
        items = await _fetch_sans_isc(client)
    assert len(items) == 1, items
    assert items[0]["name"] == "What Web Shells are Attackers Looking for?, (Tue, Apr 7th)"
    assert items[0]["description"] == "Webshells remain + popular"


# ── Translation service (mocked model) ────────────────────────────────────────

def _ollama(content: str) -> httpx.Response:
    return httpx.Response(200, json={"message": {"role": "assistant", "content": content},
                                     "done": True, "done_reason": "stop"})


def _echo_handler(prefix: str, calls: list, bad_batches: set = frozenset()):
    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        calls.append(body)
        user = body["messages"][-1]["content"]
        items = json.loads(user.split("\n", 1)[1])
        if len(calls) in bad_batches:
            return _ollama("Sorry, I cannot help with that.")
        return _ollama(json.dumps({"translations": [{"i": it["i"], "t": f"{prefix} {it['text']}"} for it in items]},
                                  ensure_ascii=False))
    return handler


@case
async def test_translate_batches_and_maps_indices():
    calls: list = []
    texts = [f"Threat number {n} affects CVE-2026-{1000 + n}" for n in range(10)]
    async with httpx.AsyncClient(transport=httpx.MockTransport(_echo_handler("FR:", calls))) as c:
        out = await CT.translate_texts(texts, "fr", batch_size=4, client=c)
    assert len(calls) == 3, len(calls)                       # 4 + 4 + 2
    assert out == {i: f"FR: {t}" for i, t in enumerate(texts)}
    sys_prompt = calls[0]["messages"][0]["content"]
    assert "French" in sys_prompt and "CVE" in sys_prompt and "URLs" in sys_prompt
    assert calls[0].get("format") == "json"


@case
async def test_translate_unparseable_batch_is_dropped_not_raised():
    calls: list = []
    texts = [f"Some threat text {n}" for n in range(6)]
    async with httpx.AsyncClient(transport=httpx.MockTransport(_echo_handler("AR عربي", calls, {2}))) as c:
        out = await CT.translate_texts(texts, "ar", batch_size=2, client=c)
    assert sorted(out) == [0, 1, 4, 5], sorted(out)          # the 2nd batch failed to parse


@case
async def test_translate_rejects_bad_items():
    # Arabic target answered in English; a CVE id dropped by the model.
    def handler(req):
        return _ollama(json.dumps({"translations": [
            {"i": 0, "t": "still english"}, {"i": 1, "t": "ثغرة بدون معرف"}, {"i": 2, "t": "ثغرة جيدة"}]}))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        out = await CT.translate_texts(["Plain text here", "Bug CVE-2026-1234 found", "Good bug here"], "ar", client=c)
    assert out == {2: "ثغرة جيدة"}, out


@case
async def test_translate_unreachable_returns_empty_and_stops():
    calls = []

    def handler(req):
        calls.append(1)
        raise httpx.ConnectError("refused", request=req)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        out = await CT.translate_texts([f"text {n} here" for n in range(20)], "fr", batch_size=2, client=c)
    assert out == {}
    assert len(calls) <= 2, len(calls)                        # first batch (+1 transport retry), then stop


@case
async def test_translate_unsupported_language_is_noop():
    # English is a target now (for French/Arabic sources), but never from itself.
    assert await CT.translate_texts(["hello there"], "en") == {}
    assert await CT.translate_texts(["hello there"], "de") == {}
    assert await CT.translate_texts([], "fr") == {}


@case
def test_needs_translation():
    assert not CT.needs_translation("[NPM] some-package")
    assert not CT.needs_translation("CVE-2026-12345")
    assert CT.needs_translation("Wireshark 4.6.8 Released")


# ── API (in-process, on a temp copy of GRC_TEST_DB_PATH) ──────────────────────

async def _api_case():
    from app.core.database import Base, engine
    import app.models  # noqa: F401
    import app.models.content_translation  # noqa: F401  (registers the table for create_all)
    from app.main import app

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    conn = sqlite3.connect(_API_DB)
    tenant = conn.execute(
        "SELECT tenant_id FROM users WHERE email='admin@demo.com'").fetchone()[0]
    feed_id, manual_id = str(uuid.uuid4()), str(uuid.uuid4())
    fname, fdesc = "Scans for Solana Endpoints, (Mon, Aug 10th)", "Attackers scan for exposed RPC endpoints."
    mname = "Hand-written threat for the selftest"
    for tid, ref, name, desc in ((feed_id, "AUTO-SANS-SELFTEST", fname, fdesc),
                                 (manual_id, "THR-SELFTEST", mname, None)):
        conn.execute(
            "INSERT INTO threats (id, ref_id, name, description, category, typical_threat_actors, "
            "typical_attack_vectors, affected_assets, mitre_ids, is_builtin, is_pending, tenant_id, "
            "profile_status, review_frequency_months, linked_asset_ids, linked_vulnerability_ids, created_at, updated_at) "
            "VALUES (?,?,?,?,'cyber_attack','[]','[]','[]','[]',0,0,?,'draft',12,'[]','[]',datetime('now'),datetime('now'))",
            (tid, ref, name, desc, tenant))
    rows = [("threat", feed_id, "ar", "name", fname, "مسح لنقاط نهاية Solana"),
            ("threat", feed_id, "ar", "description", fdesc, "يقوم المهاجمون بالمسح بحثاً عن نقاط RPC المكشوفة."),
            ("threat", feed_id, "fr", "name", fname, "Scans des points de terminaison Solana"),
            # A translation whose text hash matches the MANUAL threat: must never be applied.
            ("threat", manual_id, "ar", "name", mname, "تهديد مكتوب يدويا")]
    for et, eid, lang, field, src, text in rows:
        conn.execute(
            "INSERT INTO content_translations (id, entity_type, entity_id, lang, field, source_hash, text, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))",
            (str(uuid.uuid4()), et, eid, lang, field, CT.source_hash(src), text))
    conn.commit()
    conn.close()

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/auth/login", json={"email": "admin@demo.com", "password": "demo123"})
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]

        async def get(lang):
            h = {"Authorization": f"Bearer {tok}"}
            if lang:
                h["Accept-Language"] = lang
            r = await c.get("/api/v1/threats", headers=h)
            assert r.status_code == 200, r.text
            return {t["id"]: t for t in r.json()}

        ar = await get("ar")
        f, m = ar[feed_id], ar[manual_id]
        assert f["translated"] is True and f["name"] == "مسح لنقاط نهاية Solana", f
        assert f["description"].startswith("يقوم") and f["original_name"] == fname
        assert f["original_description"] == fdesc
        assert m["translated"] is False and m["name"] == mname and m["original_name"] is None, m

        fr = await get("fr")
        assert fr[feed_id]["name"] == "Scans des points de terminaison Solana"
        assert fr[feed_id]["description"] == fdesc          # no FR description cached -> English kept

        for lang in ("en", None):
            en = await get(lang)
            assert en[feed_id]["translated"] is False and en[feed_id]["name"] == fname
            assert en[feed_id]["original_name"] is None

        r = await c.get("/api/v1/threats/watch", headers={"Authorization": f"Bearer {tok}", "Accept-Language": "ar"})
        assert r.status_code == 200 and isinstance(r.json(), list)
        assert all("translated" in w for w in r.json())


@case
def test_api_returns_translation_for_ar_and_original_for_en():
    if _API_DB is None:
        print("  (skipped: set GRC_TEST_DB_PATH to a snapshot copy to run the API case)")
        return
    asyncio.run(_api_case())


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
