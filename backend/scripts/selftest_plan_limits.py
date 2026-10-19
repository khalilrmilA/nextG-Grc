"""Self-test for the commercial package quotas (app/services/plan_limits.py).

Runs IN-PROCESS (httpx ASGITransport — no port, no lifespan, no schedulers)
against a private copy of a SNAPSHOT of the database. Never the live grc_dev.db:
it creates tenants, users, assessments, vendors and a licence activation.

    cd backend
    GRC_TEST_DB_PATH=/path/to/snapshot-copy.db venv/bin/python scripts/selftest_plan_limits.py

Sections
* contributors — Growth: the 26th contributor is refused with 402 plan_limit
                 (structured detail, fr/ar message), viewer / executive / auditor
                 still allowed, free→contributor role change and re-activation
                 refused, contributor→contributor change allowed, a freed seat is
                 reusable, custom_limits override raises the cap, a trial on an
                 Enterprise row is Growth, Enterprise is unlimited, super-admin
                 create is guarded too, LDAP auto-provisioning over the cap fails
                 with a clear message (and an LDAP promotion is skipped, login kept)
* frameworks   — 11th NEW framework refused; an already-assessed framework passes
* vendors      — 101st vendor refused; CSV import at the cap 402; partial import
                 creates what fits and reports the rest
* ai           — /ai/chat 402 on Growth, passes the gate on Enterprise;
                 /ai/generate-document never 402 on Growth (provider stubbed)
* usage        — GET /subscriptions/current/usage counts, near / over lists
* licence      — "elite" is a licence plan; activation sets the tier to elite
Prints ok/FAIL per check and exits non-zero on any failure.
"""
from __future__ import annotations

import asyncio
import io
import os
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if not os.environ.get("GRC_TEST_DB_PATH"):
    print("GRC_TEST_DB_PATH is required (a snapshot copy of grc_dev.db)")
    sys.exit(2)
if "grc_dev.db" in os.environ["GRC_TEST_DB_PATH"]:
    sys.exit("Refusing to run against grc_dev.db — pass a snapshot COPY.")

# ── Isolation: must happen before anything imports app.core.config ──────────
_tmpdir = tempfile.mkdtemp(prefix="planlimits-")
_DB = os.path.join(_tmpdir, "api.db")
shutil.copyfile(os.environ["GRC_TEST_DB_PATH"], _DB)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB}"
os.environ["SMTP_HOST"] = "smtp.invalid.test"
os.environ["SMTP_PORT"] = "2525"
os.environ["SMTP_USER"] = ""
os.environ["SMTP_PASSWORD"] = ""
os.environ["ENABLE_NOTIFICATION_EMAILS"] = "0"
os.environ["ENABLE_TRANSLATION_WORKER"] = "0"
os.environ.setdefault("ENABLE_THREAT_SCHEDULER", "0")

import aiosmtplib  # noqa: E402


async def _fake_send(*_a, **_k):
    return ({}, "250 OK (captured by selftest)")


aiosmtplib.send = _fake_send

import httpx  # noqa: E402
from sqlalchemy import select, update  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.main import create_application  # noqa: E402
from app.models.compliance import ComplianceAssessment  # noqa: E402
from app.models.framework import Framework, FrameworkControl  # noqa: E402
from app.models.subscription import Subscription, SubscriptionStatus, SubscriptionTier  # noqa: E402
from app.models.tenant import Tenant  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.models.vendor import Vendor  # noqa: E402
from app.services import ai_provider, email_service  # noqa: E402

assert settings.DATABASE_URL.endswith("api.db"), settings.DATABASE_URL
email_service.aiosmtplib.send = _fake_send

P = settings.API_V1_PREFIX
PW = "demo123"
FAILS: list[str] = []
PASSES = 0


def check(cond: bool, label: str, extra: object = "") -> None:
    global PASSES
    if cond:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILS.append(label)
        print(f"  FAIL {label} {str(extra)[:400]}")


def is_ar(text: str) -> bool:
    return any("؀" <= c <= "ۿ" for c in str(text))


def plan_limit(body, limit: str) -> bool:
    d = body.get("detail") if isinstance(body, dict) else None
    return isinstance(d, dict) and d.get("code") == "plan_limit" and d.get("limit") == limit


