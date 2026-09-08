"""STB / gap 19.d — rattacher un risque à un département et à un processus.

The risk register could not be filtered by département or by processus, although
Policy has carried org_entity_id and business_process_id since it was written and
compliance assessments gained the same scoping in the STB migration. Without these,
"les risques de la DSI" or "les risques du processus Crédit" cannot be answered, and
the register cannot be handed to a department head as their own list.

  risks.org_entity_id        département / entité porteuse du risque
  risks.business_process_id  processus métier concerné

Both nullable: every one of the 14 existing risks stays exactly as it is, and
GET /risks without the new filters returns precisely what it returns today.

    python -m scripts.migrate_add_risk_org_scope
"""
from scripts._stb_migrate_common import run

TABLE_COLUMNS = {
    "risks": {
        "org_entity_id": "VARCHAR(36)",
        "business_process_id": "VARCHAR(36)",
    },
}

INDEXES = {
    "ix_risks_org_entity": ("risks", "org_entity_id"),
    "ix_risks_process": ("risks", "business_process_id"),
}

if __name__ == "__main__":
    raise SystemExit(run(TABLE_COLUMNS, INDEXES))
