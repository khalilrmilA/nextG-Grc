"""
License key crypto + enforcement helpers.

Key format: base64url(payload_json_bytes) + "." + base64url(ed25519_signature)
with '=' padding stripped from both parts. The signature covers the EXACT
payload bytes embedded in the key — verification never re-serializes the JSON.

Payload keys: lid (uuid4 hex), product ("grc-platform"), customer, email,
issued_at, expires_at (ISO-8601 UTC, e.g. "2027-08-10T00:00:00Z").

Enforcement is the OR of a build-time constant (baked into protected client
builds, see app/core/build_info.py) and the LICENSE_ENFORCEMENT setting —
both default off, so the SaaS deployment is unaffected.
"""
import base64
import json

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from app.core import build_info
from app.core.config import settings

LICENSE_PRODUCT = "grc-platform"

# License plans mirror SubscriptionTier values. Enterprise is the default — it
# unlocks every module/feature, which is what most self-hosted clients receive.
LICENSE_PLANS = ("starter", "professional", "enterprise")
DEFAULT_LICENSE_PLAN = "enterprise"


def normalize_plan(value: str | None) -> str:
    """Coerce any input to a known plan, falling back to the default."""
    v = (value or "").strip().lower()
    return v if v in LICENSE_PLANS else DEFAULT_LICENSE_PLAN


# ── base64url helpers (padding stripped) ─────────────────────────────────────

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


# ── Keypair / sign / verify ──────────────────────────────────────────────────

def generate_keypair() -> tuple[str, str]:
    """Generate an Ed25519 keypair.

    Returns (private_b64, public_b64): standard base64 of the 32-byte private
    seed and the 32-byte raw public key.
    """
    private = Ed25519PrivateKey.generate()
    private_b64 = base64.b64encode(private.private_bytes_raw()).decode("ascii")
    public_b64 = base64.b64encode(private.public_key().public_bytes_raw()).decode("ascii")
    return private_b64, public_b64


def sign_license(payload: dict, private_key_b64: str) -> str:
    """Serialize the payload (compact JSON), sign it, and return the key string."""
    payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    private = Ed25519PrivateKey.from_private_bytes(base64.b64decode(private_key_b64))
    signature = private.sign(payload_bytes)
    return f"{_b64url_encode(payload_bytes)}.{_b64url_encode(signature)}"


def parse_lid(key: str) -> str | None:
    """Best-effort extraction of the `lid` from a key's payload, unverified.

    For callers that only need to look a key up (e.g. the vendor's
    POST /api/v1/licenses/verify, which authenticates by exact-matching the
    submitted key against its own stored record rather than by checking a
    signature it has no reason to hold a public key for). Returns None on any
    malformed input instead of raising — this is a lookup hint, not a trust
    decision.
    """
    try:
        payload_part = key.strip().split(".")[0]
        payload = json.loads(_b64url_decode(payload_part))
        lid = payload.get("lid")
        return lid if isinstance(lid, str) else None
    except Exception:
        return None


def verify_license(key: str, public_key_b64: str) -> dict:
    """Verify a license key and return its payload dict.

    Raises ValueError on any problem: bad format, bad base64, signature
    mismatch, non-JSON payload, or wrong product. The signature is checked
    over the exact base64url-decoded payload bytes.
    """
    try:
        payload_part, signature_part = key.strip().split(".")
        payload_bytes = _b64url_decode(payload_part)
        signature = _b64url_decode(signature_part)
        public = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
        public.verify(signature, payload_bytes)
        payload = json.loads(payload_bytes)
    except Exception as exc:
        raise ValueError("Invalid license key") from exc
    if not isinstance(payload, dict) or payload.get("product") != LICENSE_PRODUCT:
        raise ValueError("Invalid license key")
    return payload


# ── Effective enforcement configuration ──────────────────────────────────────

def enforcement_enabled() -> bool:
    """True when the build constant OR the env setting turns enforcement on."""
    return build_info.LICENSED_BUILD or settings.LICENSE_ENFORCEMENT


def effective_public_key() -> str:
    """Build-time public key wins; env setting is the fallback."""
    return build_info.LICENSE_PUBLIC_KEY or settings.LICENSE_PUBLIC_KEY


# ── Middleware verdict cache ─────────────────────────────────────────────────
# The enforcement middleware re-reads the activation row from the DB at most
# every LICENSE_CACHE_TTL_SECONDS. `verdict` is None when the cache is cold.

LICENSE_CACHE_TTL_SECONDS = 60

license_cache: dict = {"verdict": None, "checked_at": 0.0}


def invalidate_license_cache() -> None:
    """Force the middleware to re-read the activation row on the next request.

    Called from the /license/activate endpoint so activation takes effect
    instantly instead of after the cache TTL.
    """
    license_cache["verdict"] = None
    license_cache["checked_at"] = 0.0
