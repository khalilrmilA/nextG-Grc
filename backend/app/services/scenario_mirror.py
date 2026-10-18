"""The risk-register entry a risk scenario creates — and what happens to it after.

Creating a scenario adds a matching Risk to the register (risk_scenarios.py,
``_new_linked_risk``; the scenario holds ``linked_risk_id``). Deleting the
scenario used to leave that Risk behind: still open, still scored, pointing at
nothing — and risks.delete_risk refuses to delete a scenario's register entry,
so nobody could clean it up either (follow-up C-5).

The rule:
* the mirror is **deleted** when nothing else rests on it — no other scenario,
  no treatment plan, no risk acceptance, no applied control, and no decision
  recorded on the risk itself (closed / accepted);
* otherwise it is **closed** with the automatic reason "Scenario deleted", so
  the plans and decisions that cite it keep a readable target.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.risk import Risk, RiskStatus, RiskTreatment
from app.models.risk_scenario import RiskScenario
from app.services import risk_versioning

SCENARIO_DELETED = "Scenario deleted"


async def links(db: AsyncSession, tenant_id: str, risk: Risk, *, ignoring_scenario: str | None = None) -> list[str]:
    """Why this risk must be kept (empty = nothing rests on it)."""
    from app.models.applied_control import AppliedControl
    from app.models.security_exception import RiskAcceptance

    why: list[str] = []
    status = getattr(risk.status, "value", risk.status)
    if status in (RiskStatus.CLOSED.value, RiskStatus.ACCEPTED.value):
        why.append(f"status {status}")
    q = select(func.count()).select_from(RiskScenario).where(
        RiskScenario.tenant_id == tenant_id, RiskScenario.linked_risk_id == risk.id)
    if ignoring_scenario:
        q = q.where(RiskScenario.id != ignoring_scenario)
    if (await db.execute(q)).scalar():
        why.append("another scenario")
    if (await db.execute(select(func.count()).select_from(RiskTreatment).where(
            RiskTreatment.risk_id == risk.id))).scalar():
        why.append("treatment plan")
    # risk_ids are JSON lists; few rows per tenant, so filter in Python (SQLite/PG alike).
    for model, label in ((RiskAcceptance, "risk acceptance"), (AppliedControl, "applied control")):
        rows = (await db.execute(select(model.risk_ids).where(model.tenant_id == tenant_id))).scalars().all()
        if any(risk.id in (r or []) for r in rows):
            why.append(label)
    return why


async def retire(db: AsyncSession, tenant_id: str, risk: Risk, actor, *, scenario_id: str | None = None,
                 scenario_name: str | None = None) -> str:
    """Delete the mirror, or close it when something rests on it. Caller commits.

    Returns "deleted", "closed" or "kept" (already closed/accepted — a decision
    somebody took is left exactly as it is).
    """
    from app.models.risk_version import RiskVersion

    why = await links(db, tenant_id, risk, ignoring_scenario=scenario_id)
    status = getattr(risk.status, "value", risk.status)
    if not why:
        for v in (await db.execute(select(RiskVersion).where(RiskVersion.risk_id == risk.id))).scalars().all():
            await db.delete(v)
        await db.delete(risk)
        return "deleted"
    if status in (RiskStatus.CLOSED.value, RiskStatus.ACCEPTED.value):
        return "kept"
    reason = SCENARIO_DELETED + (f": {scenario_name}" if scenario_name else "")
    await risk_versioning.archive(db, risk, actor, change_reason=reason,
                                  transition_from=status, transition_to=RiskStatus.CLOSED.value)
    risk.status = RiskStatus.CLOSED
    return "closed"