# ── Fixtures (written straight to the copy) ──────────────────────────────────

async def _password_hash() -> str:
    async with AsyncSessionLocal() as db:
        u = (await db.execute(select(User).where(User.email == "admin@demo.com"))).scalar_one()
        return u.hashed_password


async def make_tenant(slug: str, tier: SubscriptionTier, status=SubscriptionStatus.ACTIVE,
                      contributors: int = 0) -> tuple[str, str]:
    """Tenant + subscription + 1 tenant_admin (+ N-1 extra contributors). Returns
    (tenant_id, admin email). ``contributors`` counts the admin."""
    pw = await _password_hash()
    async with AsyncSessionLocal() as db:
        t = Tenant(name=f"Selftest {slug}", slug=slug, selected_framework_ids=[])
        db.add(t)
        await db.flush()
        db.add(Subscription(tenant_id=t.id, tier=tier, status=status, custom_limits={}))
        admin = f"admin@{slug}.selftest-grc.com"
        db.add(User(tenant_id=t.id, email=admin, hashed_password=pw, first_name="Admin",
                    last_name=slug, role=UserRole.TENANT_ADMIN, roles=["tenant_admin"],
                    is_active=True, is_verified=True))
        for i in range(max(0, contributors - 1)):
            db.add(User(tenant_id=t.id, email=f"c{i}@{slug}.selftest-grc.com", hashed_password=pw,
                        first_name="C", last_name=str(i), role=UserRole.RISK_MANAGER,
                        roles=["risk_manager"], is_active=True, is_verified=True))
        await db.commit()
        return t.id, admin


async def set_sub(tenant_id: str, **values) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(update(Subscription).where(Subscription.tenant_id == tenant_id).values(**values))
        await db.commit()


async def user_by_email(email: str) -> User | None:
    async with AsyncSessionLocal() as db:
        return (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()


async def small_frameworks(n: int) -> list[str]:
    """n built-in framework ids, fewest controls first (cheap assessment creation)."""
    from sqlalchemy import func
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(Framework.id, func.count(FrameworkControl.id).label("n"))
            .outerjoin(FrameworkControl, FrameworkControl.framework_id == Framework.id)
            .where(Framework.is_builtin == True)  # noqa: E712
            .group_by(Framework.id).order_by("n")
        )).all()
        return [r[0] for r in rows[:n]]


class Api:
    def __init__(self, c: httpx.AsyncClient):
        self.c = c
        self.tokens: dict[str, str] = {}

    async def login(self, email: str, pw: str = PW) -> str | None:
        r = await self.c.post(f"{P}/auth/login", json={"email": email, "password": pw})
        if r.status_code != 200 or "access_token" not in r.json():
            return None
        return r.json()["access_token"]

    async def req(self, method: str, path: str, who: str, lang: str | None = None, **kw):
        if who not in self.tokens:
            tok = await self.login(who, "super123" if who.startswith("superadmin@") else PW)
            assert tok, f"login failed for {who}"
            self.tokens[who] = tok
        h = {"Authorization": f"Bearer {self.tokens[who]}"}
        if lang:
            h["Accept-Language"] = lang
        r = await self.c.request(method, P + path, headers=h, **kw)
        try:
            body = r.json()
        except Exception:
            body = r.text
        return r.status_code, body


# ── Sections ─────────────────────────────────────────────────────────────────

