"""STB objectifs 4 à 8 — périmètre, grille, cycle de vie du rapport, traçabilité.

Objectif 4 requires audits scoped « selon le périmètre défini (processus, entités,
systèmes) » and grouped into campaigns. Objectif 5 requires a « grille d'évaluation
personnalisable » and real attachments. Objectif 6 requires « validation du rapport
par l'équipe d'audit avant diffusion » — a workflow, not a download. Objectif 8
requires the register to survive: today DELETE /audits/{id} is a hard delete.

  audits.campaign_id       FK -> audit_campaigns (planification annuelle/semestrielle)
  audits.grid_id           FK -> audit_grids (grille personnalisable)
  audits.assessment_id     links an engagement to the compliance assessment it covers
  audits.process_ids       JSON list of BusinessProcess ids   -- périmètre
  audits.org_entity_ids    JSON list of OrgEntity ids         -- périmètre
  audits.asset_ids         JSON list of Asset ids             -- périmètre
  audits.audit_plan        the generated plan, persisted instead of discarded
  audits.report_status     draft | submitted | approved | rejected | issued
  audits.report_submitted_at / report_submitted_by_id
  audits.report_rejected_reason
  audits.report_issued_at  stamped only once approved -- gates diffusion
  audits.deleted_at / deleted_by_id   soft delete, filtered out of list_audits

  audit_findings.finding_type   nonconformity_major | nonconformity_minor |
                                observation | improvement  (« niveau de non-conformité »)
  audit_findings.closed_at / closed_by_id / closure_note / closure_evidence_id
                                « jusqu'à leur clôture effective » (objectif 7)

  audit_evidence.finding_id     attach a preuve to the constat it supports
  audit_evidence.file_path / file_size_bytes / content_type / file_sha256
                                real uploaded files; today the endpoint stores
                                caller-supplied strings and the table is empty
  audit_evidence.record_version supersede rather than overwrite

  auditor_assignments.audit_id  today an auditor is assigned to an *assessment*,
                                so the auditor portal cannot list its own audits

    python -m scripts.migrate_add_stb_audit_columns
"""
from scripts._stb_migrate_common import run

TABLE_COLUMNS = {
    "audits": {
        "campaign_id": "VARCHAR(36)",
        "grid_id": "VARCHAR(36)",
        "assessment_id": "VARCHAR(36)",
        "process_ids": "JSON",
        "org_entity_ids": "JSON",
        "asset_ids": "JSON",
        "audit_plan": "TEXT",
        "report_status": "VARCHAR(20) DEFAULT 'draft'",
        "report_submitted_at": "DATETIME",
        "report_submitted_by_id": "VARCHAR(36)",
        "report_rejected_reason": "TEXT",
        "report_issued_at": "DATETIME",
        "deleted_at": "DATETIME",
        "deleted_by_id": "VARCHAR(36)",
    },
    "audit_findings": {
        "finding_type": "VARCHAR(30)",
        "closed_at": "DATETIME",
        "closed_by_id": "VARCHAR(36)",
        "closure_note": "TEXT",
        "closure_evidence_id": "VARCHAR(36)",
    },
    "audit_evidence": {
        "finding_id": "VARCHAR(36)",
        "file_path": "VARCHAR(500)",
        "file_size_bytes": "INTEGER",
        "content_type": "VARCHAR(120)",
        "file_sha256": "VARCHAR(64)",
        "record_version": "INTEGER DEFAULT 1",
    },
    "auditor_assignments": {
        "audit_id": "VARCHAR(36)",
    },
}

INDEXES = {
    "ix_audits_campaign": ("audits", "campaign_id"),
    "ix_audits_deleted_at": ("audits", "deleted_at"),
    "ix_audit_evidence_finding": ("audit_evidence", "finding_id"),
    "ix_auditor_assignments_audit": ("auditor_assignments", "audit_id"),
}

if __name__ == "__main__":
    raise SystemExit(run(TABLE_COLUMNS, INDEXES))
