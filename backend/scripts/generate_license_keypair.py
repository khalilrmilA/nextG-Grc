"""
Generate an Ed25519 license signing keypair.

Usage (from the backend/ directory):
    venv/bin/python -m scripts.generate_license_keypair

Prints two lines ready to paste into env files:

- LICENSE_PRIVATE_KEY — the SIGNING key. Goes into the .env of the vendor's
  SaaS server ONLY (where super admins mint keys via POST /api/v1/admin/licenses).
  NEVER ship it to a client, never commit it, never bake it into a build.

- LICENSE_PUBLIC_KEY — the VERIFICATION key. Safe to distribute. Set it on
  client installs (env), or bake it into app/core/build_info.py in the
  protected Docker build.
"""
import sys
from pathlib import Path

# Allow running from any cwd: put backend/ on sys.path so `app` imports work.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.licensing import generate_keypair  # noqa: E402


def main() -> None:
    private_b64, public_b64 = generate_keypair()
    print("# Ed25519 license keypair — generated once, keep the private key safe.")
    print("#")
    print("# 1) VENDOR SaaS server .env ONLY (signs licenses — never ship this):")
    print(f"LICENSE_PRIVATE_KEY={private_b64}")
    print("#")
    print("# 2) Client installs (verifies licenses — safe to distribute):")
    print("#    either as an env var, or baked into app/core/build_info.py")
    print("#    by the protected build:")
    print(f"LICENSE_PUBLIC_KEY={public_b64}")


if __name__ == "__main__":
    main()
