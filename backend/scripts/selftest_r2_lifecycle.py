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
* vendors    — partial PATCH keeps untouched fields; ending a relationship only via
               offboard (date + reason, logged); reactivation clears it; prescreen and
               approved AI analysis kept as assessments, score follows the latest;
               delete refused once a contract carries a CISO decision
* policies   — nothing created approved; transitions enforced; approved/published
               need the current version approved by a non-author (four-eyes, also
               after restore); a new version sends the policy back to review;
               my-attestations for any role + idempotent acknowledge; review and
               overdue-acknowledgement reminders; publish sets the next review date
               (a hand-set one is kept); mark as reviewed (comment required,
               published only) moves it, keeps a history, answers the reminders
* compliance — control_owner reads and self-assesses only rows they own (no
               reassignment); compliance_manager acts tenant-wide and creates
               assessments; evidence validity flags + 30/7/0-day reminders
               (the AI merge itself: scripts/selftest_compliance_merge.py)
* follow-ups — user directory for pickers (not auditors), target_over_appetite
               returned, compliance readable by every /compliance role, read-only
               profiles may acknowledge their own policies and nothing else
* audits     — an action raised for a recommendation is linked to its finding:
               finding roll-up counts it and the generated audit report's
               « plan d'action » section lists it
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
               "vendor_manager", "policy_manager", "viewer", "executive")

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


async def vendors(api: Api) -> None:
    print("[vendors]")
    vm = role_email("vendor_manager")
    s, v = await api.req("POST", "/vendors", who=vm, json={
        "name": "ST Vendor", "country": "TN", "risk_tier": "medium", "status": "onboarding",
        "has_data_processing_agreement": True, "contract_expiry": "2027-01-31",
        "primary_contact_name": "Ali", "primary_contact_email": "ali@example.com"})
    check(s == 201 and v["primary_contact_email"] == "ali@example.com", "contact returned on create", v)
    vid = v["id"]
    s, u = await api.req("PATCH", f"/vendors/{vid}", who=vm, json={"risk_tier": "high"})
    check(s == 200 and u["risk_tier"] == "high" and u["status"] == "onboarding"
          and u["has_data_processing_agreement"] is True and u["contract_expiry"] == "2027-01-31"
          and u["primary_contact_name"] == "Ali", "partial PATCH re-tiers, keeps the rest", u)
    s, u = await api.req("PATCH", f"/vendors/{vid}", who=vm, json={"contract_expiry": "2028-06-30", "status": "active"})
    check(s == 200 and u["contract_expiry"] == "2028-06-30" and u["status"] == "active", "renewal expiry + status")
    s, b = await api.req("PATCH", f"/vendors/{vid}", who=vm, lang="fr", json={"status": "inactive"})
    check(s == 422 and "relation" in str(b), "PATCH to inactive refused → offboard (fr)", b)
    s, _ = await api.req("PATCH", f"/vendors/{vid}", who=role_email("risk_manager"), json={"risk_tier": "low"})
    check(s == 403, "risk_manager cannot edit a vendor")

    s, _ = await api.req("POST", f"/vendors/{vid}/offboard", who=vm, json={"effective_date": "2026-12-31", "reason": " "})
    check(s == 422, "offboard needs a reason")
    s, _ = await api.req("POST", f"/vendors/{vid}/offboard", who=vm, json={"effective_date": "31/12/2026", "reason": "x"})
    check(s == 422, "offboard needs an ISO date")
    s, o = await api.req("POST", f"/vendors/{vid}/offboard", who=vm, json={
        "status": "offboarding", "effective_date": "2026-12-31", "reason": "Contract not renewed"})
    check(s == 200 and o["status"] == "offboarding" and o["offboarded_at"] == "2026-12-31"
          and o["offboarding_reason"] == "Contract not renewed", "offboarding recorded", o)
    s, o = await api.req("POST", f"/vendors/{vid}/offboard", who=vm, json={
        "status": "inactive", "effective_date": "2027-01-15", "reason": "Exit complete"})
    check(s == 200 and o["status"] == "inactive", "offboarding → inactive")
    s, _ = await api.req("POST", f"/vendors/{vid}/offboard", who=vm, json={"effective_date": "2027-01-16", "reason": "again"})
    check(s == 409, "already inactive → 409")
    s, logs = await api.req("GET", "/activity-log", params={"entity_type": "vendor", "page_size": 50})
    items = logs.get("items", logs) if isinstance(logs, dict) else logs
    check(any(x.get("action") == "offboard" and x.get("entity_id") == vid for x in items or []),
          "offboard in the activity log")
    s, r = await api.req("PATCH", f"/vendors/{vid}", who=vm, json={"status": "active"})
    check(s == 200 and r["status"] == "active" and r["offboarded_at"] is None, "reactivation clears offboarding")

    s, a = await api.req("POST", f"/vendors/{vid}/assessments", who=vm, json={
        "answers": {"Q1": "yes", "Q2": "no"}, "initial_risk_score": 6.5, "risk_level": "high",
        "summary": "weak DR", "strengths": ["ISO"], "concerns": ["DR"], "red_flags": [], "recommendations": ["test DR"]})
    check(s == 201 and a["applied_risk_score"] == 26 and a["status"] == "approved", "prescreen kept, ×4 applied", a)
    s, vv = await api.req("GET", f"/vendors/{vid}")
    check(vv["risk_score"] == 26, "vendor score = latest approved prescreen")
    s, _ = await api.req("POST", f"/vendors/{vid}/approve-analysis", who=vm, json={"risk_score": 4, "analysis_notes": "Score: 4/10 report"})
    s, hist = await api.req("GET", f"/vendors/{vid}/assessments")
    check(s == 200 and [h["kind"] for h in hist] == ["ai_analysis", "prescreen"]
          and hist[0]["narrative"] == "Score: 4/10 report", "AI analysis kept as history, newest first", hist)
    s, vv = await api.req("GET", f"/vendors/{vid}")
    check(vv["risk_score"] == 16, "vendor score = latest approved analysis, on the register's 1–40 scale (4/10 × 4)")

    from app.models.vendor import VendorContract
    async with AsyncSessionLocal() as db:
        db.add(VendorContract(vendor_id=vid, file_name="c.pdf", file_path="/nonexistent/c.pdf",
                              validation_status="approved", ciso_reviewed_at="2026-10-18"))
        await db.commit()
    s, b = await api.req("DELETE", f"/vendors/{vid}", who=vm)
    check(s == 409, "delete refused: contract carries a CISO decision", b)
    s, v2 = await api.req("POST", "/vendors", who=vm, json={"name": "ST Vendor 2"})
    s, _ = await api.req("DELETE", f"/vendors/{v2['id']}", who=vm)
    check(s == 204, "vendor without records deletes")


