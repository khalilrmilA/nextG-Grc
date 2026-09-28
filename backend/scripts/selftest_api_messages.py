"""Self-test for localised API messages (app.core.i18n_messages + main.py handlers).

Runs IN-PROCESS (httpx ASGITransport — no port, no lifespan, no schedulers) against a
SNAPSHOT COPY of the database. Never point it at the live grc_dev.db: it logs in and
enrols MFA on the copy.

    cd backend
    DATABASE_URL=sqlite+aiosqlite:///<copy.db> ENABLE_TRANSLATION_WORKER=0 \\
        venv/bin/python -m scripts.selftest_api_messages

Checks
* English (no header / "en" / "en-US") responses are byte-identical to FastAPI's stock
  handlers (a second app instance with the default handlers re-installed) on a sample
  of error endpoints;
* fr / ar translate: MFA wrong code, feature gate 402 (machine fields untouched), a
  role 403, a 404, a 422 validation error, a scanner-connector test message, a
  templated (dynamic) message, the password policy composite message;
* unknown strings pass through; Accept-Language variants (fr-FR, "ar;q=0.9", browser
  lists) resolve correctly; exempt (frontend-matched) strings stay English.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

DB_URL = os.environ.get("DATABASE_URL", "")
if "grc_dev.db" in DB_URL or not DB_URL:
    sys.exit("Refusing to run: set DATABASE_URL to a snapshot COPY of the database.")
os.environ.setdefault("ENABLE_TRANSLATION_WORKER", "0")

import httpx  # noqa: E402
from fastapi.exception_handlers import (  # noqa: E402
    http_exception_handler, request_validation_exception_handler,
)
from fastapi.exceptions import RequestValidationError  # noqa: E402
from starlette.exceptions import HTTPException as StarletteHTTPException  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.i18n_messages import (  # noqa: E402
    msg, translate_detail, translate_text, translate_validation_errors,
)
from app.main import create_application  # noqa: E402
from app.services.ai_locale import language_from_accept  # noqa: E402

assert "grc_dev.db" not in settings.DATABASE_URL, settings.DATABASE_URL
P = settings.API_V1_PREFIX

FAILS: list[str] = []
PASSES = 0


def check(cond: bool, label: str, extra: object = "") -> None:
    global PASSES
    if cond:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILS.append(label)
        print(f"  FAIL {label} {extra}")


def is_ar(text: str) -> bool:
    return any("؀" <= c <= "ۿ" for c in text)


# ---------------------------------------------------------------------------
def unit_tests() -> None:
    print("[unit]")
    s = "Invalid or expired code."
    check(translate_text(s, "en") is s, "en is identity")
    check(translate_text("totally unknown sentence xyz", "fr") == "totally unknown sentence xyz", "unknown passthrough")
    check(translate_text(None, "fr") is None and translate_text(42, "ar") == 42, "non-str passthrough")
    fr = translate_text(s, "fr")
    check(fr != s, "static fr", fr)
    check(is_ar(translate_text(s, "ar")), "static ar", translate_text(s, "ar"))
    t = translate_text("Framework not found: iso-27001-xyz", "fr")
    check(t != "Framework not found: iso-27001-xyz" and "iso-27001-xyz" in t, "template fr keeps value", t)
    t = translate_text("Password must contain at least 12 characters, an uppercase letter, a digit.", "ar")
    check(is_ar(t) and "12" in t and "uppercase" not in t, "password composite ar", t)
    t = translate_text("Organization slug already taken", "fr")
    check(t == "Organization slug already taken", "exempt string stays English")
    d = {"error": "feature_not_in_plan", "feature": "x_y", "pack": "elite",
         "message": "This capability is part of the Elite Pack. Upgrade the subscription to enable 'x_y'."}
    td = translate_detail(d, "fr")
    check(td["error"] == "feature_not_in_plan" and td["feature"] == "x_y" and td["pack"] == "elite"
          and td["message"] != d["message"] and "x_y" in td["message"], "dict detail: only message", td)
    check(translate_detail(d, "en") is d, "dict detail en identity")
    errs = [{"type": "missing", "loc": ("body", "email"), "msg": "Field required", "input": {}},
            {"type": "string_too_short", "loc": ("body", "name"), "msg": "String should have at least 3 characters",
             "input": "a", "ctx": {"min_length": 3}},
            {"type": "weird_type", "loc": ("q",), "msg": "Something odd", "input": 1}]
    out = translate_validation_errors(errs, "ar")
    check(is_ar(out[0]["msg"]) and out[0]["loc"] == ("body", "email") and out[0]["type"] == "missing",
          "422 ar missing", out[0])
    check("3" in out[1]["msg"] and is_ar(out[1]["msg"]), "422 ar ctx template", out[1])
    check(out[2] is errs[2], "422 unknown type untouched")
    check(list(out[1].keys()) == list(errs[1].keys()), "422 key order kept")
    t = translate_text("Too many requests. Please slow down and try again.", "ar")
    check(is_ar(t), "429 text ar", t)
    check(msg("Connected. {count} finding(s) on the first page.", "en", count=3)
          == "Connected. 3 finding(s) on the first page.", "msg() en")
    check("3" in msg("Connected. {count} finding(s) on the first page.", "fr", count=3)
          and "Connected." not in msg("Connected. {count} finding(s) on the first page.", "fr", count=3),
          "msg() fr")
    for header, want in [("fr-FR", "fr"), ("ar;q=0.9", "ar"), ("fr-FR,fr;q=0.9,en-US;q=0.8", "fr"),
                         ("en-US,en;q=0.8,ar;q=0.9", "ar"), ("de-DE", None), ("", None), ("AR", "ar")]:
        check(language_from_accept(header) == want, f"Accept-Language {header!r} -> {want}")


# ---------------------------------------------------------------------------
def legacy_app():
    """Same app with FastAPI's stock handlers re-installed (the pre-localisation baseline)."""
    app = create_application()
    app.exception_handlers[StarletteHTTPException] = http_exception_handler
    app.exception_handlers[RequestValidationError] = request_validation_exception_handler
    return app


