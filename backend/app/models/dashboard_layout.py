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
from sqlalchemy import String, ForeignKey, JSON, UniqueConstraint
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