async def policies(api: Api) -> None:
    print("[policies]")
    # The employee: any non-manager role (viewer is a read-only demo role).
    pm, viewer = role_email("policy_manager"), role_email("business_owner")
    s, b = await api.req("POST", "/policies", who=pm, json={"title": "ST bad", "status": "published", "content": "x"})
    check(s == 422, "cannot create a policy already published", b)
    s, p = await api.req("POST", "/policies", who=pm, json={"title": "ST Acceptable Use", "content": "Be nice."})
    pid = p["id"]
    check(s == 201 and p["status"] == "draft" and "in_review" in p["allowed_transitions"]
          and "approved" not in p["allowed_transitions"], "draft offers review, not approval", p.get("allowed_transitions"))
    s, b = await api.req("PATCH", f"/policies/{pid}", who=pm, lang="fr", json={"status": "published"})
    check(s == 409 and "politique" in str(b), "draft → published refused (fr)", b)
    s, b = await api.req("POST", f"/policies/{pid}/review", who=pm, json={"comment": "too early"})
    check(s == 409, "a draft cannot be marked as reviewed", b)
    s, p = await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "in_review"})
    check(s == 200 and p["status"] == "in_review", "draft → in_review")
    s, _ = await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "approved"})
    check(s == 409, "approve refused while the version is unapproved")
    _, vs = await api.req("GET", f"/policies/{pid}/versions")
    vid = vs[0]["id"]
    s, _ = await api.req("PATCH", f"/policies/{pid}/versions/{vid}/approve", who=pm)
    check(s == 403, "author cannot approve own version (four-eyes)")
    s, v = await api.req("PATCH", f"/policies/{pid}/versions/{vid}/approve")
    check(s == 200 and v["approved_by_id"], "second person approves the version")
    s, _ = await api.req("PATCH", f"/policies/{pid}/versions/{vid}/approve", who="admin@demo.com")
    check(s == 409, "already approved → 409")
    s, p = await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "approved"})
    check(s == 200 and p["current_version_approved"] and "published" in p["allowed_transitions"], "in_review → approved")
    s, p = await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "published"})
    check(s == 200 and p["status"] == "published", "approved → published")
    from app.api.v1.endpoints.policies import _add_months
    from datetime import date as _date
    in_a_year = _add_months(_date.today(), 12).isoformat()
    check(p["next_review_date"] == in_a_year and not p["review_due"],
          "publish sets next review = today + frequency", p.get("next_review_date"))

    async with AsyncSessionLocal() as db:
        viewer_id = (await db.execute(select(User.id).where(User.email == viewer))).scalar_one()
    s, atts = await api.req("POST", f"/policies/{pid}/attestations", who=pm, json={"user_ids": [viewer_id], "due_date": "2020-01-01"})
    check(s == 201 and len(atts) == 1, "attestation requested")
    aid = atts[0]["id"]
    s, mine = await api.req("GET", "/policies/my-attestations", who=viewer)
    mine_row = next((m for m in mine if m["id"] == aid), None) if s == 200 else None
    check(mine_row is not None and mine_row["content"] == "Be nice." and mine_row["overdue"],
          "employee sees it in my-attestations, with text, overdue", mine)

    from app.services.notification_generator import run_all_checks
    from app.models.policy import Policy
    from app.models.notification import Notification
    async with AsyncSessionLocal() as db:
        tid = (await db.execute(select(Policy.tenant_id).where(Policy.id == pid))).scalar_one()
        await db.execute(update(Policy).where(Policy.id == pid).values(next_review_date="2020-01-01"))
        await db.commit()
        res = await run_all_checks(db, tenant_id=tid)
        keys = {n.title_key for n in (await db.execute(select(Notification).where(
            Notification.tenant_id == tid, Notification.title_key.in_([
                "notifications.policy_review_overdue.title", "notifications.attestation_overdue.title"])))).scalars()}
    check(res.get("policy_reviews", 0) >= 1 and res.get("overdue_attestations", 0) >= 1
          and len(keys) == 2, "review + overdue-acknowledgement reminders created", res)

    # Periodic review (follow-up A-2): due → mark as reviewed → date moves, reminder stops.
    _, p = await api.req("GET", f"/policies/{pid}")
    check(p["review_due"], "past review date → review due")
    s, b = await api.req("POST", f"/policies/{pid}/review", who=pm, lang="fr", json={"comment": "  "})
    check(s == 422 and "commentaire" in str(b), "review without a comment refused (fr)", b)
    s, _ = await api.req("POST", f"/policies/{pid}/review", who=viewer, json={"comment": "ok"})
    check(s == 403, "an employee cannot mark a policy reviewed")
    s, p = await api.req("POST", f"/policies/{pid}/review", who=pm, json={"comment": "Still fit for purpose."})
    check(s == 200 and p["next_review_date"] == in_a_year and not p["review_due"]
          and p["last_review_comment"] == "Still fit for purpose." and p["last_reviewed_by_name"],
          "mark as reviewed moves the date and records who/why", p)
    s, hist = await api.req("GET", f"/policies/{pid}/reviews", who=viewer)
    check(s == 200 and len(hist) == 1 and hist[0]["previous_review_date"] == "2020-01-01"
          and hist[0]["next_review_date"] == in_a_year, "review history", hist)
    async with AsyncSessionLocal() as db:
        unread = (await db.execute(select(Notification).where(
            Notification.tenant_id == tid, Notification.status == "unread",
            Notification.title_key == "notifications.policy_review_overdue.title"))).scalars().all()
        unread = [n for n in unread if (n.data or {}).get("entity_id") == pid]
        res2 = await run_all_checks(db, tenant_id=tid)
        again = (await db.execute(select(Notification).where(
            Notification.tenant_id == tid, Notification.type == "policy_review_due"))).scalars().all()
        fresh = [n for n in again if (n.data or {}).get("entity_id") == pid and n.status.value == "unread"]
    check(not unread and not fresh, "review answers the reminders; no new one", res2)

    s, a = await api.req("PATCH", f"/policies/{pid}/attestations/{aid}/acknowledge", who=viewer)
    check(s == 200 and a["status"] == "acknowledged", "employee acknowledges")
    s, a2 = await api.req("PATCH", f"/policies/{pid}/attestations/{aid}/acknowledge", who=viewer)
    check(s == 200 and a2["acknowledged_at"] == a["acknowledged_at"], "acknowledge is idempotent")
    s, _ = await api.req("PATCH", f"/policies/{pid}/attestations/{aid}/acknowledge", who=pm)
    check(s == 404, "cannot acknowledge for someone else")

    s, _ = await api.req("POST", f"/policies/{pid}/versions", who=pm, json={"content": "Be nicer.", "change_summary": "tone"})
    _, p = await api.req("GET", f"/policies/{pid}")
    check(p["status"] == "in_review" and not p["current_version_approved"], "new version → back to review")
    _, vs = await api.req("GET", f"/policies/{pid}/versions")
    old = next(v for v in vs if v["version_number"] == 1)
    s, r = await api.req("POST", f"/policies/{pid}/versions/{old['id']}/restore", who="ciso@demo.com")
    s, _ = await api.req("PATCH", f"/policies/{pid}/versions/{r['id']}/approve", who="ciso@demo.com")
    check(s == 403, "restorer cannot approve the restored version")
    s, _ = await api.req("PATCH", f"/policies/{pid}/versions/{r['id']}/approve", who=pm)
    check(s == 200, "another person approves the restored version")
    # A date a person chose survives the re-publish; frequency edits go through PATCH.
    s, p = await api.req("PATCH", f"/policies/{pid}", who=pm, json={
        "next_review_date": "2031-05-05", "review_frequency_months": 6, "title": "ST Acceptable Use v2"})
    check(s == 200 and p["next_review_date_manual"] and p["review_frequency_months"] == 6
          and p["status"] == "in_review", "edit details without changing status")
    await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "approved"})
    s, p = await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "published"})
    check(s == 200 and p["next_review_date"] == "2031-05-05", "re-publish keeps a hand-set review date", p.get("next_review_date"))
    s, b = await api.req("PATCH", f"/policies/{pid}", who=pm, json={"next_review_date": "soon"})
    check(s == 422, "a review date must be a date", b)
    for bad in (0, -3, 100000):
        s1, _ = await api.req("PATCH", f"/policies/{pid}", who=pm, json={"review_frequency_months": bad})
        s2, _ = await api.req("POST", "/policies", who=pm, json={"title": "ST bad cycle", "review_frequency_months": bad})
        check(s1 == 422 and s2 == 422, f"review frequency {bad} refused with 422 (was a 500 on publish/review)", (s1, s2))
    s, p = await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "retired"})
    check(s == 200 and p["status"] == "retired" and p["allowed_transitions"] == ["draft"], "retire (only revive left)")
    s, logs = await api.req("GET", "/activity-log", params={"entity_type": "policy", "page_size": 100})
    items = logs.get("items", logs) if isinstance(logs, dict) else logs
    # The middleware files the acknowledgement under the attestation id (last id in the path).
    acts = {x.get("action") for x in items or [] if x.get("entity_id") in (pid, aid)}
    check({"submit", "approve", "publish", "retire", "acknowledge", "review"} <= acts,
          "workflow + acknowledge + review in the activity log", acts)


