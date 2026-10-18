"""Self-test: an AI re-run MERGES into a compliance assessment instead of replacing it (R2 5.1).

Two levels, no Ollama needed for either:

* [unit] services/compliance_merge.merge_verdict — the pure rules: human row kept
  (suggestion only), AI row updated, new control created, missing verdict
  preserved, protected fields (owner, notes, auditor verdict) never emitted.
* [run]  the real ``_run_analysis_background`` on a SNAPSHOT COPY of the database,
  with ``ai_chunking.assess_controls_over_document`` replaced by a fixed result:
  human row kept with its owner/notes/auditor verdict and an AI suggestion,
  AI row updated in place (same id), new control created, missing verdict
  preserved, every Evidence row still attached, no gap opened behind a human
  decision. Also checks 5.2 (rows created with the assessment) on the way.

    cd backend
    venv/bin/python -m scripts.selftest_compliance_merge                 # unit only
    venv/bin/python -m scripts.migrate_r2_lifecycle --db <copy.db> --apply
    DATABASE_URL=sqlite+aiosqlite:///<copy.db> ENABLE_TRANSLATION_WORKER=0 \\
        venv/bin/python -m scripts.selftest_compliance_merge             # unit + run

Never point it at the live grc_dev.db.
"""
from __future__ import annotations

import asyncio
import os
import sys
from types import SimpleNamespace

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


# ---------------------------------------------------------------------------
def unit_tests() -> None:
    from app.services import compliance_merge as m
    print("[unit]")
    now = "2026-10-18T10:00:00+00:00"
    v = m.AiVerdict(status="not_implemented", status_key="nc", confidence=0.83, notes="No policy found.")

    human = SimpleNamespace(status_source="human", status="implemented", status_key="c", owner_id="u1",
                            notes="Checked by hand", auditor_verdict="conforme", implementation_notes="mine",
                            not_applicable_justification=None, ai_confidence=None)
    out = m.merge_verdict(human, v, now_iso=now)
    check(out.kind == m.SUGGESTED, "human row → suggestion only", out.kind)
    check("status" not in out.fields and "implementation_notes" not in out.fields
          and "status_source" not in out.fields, "human status / notes never in the merge", out.fields)
    check(out.fields["ai_suggested_status"] == "not_implemented" and out.fields["ai_confidence"] == 0.83
          and out.fields["ai_suggested_notes"] == "No policy found.", "AI opinion recorded beside it")
    m.apply(human, out)
    check(human.status == "implemented" and human.owner_id == "u1" and human.notes == "Checked by hand"
          and human.auditor_verdict == "conforme" and human.implementation_notes == "mine",
          "applying it leaves the human half untouched")

    ai_row = SimpleNamespace(status_source="ai", status="not_started", status_key=None, owner_id="u2",
                             notes="n", implementation_notes="old", not_applicable_justification=None)
    out = m.merge_verdict(ai_row, v, now_iso=now)
    check(out.kind == m.UPDATED and out.fields["status"] == "not_implemented"
          and out.fields["implementation_notes"] == "No policy found." and out.fields["status_source"] == "ai",
          "AI row updated in place", out)
    m.apply(ai_row, out)
    check(ai_row.owner_id == "u2" and ai_row.notes == "n", "owner / notes kept on an AI row")

    legacy = SimpleNamespace(status_source=None, status="not_started")
    check(m.merge_verdict(legacy, v, now_iso=now).kind == m.UPDATED, "unmarked (legacy/seeded) row is updated")

    out = m.merge_verdict(None, v, now_iso=now)
    check(out.kind == m.CREATED and out.fields["status"] == "not_implemented"
          and out.fields["status_source"] == "ai", "no row → created", out)

    check(m.merge_verdict(ai_row, None, now_iso=now).kind == m.KEPT, "missing verdict → row kept as is")
    check(m.merge_verdict(human, None, now_iso=now).kind == m.KEPT, "missing verdict on a human row → kept")
    out = m.merge_verdict(None, None, now_iso=now, placeholder_note="not analysed")
    check(out.kind == m.PLACEHOLDER and out.fields["status"] == "not_started"
          and out.fields["implementation_notes"] == "not analysed", "missing verdict, no row → placeholder")

    na = m.AiVerdict(status="not_applicable", confidence=1.5, na_justification="  out of scope ")
    out = m.merge_verdict(None, na, now_iso=now)
    check(out.fields["not_applicable_justification"] == "out of scope" and out.fields["ai_confidence"] == 1.0,
          "N/A justification kept, confidence clamped")
    out = m.merge_verdict(None, v, now_iso=now)
    check(out.fields["not_applicable_justification"] is None, "no N/A justification on another verdict")

    for kind_case in (human, ai_row, None):
        for verdict in (v, None):
            out = m.merge_verdict(kind_case, verdict, now_iso=now)
            check(not (set(out.fields) & m.PROTECTED_FIELDS),
                  f"protected fields never emitted ({out.kind})", out.fields)


