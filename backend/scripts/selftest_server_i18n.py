"""Self-test for server-generated text in the reader's language (en/fr/ar):
in-app notifications, e-mails, and server-built PDF documents.

Runs entirely in-process against a COPY of a database you name (the named file
is copied again to a temp dir, so even it is never modified). No real mail can
leave: SMTP_HOST is forced to an unroutable name AND aiosmtplib.send is replaced
by a capturing fake before anything can call it.

Usage (from backend/):
    GRC_TEST_DB_PATH=/path/to/snapshot-copy.db venv/bin/python scripts/selftest_server_i18n.py
Optional: SRV_I18N_OUT=/some/dir  — keeps a French and an Arabic PDF there and
renders their page 1 to PNG (pdftoppm) for a visual check.
Prints PASS/FAIL per case and exits non-zero on any failure.
"""
import asyncio
import io
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import traceback
import unicodedata
import uuid
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if not os.environ.get("GRC_TEST_DB_PATH"):
    print("GRC_TEST_DB_PATH is required (a snapshot copy of grc_dev.db)")
    sys.exit(2)

# ── Isolation: must happen before anything imports app.core.config ──────────
_tmpdir = tempfile.mkdtemp(prefix="srvi18n-")
_DB = os.path.join(_tmpdir, "api.db")
shutil.copyfile(os.environ["GRC_TEST_DB_PATH"], _DB)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB}"
os.environ["SMTP_HOST"] = "smtp.invalid.test"        # never a real relay
os.environ["SMTP_PORT"] = "2525"
os.environ["SMTP_USER"] = ""
os.environ["SMTP_PASSWORD"] = ""
os.environ["ENABLE_NOTIFICATION_EMAILS"] = "1"       # the send is mocked below
os.environ["ENABLE_TRANSLATION_WORKER"] = "0"
os.environ.setdefault("ENABLE_THREAT_SCHEDULER", "0")

import aiosmtplib  # noqa: E402

SENT: list = []


async def _fake_send(message, *args, **kwargs):
    SENT.append(message)
    return ({}, "250 OK (captured by selftest)")


aiosmtplib.send = _fake_send  # patched module-wide before email_service imports it

import httpx  # noqa: E402
from pypdf import PdfReader  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.services import email_service  # noqa: E402

assert settings.DATABASE_URL.endswith("api.db"), settings.DATABASE_URL
assert settings.SMTP_HOST == "smtp.invalid.test", settings.SMTP_HOST
email_service.aiosmtplib.send = _fake_send

OUT_DIR = os.environ.get("SRV_I18N_OUT")
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


def _norm(text: str) -> str:
    """Compare PDF text regardless of Arabic presentation forms / visual order."""
    return "".join(unicodedata.normalize("NFKC", text).split())


def pdf_text(data: bytes) -> str:
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)


def pdf_has(data: bytes, phrase: str) -> bool:
    """Is `phrase` in the PDF — in logical order (Latin) or as shaped visual Arabic?"""
    from app.services import pdf_arabic
    text = _norm(pdf_text(data))
    return _norm(phrase) in text or _norm(pdf_arabic.shape(phrase)) in text


# ── Fixtures ─────────────────────────────────────────────────────────────────

def _admin_ids() -> tuple[str, str]:
    conn = sqlite3.connect(_DB)
    uid, tid = conn.execute("SELECT id, tenant_id FROM users WHERE email='admin@demo.com'").fetchone()
    conn.close()
    return uid, tid