async def compliance(api: Api) -> None:
    print("[compliance]")
    from datetime import date, timedelta
    co, cm = role_email("control_owner"), role_email("compliance_manager")
    s, lst = await api.req("GET", "/compliance/assessments", who=co)
    check(s == 200, "control_owner can list assessments", lst if s != 200 else "")
    items = lst.get("items", lst) if isinstance(lst, dict) else lst
    # A fresh assessment each run: rows from earlier runs carry evidence that would
    # make the "only evidence expired" check data-dependent, and a freshly built
    # test database has no assessment at all.
    from app.models.framework import Framework
    taken = {a.get("framework_id") for a in items}
    async with AsyncSessionLocal() as db:
        fw_ids = (await db.execute(select(Framework.id).where(Framework.is_builtin == True))).scalars().all()  # noqa: E712
    fw_id = next((f for f in fw_ids if f not in taken), fw_ids[0])
    s, created = await api.req("POST", "/compliance/assessments", who=role_email("compliance_manager"), json={
        "framework_id": fw_id, "name": f"ST assessment {uuid.uuid4().hex[:6]}", "scope_type": "tenant"})
    check(s == 201 and created.get("control_assessments"), "assessment created with its rows", s)
    aid = created["id"]
    s, a = await api.req("GET", f"/compliance/assessments/{aid}", who=co)
    check(s == 200 and a["control_assessments"], "control_owner reads the detail")
    row, other = a["control_assessments"][0], a["control_assessments"][1]
    async with AsyncSessionLocal() as db:
        co_id = (await db.execute(select(User.id).where(User.email == co))).scalar_one()
    s, _ = await api.req("PATCH", f"/compliance/control-assessments/{row['id']}", who=co, json={"status": "in_progress"})
    check(s == 403, "control_owner cannot assess a row they do not own")
    s, r = await api.req("PATCH", f"/compliance/control-assessments/{row['id']}", who=cm, json={"owner_id": co_id})
    check(s == 200 and r["owner_id"] == co_id, "compliance_manager assigns the owner")
    s, r = await api.req("PATCH", f"/compliance/control-assessments/{row['id']}", who=co, json={"status": "partially_implemented", "notes": "self"})
    check(s == 200 and r["status"] == "partially_implemented" and r["status_source"] == "human", "owner self-assesses own row")
    s, _ = await api.req("PATCH", f"/compliance/control-assessments/{row['id']}", who=co, json={"owner_id": None})
    s2, _ = await api.req("PATCH", f"/compliance/control-assessments/{row['id']}", who=co, json={"owner_id": ""})
    check(s == 200 and s2 == 403, "owner cannot hand the row to someone else (null = unchanged)", (s, s2))
    soon = (date.today() + timedelta(days=5)).isoformat()
    past = (date.today() - timedelta(days=2)).isoformat()
    s, ev = await api.req("POST", f"/compliance/control-assessments/{row['id']}/evidence", who=co,
                          files={"file": ("p.txt", b"proof", "text/plain")}, data={"valid_until": soon})
    check(s == 200 and ev["valid_until"] == soon, "owner uploads evidence with validity")
    s, _ = await api.req("POST", f"/compliance/control-assessments/{other['id']}/evidence", who=co,
                         files={"file": ("p.txt", b"proof", "text/plain")})
    check(s == 403, "owner cannot upload on someone else's row")
    s, _ = await api.req("POST", f"/compliance/control-assessments/{other['id']}/evidence", who=cm,
                         files={"file": ("p.txt", b"proof", "text/plain")}, data={"valid_until": past})
    check(s == 200, "compliance_manager uploads (already-expired) evidence tenant-wide")
    s, _ = await api.req("POST", f"/compliance/control-assessments/{other['id']}/evidence", who=cm,
                         files={"file": ("p.txt", b"proof", "text/plain")}, data={"valid_until": "31/12/2026"})
    check(s == 422, "validity must be an ISO date")
    s, a = await api.req("GET", f"/compliance/assessments/{aid}")
    rows = {c["id"]: c for c in a["control_assessments"]}
    check(rows[other["id"]]["evidence_all_expired"] and not rows[row["id"]]["evidence_all_expired"],
          "control flagged when its only evidence has expired")

    from app.services.notification_generator import run_all_checks
    from app.models.notification import Notification
    async with AsyncSessionLocal() as db:
        tid = (await db.execute(select(User.tenant_id).where(User.email == co))).scalar_one()
        res = await run_all_checks(db, tenant_id=tid)
        keys = {n.title_key for n in (await db.execute(select(Notification).where(
            Notification.user_id == co_id))).scalars()}
    check(res.get("evidence_expiry", 0) >= 1 and "notifications.evidence_expiring.title" in keys,
          "7-day evidence reminder reaches the owner", res.get("evidence_expiry"))
    async with AsyncSessionLocal() as db:
        again = await run_all_checks(db, tenant_id=tid)
    check(again.get("evidence_expiry", 0) == 0, "reminder not repeated within the same stage")

    fw = a["framework_id"]
    s, _ = await api.req("POST", "/compliance/assessments", who=co, json={"framework_id": fw, "name": "x"})
    check(s == 403, "control_owner cannot create an assessment")
    s, _ = await api.req("POST", f"/compliance/assessments/{aid}/analyze", who=co)
    check(s == 403, "control_owner cannot run the analysis")
    s, _ = await api.req("GET", "/compliance/files/deleted")
    check(s == 200, "CISO lists deleted files")