async def contributors(api: Api) -> dict:
    print("[contributors]")
    # Growth tenant with 24 contributors (admin + 23).
    gid, gadmin = await make_tenant("pl-growth", SubscriptionTier.PROFESSIONAL, contributors=24)

    s, b = await api.req("POST", "/users/create", gadmin, json={
        "email": "c25@pl-growth.selftest-grc.com", "first_name": "C", "last_name": "25", "roles": ["risk_manager"]})
    check(s == 201, "25th contributor created on Growth", (s, b))

    s, b = await api.req("POST", "/users/create", gadmin, json={
        "email": "c26@pl-growth.selftest-grc.com", "first_name": "C", "last_name": "26", "roles": ["compliance_manager"]})
    d = b.get("detail") if isinstance(b, dict) else {}
    check(s == 402 and plan_limit(b, "max_contributors") and d.get("current") == 25 and d.get("max") == 25
          and d.get("tier") == "professional" and d.get("plan") == "Growth",
          "26th contributor refused: 402 plan_limit max_contributors 25/25", (s, b))
    check(await user_by_email("c26@pl-growth.selftest-grc.com") is None, "refused contributor was not created")

    s, b = await api.req("POST", "/users/create", gadmin, lang="fr", json={
        "email": "c26@pl-growth.selftest-grc.com", "first_name": "C", "last_name": "26", "roles": ["ciso"]})
    msg = (b.get("detail") or {}).get("message", "") if isinstance(b, dict) else ""
    check(s == 402 and "contributeurs" in msg and "25" in msg and plan_limit(b, "max_contributors"),
          "fr message translated, machine fields intact", b)
    s, b = await api.req("POST", "/users/create", gadmin, lang="ar", json={
        "email": "c26@pl-growth.selftest-grc.com", "first_name": "C", "last_name": "26", "roles": ["ciso"]})
    check(s == 402 and is_ar((b.get("detail") or {}).get("message", "")), "ar message translated", b)

    for role in ("viewer", "executive"):
        s, b = await api.req("POST", "/users/create", gadmin, json={
            "email": f"{role}@pl-growth.selftest-grc.com", "first_name": role, "last_name": "x", "roles": [role]})
        check(s == 201, f"{role} still allowed at the contributor cap", (s, b))
    s, b = await api.req("POST", "/users/auditors", gadmin, json={
        "email": "auditor@pl-growth.selftest-grc.com", "first_name": "Aud", "last_name": "x"})
    check(s == 201, "auditor still allowed at the contributor cap", (s, b))

    viewer = await user_by_email("viewer@pl-growth.selftest-grc.com")
    s, b = await api.req("PATCH", f"/users/{viewer.id}", gadmin, json={"roles": ["risk_manager"]})
    check(s == 402 and plan_limit(b, "max_contributors"), "role change viewer → risk_manager refused", (s, b))
    v2 = await user_by_email("viewer@pl-growth.selftest-grc.com")
    check(v2.role == UserRole.VIEWER, "refused role change left the role untouched", v2.role)

    c0 = await user_by_email("c0@pl-growth.selftest-grc.com")
    s, b = await api.req("PATCH", f"/users/{c0.id}", gadmin, json={"roles": ["compliance_manager"]})
    check(s == 200, "contributor → other contributor role allowed at the cap", (s, b))

    s, b = await api.req("PATCH", f"/users/{c0.id}", gadmin, json={"is_active": False})
    check(s == 200, "deactivating a contributor allowed", (s, b))
    s, b = await api.req("POST", "/users/create", gadmin, json={
        "email": "c27@pl-growth.selftest-grc.com", "first_name": "C", "last_name": "27", "roles": ["risk_manager"]})
    check(s == 201, "freed seat can be reused", (s, b))
    s, b = await api.req("PATCH", f"/users/{c0.id}", gadmin, json={"is_active": True})
    check(s == 402 and plan_limit(b, "max_contributors"), "re-activation over the cap refused", (s, b))
    c0b = await user_by_email("c0@pl-growth.selftest-grc.com")
    check(c0b.is_active is False, "refused re-activation left the account inactive")

    # Over-limit tenant keeps working: logins and existing pages are untouched.
    tok = await api.login("c1@pl-growth.selftest-grc.com")
    check(tok is not None, "existing contributor can still sign in at the cap")

    # custom_limits override (the super admin's custom deal).
    await set_sub(gid, custom_limits={"max_contributors": 27})
    s, b = await api.req("POST", "/users/create", gadmin, json={
        "email": "c28@pl-growth.selftest-grc.com", "first_name": "C", "last_name": "28", "roles": ["risk_manager"]})
    check(s == 201, "custom_limits max_contributors=27 lets the 26th in", (s, b))
    s, b = await api.req("POST", "/users/create", gadmin, json={
        "email": "c29@pl-growth.selftest-grc.com", "first_name": "C", "last_name": "29", "roles": ["risk_manager"]})
    check(s == 201, "... and the 27th", (s, b))
    s, b = await api.req("POST", "/users/create", gadmin, json={
        "email": "c30@pl-growth.selftest-grc.com", "first_name": "C", "last_name": "30", "roles": ["risk_manager"]})
    check(s == 402 and (b.get("detail") or {}).get("max") == 27, "... and refuses the 28th", (s, b))
    await set_sub(gid, custom_limits={})

    # A trial is Growth, even on an Enterprise row.
    tid, tadmin = await make_tenant("pl-trial", SubscriptionTier.ENTERPRISE,
                                    status=SubscriptionStatus.TRIALING, contributors=25)
    s, b = await api.req("POST", "/users/create", tadmin, json={
        "email": "c26@pl-trial.selftest-grc.com", "first_name": "C", "last_name": "26", "roles": ["risk_manager"]})
    check(s == 402 and plan_limit(b, "max_contributors"), "trialing Enterprise row is capped like Growth", (s, b))

    # Legacy starter = Growth (25, not the old numbers).
    sid, sadmin = await make_tenant("pl-starter", SubscriptionTier.STARTER, contributors=25)
    s, b = await api.req("POST", "/users/create", sadmin, json={
        "email": "c26@pl-starter.selftest-grc.com", "first_name": "C", "last_name": "26", "roles": ["risk_manager"]})
    check(s == 402 and (b.get("detail") or {}).get("max") == 25, "legacy starter capped at Growth's 25", (s, b))

    # Enterprise: unlimited.
    eid, eadmin = await make_tenant("pl-ent", SubscriptionTier.ENTERPRISE, contributors=30)
    s, b = await api.req("POST", "/users/create", eadmin, json={
        "email": "c31@pl-ent.selftest-grc.com", "first_name": "C", "last_name": "31", "roles": ["risk_manager"]})
    check(s == 201, "Enterprise: 31st contributor created (unlimited)", (s, b))

    # Super-admin create path is guarded too (when the seeded super admin can sign in).
    if await api.login("superadmin@platform.com", "super123"):
        s, b = await api.req("POST", "/admin/users", "superadmin@platform.com", json={
            "email": "sa26@pl-growth.selftest-grc.com", "first_name": "S", "last_name": "A",
            "role": "risk_manager", "tenant_id": gid})
        check(s == 402 and plan_limit(b, "max_contributors"), "super-admin create over the cap refused", (s, b))
        s, b = await api.req("POST", "/admin/users", "superadmin@platform.com", json={
            "email": "saviewer@pl-growth.selftest-grc.com", "first_name": "S", "last_name": "V",
            "role": "viewer", "tenant_id": gid})
        check(s in (200, 201), "super-admin create of a viewer allowed", (s, b))
        s, b = await api.req("PATCH", f"/admin/tenant-access/{gid}", "superadmin@platform.com",
                             json={"quotas": {"max_contributors": 40}})
        check(s == 200, "super admin sets a quota override via tenant-access", (s, b))
        async with AsyncSessionLocal() as db:
            sub = (await db.execute(select(Subscription).where(Subscription.tenant_id == gid))).scalar_one()
        check(sub.limits.get("max_contributors") == 40, "override stored in custom_limits", sub.custom_limits)
        s, b = await api.req("PATCH", f"/admin/tenant-access/{gid}", "superadmin@platform.com",
                             json={"quotas": {"max_contributors": None}})
        check(s == 200, "override removed with null", (s, b))
    else:
        print("  skip super-admin checks (seeded super admin password rotated on this snapshot)")

    await ldap(api, gid)
    return {"growth": (gid, gadmin), "enterprise": (eid, eadmin)}


