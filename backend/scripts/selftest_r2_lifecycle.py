"""Self-test for the R2 lifecycle work (create → maintain → close/retire per GRC area).

Runs IN-PROCESS (httpx ASGITransport — no port, no lifespan, no schedulers) against a
SNAPSHOT COPY of the database. Never point it at the live grc_dev.db: it creates
users, risks, acceptances and more on the copy.

    cd backend
    venv/bin/python -m scripts.migrate_r2_lifecycle --db <copy.db> --apply
    DATABASE_URL=sqlite+aiosqlite:///<copy.db> ENABLE_TRANSLATION_WORKER=0 \\
        venv/bin/python -m scripts.selftest_r2_lifecycle

The demo tenant (admin@demo.com / ciso@demo.com, both CISO) must exist in the copy.
One user per extra role (riskmanager@demo.com, businessowner@demo.com, …) is created
on the copy if missing, with the demo password.

Sections
* risks      — status kept at creation, `closed` refused; edit / re-score; perimeter
               403; close → delete refused; reopen needs a reason; versions,
               lifecycle, diff; close/reopen in the activity log; delete is CISO-only
* scenarios  — linked incidents kept at creation; edit re-scores the register entry
* acceptance — tenant-checked targets; four-eyes; approve → risks accepted; reject
               and revoke need a reason; revoke / expiry restore the prior status;
               overlapping acceptances keep a risk accepted
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

DB_URL = os.environ.get("DATABASE_URL", "")
if "grc_dev.db" in DB_URL or not DB_URL:
    sys.exit("Refusing to run: set DATABASE_URL to a snapshot COPY of the database.")
os.environ.setdefault("ENABLE_TRANSLATION_WORKER", "0")

import httpx  # noqa: E402
from sqlalchemy import select, update  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.main import create_application  # noqa: E402
from app.models.user import User  # noqa: E402

assert "grc_dev.db" not in settings.DATABASE_URL, settings.DATABASE_URL
P = settings.API_V1_PREFIX
PW = "demo123"
EXTRA_ROLES = ("risk_manager", "business_owner", "control_owner", "compliance_manager",
               "vendor_manager", "policy_manager", "viewer")

FAILS: list[str] = []
PASSES = 0


def check(cond: bool, label: str, extra: object = "") -> None:
    global PASSES
    if cond:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILS.append(label)
        print(f"  FAIL {label} {str(extra)[:300]}")


def role_email(role: str) -> str:
    return f"{role.replace('_', '')}@demo.com"


async def ensure_role_users() -> None:
    """Clone the demo CISO (same tenant, same password hash) once per extra role."""
    async with AsyncSessionLocal() as db:
        ciso = (await db.execute(select(User).where(User.email == "ciso@demo.com"))).scalar_one()
        for role in EXTRA_ROLES:
            if (await db.execute(select(User).where(User.email == role_email(role)))).scalar_one_or_none():
                continue
            db.add(User(
                id=str(uuid.uuid4()), tenant_id=ciso.tenant_id, email=role_email(role),
                hashed_password=ciso.hashed_password, first_name=role.replace("_", " ").title(),
                last_name="Selftest", role=role, roles=[role], is_active=True, is_verified=True,
            ))
        # Elite-gated screens (risk treatment, …) are exercised too.
        await db.execute(update(User).where(User.tenant_id == ciso.tenant_id).values(elite_access=True))
        await db.commit()


class Api:
    def __init__(self, c: httpx.AsyncClient):
        self.c = c
        self.tokens: dict[str, str] = {}

    async def as_(self, email: str) -> dict:
        if email not in self.tokens:
            r = await self.c.post(f"{P}/auth/login", json={"email": email, "password": PW})
            assert r.status_code == 200, (email, r.status_code, r.text[:200])
            self.tokens[email] = r.json()["access_token"]
        return {"Authorization": f"Bearer {self.tokens[email]}"}

    async def req(self, method: str, path: str, who: str = "ciso@demo.com", lang: str | None = None, **kw):
        h = await self.as_(who)
        if lang:
            h["Accept-Language"] = lang
        r = await self.c.request(method, P + path, headers=h, **kw)
        try:
            body = r.json()
        except Exception:
            body = r.text
        return r.status_code, body


# ---------------------------------------------------------------------------
async def risks(api: Api) -> None:
    print("[risks]")
    s, b = await api.req("POST", "/risks", json={"title": "ST assessed", "status": "assessed"})
    check(s == 201 and b["status"] == "assessed", "status chosen at creation kept", b)
    s, b2 = await api.req("POST", "/risks", json={"title": "ST default"})
    check(s == 201 and b2["status"] == "identified", "no status → model default", b2)
    s, b3 = await api.req("POST", "/risks", lang="fr", json={"title": "ST closed", "status": "closed"})
    check(s == 422 and "fermé" in str(b3), "closed at creation → localized 422", b3)
    rid = b["id"]

    s, r = await api.req("PATCH", f"/risks/{rid}", who=role_email("risk_manager"), json={
        "likelihood": 4, "impact": 5, "residual_likelihood": 2, "residual_impact": 3})
    check(s == 200 and r["inherent_risk_score"] == 20 and r["residual_risk_score"] == 6, "risk_manager re-scores", r)
    s, r = await api.req("PATCH", f"/risks/{rid}", who=role_email("business_owner"), json={"title": "x"})
    check(s == 403, "business_owner outside perimeter → 403", r)

    s, r = await api.req("PATCH", f"/risks/{rid}", json={"status": "closed"})
    check(s == 200 and r["status"] == "closed", "close")
    s, _ = await api.req("DELETE", f"/risks/{rid}")
    check(s == 409, "closed risk cannot be deleted")
    s, _ = await api.req("PATCH", f"/risks/{rid}", json={"status": "assessed"})
    check(s == 422, "reopen without reason → 422")
    s, r = await api.req("PATCH", f"/risks/{rid}", json={"status": "assessed", "reopen_reason": "pentest"})
    check(s == 200 and r["status"] == "assessed" and r["reopen_reason"] == "pentest", "reopen with reason")

    s, vs = await api.req("GET", f"/risks/{rid}/versions")
    check(s == 200 and len(vs) == 3, "3 versions archived", len(vs) if isinstance(vs, list) else vs)
    s, lc = await api.req("GET", f"/risks/{rid}/lifecycle")
    check([(x["transition_from"], x["transition_to"]) for x in lc] == [("assessed", "closed"), ("closed", "assessed")]
          and lc[-1]["change_reason"] == "pentest", "lifecycle + reopen reason", lc)
    s, d = await api.req("GET", f"/risks/{rid}/versions/diff", params={"from_version": 1, "to_version": 2})
    check(s == 200 and {c["field"] for c in d} >= {"likelihood", "impact"}, "diff v1→v2 = re-score", d)
    s, d = await api.req("GET", f"/risks/{rid}/versions/diff", params={"from_version": 3, "to_version": 0})
    check(s == 200 and any(c["field"] == "status" for c in d), "diff v3→live", d)

    s, logs = await api.req("GET", "/activity-log", params={"entity_type": "risk", "page_size": 50})
    items = logs.get("items", logs) if isinstance(logs, dict) else logs
    actions = {(x.get("action"), x.get("entity_id")) for x in (items or []) if isinstance(x, dict)}
    check(("close", rid) in actions and ("reopen", rid) in actions, "close + reopen in the activity log",
          [a for a in actions if a[1] == rid])

    s, ents = await api.req("GET", "/asset-graph/org-entities")
    if s == 200 and ents:
        s, r = await api.req("POST", "/risks", json={"title": "ST scoped", "org_entity_id": ents[0]["id"]})
        check(r.get("org_entity_id") == ents[0]["id"], "org_entity_id returned by the API", r)
        await api.req("DELETE", f"/risks/{r['id']}")

    s, _ = await api.req("DELETE", f"/risks/{rid}", who=role_email("risk_manager"))
    check(s == 403, "delete is CISO-only")
    s, _ = await api.req("DELETE", f"/risks/{rid}")
    check(s == 204, "CISO deletes an open risk")
    await api.req("DELETE", f"/risks/{b2['id']}")


async def scenarios(api: Api) -> dict:
    print("[scenarios]")
    s, inc = await api.req("POST", "/incidents", json={"title": "ST incident", "category": "malware", "severity": "high"})
    iid = inc["id"]
    s, sc = await api.req("POST", "/risk-scenarios", json={
        "name": "ST scenario", "current_probability": 3, "current_impact": 3, "linked_incident_ids": [iid]})
    check(s == 201 and sc["linked_incident_ids"] == [iid], "linked incidents kept at creation", sc)
    s, _ = await api.req("POST", "/risk-scenarios", json={"name": "ST bad", "linked_incident_ids": ["nope"]})
    check(s == 422, "unknown incident refused")
    s, _ = await api.req("PATCH", f"/risk-scenarios/{sc['id']}", who=role_email("risk_manager"),
                         json={"current_probability": 5, "current_impact": 4})
    s, lr = await api.req("GET", f"/risks/{sc['linked_risk_id']}")
    check(lr["likelihood"] == 5 and lr["impact"] == 4, "edit re-scores the register entry", lr)
    return sc


async def acceptances(api: Api, sc: dict) -> None:
    print("[acceptances]")
    _, r = await api.req("POST", "/risks", json={"title": "ST accepted risk", "status": "assessed"})
    rid, srid = r["id"], sc["linked_risk_id"]
    status = lambda x: api.req("GET", f"/risks/{x}")  # noqa: E731

    s, _ = await api.req("POST", "/security/acceptances", json={
        "name": "bad", "justification": "j", "expiration_date": "2030-01-01", "risk_ids": ["nope"]})
    check(s == 422, "unknown risk id refused")
    s, a = await api.req("POST", "/security/acceptances", json={
        "name": "ST accept", "justification": "j", "expiration_date": "2030-01-01",
        "risk_ids": [rid], "risk_scenario_ids": [sc["id"]]})
    check(s == 201 and a["risk_ids"] == [rid], "acceptance created with targets")
    aid = a["id"]
    s, _ = await api.req("PATCH", f"/security/acceptances/{aid}/approve")
    check(s == 403, "requester cannot approve (four-eyes)")
    s, _ = await api.req("PATCH", f"/security/acceptances/{aid}/reject", json={"reason": "no"})
    check(s == 403, "requester cannot reject (four-eyes)")
    s, _ = await api.req("PATCH", f"/security/acceptances/{aid}/approve", who=role_email("risk_manager"))
    check(s == 403, "approve is CISO-only")
    s, _ = await api.req("PATCH", f"/security/acceptances/{aid}/revoke", who="admin@demo.com", json={"reason": "x"})
    check(s == 409, "pending cannot be revoked")
    s, _ = await api.req("PATCH", f"/security/acceptances/{aid}/approve", who="admin@demo.com")
    check(s == 200, "second CISO approves")
    check((await status(rid))[1]["status"] == "accepted", "covered risk → accepted")
    check((await status(srid))[1]["status"] == "accepted", "scenario's register entry → accepted")
    s, _ = await api.req("PATCH", f"/security/acceptances/{aid}/revoke", who="admin@demo.com", json={"reason": " "})
    check(s == 422, "revoke needs a reason")
    s, ra = await api.req("PATCH", f"/security/acceptances/{aid}/revoke", who="admin@demo.com", json={"reason": "changed"})
    check(s == 200 and ra["status"] == "revoked" and ra["revocation_reason"] == "changed", "revoked with reason", ra)
    check((await status(rid))[1]["status"] == "assessed", "revoke restores prior status (assessed)")
    check((await status(srid))[1]["status"] == "identified", "revoke restores prior status (identified)")

    s, b = await api.req("POST", "/security/acceptances", json={
        "name": "ST reject", "justification": "j", "expiration_date": "2030-01-01", "risk_ids": [rid]})
    s, _ = await api.req("PATCH", f"/security/acceptances/{b['id']}/reject", who="admin@demo.com", json={"reason": ""})
    check(s == 422, "reject needs a reason")
    s, rb = await api.req("PATCH", f"/security/acceptances/{b['id']}/reject", who="admin@demo.com", json={"reason": "weak"})
    check(s == 200 and rb["status"] == "rejected" and rb["rejection_reason"] == "weak", "rejected with reason")
    check((await status(rid))[1]["status"] == "assessed", "reject leaves the risk alone")

    ids = []
    for n in ("ST c1", "ST c2"):
        _, c = await api.req("POST", "/security/acceptances", json={
            "name": n, "justification": "j", "expiration_date": "2030-01-01", "risk_ids": [rid]})
        await api.req("PATCH", f"/security/acceptances/{c['id']}/approve", who="admin@demo.com")
        ids.append(c["id"])
    from app.models.security_exception import RiskAcceptance
    for i, aid_ in enumerate(ids):
        async with AsyncSessionLocal() as db:
            await db.execute(update(RiskAcceptance).where(RiskAcceptance.id == aid_).values(expiration_date="2020-01-01"))
            await db.commit()
        s, lst = await api.req("GET", "/security/acceptances")
        check(next(x for x in lst if x["id"] == aid_)["status"] == "expired", f"c{i + 1} expires on read")
        want = "accepted" if i == 0 else "assessed"
        check((await status(rid))[1]["status"] == want, f"after c{i + 1} expiry risk is {want}")


async def http_tests() -> None:
    from app.core.rate_limit import limiter
    limiter.enabled = False
    await ensure_role_users()
    app = create_application()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=120) as c:
        api = Api(c)
        await risks(api)
        sc = await scenarios(api)
        await acceptances(api, sc)


def main() -> None:
    asyncio.run(http_tests())
    print(f"\n{PASSES} passed, {len(FAILS)} failed")
    if FAILS:
        for f in FAILS:
            print("  -", f)
        sys.exit(1)


if __name__ == "__main__":
    main()
