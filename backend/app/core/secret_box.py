"""Authenticated encryption for secrets stored in the database.

Used for a tenant's own AI provider API key. That key belongs to the customer,
is worth real money, and must not sit in the database in clear text where a
backup, a support bundle or a stray SELECT would expose it.

Design notes:

- AES-256-GCM, so the ciphertext is authenticated. A tampered row fails to
  decrypt rather than decrypting to something attacker-chosen.
- The key is derived from SECRET_KEY with HKDF and a fixed info string, so this
  cannot decrypt anything else derived from the same secret, and vice versa.
- SECRET_KEY is already per-deployment: firstboot.sh generates a fresh 64 char
  value on every appliance, so two appliances never share an encryption key.
- Decryption NEVER raises to the caller. A rotated SECRET_KEY or a database
  restored onto a different deployment must degrade to "you need to re-enter the
  key", not a 500 on every AI request.

cryptography is already a dependency (app/core/licensing.py) and is already in
the Nuitka include list, so nothing new ships in the appliance for this.
"""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

# Bump the suffix if the scheme ever changes; stored values carry their version
# so old rows can be recognised rather than silently mis-decrypted.
_INFO = b"tenant-ai-key-v1"
_PREFIX = "v1"


def _derive_key() -> bytes:
    """32 bytes derived from SECRET_KEY, scoped to this purpose only."""
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=_INFO,
    ).derive(settings.SECRET_KEY.encode("utf-8"))


def encrypt(plaintext: str) -> str:
    """Encrypt a secret for storage. Returns "v1.<nonce>.<ciphertext>", base64.

    An empty string encrypts to an empty string: "no key set" stays trivially
    distinguishable from "a key that happens to decrypt to nothing".
    """
    if not plaintext:
        return ""
    nonce = os.urandom(12)
    ct = AESGCM(_derive_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return "%s.%s.%s" % (
        _PREFIX,
        base64.b64encode(nonce).decode("ascii"),
        base64.b64encode(ct).decode("ascii"),
    )


def decrypt(stored: str) -> str | None:
    """Decrypt a stored secret.

    Returns None when the value cannot be decrypted, which is a normal
    operational state, not an error: SECRET_KEY may have been rotated, or the
    database may have been restored onto a different deployment. Callers must
    treat None as "the customer has to enter their key again" and carry on.
    """
    if not stored:
        return None
    try:
        prefix, nonce_b64, ct_b64 = stored.split(".", 2)
        if prefix != _PREFIX:
            return None
        nonce = base64.b64decode(nonce_b64)
        ct = base64.b64decode(ct_b64)
        return AESGCM(_derive_key()).decrypt(nonce, ct, None).decode("utf-8")
    except Exception:
        # Deliberately broad and deliberately silent about the reason. The
        # distinction between "wrong key", "corrupt", and "truncated" is not
        # useful to a caller and is useful to an attacker.
        return None


def last4(plaintext: str) -> str:
    """The tail of a key, for showing which one is configured without showing it.

    Short secrets reveal proportionally too much, so anything under 8 characters
    gets no hint at all.
    """
    if not plaintext or len(plaintext) < 8:
        return ""
    return plaintext[-4:]
