"""License models — vendor-issued keys and the client-side activation record.

Datetimes are stored as ISO-8601 UTC strings (String(30)), matching the
Subscription model style.
"""
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Text
from app.core.database import Base


class IssuedLicense(Base):
    """A license key minted by a super admin on the vendor's SaaS server."""
    __tablename__ = "issued_licenses"

    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    license_key: Mapped[str] = mapped_column(Text, nullable=False)
    lid: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    plan: Mapped[str] = mapped_column(
        String(20), nullable=False, default="enterprise", server_default="enterprise"
    )
    issued_at: Mapped[str] = mapped_column(String(30), nullable=False)
    expires_at: Mapped[str] = mapped_column(String(30), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)  # super admin email


class LicenseActivation(Base):
    """The single activated license on a client install (at most one row)."""
    __tablename__ = "license_activations"

    license_key: Mapped[str] = mapped_column(Text, nullable=False)
    lid: Mapped[str] = mapped_column(String(36), nullable=False)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    plan: Mapped[str] = mapped_column(
        String(20), nullable=False, default="enterprise", server_default="enterprise"
    )
    issued_at: Mapped[str] = mapped_column(String(30), nullable=False)
    expires_at: Mapped[str] = mapped_column(String(30), nullable=False)
    activated_at: Mapped[str] = mapped_column(String(30), nullable=False)
    activated_by: Mapped[str] = mapped_column(String(255), nullable=False)  # activating user's email
    last_seen_at: Mapped[str] = mapped_column(String(30), nullable=False)   # clock-rollback guard
