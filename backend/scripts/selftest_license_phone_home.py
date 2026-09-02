"""Self-test for the license phone-home feature: the vendor-side check-in
endpoint (app.api.v1.endpoints.license_server) and the appliance-side
scheduler tick (app.services.license_phone_home).

Uses a throwaway on-disk sqlite DB (DATABASE_URL is pointed at it before any
app module is imported, so app.core.database's module-level engine picks it
up) rather than the real grc_dev.db. Not pytest — mirrors this repo's other
scripts/selftest_*.py: plain asserts, PASS/FAIL per case, non-zero exit on
failure.

Usage (from backend/):
    venv/bin/python scripts/selftest_license_phone_home.py
"""
import asyncio
import os
import sys
import tempfile
import traceback
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_TMP_DB = Path(tempfile.gettempdir()) / f"selftest_license_phone_home_{uuid4().hex}.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP_DB}"

from sqlalchemy import delete  # noqa: E402

from app.core.database import Base, engine, AsyncSessionLocal  # noqa: E402
from app.core.licensing import sign_license, generate_keypair  # noqa: E402
from app.models.license import IssuedLicense, LicenseActivation  # noqa: E402
from app.api.v1.endpoints.license_server import VerifyLicenseRequest, verify_license_checkin  # noqa: E402
from app.services.license_client import LicenseServerError  # noqa: E402
from app.services import license_phone_home  # noqa: E402

PRIVATE_KEY, PUBLIC_KEY = generate_keypair()


async def _init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _reset_tables() -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(IssuedLicense))
        await db.execute(delete(LicenseActivation))
        await db.commit()


def _sign(lid: str, plan: str = "enterprise") -> str:
    return sign_license(
        {
            "lid": lid,
            "product": "grc-platform",
            "customer": "Acme Corp",
            "email": "it@acme.com",
            "plan": plan,
            "issued_at": "2026-01-01T00:00:00Z",
            "expires_at": "2027-01-01T00:00:00Z",
        },
        PRIVATE_KEY,
    )


async def _issue(lid: str, key: str, status: str = "active") -> None:
    async with AsyncSessionLocal() as db:
        db.add(IssuedLicense(
            customer_name="Acme Corp", contact_email="it@acme.com", license_key=key,
            lid=lid, plan="enterprise", issued_at="2026-01-01T00:00:00Z",
            expires_at="2027-01-01T00:00:00Z", created_by="super@platform.com", status=status,
        ))
        await db.commit()


async def _activate(lid: str, key: str, expires_at: str = "2027-01-01T00:00:00Z") -> None:
    async with AsyncSessionLocal() as db:
        db.add(LicenseActivation(
            license_key=key, lid=lid, customer_name="Acme Corp", contact_email="it@acme.com",
            plan="enterprise", issued_at="2026-01-01T00:00:00Z", expires_at=expires_at,
            activated_at="2026-01-01T00:00:00Z", activated_by="admin@acme.com",
            last_seen_at="2026-01-01T00:00:00Z",
        ))
        await db.commit()


async def _latest_activation() -> LicenseActivation | None:
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(LicenseActivation).order_by(LicenseActivation.activated_at.desc()).limit(1)
        )
        return result.scalars().first()


# ── Vendor-side endpoint: POST /api/v1/licenses/verify ──────────────────────

def test_verify_endpoint_active_license():
    async def _run():
        await _reset_tables()
        lid = uuid4().hex
        key = _sign(lid)
        await _issue(lid, key, status="active")
        async with AsyncSessionLocal() as db:
            resp = await verify_license_checkin(
                VerifyLicenseRequest(license_key=key, machine_id="box-1"), db
            )
        assert resp.status == "active", resp.status
    asyncio.run(_run())


def test_verify_endpoint_revoked_license():
    async def _run():
        await _reset_tables()
        lid = uuid4().hex
        key = _sign(lid)
        await _issue(lid, key, status="revoked")
        async with AsyncSessionLocal() as db:
            resp = await verify_license_checkin(
                VerifyLicenseRequest(license_key=key, machine_id="box-1"), db
            )
        assert resp.status == "revoked", resp.status
    asyncio.run(_run())


