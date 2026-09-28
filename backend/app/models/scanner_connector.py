"""Vulnerability-scanner connector configuration (Elite Pack, RFP module 3).

Stores how to reach a scanner platform (Nessus/Tenable, Qualys, OpenVAS) so the
system can pull findings on a schedule or on demand — the 'connector' integration
the RFP requires alongside file import. New table (create_all).

NOTE: api_key/api_secret are stored as-is for the on-prem single-tenant install;
encryption-at-rest is a documented follow-up (see MULTI_DB/security notes).
"""
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean, Integer, DateTime, ForeignKey, JSON
from app.core.database import Base


class ScannerConnector(Base):
    __tablename__ = "scanner_connectors"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    tool: Mapped[str] = mapped_column(String(20), nullable=False)  # tenable|nessus|qualys|openvas|demo
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    api_key: Mapped[str | None] = mapped_column(String(500), nullable=True)     # access key / username
    api_secret: Mapped[str | None] = mapped_column(String(500), nullable=True)  # secret key / password
    verify_ssl: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    schedule_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    interval_hours: Mapped[int] = mapped_column(Integer, default=168, nullable=False)  # weekly
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(50), nullable=True)


class ScannerConnectorSettings(Base):
    """Tool-specific, NON-secret configuration for a connector (one row each).

    A separate table rather than new columns on ``scanner_connectors``: the live
    database takes new columns only by a hand-written ALTER, while a new table is
    created by ``create_all()`` at startup. Used by the configurable EASM
    connector (auth style, endpoint paths, field mapping — see
    app/services/easm_connector.py). Credentials never go here; they stay in
    ``ScannerConnector.api_key`` / ``api_secret``. Deleted with its connector
    (explicitly, in the delete endpoint — SQLite does not enforce the FK).
    """
    __tablename__ = "scanner_connector_settings"

    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )
    connector_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("scanner_connectors.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