async def _ensure_tables():
    """create_all() on the COPY, as the app's startup would (user_locales is new)."""
    import importlib
    from app.core.database import Base, engine
    importlib.import_module("app.models")  # registers every table, as app.main does
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _insert_notifications(uid: str, tid: str) -> tuple[str, str]:
    import json
    keyed, legacy = str(uuid.uuid4()), str(uuid.uuid4())
    conn = sqlite3.connect(_DB)
    conn.execute(
        "INSERT INTO notifications (id, tenant_id, user_id, type, status, title, message, title_key, "
        "message_key, params, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, "
        "datetime('now','+2 minutes'), datetime('now'))",
        (keyed, tid, uid, "risk_overdue", "unread",
         "Risk review OVERDUE: Selftest risk", "Risk 'Selftest risk' review is overdue by 4 days.",
         "notifications.risk_review_overdue.title", "notifications.risk_review_overdue.message",
         json.dumps({"risk": "Selftest risk", "days": 4, "due": "2026-09-24"}), json.dumps({"severity": "critical"})))
    # A row written before keys existed: only the English text.
    conn.execute(
        "INSERT INTO notifications (id, tenant_id, user_id, type, status, title, message, data, "
        "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?, datetime('now','+1 minutes'), datetime('now'))",
        (legacy, tid, uid, "vendor_alert", "unread",
         "Contract EXPIRED: Selftest Vendor",
         "The contract with Selftest Vendor expired 12 days ago. Immediate action required.", "{}"))
    conn.commit()
    conn.close()
    return keyed, legacy


# ── Notifications ────────────────────────────────────────────────────────────

@case
async def notifications_feed_in_reader_language():
    from app.main import app
    await _ensure_tables()
    uid, tid = _admin_ids()
    keyed, legacy = _insert_notifications(uid, tid)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/auth/login", json={"email": "admin@demo.com", "password": "demo123"})
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]

        async def feed(lang):
            h = {"Authorization": f"Bearer {tok}", "Accept-Language": lang}
            r = await c.get("/api/v1/notifications", params={"limit": 50}, headers=h)
            assert r.status_code == 200, r.text
            return {n["id"]: n for n in r.json()["items"]}

        en, fr, ar = await feed("en"), await feed("fr"), await feed("ar")
        # English: exactly what is stored.
        assert en[keyed]["title"] == "Risk review OVERDUE: Selftest risk", en[keyed]
        assert en[legacy]["message"].startswith("The contract with Selftest Vendor expired 12 days"), en[legacy]
        # Keyed row rendered from its key + params.
        assert fr[keyed]["title"] == "Revue du risque EN RETARD : Selftest risk", fr[keyed]["title"]
        assert fr[keyed]["message"] == "La revue du risque « Selftest risk » accuse un retard de 4 jours.", fr[keyed]["message"]
        assert ar[keyed]["title"] == "مراجعة الخطر متأخرة: Selftest risk", ar[keyed]["title"]
        assert "4 أيام" in ar[keyed]["message"], ar[keyed]["message"]
        # Legacy English row matched back to its template.
        assert fr[legacy]["title"] == "Contrat EXPIRÉ : Selftest Vendor", fr[legacy]["title"]
        assert fr[legacy]["message"] == ("Le contrat avec Selftest Vendor a expiré il y a 12 jours. "
                                         "Une action immédiate est requise."), fr[legacy]["message"]
        assert ar[legacy]["title"] == "عقد منتهي الصلاحية: Selftest Vendor", ar[legacy]["title"]
        assert "منذ 12 يوماً" in ar[legacy]["message"], ar[legacy]["message"]
        # Stored rows are untouched.
        conn = sqlite3.connect(_DB)
        stored = conn.execute("SELECT title FROM notifications WHERE id=?", (keyed,)).fetchone()[0]
        lang_row = conn.execute("SELECT language FROM user_locales WHERE user_id=?", (uid,)).fetchone()
        conn.close()
        assert stored == "Risk review OVERDUE: Selftest risk", stored
        # The last feed call was Arabic: remembered for the mail leg.
        assert lang_row and lang_row[0] == "ar", lang_row
        # mark-as-read answers in the reader's language too.
        r = await c.patch(f"/api/v1/notifications/{legacy}/read",
                          headers={"Authorization": f"Bearer {tok}", "Accept-Language": "fr"})
        assert r.status_code == 200 and r.json()["title"] == "Contrat EXPIRÉ : Selftest Vendor", r.text


