"""STB objectifs 2 & 3 — périmètre d'évaluation, échelle, et plan d'action.

Objectif 2 requires evaluating « des processus, départements ou systèmes » against
the requirements, on a « grille d'évaluation personnalisable ». Today an assessment
is scoped only to (tenant, framework) and the conformity scale is a hard-coded
enum. Objectif 3 requires corrective *and* preventive actions, each tied to the
unmet requirement, with recurrence for the preventive ones.

  compliance_assessments.scope_type           tenant | process | org_entity | asset
  compliance_assessments.org_entity_id        département / entité évaluée
  compliance_assessments.business_process_id  processus évalué
  compliance_assessments.scale_id             FK -> compliance_scales (custom grid)

  control_assessments.status_key         key within the custom scale, when one is used
  control_assessments.auditor_verdict     the auditor's own conformity level, kept
                                          separate from the owner's self-assessment
  control_assessments.auditor_note
  control_assessments.auditor_verdict_by_id
  control_assessments.auditor_verdict_at

  action_items.action_type        corrective | preventive
  action_items.finding_id         links an action to an audit finding, so the same
                                  action-plan machinery serves objectifs 3 and 7
  action_items.recurrence         none | monthly | quarterly | semiannual | annual
  action_items.next_occurrence_at next spawn date for a recurring preventive action

    python -m scripts.migrate_add_stb_compliance_columns
"""
from scripts._stb_migrate_common import run

TABLE_COLUMNS = {
    "compliance_assessments": {
        "scope_type": "VARCHAR(20)",
        "org_entity_id": "VARCHAR(36)",
        "business_process_id": "VARCHAR(36)",
        "scale_id": "VARCHAR(36)",
    },
    "control_assessments": {
        "status_key": "VARCHAR(40)",
        "auditor_verdict": "VARCHAR(40)",
        "auditor_note": "TEXT",
        "auditor_verdict_by_id": "VARCHAR(36)",
        "auditor_verdict_at": "DATETIME",
    },
    "action_items": {
        "action_type": "VARCHAR(20) DEFAULT 'corrective'",
        "finding_id": "VARCHAR(36)",
        "recurrence": "VARCHAR(20)",
        "next_occurrence_at": "VARCHAR(20)",
    },
}

INDEXES = {
    "ix_assessments_process": ("compliance_assessments", "business_process_id"),
    "ix_assessments_org_entity": ("compliance_assessments", "org_entity_id"),
    "ix_action_items_finding": ("action_items", "finding_id"),
}

if __name__ == "__main__":
    raise SystemExit(run(TABLE_COLUMNS, INDEXES))