# ---------------------------------------------------------------------------
async def run_tests() -> None:
    from sqlalchemy import delete, select, update
    import httpx

    from app.api.v1.endpoints import compliance as comp
    from app.core.database import AsyncSessionLocal
    from app.core.rate_limit import limiter
    from app.main import create_application
    from app.models.compliance import ComplianceGap, ControlAssessment, ControlStatus, Evidence
    from app.models.framework import Framework, FrameworkControl
    from app.models.user import User
    from app.services import ai_chunking

    print("[run]")
    limiter.enabled = False
    P = "/api/v1"
    app = create_application()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=120) as c:
        r = await c.post(f"{P}/auth/login", json={"email": "ciso@demo.com", "password": "demo123"})
        H = {"Authorization": f"Bearer {r.json()['access_token']}"}

        async with AsyncSessionLocal() as db:
            me = (await db.execute(select(User).where(User.email == "ciso@demo.com"))).scalar_one()
            # A small framework keeps the run quick; at least 4 controls needed.
            # ...and one this tenant has no assessment for, so POST creates a NEW one.
            from app.models.compliance import ComplianceAssessment
            taken = set((await db.execute(select(ComplianceAssessment.framework_id).where(
                ComplianceAssessment.tenant_id == me.tenant_id))).scalars())
            fws = (await db.execute(select(Framework).where(Framework.is_builtin == True))).scalars().all()  # noqa: E712
            fw = None
            for f in fws:
                if f.id in taken:
                    continue
                n = len((await db.execute(select(FrameworkControl.id).where(FrameworkControl.framework_id == f.id))).all())
                if 4 <= n <= 40:
                    fw, n_controls = f, n
                    break
        assert fw is not None, "no small built-in framework in the copy"

        r = await c.post(f"{P}/compliance/assessments", headers=H, json={
            "framework_id": fw.id, "name": "ST merge", "scope_type": "tenant", "description": "selftest"})
        check(r.status_code == 201, "assessment created", r.text[:200])
        a = r.json()
        aid = a["id"]
        check(len(a["control_assessments"]) == n_controls, "5.2: one row per requirement at creation",
              (len(a["control_assessments"]), n_controls))

        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(ControlAssessment, FrameworkControl)
                .join(FrameworkControl, FrameworkControl.id == ControlAssessment.control_id)
                .where(ControlAssessment.assessment_id == aid)
                .order_by(FrameworkControl.sort_order)
            )).all()
            (ca_h, fc_h), (ca_ai, fc_ai), (ca_miss, fc_miss), (ca_new, fc_new) = rows[:4]
            ids = {"human": ca_h.id, "ai": ca_ai.id, "miss": ca_miss.id}
            # The missing-verdict control holds an earlier AI result.
            await db.execute(update(ControlAssessment).where(ControlAssessment.id == ca_miss.id).values(
                status=ControlStatus.PARTIALLY_IMPLEMENTED, status_source="ai", ai_confidence=0.6))
            # Simulate a requirement added to the framework after the assessment existed.
            await db.execute(delete(ControlAssessment).where(ControlAssessment.id == ca_new.id))
            await db.commit()

        # A person decides the first control, with owner, notes, evidence + auditor verdict.
        r = await c.patch(f"{P}/compliance/control-assessments/{ids['human']}", headers=H, json={
            "status": "implemented", "notes": "Verified on site", "owner_id": me.id})
        check(r.status_code == 200 and r.json()["status_source"] == "human", "manual edit marks the row human", r.text[:200])
        for key in ("human", "ai"):
            r = await c.post(f"{P}/compliance/control-assessments/{ids[key]}/evidence", headers=H,
                             files={"file": ("proof.txt", b"signed register", "text/plain")},
                             data={"valid_until": "2030-01-01"})
            check(r.status_code == 200 and r.json()["valid_until"] == "2030-01-01", f"evidence with validity on {key} row")
        async with AsyncSessionLocal() as db:
            await db.execute(update(ControlAssessment).where(ControlAssessment.id == ids["human"]).values(
                auditor_verdict="conforme", auditor_note="seen"))
            await db.commit()
            ev_before = {e.id for e in (await db.execute(select(Evidence).where(
                Evidence.control_assessment_id.in_([ids["human"], ids["ai"]])))).scalars()}
        r = await c.post(f"{P}/compliance/assessments/{aid}/documents", headers=H,
                         files={"file": ("policy.txt", b"Access control policy text.", "text/plain")})
        check(r.status_code == 201, "analysis document uploaded", r.text[:200])

    # Fake AI: human row → not_implemented, AI row → implemented, new → not_implemented,
    # missing row → no verdict. Everything else implemented (so the run is not "mostly failed").
    async with AsyncSessionLocal() as db:
        all_fc = (await db.execute(select(FrameworkControl).where(
            FrameworkControl.framework_id == fw.id).order_by(FrameworkControl.sort_order))).scalars().all()
    verdicts, missing = {}, []
    for fc in all_fc:
        key = fc.control_id
        if fc.id == fc_miss.id:
            missing.append(key)
            continue
        verdict = {fc_h.id: "not_implemented", fc_new.id: "not_implemented"}.get(fc.id, "implemented")
        verdicts[key] = ai_chunking.ControlVerdict(
            control_id=key, verdict=verdict, confidence=0.9, rationale=f"fake {verdict}",
            gap_description="fake gap" if verdict == "not_implemented" else None,
            remediation="fix it" if verdict == "not_implemented" else None)
    fake_run = ai_chunking.ControlAssessmentRun(
        verdicts=verdicts, missing_ids=missing, mode="direct", chunks=1, calls=1,
        warnings=[], failures=[], document_summaries=[])

    async def fake_assess(*_a, **_k):
        return SimpleNamespace(ok=True, data=fake_run)

    original = comp.ai_chunking.assess_controls_over_document
    comp.ai_chunking.assess_controls_over_document = fake_assess
    try:
        await comp._run_analysis_background(aid, me.tenant_id, me.id, "en")
    finally:
        comp.ai_chunking.assess_controls_over_document = original

    async with AsyncSessionLocal() as db:
        cas = {ca.control_id: ca for ca in (await db.execute(
            select(ControlAssessment).where(ControlAssessment.assessment_id == aid))).scalars()}
        h, ai, miss, new = cas.get(fc_h.id), cas.get(fc_ai.id), cas.get(fc_miss.id), cas.get(fc_new.id)
        ev_after = {e.id for e in (await db.execute(select(Evidence).where(
            Evidence.control_assessment_id.in_([ids["human"], ids["ai"]])))).scalars()}
        gaps = {g.control_id for g in (await db.execute(select(ComplianceGap).where(
            ComplianceGap.assessment_id == aid))).scalars()}
        from app.models.compliance import ComplianceAssessment
        status = (await db.execute(select(ComplianceAssessment.ai_analysis_status).where(
            ComplianceAssessment.id == aid))).scalar_one()

    check(status == "completed", "analysis completed", status)
    check(h is not None and h.id == ids["human"] and h.status == ControlStatus.IMPLEMENTED
          and h.status_source == "human", "human row kept (same id, same status)")
    check(h.owner_id == me.id and h.notes == "Verified on site" and h.auditor_verdict == "conforme"
          and h.auditor_note == "seen", "owner, notes and auditor verdict preserved")
    check(h.ai_suggested_status == "not_implemented" and h.ai_confidence == 0.9,
          "AI opinion stored as a suggestion", (h.ai_suggested_status, h.ai_confidence))
    check(fc_h.id not in gaps, "no gap opened behind a human decision")
    check(ai is not None and ai.id == ids["ai"] and ai.status == ControlStatus.IMPLEMENTED
          and ai.status_source == "ai", "AI row updated in place (same id)")
    check(miss is not None and miss.id == ids["miss"] and miss.status == ControlStatus.PARTIALLY_IMPLEMENTED
          and miss.ai_confidence == 0.6, "missing verdict preserved")
    check(new is not None and new.status == ControlStatus.NOT_IMPLEMENTED and new.status_source == "ai"
          and fc_new.id in gaps, "new control created (with its gap)")
    check(ev_before and ev_before == ev_after, "evidence untouched", (len(ev_before), len(ev_after)))


def main() -> None:
    unit_tests()
    url = os.environ.get("DATABASE_URL", "")
    if url and "grc_dev.db" not in url:
        os.environ.setdefault("ENABLE_TRANSLATION_WORKER", "0")
        asyncio.run(run_tests())
    else:
        print("[run] skipped — set DATABASE_URL to a snapshot COPY to exercise the real analysis task")
    print(f"\n{PASSES} passed, {len(FAILS)} failed")
    if FAILS:
        for f in FAILS:
            print("  -", f)
        sys.exit(1)


if __name__ == "__main__":
    main()