@case
def notifications_every_catalog_key_renders():
    """Every fr/ar template formats with the params its English template names."""
    import string
    from app.services.notification_i18n import CATALOG, render_key
    fmt = string.Formatter()
    for key, entry in CATALOG.items():
        names = {f for _l, f, _s, _c in fmt.parse(entry["en"]) if f}
        for alt in entry.get("en_alt", ()):
            names |= {f for _l, f, _s, _c in fmt.parse(alt) if f}
        params = {n: ("3" if n in ("days", "score", "progress") else f"<{n}>") for n in names}
        for lang in ("fr", "ar"):
            out = render_key(key, lang, params, "FALLBACK")
            assert out != "FALLBACK", (key, lang)
            assert "{" not in out, (key, lang, out)


@case
def notifications_legacy_templates_roundtrip():
    """Each English template, filled in, is recognised and re-rendered."""
    from app.services.notification_i18n import CATALOG, match_legacy
    samples = {
        "Contract expiring in 30 days: ACME": "notifications.contract_expiring.title",
        "The contract with ACME will expire in 7 days. Renewal needed.": "notifications.contract_expiring.message",
        "Asset end-of-life in 20 days: Core switch": "notifications.asset_eol_soon.title",
        "New device sign-in: Admin Demo": "notifications.new_device_login_admin.title",
        ("Your GRCEye account was just signed in to from a device we haven't seen before (Firefox on Linux)"
         ". If this wasn't you, change your password immediately and review your active sessions in Settings."):
            "notifications.new_device_login.message",
        'The share link "4.1" was opened by an external stakeholder.': "notifications.share_link_viewed.message",
    }
    for text, key in samples.items():
        hit = match_legacy(text, "title" if key.endswith(".title") else "message")
        assert hit and hit[0] == key, (text, hit)
    assert "notifications.compliance_gap.message" in CATALOG
    assert match_legacy("Some free text an AI wrote", "message") is None


# ── E-mails ──────────────────────────────────────────────────────────────────

def _html_of(msg) -> str:
    for part in msg.walk():
        if part.get_content_type() == "text/html":
            return part.get_payload(decode=True).decode("utf-8")
    return ""


def _subject_of(msg) -> str:
    from email.header import decode_header, make_header
    return str(make_header(decode_header(msg["Subject"])))


@case
async def email_relance_in_recipient_language():
    """flush_email_outbox writes each mail in the recipient's remembered language."""
    from app.core.database import AsyncSessionLocal
    from app.models.notification import NotificationType
    from app.services.notification_generator import flush_email_outbox
    await _ensure_tables()
    uid, tid = _admin_ids()
    conn = sqlite3.connect(_DB)
    conn.execute("DELETE FROM user_locales WHERE user_id=?", (uid,))
    conn.execute("INSERT INTO user_locales (id, user_id, language, created_at, updated_at) "
                 "VALUES (?,?,?,datetime('now'),datetime('now'))", (str(uuid.uuid4()), uid, "ar"))
    conn.commit()
    conn.close()
    item = {
        "user_id": uid, "tenant_id": tid, "to_email": "admin@demo.com",
        "type": NotificationType.COMPLIANCE_ACTION_OVERDUE,
        "title": "Reminder J+3: action 'Patch servers' is 3 day(s) overdue",
        "message": "The corrective/preventive action 'Patch servers' was due on 2026-09-25 and is not closed. "
                   "Update its progress or record why it cannot be closed.",
        "title_key": "notifications.action_item_relance.title",
        "message_key": "notifications.action_item_relance.message",
        "params": {"title": "Patch servers", "due": "2026-09-25", "days": 3, "stage": "J+3"},
        "link": "/compliance",
    }
    SENT.clear()
    async with AsyncSessionLocal() as db:
        sent = await flush_email_outbox(db, [item])
    assert sent == 1 and len(SENT) == 1, (sent, len(SENT))
    subject, html = _subject_of(SENT[0]), _html_of(SENT[0])
    assert subject.startswith("تذكير J+3"), subject
    assert 'dir="rtl"' in html and 'lang="ar"' in html, html[:300]
    assert "الحوكمة والمخاطر والامتثال" in html and "فتح" in html
    assert "Governance, Risk" not in html and "Manage notification preferences" not in html