async def ldap(api: Api, gid: str) -> None:
    print("[ldap auto-provisioning]")
    from app.services.directory_auth import DirectoryUser
    async with AsyncSessionLocal() as db:
        t = (await db.execute(select(Tenant).where(Tenant.id == gid))).scalar_one()
        t.settings = {"ldap": {"enabled": True, "server_uri": "ldap://dir.invalid.test",
                               "default_role": "risk_manager", "auto_create": True}}
        await db.commit()
    await set_sub(gid, custom_limits={"ad_ldap_sso": True})

    def fake_auth(username, password, cfg):
        return DirectoryUser(username=username, email=f"{username}@pl-growth.selftest-grc.com",
                             first_name="Dir", last_name=username, groups=[])

    with patch("app.api.v1.endpoints.sso.authenticate", fake_auth):
        r = await api.c.post(f"{P}/sso/ldap/login", json={
            "username": "newdir", "password": "x", "tenant_slug": "pl-growth"})
        body = r.json()
        d = body.get("detail") if isinstance(body, dict) else {}
        check(r.status_code == 402 and plan_limit(body, "max_contributors")
              and "contributor limit" in (d or {}).get("message", ""),
              "LDAP login that would create an over-cap contributor fails clearly", (r.status_code, body))
        check(await user_by_email("newdir@pl-growth.selftest-grc.com") is None, "no over-cap LDAP account was created")

        r = await api.c.post(f"{P}/sso/ldap/login", headers={"Accept-Language": "fr"}, json={
            "username": "newdir", "password": "x", "tenant_slug": "pl-growth"})
        check(r.status_code == 402 and "contributeurs" in str(r.json()), "LDAP refusal translated (fr)", r.text)

    # A free default role still provisions at the cap.
    async with AsyncSessionLocal() as db:
        t = (await db.execute(select(Tenant).where(Tenant.id == gid))).scalar_one()
        t.settings = {"ldap": {"enabled": True, "server_uri": "ldap://dir.invalid.test",
                               "default_role": "viewer", "auto_create": True,
                               "group_role_map": {"CN=GRC-Risk,OU=G,DC=x": "risk_manager"}}}
        await db.commit()

    def fake_auth_viewer(username, password, cfg):
        return DirectoryUser(username=username, email=f"{username}@pl-growth.selftest-grc.com",
                             first_name="Dir", last_name=username,
                             groups=["CN=Other,OU=G,DC=x"])

    def fake_auth_promoted(username, password, cfg):
        return DirectoryUser(username=username, email=f"{username}@pl-growth.selftest-grc.com",
                             first_name="Dir", last_name=username,
                             groups=["CN=GRC-Risk,OU=G,DC=x"])

    with patch("app.api.v1.endpoints.sso.authenticate", fake_auth_viewer):
        r = await api.c.post(f"{P}/sso/ldap/login", json={
            "username": "dirviewer", "password": "x", "tenant_slug": "pl-growth"})
        check(r.status_code == 200, "LDAP provisioning of a free-role user allowed at the cap", r.text[:300])
    from app.services.directory_auth import group_map_configured, resolve_ldap_config
    async with AsyncSessionLocal() as db:
        t = (await db.execute(select(Tenant).where(Tenant.id == gid))).scalar_one()
        mapped = group_map_configured(resolve_ldap_config(t.settings))
    if mapped:
        with patch("app.api.v1.endpoints.sso.authenticate", fake_auth_promoted):
            r = await api.c.post(f"{P}/sso/ldap/login", json={
                "username": "dirviewer", "password": "x", "tenant_slug": "pl-growth"})
            u = await user_by_email("dirviewer@pl-growth.selftest-grc.com")
            check(r.status_code == 200 and u.role == UserRole.VIEWER,
                  "LDAP promotion over the cap skipped, login still works", (r.status_code, u.role))
    else:
        print("  skip LDAP promotion check (group map key not recognised by this config)")
    await set_sub(gid, custom_limits={})