async def audits(api: Api) -> None:
    print("[audits]")
    s, au = await api.req("POST", "/audits", json={"title": "ST audit", "audit_type": "internal"})
    check(s == 201, "audit created", au)
    auid = au["id"]
    s, f = await api.req("POST", f"/audits/{auid}/findings", json={
        "title": "ST finding", "description": "Access reviews not evidenced", "severity": "high"})
    long_title = "ST privileged access reviews are not performed quarterly for administrator accounts"
    long_desc = ("Quarterly reviews of privileged accounts could not be evidenced for the period under audit; "
                 "two dormant administrator accounts remained enabled after their owners left the organisation")
    await api.req("POST", f"/audits/{auid}/findings", json={"title": long_title, "description": long_desc, "severity": "medium"})
    check(s == 201, "finding created", f)
    s, rec = await api.req("POST", f"/audits/{auid}/recommendations", json={
        "title": "ST recommendation", "finding_id": f["id"]})
    check(s == 201 and rec.get("finding_id") == f["id"], "recommendation linked to the finding", rec)
    s, item = await api.req("POST", "/compliance/action-plan", json={
        "title": "ST action: quarterly access review", "recommendation_id": rec["id"], "due_date": "2027-01-31"})
    check(s == 201 and item["finding_id"] == f["id"] and item["recommendation_id"] == rec["id"],
          "action takes the recommendation's finding", item)
    s, _ = await api.req("POST", "/compliance/action-plan", json={"title": "x", "finding_id": "nope"})
    check(s == 404, "unknown finding refused")
    s, recs = await api.req("GET", f"/audits/{auid}/recommendations")
    check(s == 200 and recs[0].get("action_items_total") == 1, "recommendation roll-up counts the action", recs)
    s, out = await api.req("POST", f"/audits/{auid}/report/generate")
    check(s == 200 and out.get("report_url"), "audit report generated", out)
    import io
    from pathlib import Path
    from pypdf import PdfReader
    pdf = Path(settings.UPLOADS_DIR) / out["report_url"]
    # Table cells wrap, so compare on normalised whitespace.
    text = " ".join(" ".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(pdf.read_bytes())).pages).split())
    check("quarterly access review" in text and "ST finding" in text,
          "report « plan d'action » lists the action with its finding", text[-400:])
    flat = text.replace("- ", "")
    check(long_title in flat and long_desc in flat,
          "report table cells keep long titles and descriptions whole (no mid-word cut)", flat[:600])


async def followups(api: Api) -> None:
    print("[follow-ups]")
    s, d = await api.req("GET", "/users/directory")
    check(s == 200 and any(u["email"] == "ciso@demo.com" for u in d)
          and not any(u["email"].startswith("system+") for u in d), "CISO reads the user directory", d if s != 200 else "")
    s, _ = await api.req("GET", "/users/directory", who="auditor@demo.com")
    check(s == 403, "auditors do not get the directory")
    s, _ = await api.req("GET", "/users", who=role_email("risk_manager"))
    check(s == 403, "GET /users stays tenant-admin only")

    _, r = await api.req("POST", "/risks", json={"title": "ST appetite", "likelihood": 5, "impact": 5,
                                                  "target_likelihood": 4, "target_impact": 4})
    s, r = await api.req("PUT", f"/risks/{r['id']}/appetite", json={"appetite_threshold": 6})
    check(s == 200 and r.get("target_over_appetite") is True, "target_over_appetite returned", r)
    await api.req("DELETE", f"/risks/{r['id']}")

    for who in ("viewer", "executive", "risk_manager"):
        s, _ = await api.req("GET", "/compliance/assessments", who=role_email(who))
        check(s == 200, f"{who} can read compliance assessments")

    pm = role_email("policy_manager")
    # Acknowledgements need a signed-off text in force (follow-up C-2).
    p = await _published_policy(api, "ST read-only ack", "x")
    async with AsyncSessionLocal() as db:
        ids = dict((await db.execute(select(User.email, User.id).where(
            User.email.in_([role_email("viewer"), role_email("executive")])))).all())
    s, atts = await api.req("POST", f"/policies/{p['id']}/attestations", who=pm, json={"user_ids": list(ids.values())})
    for a in atts:
        who = next(e for e, i in ids.items() if i == a["user_id"])
        s, r = await api.req("PATCH", f"/policies/{p['id']}/attestations/{a['id']}/acknowledge", who=who)
        check(s == 200 and r["status"] == "acknowledged", f"{who.split('@')[0]} acknowledges own policy")
    s, _ = await api.req("POST", "/risks", who=role_email("viewer"), json={"title": "nope"})
    check(s == 403, "viewer still cannot write anything else")


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
        await vendors(api)
        await policies(api)
        await compliance(api)
        await audits(api)
        await followups(api)
        await prompt2(api)


