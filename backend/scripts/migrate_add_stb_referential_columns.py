"""STB objectif 1 — classer chaque exigence par source, domaine et type.

The tender requires « Chaque exigence est classée par source (norme/réglementation),
domaine, type, et applicabilité ». Today a control carries only framework_id +
a free-text `category` (157 distinct values, case-split), and nothing anywhere
records whether a framework is a standard, a regulation, a law or an internal
policy. Adds:

  frameworks.source_type              norme | reglementation | loi | politique_interne
  frameworks.cloned_from_framework_id lineage, so a forked copy can be diffed
                                       against the built-in it came from
  framework_controls.domain           controlled vocabulary, backfilled from
                                       `category` by backfill_control_domain.py
  framework_controls.requirement_type exigence | recommandation | mesure

`applicabilité` is deliberately NOT a column here: it is per-organisation and
per-perimeter, so it lives in the control_applicability table created by
create_all(), not on the shared built-in control rows.

    python -m scripts.migrate_add_stb_referential_columns
"""
from scripts._stb_migrate_common import run

TABLE_COLUMNS = {
    "frameworks": {
        "source_type": "VARCHAR(30)",
        "cloned_from_framework_id": "VARCHAR(36)",
    },
    "framework_controls": {
        "domain": "VARCHAR(80)",
        "requirement_type": "VARCHAR(30)",
    },
}

INDEXES = {
    "ix_frameworks_source_type": ("frameworks", "source_type"),
    "ix_framework_controls_domain": ("framework_controls", "domain"),
}

if __name__ == "__main__":
    raise SystemExit(run(TABLE_COLUMNS, INDEXES))