async def login(c: httpx.AsyncClient, email: str, pw: str) -> str | None:
    r = await c.post(f"{P}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        return None
    return r.json().get("access_token")


async def http_tests() -> None:
    print("[http]")
    # The slowapi limiter is process-global and shared by both app instances; the
    # comparisons below replay the same login several times, so switch it off.
    from app.core.rate_limit import limiter
    limiter.enabled = False
    new_app, old_app = create_application(), legacy_app()
    tn = httpx.ASGITransport(app=new_app)
    to = httpx.ASGITransport(app=old_app)
    async with httpx.AsyncClient(transport=tn, base_url="http://t") as c, \
            httpx.AsyncClient(transport=to, base_url="http://t") as o:
        admin = await login(c, "admin@demo.com", "demo123")
        tadmin = await login(c, "tenantadmin@demo.com", "demo123")
        auditor = await login(c, "auditor@demo.com", "demo123")
        check(bool(admin), "login admin@demo.com")
        H = lambda tok: {"Authorization": f"Bearer {tok}"} if tok else {}  # noqa: E731

        # Pick a 402 (feature gate): first gated route that answers 402 for some demo user.
        gate_req = None
        for tok in (auditor, tadmin, admin):
            for path in ("/vuln-import/journal", "/vuln-import/connectors", "/mfa/status"):
                r = await c.get(P + path, headers=H(tok))
                if r.status_code == 402:
                    gate_req = ("GET", path, tok)
                    break
            if gate_req:
                break

        samples = [
            ("POST", "/auth/login", None, {"email": "nobody@example.com", "password": "wrong-password"}),
            ("POST", "/auth/login", None, {"email": "not-an-email"}),                   # 422
            ("GET", "/no/such/route", None, None),                                       # 404 Starlette
            ("GET", "/users", None, None),                                               # 401/403 unauth
            ("GET", "/risks/00000000-0000-0000-0000-000000000000", admin, None),         # 404
            ("POST", "/mfa/verify", admin, {"code": "000000"}),                          # 404/400
            ("POST", "/auth/refresh", None, {"refresh_token": "garbage"}),               # 400/401
            ("POST", "/risks", admin, {"title": 5}),                                     # 422
            ("GET", "/admin/users", admin, None),                                        # 403 (super admin only)
        ]
        if gate_req:
            samples.append((gate_req[0], gate_req[1], gate_req[2], None))
        for lang_hdr in (None, "en", "en-US,en;q=0.9"):
            same = 0
            for method, path, tok, body in samples:
                hdr = H(tok)
                if lang_hdr:
                    hdr["Accept-Language"] = lang_hdr
                rn = await c.request(method, P + path, headers=hdr, json=body)
                ro = await o.request(method, P + path, headers=hdr, json=body)
                if rn.status_code == ro.status_code and rn.content == ro.content:
                    same += 1
                else:
                    print("    diff:", method, path, rn.status_code, rn.content[:200], ro.content[:200])
            check(same == len(samples), f"English byte-identical ({lang_hdr!r}) {same}/{len(samples)}")

        # fr / ar: same status + shape as legacy, translated human text
        for method, path, tok, body in samples:
            ro = await o.request(method, P + path, headers=H(tok), json=body)
            for lang in ("fr", "ar"):
                rn = await c.request(method, P + path, headers={**H(tok), "Accept-Language": lang}, json=body)
                try:
                    jn, jo = rn.json(), ro.json()
                except ValueError:  # e.g. a redirect / empty body: must simply be identical
                    check(rn.status_code == ro.status_code and rn.content == ro.content,
                          f"{lang} {method} {path} -> {rn.status_code} (non-JSON) identical")
                    continue
                ok = rn.status_code == ro.status_code and type(jn.get("detail")) is type(jo.get("detail"))
                if isinstance(jo.get("detail"), dict):
                    ok = ok and set(jn["detail"]) == set(jo["detail"]) and all(
                        jn["detail"][k] == v for k, v in jo["detail"].items() if k != "message")
                if isinstance(jo.get("detail"), list):
                    ok = ok and [(e["loc"], e["type"]) for e in jn["detail"]] == \
                        [(e["loc"], e["type"]) for e in jo["detail"]]
                check(ok, f"{lang} {method} {path} -> {rn.status_code} shape kept")
                print("       ", lang, json.dumps(jn, ensure_ascii=False)[:230])

        # Specific translated cases
        async def detail_of(method, path, tok, body, lang):
            r = await c.request(method, P + path, headers={**H(tok), "Accept-Language": lang}, json=body)
            return r.status_code, r.json().get("detail")

        # MFA wrong code: enrol on the copy, then verify with a bad code.
        r = await c.post(f"{P}/mfa/enroll", headers=H(admin))
        if r.status_code == 200:
            for lang, header in (("fr", "fr-FR"), ("ar", "ar;q=0.9")):
                st, d = await detail_of("POST", "/mfa/verify", admin, {"code": "000000"}, header)
                good = st == 400 and isinstance(d, str) and d != "Invalid or expired code." and (lang != "ar" or is_ar(d))
                check(good, f"MFA wrong code {header}", (st, d))
        else:
            check(False, "MFA enroll on copy", (r.status_code, r.text[:200]))

        if gate_req:
            for lang in ("fr", "ar"):
                st, d = await detail_of(gate_req[0], gate_req[1], gate_req[2], None, lang)
                check(st == 402 and d.get("error") == "feature_not_in_plan" and
                      "Upgrade the subscription" not in d.get("message", ""), f"402 gate {lang}", d)
        else:
            print("  (no demo user hits a 402 on this snapshot; 402 covered by the unit test)")

        for lang in ("fr", "ar"):
            st, d = await detail_of("GET", "/admin/users", admin, None, lang)
            check(st == 403 and isinstance(d, str) and (lang != "ar" or is_ar(d)), f"403 {lang}", (st, d))
            st, d = await detail_of("GET", "/risks/00000000-0000-0000-0000-000000000000", admin, None, lang)
            check(st == 404 and isinstance(d, str) and (lang != "ar" or is_ar(d)), f"404 {lang}", (st, d))
            st, d = await detail_of("POST", "/auth/login", None, {"email": "x"}, lang)
            check(st == 422 and all(e["msg"] != "Field required" for e in d), f"422 {lang}", d)

        # Scanner connector Test message (demo connector on the copy). The connector
        # module is Elite-gated: grant admin@demo.com the per-user Elite flag ON THE COPY.
        import sqlite3
        db_file = settings.DATABASE_URL.split(":///", 1)[1]
        assert "grc_dev.db" not in db_file
        with sqlite3.connect(db_file) as cx:
            cx.execute("UPDATE users SET elite_access=1 WHERE email='admin@demo.com'")
        tok = admin
        r = await c.post(f"{P}/vuln-import/connectors", headers=H(tok),
                         json={"name": "i18n selftest", "tool": "demo"})
        if r.status_code in (200, 201):
            cid = r.json()["id"]
            for lang in ("en", "fr", "ar"):
                r2 = await c.post(f"{P}/vuln-import/connectors/{cid}/test",
                                  headers={**H(tok), "Accept-Language": lang})
                m = r2.json().get("message", "")
                if lang == "en":
                    check(m == "Demo connector ready (simulated pull).", "connector test en", m)
                else:
                    check(r2.status_code == 200 and m and m != "Demo connector ready (simulated pull)."
                          and (lang != "ar" or is_ar(m)), f"connector test {lang}", m)
            await c.delete(f"{P}/vuln-import/connectors/{cid}", headers=H(tok))
        else:
            print(f"  (connector create -> {r.status_code}: {r.text[:160]}; checking message via catalog)")
            for lang in ("fr", "ar"):
                m = translate_text("Demo connector ready (simulated pull).", lang)
                check(m != "Demo connector ready (simulated pull).", f"connector msg catalog {lang}", m)


def main() -> None:
    unit_tests()
    asyncio.run(http_tests())
    print(f"\n{PASSES} passed, {len(FAILS)} failed")
    if FAILS:
        for f in FAILS:
            print("  -", f)
        sys.exit(1)


if __name__ == "__main__":
    main()
