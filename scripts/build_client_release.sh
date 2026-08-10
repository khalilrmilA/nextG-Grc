#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build a complete PROTECTED on-prem client release of the GRC Platform.
#
#   scripts/build_client_release.sh <version> <company> <admin-email> \
#       <admin-password> <license-public-key-or-path> [pyarmor-regfile]
#
# Example:
#   scripts/build_client_release.sh 1.0.0 "Acme Corp" admin@acme.example \
#       'S0me-Strong-Passw0rd' release/keys/license_public.b64 \
#       ~/pyarmor-regfile-5432.zip
#
# Produces:
#   release/seed/grc_seed.db              — cleaned seed DB (no customer data)
#   release/bundle-<version>/             — everything the client receives:
#       grc-onprem-<version>.tar.gz       — both docker images (docker load)
#       docker-compose.onprem.yml
#       .env.onprem.example
#       INSTALL.md
#
# Safety notes:
#   * make_client_seed_db.py NEVER mutates the source DB — it opens
#     backend/grc_dev.db strictly read-only and works on a snapshot copy.
#   * This script never restarts services and never writes outside release/.
#   * A PyArmor Basic/Pro regfile is required for real builds — the free trial
#     cannot obfuscate several large files in this codebase.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

usage() {
    sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
}

[ "$#" -ge 5 ] || usage

VERSION="$1"
COMPANY="$2"
ADMIN_EMAIL="$3"
ADMIN_PASSWORD="$4"
PUBLIC_KEY_ARG="$5"
PYARMOR_REGFILE="${6:-}"

case "$VERSION" in
    *[!A-Za-z0-9._-]*|"")
        echo "ERROR: version '$VERSION' — use only letters, digits, dot, dash, underscore." >&2
        exit 1 ;;
esac

VENV_PY="$REPO_ROOT/backend/venv/bin/python"
if [ ! -x "$VENV_PY" ]; then
    echo "ERROR: backend virtualenv not found at backend/venv — required to build the seed DB." >&2
    exit 1
fi

# Public key: accept either the base64 value itself or a path to a file
# containing it (a bare value, or the saved output of
# generate_license_keypair.py — which ALSO contains the PRIVATE key, so only
# the LICENSE_PUBLIC_KEY= line may ever be read from it).
if [ -f "$PUBLIC_KEY_ARG" ]; then
    if grep -q '^LICENSE_PUBLIC_KEY=' "$PUBLIC_KEY_ARG"; then
        LICENSE_PUBLIC_KEY="$(sed -n 's/^LICENSE_PUBLIC_KEY=//p' "$PUBLIC_KEY_ARG" | head -n 1 | tr -d '[:space:]')"
    else
        LICENSE_PUBLIC_KEY="$(tr -d '[:space:]' < "$PUBLIC_KEY_ARG")"
    fi
else
    LICENSE_PUBLIC_KEY="$PUBLIC_KEY_ARG"
fi
if [ -z "$LICENSE_PUBLIC_KEY" ]; then
    echo "ERROR: license public key is empty." >&2
    exit 1
fi
# An Ed25519 raw public key is exactly 32 bytes of standard base64. Refuse
# anything else so a whole keypair file, a mangled multi-line paste, or a
# wrong-path argument can never be baked into a client build.
if ! printf '%s' "$LICENSE_PUBLIC_KEY" | "$VENV_PY" -c '
import base64, sys
try:
    raw = base64.b64decode(sys.stdin.read(), validate=True)
except Exception:
    sys.exit(1)
sys.exit(0 if len(raw) == 32 else 1)
'; then
    echo "ERROR: license public key is not standard base64 of exactly 32 raw bytes (Ed25519)." >&2
    exit 1
fi

echo "── Step 1/4: building clean seed database (source is opened READ-ONLY) ──"
"$VENV_PY" backend/scripts/make_client_seed_db.py \
    --source backend/grc_dev.db \
    --out release/seed/grc_seed.db \
    --company "$COMPANY" \
    --admin-email "$ADMIN_EMAIL" \
    --admin-password "$ADMIN_PASSWORD"

if ! command -v docker >/dev/null 2>&1; then
    cat >&2 <<'EOF'

Seed database built, but 'docker' is not installed on this machine — stopping
before the image-build steps. Copy the repo (or at minimum the build context)
to a machine with Docker and re-run this script there. The seed DB at
release/seed/grc_seed.db is ready and safe to transfer.
EOF
    exit 1
fi

