"""Per-user dashboard widget layout (Elite Pack, M14.9 partial: widget personalization).

The RFP gap: fixed tiles on the main Dashboard and the 7 Analytics module
dashboards (dashboards.py) — the `custom_dashboards` flag only gated access to
the dashboard SET, not any actual layout personalization. This table lets a
user save which tiles are visible and in what order, per dashboard.

One row per (user, dashboard_key) — dashboard_key is "main" for the primary
Dashboard, or a module key ("risks", "compliance", "assets", ...) for the
per-module Analytics dashboards. New table — Base.metadata.create_all() builds
it on next restart, no migration script needed (see CLAUDE.md).
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, ForeignKey, JSON, Integer, UniqueConstraint
from app.core.database import Base


class DashboardLayout(Base):
    """A user's saved widget visibility + order for one dashboard."""
    __tablename__ = "dashboard_layouts"
    __table_args__ = (
        UniqueConstraint("user_id", "dashboard_key", name="uq_dashboard_layout_user_key"),
    )

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    dashboard_key: Mapped[str] = mapped_column(String(50), nullable=False, default="main")

    # Ordered list of {"id": <widget-id>, "visible": <bool>}. List order IS the
    # display order the frontend renders — no drag-and-drop backend logic needed,
    # the client just persists the array it currently shows.
    widget_config: Mapped[list] = mapped_column(JSON, default=list)

    # --- STB objectif 1: « mise à jour ... selon un intervalle configuré » ----
    # The tender asks for dashboard freshness "en temps réel ou selon un
    # intervalle configuré". The platform had neither: no auto-refresh at all,
    # and nowhere to store a cadence. This is that cadence, in seconds, per user
    # per dashboard:
    #   NULL -> never configured, the client applies its own default
    #   0    -> auto-refresh explicitly OFF (manual reload only)
    #   n    -> refresh every n seconds, bounded 30..3600 by the API
    #
    # WARNING — this is a NEW COLUMN on an EXISTING table. create_all() only
    # creates missing *tables*, so it will NOT appear on any database that
    # already has dashboard_layouts (production does). The operator must run
    # scripts/migrate_add_dashboard_refresh.py; until then every ORM SELECT of
    # this model names a column that does not exist, so dashboard.py probes for
    # it and falls back to a column-restricted query rather than 500-ing (a 5xx
    # ejects the SPA to /service-down).
    refresh_interval_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