async def frameworks(api: Api, growth: tuple[str, str]) -> None:
    print("[frameworks]")
    gid, gadmin = growth
    fws = await small_frameworks(12)
    async with AsyncSessionLocal() as db:
        for fw in fws[:10]:
            db.add(ComplianceAssessment(tenant_id=gid, framework_id=fw, name="ST seeded",
                                        in_scope_assets=[], scope_type="tenant"))
        await db.commit()
    s, b = await api.req("POST", "/compliance/assessments", gadmin, json={
        "framework_id": fws[10], "name": "ST 11th"})
    check(s == 402 and plan_limit(b, "max_frameworks") and (b.get("detail") or {}).get("current") == 10,
          "11th NEW framework refused (402 max_frameworks 10/10)", (s, b))
    s, b = await api.req("POST", "/compliance/assessments", gadmin, lang="fr", json={
        "framework_id": fws[10], "name": "ST 11th"})
    check(s == 402 and "référentiels" in str(b), "framework refusal translated (fr)", b)
    s, b = await api.req("POST", "/compliance/assessments", gadmin, json={
        "framework_id": fws[0], "name": "ST again"})
    check(s == 201, "assessment on an already-assessed framework still allowed", (s, str(b)[:200]))
    s, _ = await api.req("GET", "/compliance/assessments", gadmin)
    check(s == 200, "existing assessments still listed", s)


