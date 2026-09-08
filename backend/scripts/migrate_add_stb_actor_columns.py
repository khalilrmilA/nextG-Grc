"""STB objectifs 4 & 3 — auditeurs externes, et relances traduisibles.

Objectif 4 requires « Affectation des auditeurs internes ou externes » — the
platform has an `auditor` role but nothing distinguishes an external firm's
auditor from an employee. Objectif 3's « relances automatiques » must reach a
Tunisian bank in French and Arabic, so a notification cannot store an English
sentence: it stores the key and its parameters, and the client renders it with
t(). `title`/`message` stay populated as the fallback for existing rows and for
the e-mail leg.

  users.is_external    auditeur externe (cabinet)
  users.external_org   nom du cabinet

  notifications.title_key / message_key   i18n keys resolved client-side
  notifications.params                    JSON interpolation parameters

    python -m scripts.migrate_add_stb_actor_columns
"""
from scripts._stb_migrate_common import run

TABLE_COLUMNS = {
    "users": {
        "is_external": "BOOLEAN DEFAULT 0",
        "external_org": "VARCHAR(200)",
    },
    "notifications": {
        "title_key": "VARCHAR(120)",
        "message_key": "VARCHAR(120)",
        "params": "JSON",
    },
}

if __name__ == "__main__":
    raise SystemExit(run(TABLE_COLUMNS))
