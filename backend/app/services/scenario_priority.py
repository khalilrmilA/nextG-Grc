"""Configurable prioritisation for risk scenarios.

The requirement is that the criteria be configurable "selon la politique de
gestion des risques de l'organisation". The formula was hard-coded:
``matrix_score * (1 + regulatory_exposure_weight)``. Two organisations with
different risk policies got the same ranking.

The probability x impact part stays where it belongs — the tenant's own risk
matrix, which is already configurable and is the organisation's stated policy
for that axis. What is configurable here is the layer on top: how strongly
regulatory exposure amplifies a score, whether the criticality of the assets in
the chain contributes at all, and the score above which the people responsible
are told.

Defaults reproduce the previous formula exactly (regulatory multiplier 1.0,
asset criticality 0.0), so an organisation that never opens the settings sees
no change in its rankings.
"""
from app.services import risk_scoring

# Stored under Tenant.settings["risk_priority"].
DEFAULT_CRITERIA: dict = {
    # How strongly regulatory exposure amplifies. 0 ignores it entirely;
    # 1.0 is the previous behaviour (max exposure doubles the score).
    "regulatory_multiplier": 1.0,
    # How strongly the criticality of the most critical asset in the chain
    # amplifies. 0 is the previous behaviour — asset criticality did not count.
    "asset_criticality_multiplier": 0.0,
    # Priority score at or above which the scenario owner and the CISO are
    # notified. None disables the alert.
    "alert_threshold": None,
}

# Asset criticality -> 0..1. Mirrors the vocabulary the asset register uses.
_CRITICALITY = {"critical": 1.0, "high": 0.75, "medium": 0.5, "low": 0.25}


def resolve_criteria(tenant_settings: dict | None) -> dict:
    """Effective criteria: the tenant's overrides on top of the defaults."""
    criteria = dict(DEFAULT_CRITERIA)
    if isinstance(tenant_settings, dict):
        override = tenant_settings.get("risk_priority")
        if isinstance(override, dict):
            for key in DEFAULT_CRITERIA:
                if key in override:
                    criteria[key] = override[key]
    return criteria


def _clamp(value, low: float, high: float, default: float) -> float:
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return default


def compute(
    definition: dict | None,
    probability,
    impact,
    regulatory_exposure_weight: float | None,
    criteria: dict | None = None,
    asset_criticality: str | None = None,
) -> float | None:
    """Priority score for one scenario, or None when it has not been rated yet.

    A scenario with no probability or impact is deliberately unscored rather
    than scored zero: "not yet assessed" and "assessed as negligible" are
    different statements, and ranking them together hides the first.
    """
    score, _level = risk_scoring.score_and_level(definition, probability, impact)
    if score is None:
        return None

    criteria = criteria or DEFAULT_CRITERIA
    reg_mult = _clamp(criteria.get("regulatory_multiplier", 1.0), 0.0, 5.0, 1.0)
    asset_mult = _clamp(criteria.get("asset_criticality_multiplier", 0.0), 0.0, 5.0, 0.0)

    reg = _clamp(regulatory_exposure_weight or 0.0, 0.0, 1.0, 0.0)
    result = score * (1 + reg_mult * reg)

    if asset_mult:
        crit = _CRITICALITY.get((asset_criticality or "").strip().lower(), 0.0)
        result *= (1 + asset_mult * crit)

    return round(result, 2)


def over_threshold(priority_score: float | None, criteria: dict) -> bool:
    threshold = criteria.get("alert_threshold")
    if threshold is None or priority_score is None:
        return False
    try:
        return priority_score >= float(threshold)
    except (TypeError, ValueError):
        return False