@case
async def email_templates_per_language():
    """Typed helpers + chrome in fr and en; sending is captured, never delivered."""
    SENT.clear()
    ok = await email_service.send_password_reset_email(
        to_email="someone@example.invalid", reset_link="https://example.invalid/reset?t=x", lang="fr")
    assert ok and len(SENT) == 1
    subject, html = _subject_of(SENT[0]), _html_of(SENT[0])
    assert subject == "Réinitialisez votre mot de passe — GRCEye", subject
    assert 'lang="fr"' in html and 'dir="ltr"' in html
    assert "Réinitialiser mon mot de passe" in html and "Gérer les préférences de notification" in html
    assert "&lt;a href" not in html   # the link is a button now, not escaped markup

    SENT.clear()
    await email_service.send_risk_alert(to_email="x@example.invalid", risk_title="Ransomware", severity="high",
                                        org="ACME", risk_url="https://example.invalid/risks", lang="ar")
    subject, html = _subject_of(SENT[0]), _html_of(SENT[0])
    assert subject == "[خطر مرتفع] Ransomware — ACME", subject
    assert 'dir="rtl"' in html and "عرض الخطر" in html and "درجة الخطورة" in html

    SENT.clear()
    await email_service.send_weekly_digest(to_email="x@example.invalid", org="ACME", open_risks=1, critical_risks=0,
                                           compliance_score=50.0, open_findings=2, policies_due=3,
                                           dashboard_url="https://example.invalid", lang="en")
    subject, html = _subject_of(SENT[0]), _html_of(SENT[0])
    assert subject == "[WEEKLY DIGEST] GRC Summary — ACME" and 'lang="en"' in html

    SENT.clear()
    await email_service.send_report_email(to_email="x@example.invalid", subject="r", pdf_bytes=b"%PDF-1.4",
                                          filename="r.pdf", lang="ar")
    html = _html_of(SENT[0])
    assert 'dir="rtl"' in html and "مرفقاً" in html, html


# ── Reports ──────────────────────────────────────────────────────────────────

EXPECTED = {
    "executive": {"en": ["Executive Summary", "Risk Overview"], "fr": ["Synthèse de direction", "Vue d'ensemble des risques"],
                  "ar": ["الملخص التنفيذي"]},
    "risk": {"en": ["Risk Register Report"], "fr": ["Rapport du registre des risques", "Gravité"],
             "ar": ["تقرير سجل المخاطر"]},
    "vendor": {"en": ["3rd Party Risk Report"], "fr": ["Rapport des risques tiers"], "ar": ["تقرير مخاطر الأطراف الثالثة"]},
    "compliance": {"en": ["Compliance Status Report"], "fr": ["Rapport d'état de la conformité"],
                   "ar": ["الحالة"]},
    "audit": {"en": ["Audit Status Report"], "fr": ["Rapport d'état des audits"], "ar": ["الحالة"]},
}
ENGLISH_ONLY = ["Report Period", "CONFIDENTIAL", "No data available", "Generated"]


@case
async def reports_every_type_every_language():
    from app.core.database import AsyncSessionLocal
    from app.services import report_generator as rg
    _uid, tid = _admin_ids()
    async with AsyncSessionLocal() as db:
        for rtype in rg.REPORT_GENERATORS:
            for lang in ("en", "fr", "ar"):
                data = await rg.generate_report(rtype, db, tid, "ACME Corp", lang)
                assert data[:4] == b"%PDF" and len(data) > 1500, (rtype, lang, len(data))
                expected = EXPECTED[rtype][lang]
                for phrase in expected:
                    assert pdf_has(data, phrase), (rtype, lang, phrase, pdf_text(data)[:400])
                if lang != "en":
                    text = pdf_text(data)
                    for word in ENGLISH_ONLY:
                        assert word not in text, (rtype, lang, word)
                if OUT_DIR and rtype == "risk" and lang in ("fr", "ar"):
                    _keep(data, f"risk_report_{lang}.pdf")
                if OUT_DIR and rtype == "executive" and lang == "ar":
                    _keep(data, "executive_report_ar.pdf")


