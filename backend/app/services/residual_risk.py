"""Residual risk from inherent risk and the effectiveness of the controls in place.

The requirement is explicit that the inputs are "les scores d'impact, de
probabilité, **et l'efficacité des contrôles**". Residual likelihood and impact
were entered by hand and had no connection to the controls attached to the risk,
so an organisation could evaluate every control as non-performant and its
residual risk would not move.

This computes a **suggestion**, and deliberately does not overwrite what an
assessor entered. The two are different claims: the computed figure says what
the control evidence implies, the entered figure is the assessor's judgement
having seen the context. Silently replacing one with the other would destroy the
judgement and leave no trace that it ever differed — the screen shows both and
the assessor decides.

Method, stated so it can be reviewed and challenged rather than reverse-engineered:

    effectiveness  = mean over the risk's controls of that control's latest
                     evaluation, mapped performant 1.0 / moyennement 0.5 /
                     non-performant 0.1
    coverage       = fraction of those controls that are active AND validated
    mitigation     = effectiveness * coverage        (0 .. 1)
    residual score = inherent score * (1 - mitigation)

Two deliberate choices. A control that exists but is neither active nor signed
off contributes nothing, because an unverified control is not a mitigation. And
a non-performant control keeps a floor of 0.1 rather than 0, because a control
that scores badly is rarely worth exactly nothing, and treating it as zero makes
the arithmetic swing on a single bad evaluation.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.applied_control import AppliedControl
from app.models.control_evaluation import (
    MOYENNEMENT,
    NON_PERFORMANT,
    PERFORMANT,
    ControlEvaluation,
)

# Performance level -> how much of the risk that control is credited with removing.
EFFECTIVENESS = {PERFORMANT: 1.0, MOYENNEMENT: 0.5, NON_PERFORMANT: 0.1}

# A control only counts as a mitigation once it is operating and signed off.
COUNTS_AS_ACTIVE = {"active", "in_progress"}


async def compute(
    db: AsyncSession, tenant_id: str, control_ids: list[str], inherent_score: float | None
) -> dict:
    """Suggested residual score for one risk, with the reasoning shown.

    Returns the inputs as well as the result so the screen can explain the
    number rather than assert it — a residual figure nobody can account for is
    one nobody will defend in an audit.
    """
    out: dict = {
        "inherent_score": inherent_score,
        "control_count": 0,
        "evaluated_count": 0,
        "effectiveness": None,
        "coverage": None,
        "mitigation": None,
        "suggested_residual_score": None,
        "controls": [],
    }
    if not control_ids:
        return out

    controls = (await db.execute(
        select(AppliedControl).where(
            AppliedControl.tenant_id == tenant_id, AppliedControl.id.in_(list(control_ids))
        )
    )).scalars().all()
    if not controls:
        return out
    out["control_count"] = len(controls)

    # Latest evaluation per control, in one query.
    evaluations = (await db.execute(
        select(ControlEvaluation)
        .where(ControlEvaluation.tenant_id == tenant_id,
               ControlEvaluation.applied_control_id.in_([c.id for c in controls]))
        .order_by(ControlEvaluation.evaluated_at.desc().nullslast())
    )).scalars().all()
    latest: dict = {}
    for ev in evaluations:
        latest.setdefault(ev.applied_control_id, ev)

    scores, counted = [], 0
    for c in controls:
        status = c.status.value if hasattr(c.status, "value") else str(c.status or "")
        validation = c.validation_status.value if hasattr(c.validation_status, "value") else str(c.validation_status or "")
        operating = status in COUNTS_AS_ACTIVE and validation == "validated"
        ev = latest.get(c.id)
        level = ev.performance_level if ev else None
        if ev is not None:
            scores.append(EFFECTIVENESS.get(level, 0.1))
        if operating:
            counted += 1
        out["controls"].append({
            "id": c.id, "ref_id": c.ref_id, "name": c.name,
            "status": status, "validation_status": validation,
            "performance_level": level,
            "counts_as_mitigation": operating,
        })

    out["evaluated_count"] = len(scores)
    if not scores:
        # Controls exist but none has been evaluated. Deliberately no number:
        # claiming a mitigation with no evidence behind it is worse than saying
        # "not yet measurable".
        return out

    effectiveness = sum(scores) / len(scores)
    coverage = counted / len(controls)
    mitigation = effectiveness * coverage
    out["effectiveness"] = round(effectiveness, 3)
    out["coverage"] = round(coverage, 3)
    out["mitigation"] = round(mitigation, 3)
    if inherent_score is not None:
        out["suggested_residual_score"] = round(inherent_score * (1 - mitigation), 2)
    return out
