"""Matrix-driven risk scoring.

Resolves the tenant's active RiskMatrix and turns a (likelihood, impact) pair into
a numeric score + qualitative level, replacing the old hardcoded 5x5 thresholds
that were duplicated (and divergent) across risks.py and risk_scenarios.py.

This module is the single source of truth for the builtin matrices — the
risk_matrices endpoint imports the constants from here.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.risk import RiskSeverity
from app.models.risk_matrix import RiskMatrix

# --- Canonical builtin matrices (single source of truth) --------------------
DEFAULT_MATRIX_5X5 = {
    "probability": {"count": 5, "labels": ["Very Low", "Low", "Medium", "High", "Very High"]},
    "impact": {"count": 5, "labels": ["Negligible", "Minor", "Moderate", "Major", "Catastrophic"]},
    "risk_levels": [
        {"name": "low", "color": "#22c55e", "min_score": 1, "max_score": 6},
        {"name": "medium", "color": "#eab308", "min_score": 7, "max_score": 12},
        {"name": "high", "color": "#f97316", "min_score": 13, "max_score": 18},
        {"name": "critical", "color": "#ef4444", "min_score": 19, "max_score": 25},
    ],
    "grid": [[1, 2, 3, 4, 5], [2, 4, 6, 8, 10], [3, 6, 9, 12, 15], [4, 8, 12, 16, 20], [5, 10, 15, 20, 25]],
}
DEFAULT_MATRIX_3X3 = {
    "probability": {"count": 3, "labels": ["Low", "Medium", "High"]},
    "impact": {"count": 3, "labels": ["Low", "Medium", "High"]},
    "risk_levels": [
        {"name": "low", "color": "#22c55e", "min_score": 1, "max_score": 3},
        {"name": "medium", "color": "#eab308", "min_score": 4, "max_score": 6},
        {"name": "high", "color": "#ef4444", "min_score": 7, "max_score": 9},
    ],
    "grid": [[1, 2, 3], [2, 4, 6], [3, 6, 9]],
}

_LEVEL_TO_SEVERITY = {
    "critical": RiskSeverity.CRITICAL,
    "very high": RiskSeverity.CRITICAL,
    "high": RiskSeverity.HIGH,
    "medium": RiskSeverity.MEDIUM,
    "moderate": RiskSeverity.MEDIUM,
    "low": RiskSeverity.LOW,
    "very low": RiskSeverity.LOW,
    "info": RiskSeverity.INFO,
    "negligible": RiskSeverity.INFO,
}


def level_to_severity(level: str | None) -> RiskSeverity | None:
    """Map a matrix risk-level name to the RiskSeverity enum (best effort)."""
    if not level:
        return None
    return _LEVEL_TO_SEVERITY.get(str(level).strip().lower())


def _level_for_score(definition: dict, score: float) -> str | None:
    """Find the risk_levels band that contains `score`."""
    levels = (definition or {}).get("risk_levels") or DEFAULT_MATRIX_5X5["risk_levels"]
    for band in levels:
        lo, hi = band.get("min_score"), band.get("max_score")
        if lo is not None and hi is not None and lo <= score <= hi:
            return band.get("name")
    # Fallback: highest band whose min_score <= score (handles scores above the top band).
    chosen = None
    for band in levels:
        lo = band.get("min_score")
        if lo is not None and score >= lo:
            chosen = band.get("name")
    return chosen or (levels[-1].get("name") if levels else None)


def score_and_level(definition: dict | None, likelihood: float | None, impact: float | None) -> tuple[float | None, str | None]:
    """Return (score, level_name) for a (likelihood, impact) pair using a matrix definition.

    likelihood/impact are 1-based scale positions; out-of-range values are clamped to
    the grid so a mis-entered value never raises.
    """
    if not likelihood or not impact:
        return None, None
    grid = (definition or {}).get("grid") or DEFAULT_MATRIX_5X5["grid"]
    if not grid:
        return None, None
    li = max(1, min(int(round(likelihood)), len(grid)))
    row = grid[li - 1]
    if not row:
        return None, None
    ii = max(1, min(int(round(impact)), len(row)))
    score = row[ii - 1]
    return score, _level_for_score(definition, score)


def severity_for(definition: dict | None, likelihood: float | None, impact: float | None) -> RiskSeverity | None:
    """Convenience: matrix-derived RiskSeverity for a (likelihood, impact) pair."""
    _, level = score_and_level(definition, likelihood, impact)
    return level_to_severity(level)


async def resolve_matrix(db: AsyncSession, tenant_id: str, matrix_id: str | None = None) -> tuple[dict, str]:
    """Resolve the active risk-matrix definition + display name for a tenant.

    Priority: explicit matrix_id (real row) -> the "builtin-*" sentinels -> tenant's
    default matrix -> a builtin default row (if seeded) -> DEFAULT_MATRIX_5X5. Always
    returns a usable definition, even when the tenant has no matrices at all.
    """
    if matrix_id:
        if matrix_id == "builtin-3x3":
            return DEFAULT_MATRIX_3X3, "Simple 3x3 Matrix"
        if matrix_id == "builtin-5x5":
            return DEFAULT_MATRIX_5X5, "Standard 5x5 Matrix"
        # Only a matrix the tenant owns (or a shared builtin) may drive their scoring —
        # never another tenant's, even if a forged risk_matrix_id is supplied.
        m = (await db.execute(
            select(RiskMatrix).where(
                RiskMatrix.id == matrix_id,
                (RiskMatrix.tenant_id == tenant_id) | (RiskMatrix.is_builtin == True),  # noqa: E712
            )
        )).scalar_one_or_none()
        if m and m.definition:
            return m.definition, m.name

    # Tenant's own default matrix.
    m = (await db.execute(
        select(RiskMatrix)
        .where(RiskMatrix.tenant_id == tenant_id, RiskMatrix.is_default == True)  # noqa: E712
        .order_by(RiskMatrix.created_at.desc())
    )).scalars().first()
    if m and m.definition:
        return m.definition, m.name

    # A seeded builtin default row, if any.
    m = (await db.execute(
        select(RiskMatrix).where(RiskMatrix.is_builtin == True, RiskMatrix.is_default == True)  # noqa: E712
    )).scalars().first()
    if m and m.definition:
        return m.definition, m.name

    return DEFAULT_MATRIX_5X5, "Standard 5x5 Matrix"