echo
echo "── Step 2/4: building protected backend image ──"
BACKEND_BUILD_ARGS=(--build-arg "LICENSE_PUBLIC_KEY=$LICENSE_PUBLIC_KEY")
if [ -n "$PYARMOR_REGFILE" ]; then
    if [ ! -f "$PYARMOR_REGFILE" ]; then
        echo "ERROR: PyArmor regfile not found: $PYARMOR_REGFILE" >&2
        exit 1
    fi
    # The regfile must live inside the build context for the Dockerfile to
    # COPY it (release/pyarmor/ is picked up by an optional-COPY glob).
    mkdir -p release/pyarmor
    cp "$PYARMOR_REGFILE" "release/pyarmor/$(basename "$PYARMOR_REGFILE")"
    BACKEND_BUILD_ARGS+=(--build-arg "PYARMOR_REGFILE=release/pyarmor/$(basename "$PYARMOR_REGFILE")")
else
    cat <<'EOF'
WARNING: no PyArmor regfile supplied — building in TRIAL mode, which FAILS on
this codebase (several files exceed the trial's 32 KB code-object limit).
Trial mode is only useful for pipeline testing on a stub app.
EOF
fi

docker build \
    -f infrastructure/docker/Dockerfile.backend.onprem \
    "${BACKEND_BUILD_ARGS[@]}" \
    -t "grc-backend:onprem" \
    -t "grc-backend:onprem-$VERSION" \
    .

echo
echo "── Step 3/4: building frontend image ──"
docker build \
    -f infrastructure/docker/Dockerfile.frontend.onprem \
    -t "grc-frontend:onprem" \
    -t "grc-frontend:onprem-$VERSION" \
    .

echo
echo "── Step 4/4: exporting images + assembling client bundle ──"
TARBALL="release/grc-onprem-$VERSION.tar.gz"
docker save "grc-backend:onprem" "grc-frontend:onprem" | gzip > "$TARBALL"

BUNDLE_DIR="release/bundle-$VERSION"
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"
mv "$TARBALL" "$BUNDLE_DIR/"
cp docker-compose.onprem.yml "$BUNDLE_DIR/"
cp .env.onprem.example "$BUNDLE_DIR/"

cat > "$BUNDLE_DIR/INSTALL.md" <<EOF
# GRC Platform — On-Prem Installation (v$VERSION)

## Requirements
- Linux host with Docker Engine 24+ and the Docker Compose plugin
- 4 GB RAM minimum, 20 GB disk
- The host should sit on your internal LAN behind your firewall. Only port 80
  needs to be reachable by users; do not expose it to the internet.

## 1. Load the images
\`\`\`bash
docker load -i grc-onprem-$VERSION.tar.gz
\`\`\`

## 2. Configure
\`\`\`bash
cp .env.onprem.example .env.onprem
\`\`\`
Edit \`.env.onprem\`:
- \`SECRET_KEY\` — generate with
  \`python3 -c "import secrets; print(secrets.token_urlsafe(64))"\`
- \`ALLOWED_ORIGINS\` / \`FRONTEND_URL\` — the hostname users will browse to
- SMTP settings are optional; leave empty to run without email

## 3. Start
\`\`\`bash
docker compose -f docker-compose.onprem.yml up -d
\`\`\`
Open http://<this-host>/ in a browser.

## 4. First login
- Email: \`$ADMIN_EMAIL\`
- Password: the one your vendor communicated to you separately
- Change it immediately under Settings → Security.

## 5. Activate your license
On first use the app redirects to the **/license** screen. Paste the license
key provided by your vendor and click Activate. Renewals work the same way —
paste the new key on the same screen.

## Backups
All data (database + uploaded files) lives in the \`grc_data\` Docker volume:
\`\`\`bash
docker run --rm -v grc_data:/data -v "\$PWD:/backup" alpine \\
    tar czf /backup/grc-backup-\$(date +%F).tar.gz -C /data .
\`\`\`
Restore by extracting the archive back into the volume before starting.

## Updates
Your vendor ships a new \`grc-onprem-<version>.tar.gz\`:
\`\`\`bash
docker load -i grc-onprem-<new-version>.tar.gz
docker compose -f docker-compose.onprem.yml up -d
\`\`\`
Your data volume and license activation are preserved across updates.
EOF

echo
echo "══════════════════════════════════════════════════════════════"
echo "Release v$VERSION ready:"
echo "  $BUNDLE_DIR/"
ls -lh "$BUNDLE_DIR"
echo
echo "Deliver the whole bundle-$VERSION directory to the client."
echo "Communicate the admin password ($ADMIN_EMAIL) out-of-band — it is NOT in the bundle."
echo "══════════════════════════════════════════════════════════════"