async def _published_policy(api: Api, title: str, content: str) -> dict:
    """policy_manager writes it, the CISO approves the version, it is published."""
    pm = role_email("policy_manager")
    _, p = await api.req("POST", "/policies", who=pm, json={"title": title, "content": content})
    _, vs = await api.req("GET", f"/policies/{p['id']}/versions")
    await api.req("PATCH", f"/policies/{p['id']}", who=pm, json={"status": "in_review"})
    await api.req("PATCH", f"/policies/{p['id']}/versions/{vs[0]['id']}/approve")
    await api.req("PATCH", f"/policies/{p['id']}", who=pm, json={"status": "approved"})
    s, p = await api.req("PATCH", f"/policies/{p['id']}", who=pm, json={"status": "published"})
    assert s == 200 and p["status"] == "published", (s, p)
    return p


async def _new_assessment(api: Api, name: str) -> dict:
    from app.models.framework import Framework
    from app.models.compliance import ComplianceAssessment
    # One assessment per framework: POST returns the existing one, so use a free framework.
    async with AsyncSessionLocal() as db:
        taken = set((await db.execute(select(ComplianceAssessment.framework_id))).scalars().all())
        fw_id = next(f for f in (await db.execute(select(Framework.id).where(Framework.is_builtin == True))).scalars().all()  # noqa: E712
                     if f not in taken)
    s, a = await api.req("POST", "/compliance/assessments", json={
        "framework_id": fw_id, "name": f"{name} {uuid.uuid4().hex[:6]}", "scope_type": "tenant"})
    assert s == 201, (s, a)
    return a


