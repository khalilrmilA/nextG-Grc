"""STB objectif 1 — « mise à jour en temps réel ou selon un intervalle configuré ».

The tender asks that a dashboard refresh itself, either live or on a cadence the
customer configures. The platform stored no cadence anywhere: DashboardLayout
held the widget list and nothing else, and the SPA refetched only on navigation.
Adds:

  dashboard_layouts.refresh_interval_seconds   NULL = never configured (client
                                               default), 0 = auto-refresh off,
                                               n = every n seconds (the API
                                               bounds n to 30..3600)

This is a NEW COLUMN on an EXISTING table. `dashboard_layouts` was created by
create_all() long ago, so create_all() will never revisit it — without this pass
every ORM read of DashboardLayout selects a column the database does not have,
which is an OperationalError, which is a 5xx, which hard-redirects the SPA to
/service-down. dashboard.py degrades gracefully in the meantime (it probes for
the column and falls back to a column-restricted query), but the feature stays
inert until this runs.

No index: the column is only ever read alongside the row it belongs to, which is
already reached through uq_dashboard_layout_user_key.

    python -m scripts.migrate_add_dashboard_refresh

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
"""
from scripts._stb_migrate_common import run

TABLE_COLUMNS = {
    "dashboard_layouts": {
        # No DEFAULT clause on purpose: NULL is a meaningful third state here
        # ("the user never chose"), distinct from 0 ("the user turned it off").
        "refresh_interval_seconds": "INTEGER",
    },
}

if __name__ == "__main__":
    raise SystemExit(run(TABLE_COLUMNS))