async def vendors(api: Api, growth: tuple[str, str]) -> None:
    print("[vendors]")
    gid, gadmin = growth
    async with AsyncSessionLocal() as db:
        for i in range(99):
            db.add(Vendor(tenant_id=gid, name=f"ST vendor {i}"))
        await db.commit()
    s, b = await api.req("POST", "/vendors", gadmin, json={"name": "ST vendor 100"})
    check(s == 201, "100th vendor created", (s, str(b)[:200]))
    s, b = await api.req("POST", "/vendors", gadmin, json={"name": "ST vendor 101"})
    check(s == 402 and plan_limit(b, "max_vendors") and (b.get("detail") or {}).get("max") == 100,
          "101st vendor refused (402 max_vendors)", (s, b))
    csv = b"name,industry\nImp A,IT\nImp B,IT\nImp C,IT\n"
    s, b = await api.req("POST", "/data/import/vendors", gadmin,
                         files={"file": ("v.csv", io.BytesIO(csv), "text/csv")})
    check(s == 402 and plan_limit(b, "max_vendors"), "CSV import at the cap refused", (s, b))
    await set_sub(gid, custom_limits={"max_vendors": 101})
    s, b = await api.req("POST", "/data/import/vendors", gadmin,
                         files={"file": ("v.csv", io.BytesIO(csv), "text/csv")})
    check(s == 200 and b.get("created") == 1 and len(b.get("errors", [])) == 2
          and (b.get("plan_limit") or {}).get("refused_rows") == 2,
          "partial import: 1 created, 2 rows refused and reported", (s, b))
    s, b = await api.req("GET", "/vendors", gadmin)
    check(s == 200, "vendor list still works over/at the cap", s)
    await set_sub(gid, custom_limits={})


async def ai(api: Api, growth: tuple[str, str], enterprise: tuple[str, str]) -> None:
    print("[ai copilot]")

    async def no_provider(cfg):
        raise ai_provider.AIUnavailable("stubbed by selftest")

    chat = {"messages": [{"role": "user", "content": "What is ISO 27001?"}]}
    with patch.object(ai_provider, "preflight", no_provider):
        s, b = await api.req("POST", "/ai/chat", growth[1], json=chat)
        d = b.get("detail") if isinstance(b, dict) else {}
        check(s == 402 and d.get("feature") == "ai_copilot" and d.get("pack") == "enterprise",
              "Growth: /ai/chat refused 402 (ai_copilot, pack enterprise)", (s, b))
        s, b = await api.req("POST", "/ai/chat", growth[1], lang="fr", json=chat)
        check(s == 402 and "Entreprise" in str(b), "copilot refusal translated (fr)", b)
        s, b = await api.req("POST", "/ai/chat", enterprise[1], json=chat)
        check(s != 402, "Enterprise: /ai/chat passes the plan gate", (s, b))
        s, b = await api.req("POST", "/ai/generate-document", growth[1], json={
            "document_type": "information_security_policy", "org_name": "ST", "industry": "finance"})
        check(s != 402, "Growth: document generation is not gated", (s, b))
    s, b = await api.req("GET", "/subscriptions/current/entitlements", growth[1])
    check(s == 200 and b["features"].get("ai_copilot") is False, "entitlements: ai_copilot false on Growth", b)