async def prompt2(api: Api) -> None:
    """R2 Prompt 2 follow-ups (B–D)."""
    print("[prompt 2: B — draft assessment delete]")
    a = await _new_assessment(api, "ST draft untouched")
    s, b = await api.req("DELETE", f"/compliance/assessments/{a['id']}")
    check(s == 204, "an untouched draft (with its control rows) deletes — was 500", b)
    s, _ = await api.req("GET", f"/compliance/assessments/{a['id']}")
    check(s == 404, "and is gone")
    a = await _new_assessment(api, "ST draft worked")
    row = a["control_assessments"][0]
    await api.req("PATCH", f"/compliance/control-assessments/{row['id']}", json={"status": "partially_implemented"})
    s, b = await api.req("DELETE", f"/compliance/assessments/{a['id']}", lang="fr")
    check(s == 409 and "archivez" in str(b), "a draft with a person's decision is refused with 409 (fr)", b)
    s, _ = await api.req("GET", f"/compliance/assessments/{a['id']}")
    check(s == 200, "and is kept")

    print("[prompt 2: C-1 — acceptance withdraw + expiry in the daily check]")
    rm = role_email("risk_manager")
    s, risk = await api.req("POST", "/risks", who=rm, json={"title": "ST C1 risk", "likelihood": 3, "impact": 3, "category": "operational"})
    rid = risk["id"]
    s, w = await api.req("POST", "/security/acceptances", who=rm, json={
        "name": "ST withdraw", "justification": "j", "expiration_date": "2030-01-01", "risk_ids": [rid]})
    s, _ = await api.req("PATCH", f"/security/acceptances/{w['id']}/withdraw", json={"reason": "not mine"})
    check(s == 403, "only the requester can withdraw")
    s, b = await api.req("PATCH", f"/security/acceptances/{w['id']}/withdraw", who=rm, lang="fr", json={"reason": " "})
    check(s == 422 and "motif" in str(b), "withdraw needs a reason (fr)", b)
    s, w2 = await api.req("PATCH", f"/security/acceptances/{w['id']}/withdraw", who=rm, json={"reason": "Risk treated instead"})
    check(s == 200 and w2["status"] == "withdrawn" and w2["revocation_reason"] == "Risk treated instead",
          "requester withdraws their pending request", w2)
    s, _ = await api.req("PATCH", f"/security/acceptances/{w['id']}/withdraw", who=rm, json={"reason": "again"})
    check(s == 409, "a withdrawn request cannot be withdrawn again")
    s, _ = await api.req("PATCH", f"/security/acceptances/{w['id']}/approve")
    check(s == 409, "a withdrawn request cannot be approved")
    s, logs = await api.req("GET", "/activity-log", params={"entity_type": "risk_acceptance", "page_size": 50})
    items = logs.get("items", logs) if isinstance(logs, dict) else logs
    check(any(x.get("action") == "withdraw" and x.get("entity_id") == w["id"] for x in items or []), "withdraw is logged")

    s, e = await api.req("POST", "/security/acceptances", who=rm, json={
        "name": "ST expiring", "justification": "j", "expiration_date": "2030-01-01", "risk_ids": [rid]})
    s, e = await api.req("PATCH", f"/security/acceptances/{e['id']}/approve")
    _, r = await api.req("GET", f"/risks/{rid}")
    check(s == 200 and r["status"] == "accepted", "approved acceptance accepts the risk", r.get("status"))
    from app.models.security_exception import RiskAcceptance
    from app.services.notification_generator import run_all_checks
    async with AsyncSessionLocal() as db:
        await db.execute(update(RiskAcceptance).where(RiskAcceptance.id == e["id"]).values(expiration_date="2020-01-01"))
        await db.commit()
        tid = (await db.execute(select(RiskAcceptance.tenant_id).where(RiskAcceptance.id == e["id"]))).scalar_one()
        first = await run_all_checks(db, tenant_id=tid)
        second = await run_all_checks(db, tenant_id=tid)
        st = (await db.execute(select(RiskAcceptance.status).where(RiskAcceptance.id == e["id"]))).scalar_one()
    _, r = await api.req("GET", f"/risks/{rid}")
    check(first.get("waiver_expiry", 0) >= 1 and second.get("waiver_expiry") == 0 and st == "expired"
          and r["status"] != "accepted", "daily check expires it once and hands the risk back",
          (first.get("waiver_expiry"), second.get("waiver_expiry"), st, r.get("status")))

    # Race: two sweeps at the same moment (2 workers) on separate connections.
    from app.services.notification_generator import sync_waiver_expiry
    from app.models.risk_version import RiskVersion
    s, risk2 = await api.req("POST", "/risks", who=rm, json={"title": "ST race risk", "likelihood": 3, "impact": 3, "category": "operational"})
    s, e2 = await api.req("POST", "/security/acceptances", who=rm, json={
        "name": "ST race", "justification": "j", "expiration_date": "2030-01-01", "risk_ids": [risk2["id"]]})
    await api.req("PATCH", f"/security/acceptances/{e2['id']}/approve")
    async with AsyncSessionLocal() as db:
        await db.execute(update(RiskAcceptance).where(RiskAcceptance.id == e2["id"]).values(expiration_date="2020-01-01"))
        await db.commit()

    async def one_sweep():
        async with AsyncSessionLocal() as db:
            return await sync_waiver_expiry(db, tid)
    counts = await asyncio.gather(one_sweep(), one_sweep(), return_exceptions=True)
    async with AsyncSessionLocal() as db:
        st2 = (await db.execute(select(RiskAcceptance.status).where(RiskAcceptance.id == e2["id"]))).scalar_one()
        hand_backs = (await db.execute(select(RiskVersion).where(
            RiskVersion.risk_id == risk2["id"], RiskVersion.transition_from == "accepted"))).scalars().all()
    check(st2 == "expired" and sum(c for c in counts if isinstance(c, int)) == 1 and len(hand_backs) == 1,
          "two simultaneous sweeps: expired once, risk handed back once", (counts, st2, len(hand_backs)))
    s, b = await api.req("PATCH", f"/security/acceptances/{e2['id']}/revoke", json={"reason": "late"})
    check(s == 409 and "expired" in str(b), "revoke after expiry is refused with the real status", b)

    print("[prompt 2: C-2 — attestations on an approved text only, no duplicates, auditors attest]")
    pm = role_email("policy_manager")
    s, p = await api.req("POST", "/policies", who=pm, json={"title": "ST C2 policy", "content": "Rule 1."})
    pid = p["id"]
    async with AsyncSessionLocal() as db:
        auditor_id = (await db.execute(select(User.id).where(User.email == "auditor@demo.com"))).scalar_one()
        viewer_id = (await db.execute(select(User.id).where(User.email == role_email("business_owner")))).scalar_one()
    s, b = await api.req("POST", f"/policies/{pid}/attestations", who=pm, lang="fr", json={"user_ids": [viewer_id]})
    check(s == 409 and "approuv" in str(b), "no acknowledgement request on a draft (fr)", b)
    _, vs = await api.req("GET", f"/policies/{pid}/versions")
    await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "in_review"})
    await api.req("PATCH", f"/policies/{pid}/versions/{vs[0]['id']}/approve")
    await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "approved"})
    s, p = await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "published"})
    s, atts = await api.req("POST", f"/policies/{pid}/attestations", who=pm, json={"user_ids": [viewer_id, auditor_id, viewer_id]})
    check(s == 201 and len(atts) == 2, "published + approved text: requests created (repeated id once)", atts)
    s, again = await api.req("POST", f"/policies/{pid}/attestations", who=pm, json={"user_ids": [viewer_id]})
    _, all_atts = await api.req("GET", f"/policies/{pid}/attestations")
    check(s == 201 and len(all_atts) == 2 and again[0]["id"] in {a["id"] for a in atts},
          "re-sending does not duplicate a pending request", len(all_atts))
    s, mine = await api.req("GET", "/policies/my-attestations", who="auditor@demo.com")
    mine_row = next((m for m in mine if m["policy_id"] == pid), None) if s == 200 else None
    check(mine_row is not None, "the auditor sees the request in My policies", s)
    s, a = await api.req("PATCH", f"/policies/{pid}/attestations/{mine_row['id']}/acknowledge", who="auditor@demo.com")
    check(s == 200 and a["status"] == "acknowledged", "the auditor acknowledges")
    s, logs = await api.req("GET", "/activity-log", params={"entity_type": "policy", "page_size": 100})
    items = logs.get("items", logs) if isinstance(logs, dict) else logs
    check(any(x.get("action") == "approve_version" and x.get("entity_id") == pid for x in items or []),
          "version approval is in the activity log")
    viewer_att = next(x for x in all_atts if x["user_id"] == viewer_id)
    await api.req("PATCH", f"/policies/{pid}", who=pm, json={"status": "retired"})
    s, b = await api.req("PATCH", f"/policies/{pid}/attestations/{viewer_att['id']}/acknowledge", who=role_email("business_owner"))
    check(s == 409, "a retired policy can no longer be acknowledged", b)

    print("[prompt 2: C-3 — vendors: send queue, duplicates, unscored prescreen, alerts]")
    vm = role_email("vendor_manager")
    s, v = await api.req("POST", "/vendors", who=vm, json={"name": "ST C3 Vendor", "country": "TN",
                                                          "contract_expiry": "2026-11-01"})
    vid = v["id"]
    check(v.get("risk_score") is None, "a vendor created without an assessment has no score (not a default)", v.get("risk_score"))
    s, b = await api.req("POST", "/vendors", who=vm, lang="fr", json={"name": "st c3 vendor"})
    check(s == 409 and "registre" in str(b), "a second vendor with the same name is refused (fr)", b)
    body = b"Master services agreement. Liability capped at 12 months of fees." * 20
    s, c1 = await api.req("POST", f"/vendors/{vid}/upload-contract", who=vm,
                          files={"contract_file": ("msa.txt", body, "text/plain")})
    s2, c2 = await api.req("POST", f"/vendors/{vid}/upload-contract", who=vm,
                           files={"contract_file": ("msa.txt", body, "text/plain")})
    check(s == 200 and s2 == 200 and c1["id"] == c2["id"] and c2["version"] == 1,
          "re-uploading the same file returns the contract on file (no second version)", (c1.get("id"), c2.get("id")))
    s, ready = await api.req("GET", "/vendors/contracts/ready-to-send")
    check(s == 200 and all(r["id"] != c1["id"] for r in ready), "not ready to send before approval")
    s, ap = await api.req("POST", f"/vendors/contracts/{c1['id']}/ciso-review", json={"action": "approve", "comments": "ok"})
    check(s == 200 and ap["validation_status"] == "approved", "CISO approves the contract", ap)
    s, ready = await api.req("GET", "/vendors/contracts/ready-to-send", who=vm)
    row = next((r for r in ready if r["id"] == c1["id"]), None) if s == 200 else None
    check(row is not None and row["vendor_name"] == "ST C3 Vendor", "approved contract is in Ready to send, with its vendor name", ready)
    s, _ = await api.req("POST", f"/vendors/contracts/{c1['id']}/ciso-review", json={"action": "reject", "comments": "x"})
    check(s == 409, "a decided contract cannot be decided again")
    s, sent = await api.req("POST", f"/vendors/contracts/{c1['id']}/send-to-vendor", who=vm)
    s2, ready = await api.req("GET", "/vendors/contracts/ready-to-send")
    check(s == 200 and sent["validation_status"] == "sent_to_vendor" and all(r["id"] != c1["id"] for r in ready),
          "sent to vendor, leaves Ready to send")
    # Give the background AI review (dead Ollama here) time to finish, then check it did not revert.
    await asyncio.sleep(1.5)
    from app.models.vendor import VendorContract as _VC
    async with AsyncSessionLocal() as db:
        st = (await db.execute(select(_VC.validation_status).where(_VC.id == c1["id"]))).scalar_one()
    check(st == "sent_to_vendor", "a late AI result does not pull a sent contract back to review", st)

    s, before = await api.req("GET", f"/vendors/{vid}")
    s, a = await api.req("POST", f"/vendors/{vid}/assessments", who=vm,
                         json={"answers": {"q1": "yes"}, "apply_score": False})
    s2, after = await api.req("GET", f"/vendors/{vid}")
    check(s == 201 and a["assessment_score"] is None and a["status"] == "completed"
          and after["risk_score"] == before["risk_score"], "prescreen kept without an AI score; score untouched", a)

    from app.models.notification import Notification
    from app.services.notification_generator import check_vendor_contract_expiry
    await api.req("POST", f"/vendors/{vid}/offboard", who=vm, json={"status": "inactive", "reason": "ended", "effective_date": "2026-10-18"})
    async with AsyncSessionLocal() as db:
        tid = (await db.execute(select(User.tenant_id).where(User.email == vm))).scalar_one()
        await check_vendor_contract_expiry(db, tid)
        await db.commit()
        n = [x for x in (await db.execute(select(Notification).where(Notification.tenant_id == tid))).scalars().all()
             if (x.data or {}).get("entity_id") == vid]
    check(not n, "no contract-expiry alert for an offboarded vendor", len(n))
    s, b = await api.req("DELETE", f"/vendors/{vid}", who=vm)
    check(s == 409 and "Offboard" in str(b), "delete refusal points to Offboard", b)

    print("[prompt 2: C-4 — evidence by its uploader, validity edit, mixed roles]")
    co, cm = role_email("control_owner"), role_email("compliance_manager")
    a = await _new_assessment(api, "ST C4")
    rows = a["control_assessments"]
    async with AsyncSessionLocal() as db:
        co_id = (await db.execute(select(User.id).where(User.email == co))).scalar_one()
        ciso = (await db.execute(select(User).where(User.email == "ciso@demo.com"))).scalar_one()
        mixed = "mixedrole@demo.com"
        if not (await db.execute(select(User).where(User.email == mixed))).scalar_one_or_none():
            db.add(User(id=str(uuid.uuid4()), tenant_id=ciso.tenant_id, email=mixed,
                        hashed_password=ciso.hashed_password, first_name="Mixed", last_name="Selftest",
                        role="control_owner", roles=["control_owner", "risk_manager"],
                        is_active=True, is_verified=True, elite_access=True))
            await db.commit()
    await api.req("PATCH", f"/compliance/control-assessments/{rows[0]['id']}", who=cm, json={"owner_id": co_id})
    s, ev = await api.req("POST", f"/compliance/control-assessments/{rows[0]['id']}/evidence", who=co,
                          files={"file": ("own.txt", b"own proof", "text/plain")}, data={"valid_until": "2027-01-01"})
    check(s == 200 and ev.get("uploaded_by_id") == co_id, "upload response names the uploader", ev)
    s, e2 = await api.req("PATCH", f"/compliance/evidence/{ev['id']}", who=co, json={"valid_until": "2027-06-30"})
    check(s == 200 and e2["valid_until"] == "2027-06-30", "uploader changes the validity date", e2)
    s, _ = await api.req("PATCH", f"/compliance/evidence/{ev['id']}", who=co, json={"valid_until": "30/06/2027"})
    check(s == 422, "validity must be a date")
    s, vis = await api.req("PATCH", f"/compliance/evidence/{ev['id']}/visibility")
    check(s == 200 and vis["valid_until"] == "2027-06-30", "visibility toggle keeps the validity window", vis)
    s, cm_ev = await api.req("POST", f"/compliance/control-assessments/{rows[0]['id']}/evidence", who=cm,
                             files={"file": ("cm.txt", b"manager proof", "text/plain")})
    s, b = await api.req("DELETE", f"/compliance/evidence/{cm_ev['id']}", who=co)
    check(s == 403, "a control owner cannot delete someone else's evidence", b)
    s, _ = await api.req("DELETE", f"/compliance/evidence/{ev['id']}", who=co)
    check(s == 204, "the uploader deletes their own evidence (was CISO-only)")
    s, _ = await api.req("DELETE", f"/compliance/evidence/{cm_ev['id']}", who=cm)
    check(s == 204, "compliance_manager deletes any evidence")
    s, _ = await api.req("GET", "/compliance/files/deleted", who=cm)
    check(s == 200, "compliance_manager reads the deleted-files list")
    s, r = await api.req("PATCH", f"/compliance/control-assessments/{rows[1]['id']}", who=mixed,
                         json={"status": "partially_implemented"})
    check(s == 200, "control_owner + risk_manager acts on a row they do not own (organisation-wide wins)", r)
    s, _ = await api.req("PATCH", f"/compliance/control-assessments/{rows[1]['id']}", who=co,
                         json={"status": "implemented"})
    check(s == 403, "a plain control_owner still cannot")

    print("[prompt 2: C-5 — scenario mirror risk, history before re-score, orphan backfill]")
    rm = role_email("risk_manager")
    s, sa = await api.req("POST", "/risk-scenarios", who=rm, json={"name": "ST C5 lone", "current_probability": 2, "current_impact": 2})
    ra = sa["linked_risk_id"]
    await api.req("PATCH", f"/risk-scenarios/{sa['id']}", who=rm, json={"current_probability": 4, "current_impact": 3})
    s, vers = await api.req("GET", f"/risks/{ra}/versions")
    check(s == 200 and any("Re-scored from risk scenario" in (v.get("change_reason") or "") for v in vers)
          and any(v["snapshot"].get("likelihood") == 2 for v in vers),
          "a scenario re-score versions the register entry first (old score kept)", vers)
    s, _ = await api.req("DELETE", f"/risk-scenarios/{sa['id']}", who=rm)
    s2, _ = await api.req("GET", f"/risks/{ra}")
    check(s == 204 and s2 == 404, "deleting a scenario deletes its unreferenced register entry", (s, s2))

    s, sb = await api.req("POST", "/risk-scenarios", who=rm, json={"name": "ST C5 treated", "current_probability": 3, "current_impact": 3})
    rb = sb["linked_risk_id"]
    s, tr = await api.req("POST", "/risk-treatment", json={"risk_id": rb, "treatment_option": "mitigate", "description": "patch",
                                                         "acceptance_justification": "fix it"})
    check(s == 201, "treatment plan on the scenario's register entry", tr)
    await api.req("DELETE", f"/risk-scenarios/{sb['id']}", who=rm)
    s, r = await api.req("GET", f"/risks/{rb}")
    s2, vers = await api.req("GET", f"/risks/{rb}/versions")
    check(s == 200 and r["status"] == "closed" and any("Scenario deleted" in (v.get("change_reason") or "") for v in vers),
          "a register entry a treatment plan cites is closed, reason 'Scenario deleted'", r.get("status"))

    # An orphan made the old way: scenario row removed, its risk left open, log entry without the link.
    s, sc3 = await api.req("POST", "/risk-scenarios", who=rm, json={"name": "ST C5 old orphan", "current_probability": 2, "current_impact": 4})
    rc = sc3["linked_risk_id"]
    from app.models.risk_scenario import RiskScenario
    from app.models.activity_log import ActivityLog
    async with AsyncSessionLocal() as db:
        tid = (await db.execute(select(RiskScenario.tenant_id).where(RiskScenario.id == sc3["id"]))).scalar_one()
        rm_id = (await db.execute(select(User.id).where(User.email == rm))).scalar_one()
        await db.execute(RiskScenario.__table__.delete().where(RiskScenario.id == sc3["id"]))
        db.add(ActivityLog(tenant_id=tid, user_id=rm_id, user_email=rm, action="delete", entity_type="risk_scenario", entity_id=sc3["id"],
                           entity_name="ST C5 old orphan", details={"deleted": {"name": "ST C5 old orphan"}}, origin="api"))
        await db.commit()
    from scripts.backfill_scenario_mirrors import run as backfill_mirrors
    from app.core.config import settings as _settings
    await backfill_mirrors(_settings.DATABASE_URL, apply=True)
    s, r = await api.req("GET", f"/risks/{rc}")
    check(r.get("status") == "closed", "backfill closes the old orphan", r.get("status"))
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        await backfill_mirrors(_settings.DATABASE_URL, apply=False)
    check("would close 0 risk" in buf.getvalue(), "backfill is idempotent", buf.getvalue()[-120:])

    print("[prompt 2: D — gap text, clearable risk fields, supersede, upload trail, owner dashboards]")
    a = await _new_assessment(api, "ST D gaps")
    row = a["control_assessments"][0]
    await api.req("PATCH", f"/compliance/control-assessments/{row['id']}", json={"status": "partially_implemented"})
    _, det = await api.req("GET", f"/compliance/assessments/{a['id']}")
    gaps = det.get("gaps", [])
    g = next((x for x in gaps if x.get("control_id") == row["control_id"]), {})
    check("partially compliant" in (g.get("gap_description") or ""), "a partial control's gap says partially compliant", g.get("gap_description"))
    await api.req("PATCH", f"/compliance/control-assessments/{row['id']}", json={"status": "not_implemented"})
    _, det = await api.req("GET", f"/compliance/assessments/{a['id']}")
    gaps = det.get("gaps", [])
    g = next((x for x in gaps if x.get("control_id") == row["control_id"]), {})
    check("assessed as not compliant" in (g.get("gap_description") or ""), "the same gap's text follows the new verdict", g.get("gap_description"))

    s, rk = await api.req("POST", "/risks", json={"title": "ST D clearable", "likelihood": 2, "impact": 3,
                                                  "residual_likelihood": 1, "next_review_date": "2027-01-01"})
    s, rk2 = await api.req("PATCH", f"/risks/{rk['id']}", json={"residual_likelihood": None, "next_review_date": None})
    check(s == 200 and rk2["residual_likelihood"] is None and rk2["next_review_date"] is None
          and rk2["likelihood"] == 2, "explicit null clears optional risk fields; others untouched", rk2)

    s, tr = await api.req("POST", "/risk-treatment", json={
        "risk_id": rk["id"], "treatment_option": "mitigate", "acceptance_justification": "j",
        "start_date": "2026-11-01", "complexity": "high", "actual_cost": 1200, "delay_justification": "vendor slip"})
    s, tr2 = await api.req("POST", f"/risk-treatment/{rk['id']}/supersede", json={
        "treatment_option": "transfer", "acceptance_justification": "insure", "transfer_to": "Insurer",
        "change_summary": "moved to insurance"})
    check(s == 200 and tr2["start_date"] == "2026-11-01" and tr2["complexity"] == "high"
          and tr2["actual_cost"] == 1200 and tr2["delay_justification"] == "vendor slip"
          and tr2["treatment_option"] == "transfer", "supersede keeps the fields its form does not show", tr2)

    s, ev = await api.req("POST", f"/compliance/control-assessments/{row['id']}/evidence",
                          files={"file": ("d.txt", b"trail proof", "text/plain")})
    from app.models.activity_log import ActivityLog as _AL
    async with AsyncSessionLocal() as db:
        logged = [x for x in (await db.execute(select(_AL).where(_AL.entity_type == "compliance"))).scalars().all()
                  if f"/control-assessments/{row['id']}/evidence" in str((x.details or {}).get("path", ""))]
    check(s == 200 and logged, "the evidence upload is in the activity log (committed before returning)", len(logged))

    for path in ("/dashboards/governance", "/dashboards/risks", "/dashboard/executive-summary"):
        s, _ = await api.req("GET", path, who="admin@demo.com")
        check(s != 403, f"tenant owner is not refused on {path}", s)


def main() -> None:
    asyncio.run(http_tests())
    print(f"\n{PASSES} passed, {len(FAILS)} failed")
    if FAILS:
        for f in FAILS:
            print("  -", f)
        sys.exit(1)


if __name__ == "__main__":
    main()
