"""Self-test: every AI-generated output follows the caller's UI language (en | fr | ar).

What it checks
--------------
1. Pure composition (no DB, no network): for every foundation task, ``ai_prompts.system_prompt``
   embeds exactly the requested LANGUAGE block (and no other one); JSON-output tasks still
   demand the untranslated English enum values / JSON keys in fr and ar; the chunked compliance
   assessor (``ai_chunking``) and the regulatory triage prompt carry the block too.
2. Endpoints, in-process (httpx ASGITransport) on a temp COPY of the database named in
   GRC_TEST_DB_PATH (itself a snapshot copy -- never point it at the live file), with the model
   MOCKED (``ai_provider.ai_stream`` / ``ai_complete`` / ``ai_complete_full`` / ``preflight``
   replaced by recorders -- no network): each AI endpoint category is called with fr / ar / en
   signals and the system prompt the model would have received is asserted to carry the right
   LANGUAGE block. Also: an explicit body ``language`` beats the Accept-Language header, a raw
   browser header (``fr-FR,fr;q=0.9``) resolves, and an Arabic header wins over nothing.

Usage (from backend/):
    venv/bin/python scripts/selftest_ai_language.py
    GRC_TEST_DB_PATH=/path/to/snapshot-copy.db venv/bin/python scripts/selftest_ai_language.py

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
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_TMP = tempfile.mkdtemp(prefix="ailang-")
_API_DB = None
if os.environ.get("GRC_TEST_DB_PATH"):
    _API_DB = os.path.join(_TMP, "api.db")
    shutil.copyfile(os.environ["GRC_TEST_DB_PATH"], _API_DB)
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_API_DB}"
os.environ["TRANSLATION_WORKER_LOCK"] = os.path.join(_TMP, "worker.lock")
os.environ["TRANSLATION_WORKER_STATUS"] = os.path.join(_TMP, "worker.status.json")
for _k in ("ENABLE_THREAT_SCHEDULER", "ENABLE_TRANSLATION_WORKER"):
    os.environ[_k] = "0"

import httpx  # noqa: E402

from app.services import ai_chunking as C  # noqa: E402
from app.services import ai_locale as L  # noqa: E402
from app.services import ai_prompts as PR  # noqa: E402
from app.services import ai_provider as P  # noqa: E402

LANGS = ("en", "fr", "ar")
RESULTS: list[tuple[str, bool, str]] = []


def _block(lang: str) -> str:
    return L.language_instruction(lang).strip()


def assert_lang(system: str, lang: str, where: str) -> None:
    assert _block(lang) in system, f"{where}: LANGUAGE block for {lang!r} missing"
    for other in LANGS:
        if other != lang:
            assert _block(other) not in system, f"{where}: stray LANGUAGE block for {other!r}"


def _run(name, fn):
    try:
        r = fn()
        if asyncio.iscoroutine(r):
            asyncio.run(r)
        RESULTS.append((name, True, ""))
    except Exception as exc:  # noqa: BLE001
        RESULTS.append((name, False, f"{type(exc).__name__}: {exc}\n{traceback.format_exc(limit=3)}"))


# ---------------------------------------------------------------------------
# 1. Pure composition
# ---------------------------------------------------------------------------

def _all_tasks() -> list[str]:
    return sorted(PR._TASK_SPECS)


def test_every_task_carries_the_block():
    tasks = _all_tasks()
    assert len(tasks) >= 10, tasks
    for task in tasks:
        for lang in LANGS:
            assert_lang(PR.system_prompt(task, lang=lang), lang, f"system_prompt({task})")
        # unknown / regional values degrade to a supported block, never to nothing
        assert_lang(PR.system_prompt(task, lang=L.normalize_language("fr-FR") or "en"), "fr", task)


def test_json_tasks_keep_english_enums_in_fr_and_ar():
    json_tasks = [t for t in _all_tasks() if PR.task_schema(t) is not None and PR._spec(t).output == "json"]
    assert json_tasks, "no JSON task registered"
    for task in json_tasks:
        for lang in ("fr", "ar"):
            s = PR.system_prompt(task, lang=lang)
            # the language block itself lists the enum examples that must stay English
            assert '"implemented"' in s and '"partially_implemented"' in s and '"high"' in s, task
            # and the schema still names the English enum values (untranslated)
            assert "OUTPUT SCHEMA (JSON object)" in s, task
            schema_txt = PR.schema_text(PR.task_schema(task))
            assert schema_txt in s, task
    # a representative enum survives verbatim in fr/ar prompts
    s = PR.system_prompt("control_assessment", lang="ar")
    assert "not_implemented" in s or "not_covered" in s, "control_assessment enum values missing"


def test_chunked_assessor_prompt_follows_lang():
    for lang in LANGS:
        assert_lang(C._assess_system_prompt(lang, ""), lang, "ai_chunking assess")


def test_regulatory_triage_prompt_follows_lang():
    for lang in LANGS:
        assert_lang(PR.system_prompt("regulatory_impact", lang=lang), lang, "regulatory_impact")


def test_resolution_precedence():
    assert L.resolve_language("ar", explicit="fr") == "fr"            # body beats header
    assert L.resolve_language("fr-FR,fr;q=0.9,en;q=0.8") == "fr"      # raw browser header
    assert L.resolve_language(None, tenant_default="ar") == "ar"      # background job default
    assert L.resolve_language(None) == "en"


async def test_chunked_assessor_end_to_end_mocked():
    seen: list[dict] = []

    async def fake_complete(messages, **kw):
        seen.append({"task": kw.get("task"), "system": messages[0]["content"]})
        return json.dumps({"results": []})

    orig = P.ai_complete
    P.ai_complete = fake_complete
    try:
        spec = C.control_spec_from_model({"control_id": "A.5.1", "title": "Policies", "description": "Have policies."})
        for lang in ("fr", "ar"):
            seen.clear()
            await C.assess_controls_over_document([("doc.txt", "We have an information security policy. " * 20)],
                                                  [spec], lang=lang, allow_partial=True)
            assess = [s for s in seen if s["task"] and "assess" in s["task"]]
            assert assess, f"no assess call recorded: {[s['task'] for s in seen]}"
            for s in assess:
                assert_lang(s["system"], lang, "compliance.assess")
    finally:
        P.ai_complete = orig


# ---------------------------------------------------------------------------
# 2. Endpoints in-process, model mocked
# ---------------------------------------------------------------------------

CALLS: list[dict] = []


def _install_mocks():
    async def fake_preflight(cfg=None, *, timeout_s=4.0):
        return None

    async def fake_stream(messages, **kw):
        CALLS.append({"task": kw.get("task"), "system": messages[0]["content"] if messages else ""})
        yield "OK"

    async def fake_complete(messages, **kw):
        CALLS.append({"task": kw.get("task"), "system": messages[0]["content"] if messages else ""})
        return "{}"

    async def fake_complete_full(messages, **kw):
        CALLS.append({"task": kw.get("task"), "system": messages[0]["content"] if messages else ""})
        return P.AIResult(content="Review text.", finish_reason="stop")

    P.preflight = fake_preflight
    P.ai_stream = fake_stream
    P.ai_complete = fake_complete
    P.ai_complete_full = fake_complete_full


async def _db_cases():
    from app.core.database import Base, engine
    import app.models  # noqa: F401
    from app.main import app

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    raw = sqlite3.connect(_API_DB)
    tenant_id = raw.execute("SELECT tenant_id FROM users WHERE email='admin@demo.com'").fetchone()[0]
    vendor = raw.execute("SELECT id FROM vendors WHERE tenant_id=? LIMIT 1", (tenant_id,)).fetchone()
    assessment = raw.execute("SELECT id FROM compliance_assessments WHERE tenant_id=? LIMIT 1", (tenant_id,)).fetchone()

    _install_mocks()
    tr = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=60)

    async def login(email, pw):
        r = await tr.post("/api/v1/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, r.text
        return r.json()["access_token"]

    tok = await login("admin@demo.com", "demo123")

    async def call(name, method, path, *, header=None, body=None, expect, tok_=None, task_hint=None):
        CALLS.clear()
        h = {"Authorization": f"Bearer {tok_ or tok}"} if (tok_ or tok) else {}
        if header:
            h["Accept-Language"] = header
        r = await tr.request(method, "/api/v1" + path, headers=h, json=body)
        _ = r.text  # drain the stream
        assert CALLS, f"{name}: model never called (HTTP {r.status_code}: {r.text[:300]})"
        calls = [c for c in CALLS if not task_hint or (c["task"] and task_hint in c["task"])] or CALLS
        for c in calls:
            assert_lang(c["system"], expect, f"{name} [{c['task']}]")
        return r

    cases = []

    def add(name, *a, **kw):
        cases.append((name, a, kw))

    # --- authenticated assistant chat (/ai/chat) --------------------------------------
    msgs = [{"role": "user", "content": "What is ISO 27001 clause A.5.1 about?"}]
    add("chat: body fr beats header ar", "POST", "/ai/chat", header="ar", body={"messages": msgs, "language": "fr"}, expect="fr")
    add("chat: body ar (English message) -> ar", "POST", "/ai/chat", header="en", body={"messages": msgs, "language": "ar"}, expect="ar")
    add("chat: body en", "POST", "/ai/chat", header="fr", body={"messages": msgs, "language": "en"}, expect="en")
    # --- public support chat -----------------------------------------------------------
    add("public chat: body ar", "POST", "/public/support-chat", header="en-US,en;q=0.9",
        body={"messages": msgs, "language": "ar"}, expect="ar", tok_="")
    add("public chat: body fr", "POST", "/public/support-chat", header="ar",
        body={"messages": msgs, "language": "fr"}, expect="fr", tok_="")
    # --- Doc Generator ------------------------------------------------------------------
    doc = {"document_type": "information_security_policy", "org_name": "Acme", "industry": "finance",
           "size": "smb", "country": "TN"}
    for lg in LANGS:
        add(f"doc generator: body {lg}", "POST", "/ai/generate-document", header="en", body={**doc, "language": lg}, expect=lg)
    add("doc generator: raw browser header only (fr-FR,fr;q=0.9)", "POST", "/ai/generate-document",
        header="fr-FR,fr;q=0.9,en;q=0.8", body=doc, expect="fr")
    # --- policy content / gap policy ----------------------------------------------------
    add("policy content: body ar", "POST", "/ai/generate-policy-content", header="en",
        body={"title": "Access Control Policy", "language": "ar"}, expect="ar")
    add("gap policy: body fr", "POST", "/ai/generate-policy", header="ar",
        body={"control_identifier": "A.5.1", "control_title": "Policies", "framework_short_name": "ISO27001",
              "language": "fr"}, expect="fr")
    # --- risk AI panel ------------------------------------------------------------------
    for lg in ("fr", "ar"):
        add(f"risk AI: body {lg}", "POST", "/ai/analyze-risk", header="en",
            body={"title": "Ransomware on file server", "risk_category": "cyber", "language": lg}, expect=lg)
    # --- audit plan / evidence ----------------------------------------------------------
    add("audit plan: body ar", "POST", "/ai/generate-audit-plan", header="fr",
        body={"framework_name": "ISO 27001", "framework_short_name": "ISO27001", "audit_title": "Q3",
              "controls": [{"control_id": "A.5.1", "title": "Policies"}], "language": "ar"}, expect="ar")
    add("evidence analysis: body fr", "POST", "/ai/analyze-evidence", header="en",
        body={"document_text": "We maintain an approved information security policy reviewed yearly. " * 5,
              "framework_short_name": "ISO27001", "controls": [{"control_id": "A.5.1", "title": "Policies"}],
              "language": "fr"}, expect="fr")
    # --- vendor analysis stream / contract analysis stream (structured JSON) ------------
    add("vendor analysis (ai): body ar", "POST", "/ai/analyze-vendor", header="en",
        body={"vendor_name": "CloudCo", "questionnaire_responses": {"Do you encrypt data at rest?": "yes"},
              "language": "ar"}, expect="ar")
    add("contract analysis stream: body fr", "POST", "/ai/stream-contract-analysis", header="ar",
        body={"contract_text": "The Supplier shall keep customer data confidential. " * 10, "vendor_name": "CloudCo",
              "language": "fr"}, expect="fr")
    # --- vendor prescreen (axios: Accept-Language) --------------------------------------
    for lg in ("fr", "ar"):
        add(f"vendor prescreen: header {lg}", "POST", "/vendors/prescreen", header=lg,
            body={"vendor_name": "CloudCo", "responses": {"Do you encrypt data at rest?": "yes",
                                                           "Do you have ISO 27001?": "no"}}, expect=lg)
    if vendor:
        add("vendor analyze (axios): header fr", "POST", f"/vendors/{vendor[0]}/analyze", header="fr",
            body={"questionnaire_responses": {"Do you encrypt data at rest?": "yes"}}, expect="fr")
    if assessment:
        add("remediation plan: body ar", "POST", "/ai/stream-remediation-plan", header="en",
            body={"assessment_id": assessment[0], "language": "ar"}, expect="ar")
    # --- auditor portal report (raw fetch via _streamAi: Accept-Language only) ----------
    if assessment:
        import uuid
        aud_id = raw.execute("SELECT id FROM users WHERE email='auditor@demo.com'").fetchone()
        if aud_id:
            raw.execute(
                "INSERT INTO auditor_assignments (auditor_id, assessment_id, tenant_id, assigned_by_id, is_active,"
                " reference_document_ids, id, created_at, updated_at) VALUES (?,?,?,?,1,'[]',?,"
                " '2026-01-01 00:00:00','2026-01-01 00:00:00')",
                (aud_id[0], assessment[0], tenant_id, aud_id[0], str(uuid.uuid4())))
            raw.commit()
            aud_tok = await login("auditor@demo.com", "demo123")
            for lg in ("fr", "ar"):
                add(f"auditor report: header {lg}", "POST",
                    f"/auditor-portal/assessments/{assessment[0]}/generate-report",
                    header=lg, body={"language": lg}, expect=lg, tok_=aud_tok)
    # --- framework builder (axios) ------------------------------------------------------
    add("framework builder: header ar", "POST", "/frameworks/builder/ai-suggestions", header="ar",
        body={"industry": "banking", "region": "TN", "use_case": "cloud"}, expect="ar")

    for name, a, kw in cases:
        async def one(a=a, kw=kw, name=name):
            await call(name, *a, **kw)
        try:
            await one()
            RESULTS.append((name, True, ""))
        except Exception as exc:  # noqa: BLE001
            RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
    await tr.aclose()
    raw.close()


def main() -> int:
    for name, fn in [
        ("compose: every task carries exactly the requested LANGUAGE block", test_every_task_carries_the_block),
        ("compose: JSON tasks keep English enum values / keys in fr + ar", test_json_tasks_keep_english_enums_in_fr_and_ar),
        ("compose: chunked compliance assessor follows lang", test_chunked_assessor_prompt_follows_lang),
        ("compose: regulatory triage follows lang", test_regulatory_triage_prompt_follows_lang),
        ("resolve: body > header > tenant > en", test_resolution_precedence),
        ("compliance batch (assess_controls_over_document) mocked, fr + ar", test_chunked_assessor_end_to_end_mocked),
    ]:
        _run(name, fn)
    if _API_DB:
        try:
            asyncio.run(_db_cases())
        except Exception as exc:  # noqa: BLE001
            RESULTS.append(("endpoint harness", False, f"{type(exc).__name__}: {exc}\n{traceback.format_exc(limit=5)}"))
    else:
        print("SKIP endpoint cases (set GRC_TEST_DB_PATH to a snapshot copy)")
    failed = 0
    for name, ok, detail in RESULTS:
        print(("PASS " if ok else "FAIL ") + name)
        if not ok:
            failed += 1
            print("     " + detail.replace("\n", "\n     "))
    print(f"\n{len(RESULTS) - failed}/{len(RESULTS)} passed")
    shutil.rmtree(_TMP, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