def test_verify_endpoint_unknown_and_malformed_and_tampered_keys():
    async def _run():
        await _reset_tables()
        lid = uuid4().hex
        key = _sign(lid)
        # never issued
        async with AsyncSessionLocal() as db:
            resp = await verify_license_checkin(
                VerifyLicenseRequest(license_key=key, machine_id=""), db
            )
        assert resp.status == "not_found", resp.status

        # garbage input never raises
        async with AsyncSessionLocal() as db:
            resp = await verify_license_checkin(
                VerifyLicenseRequest(license_key="not-a-license-key", machine_id=""), db
            )
        assert resp.status == "not_found", resp.status

        # correct lid but a tampered/different key string than what was issued
        await _issue(lid, key, status="active")
        other_key = _sign(uuid4().hex)  # different lid entirely, but let's also try same-lid tamper
        tampered = key[:-1] + ("A" if key[-1] != "A" else "B")
        async with AsyncSessionLocal() as db:
            resp = await verify_license_checkin(
                VerifyLicenseRequest(license_key=tampered, machine_id=""), db
            )
        assert resp.status == "not_found", resp.status
        assert other_key != key  # sanity: helper actually produced a distinct key
    asyncio.run(_run())


# ── Appliance-side tick: license_phone_home._run_once ────────────────────────

def test_phone_home_revoked_expires_activation_locally():
    async def _run():
        await _reset_tables()
        lid = uuid4().hex
        key = _sign(lid)
        await _activate(lid, key, expires_at="2027-01-01T00:00:00Z")

        with patch.object(license_phone_home, "verify_license_status", return_value="revoked"):
            with patch.object(license_phone_home, "invalidate_license_cache") as mock_invalidate:
                await license_phone_home._run_once()
                assert mock_invalidate.called

        activation = await _latest_activation()
        assert activation is not None
        # Expired into the past, not just "changed" — must be before "now".
        from datetime import datetime, timezone
        expires = datetime.fromisoformat(activation.expires_at.replace("Z", "+00:00"))
        assert expires <= datetime.now(timezone.utc)
    asyncio.run(_run())


def test_phone_home_active_leaves_activation_untouched():
    async def _run():
        await _reset_tables()
        lid = uuid4().hex
        key = _sign(lid)
        original_expiry = "2027-06-01T00:00:00Z"
        await _activate(lid, key, expires_at=original_expiry)

        async def fake_active(_key):
            return "active"

        with patch.object(license_phone_home, "verify_license_status", side_effect=fake_active):
            await license_phone_home._run_once()

        activation = await _latest_activation()
        assert activation.expires_at == original_expiry, activation.expires_at
    asyncio.run(_run())


def test_phone_home_fails_open_on_network_error():
    async def _run():
        await _reset_tables()
        lid = uuid4().hex
        key = _sign(lid)
        original_expiry = "2027-06-01T00:00:00Z"
        await _activate(lid, key, expires_at=original_expiry)

        async def raise_error(_key):
            raise LicenseServerError("timeout")

        with patch.object(license_phone_home, "verify_license_status", side_effect=raise_error):
            await license_phone_home._run_once()  # must not raise

        activation = await _latest_activation()
        assert activation.expires_at == original_expiry, activation.expires_at
    asyncio.run(_run())


def test_phone_home_not_found_leaves_activation_untouched():
    """A deleted/migrated vendor record must not be treated as revocation."""
    async def _run():
        await _reset_tables()
        lid = uuid4().hex
        key = _sign(lid)
        original_expiry = "2027-06-01T00:00:00Z"
        await _activate(lid, key, expires_at=original_expiry)

        async def fake_not_found(_key):
            return "not_found"

        with patch.object(license_phone_home, "verify_license_status", side_effect=fake_not_found):
            await license_phone_home._run_once()

        activation = await _latest_activation()
        assert activation.expires_at == original_expiry, activation.expires_at
    asyncio.run(_run())


def test_phone_home_noop_with_no_activation():
    async def _run():
        await _reset_tables()
        with patch.object(license_phone_home, "verify_license_status") as mock_verify:
            await license_phone_home._run_once()
            assert not mock_verify.called
    asyncio.run(_run())


CASES = [
    test_verify_endpoint_active_license,
    test_verify_endpoint_revoked_license,
    test_verify_endpoint_unknown_and_malformed_and_tampered_keys,
    test_phone_home_revoked_expires_activation_locally,
    test_phone_home_active_leaves_activation_untouched,
    test_phone_home_fails_open_on_network_error,
    test_phone_home_not_found_leaves_activation_untouched,
    test_phone_home_noop_with_no_activation,
]


def main() -> int:
    asyncio.run(_init_db())
    failures = 0
    for case in CASES:
        try:
            case()
        except Exception:
            failures += 1
            print(f"FAIL  {case.__name__}")
            traceback.print_exc()
        else:
            print(f"PASS  {case.__name__}")

    asyncio.run(engine.dispose())
    _TMP_DB.unlink(missing_ok=True)
    for suffix in ("-wal", "-shm"):
        Path(str(_TMP_DB) + suffix).unlink(missing_ok=True)

    total = len(CASES)
    print(f"\n{total - failures}/{total} passed" + ("" if not failures else f", {failures} FAILED"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
