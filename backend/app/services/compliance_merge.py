"""Merge an AI analysis verdict into an existing control assessment row.

An AI re-run used to delete and recreate every ControlAssessment it re-judged —
and every Evidence row hanging off it — so a re-run silently erased the status a
person had set, the N/A justification, the owner's notes and the uploaded proof.

This module decides, for ONE control, what a verdict is allowed to change. It is
pure (no database, no AI) so the rules are testable on their own
(scripts/selftest_compliance_merge.py):

* the AI never overwrites a row a human set (``status_source == "human"``): it
  only records its opinion in the ``ai_suggested_*`` fields, which the UI shows
  as "AI suggests X" with an Accept button;
* a row the AI set before (or a NOT_STARTED placeholder) is updated in place;
* a control with no row gets one;
* a control the run produced no verdict for keeps its row exactly as it was;
* fields the AI never writes — owner, notes, auditor verdict — and the
  evidence are not touched in any case: this function does not even return them.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

HUMAN = "human"
AI = "ai"

# What each outcome means for the caller.
CREATED = "created"          # no row: create one with `fields`
UPDATED = "updated"          # AI-owned row: apply `fields` in place
SUGGESTED = "suggested"      # human-owned row: apply `fields` (suggestion only)
KEPT = "kept"                # no verdict this run: leave the row alone
PLACEHOLDER = "placeholder"  # no verdict and no row: create a not-started row

# Never part of a merge, whatever the outcome — the human's half of the row.
PROTECTED_FIELDS = frozenset({
    "owner_id", "notes", "auditor_verdict", "auditor_note",
    "auditor_verdict_by_id", "auditor_verdict_at",
})


@dataclass(frozen=True)
class AiVerdict:
    """The AI's verdict for one control, already mapped onto the platform's levels."""
    status: Any                         # ControlStatus (or its value)
    status_key: str | None = None       # level key on the assessment's grid, if any
    confidence: float | None = None
    notes: str | None = None            # the AI's explanation
    na_justification: str | None = None  # only meaningful for not_applicable


@dataclass
class MergeOutcome:
    kind: str
    fields: dict = field(default_factory=dict)

    @property
    def touches_status(self) -> bool:
        return "status" in self.fields


def _value(v: Any) -> Any:
    return getattr(v, "value", v)


def is_human(row: Any) -> bool:
    return row is not None and getattr(row, "status_source", None) == HUMAN


def merge_verdict(
    existing: Any,
    verdict: AiVerdict | None,
    *,
    now_iso: str,
    not_applicable_value: str = "not_applicable",
    placeholder_status: Any = "not_started",
    placeholder_status_key: str | None = None,
    placeholder_note: str | None = None,
) -> MergeOutcome:
    """What this run may write for one control.

    ``existing`` is the current row (any object with the ControlAssessment
    attributes) or None. The returned ``fields`` are attribute → value pairs for
    the caller to set (or to create the row with); nothing outside them changes.
    """
    if verdict is None:
        if existing is not None:
            return MergeOutcome(KEPT)
        return MergeOutcome(PLACEHOLDER, {
            "status": placeholder_status,
            "status_key": placeholder_status_key,
            "ai_confidence": None,
            "implementation_notes": placeholder_note,
            "status_source": AI,
        })

    confidence = None
    if verdict.confidence is not None:
        confidence = round(max(0.0, min(1.0, float(verdict.confidence))), 3)
    notes = (verdict.notes or "").strip() or None
    suggestion = {
        "ai_suggested_status": _value(verdict.status),
        "ai_suggested_status_key": verdict.status_key,
        "ai_suggested_notes": notes,
        "ai_suggested_at": now_iso,
        "ai_confidence": confidence,
    }

    if is_human(existing):
        # The person's decision stands; the AI's opinion sits beside it.
        return MergeOutcome(SUGGESTED, suggestion)

    is_na = _value(verdict.status) == not_applicable_value
    decided = {
        **suggestion,
        "status": verdict.status,
        "status_key": verdict.status_key,
        "implementation_notes": notes,
        "not_applicable_justification": ((verdict.na_justification or "").strip() or None) if is_na else None,
        "status_source": AI,
    }
    return MergeOutcome(CREATED if existing is None else UPDATED, decided)


def apply(row: Any, outcome: MergeOutcome) -> None:
    """Set the outcome's fields on an existing row (never a protected one)."""
    for name, value in outcome.fields.items():
        if name in PROTECTED_FIELDS:   # defensive: merge_verdict never emits them
            continue
        setattr(row, name, value)