async def usage(api: Api, growth: tuple[str, str], enterprise: tuple[str, str]) -> None:
    print("[usage]")
    s, b = await api.req("GET", "/subscriptions/current/usage", growth[1])
    u = b.get("usage", {}) if isinstance(b, dict) else {}
    check(s == 200 and b.get("tier") == "professional" and b.get("plan") == "Growth"
          and b["limits"]["max_contributors"] == 25 and b["limits"]["max_frameworks"] == 10
          and b["limits"]["max_vendors"] == 100 and b["limits"]["ai_copilot"] is False,
          "usage: Growth limits", b)
    check(u.get("frameworks") == 10 and u.get("vendors") == 101 and u.get("contributors", 0) >= 25,
          "usage: live counts", u)
    check("frameworks" in b.get("near_limit", []) and "vendors" in b.get("over_limit", [])
          and "contributors" in b.get("over_limit", []) + b.get("near_limit", []),
          "usage: near_limit / over_limit", b)
    s, b = await api.req("GET", "/subscriptions/current/usage", enterprise[1])
    check(s == 200 and b["limits"]["max_contributors"] == -1 and not b["near_limit"] and not b["over_limit"]
          and b["limits"]["ai_copilot"] is True and b["plan"] == "Enterprise",
          "usage: Enterprise unlimited, nothing flagged", b)
    s, b = await api.req("GET", "/subscriptions/plans", growth[1])
    names = {p["tier"]: p["name"] for p in b} if s == 200 else {}
    check(names.get("professional") == "Growth" and names.get("elite") == "Elite",
          "plans list uses marketing names", names)


async def licence(api: Api, growth: tuple[str, str]) -> None:
    print("[licence]")
    from app.core.licensing import (LICENSE_PLANS, generate_keypair, normalize_plan,
                                    sign_license, verify_license)
    check("elite" in LICENSE_PLANS and normalize_plan("elite") == "elite"
          and normalize_plan("ELITE ") == "elite", "elite is a licence plan", LICENSE_PLANS)
    check(normalize_plan("bogus") == "enterprise", "unknown plan still falls back to enterprise")
    priv, pub = generate_keypair()
    now = datetime.now(timezone.utc)
    key = sign_license({
        "lid": str(uuid.uuid4()), "product": "grc-platform", "customer": "ST", "email": "st@x.test",
        "plan": "elite", "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
    }, priv)
    check(verify_license(key, pub).get("plan") == "elite", "elite key verifies with plan elite")
    gid, gadmin = growth
    with patch("app.api.v1.endpoints.license.enforcement_enabled", lambda: True), \
         patch("app.api.v1.endpoints.license.effective_public_key", lambda: pub):
        s, b = await api.req("POST", "/license/activate", gadmin, json={"license_key": key})
    async with AsyncSessionLocal() as db:
        sub = (await db.execute(select(Subscription).where(Subscription.tenant_id == gid))).scalar_one()
    check(s == 200 and (b or {}).get("plan") == "elite", "activation reports plan elite", (s, b))
    check(sub.tier == SubscriptionTier.ELITE and sub.status == SubscriptionStatus.ACTIVE,
          "activation set the tenant's tier to elite", (sub.tier, sub.status))
    check(sub.has_feature("cve_knowledge_base") and sub.limits["max_contributors"] == -1,
          "elite unlocks Elite features + unlimited quotas")


async def unit() -> None:
    print("[unit]")
    from app.models.subscription import TIER_LIMITS, togglable_features
    check(TIER_LIMITS[SubscriptionTier.PROFESSIONAL]["max_contributors"] == 25
          and TIER_LIMITS[SubscriptionTier.ELITE]["max_contributors"] == -1
          and TIER_LIMITS[SubscriptionTier.ENTERPRISE]["max_vendors"] == -1,
          "TIER_LIMITS quotas")
    keys = {k for k, _ in togglable_features()}
    check("max_contributors" not in keys and "ai_copilot" in keys, "quotas are not toggles; ai_copilot is")
    s = Subscription(tenant_id="x", tier=SubscriptionTier.ELITE, status=SubscriptionStatus.TRIALING,
                     custom_limits={})
    check(s.plan_tier == SubscriptionTier.ELITE, "an Elite trial stays Elite")


async def main_async() -> None:
    await unit()
    app = create_application()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://selftest") as c:
        api = Api(c)
        t = await contributors(api)
        await frameworks(api, t["growth"])
        await vendors(api, t["growth"])
        await ai(api, t["growth"], t["enterprise"])
        await usage(api, t["growth"], t["enterprise"])
        await licence(api, t["growth"])


def main() -> None:
    try:
        asyncio.run(main_async())
    finally:
        shutil.rmtree(_tmpdir, ignore_errors=True)
    print(f"\n{PASSES} passed, {len(FAILS)} failed")
    if FAILS:
        for f in FAILS:
            print("  -", f)
        sys.exit(1)


if __name__ == "__main__":
    main()