@case
async def other_server_pdfs_localised():
    """Cartography, policy and archive exports through the API, in fr and ar."""
    from app.main import app
    await _ensure_tables()
    conn = sqlite3.connect(_DB)
    _uid, tid = _admin_ids()
    carto = conn.execute("SELECT id FROM risk_cartographies WHERE tenant_id=? LIMIT 1", (tid,)).fetchone()
    if not carto:
        # The demo tenant has none: add one to the COPY, with the default
        # (English-labelled) definition the PDF must translate.
        import json
        from app.api.v1.endpoints.risk_cartographies import DEFAULT_DEFINITION
        carto = (str(uuid.uuid4()),)
        conn.execute(
            "INSERT INTO risk_cartographies (id, tenant_id, name, description, is_default, definition, "
            "risk_positions, created_at, updated_at) VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))",
            (carto[0], tid, "Selftest map", "Carte de test", 0, json.dumps(DEFAULT_DEFINITION), "{}"))
        conn.commit()
    pol = conn.execute("SELECT id FROM policies WHERE tenant_id=? LIMIT 1", (tid,)).fetchone()
    conn.close()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/auth/login", json={"email": "admin@demo.com", "password": "demo123"})
        tok = r.json()["access_token"]
        for lang, words in (("fr", {"carto": "Registre des risques", "policy": "Statut", "arch": "Export des enregistrements archivés"}),
                            ("ar", {"carto": "سجل المخاطر", "policy": "الحالة", "arch": "تصدير السجلات المؤرشفة"})):
            h = {"Authorization": f"Bearer {tok}", "Accept-Language": lang}
            if carto:
                r = await c.get(f"/api/v1/risk-cartographies/{carto[0]}/pdf", headers=h)
                assert r.status_code == 200, r.text[:300]
                assert pdf_has(r.content, words["carto"]), (lang, "carto", pdf_text(r.content)[:300])
                assert "Risk Register" not in pdf_text(r.content)
                assert "Almost Certain" not in pdf_text(r.content) and "Catastrophic" not in pdf_text(r.content)
                if OUT_DIR and lang == "ar":
                    _keep(r.content, "cartography_ar.pdf")
            if pol:
                r = await c.get(f"/api/v1/policies/{pol[0]}/export-pdf", headers=h)
                assert r.status_code == 200, r.text[:300]
                assert pdf_has(r.content, words["policy"]), (lang, "policy", pdf_text(r.content)[:300])
            r = await c.get("/api/v1/archiving/export/download", params={"format": "pdf"}, headers=h)
            if r.status_code == 200:   # the module is plan-gated; 402/403 on a tenant without it
                assert pdf_has(r.content, words["arch"]), (lang, "archive", pdf_text(r.content)[:300])


def _keep(data: bytes, name: str) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    with open(path, "wb") as fh:
        fh.write(data)
    if shutil.which("pdftoppm"):
        subprocess.run(["pdftoppm", "-r", "80", "-f", "1", "-l", "1", "-png", path, path[:-4]], check=False)


if __name__ == "__main__":
    for run in CASES:
        run()
    failed = 0
    for name, ok, err in RESULTS:
        print(("PASS " if ok else "FAIL ") + name)
        if not ok:
            failed += 1
            print(err)
    print(f"\n{len(RESULTS) - failed}/{len(RESULTS)} passed; mails captured (never sent): {len(SENT)}")
    shutil.rmtree(_tmpdir, ignore_errors=True)
    sys.exit(1 if failed else 0)
