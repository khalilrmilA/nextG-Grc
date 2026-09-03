#!/usr/bin/env bash
# Install the application into the image.
#
# Layout produced here:
#
#   /opt/appliance/backend/        Python source (removed again by 25-protect-app.sh)
#   /opt/appliance/backend/venv/   build-time virtualenv (removed at binary level)
#   /opt/appliance/frameworks/     framework YAML, one level above the backend package
#   /opt/appliance/seed/           clean reference database shipped with the image
#   /var/www/appliance/            built React dashboard, static files only
#   /var/lib/appliance/            runtime state: database, uploads
#
# The frameworks directory sits beside backend/ deliberately: app/frameworks/
# loader.py resolves it as <backend>/../frameworks, so any other placement
# silently breaks it.
set -euo pipefail

APP_SRC=/tmp/app
APP_DIR=/opt/appliance
BACKEND_DIR="${APP_DIR}/backend"
VENV="${BACKEND_DIR}/venv"
APPLIANCE_NAME="${APPLIANCE_NAME:-appliance}"
APPLIANCE_VERSION="${APPLIANCE_VERSION:-1.0.0}"

echo "[20-app] preparing ${APP_DIR}"
install -d -m 0755 "${APP_DIR}" "${BACKEND_DIR}" "${APP_DIR}/seed"

# ---------------------------------------------------------------------------
# Copy by allowlist, never wholesale.
#
# A "cp -a ${APP_SRC}/." here would place the developer's working tree into
# every OVA: backend/.env (a real SECRET_KEY and API keys), backend/uploads
# (customer evidence files, which are tracked in git), the git-tracked database
# backup, build logs and a 200 MB virtualenv. Every copy of an OVA is byte
# identical, so each of those becomes a shared secret or a data breach.
# ---------------------------------------------------------------------------
echo "[20-app] copying application source (allowlist)"

copy_required() {
  # copy_required <relative source path> <destination>
  local src="${APP_SRC}/$1" dst="$2"
  if [ ! -e "${src}" ]; then
    echo "[20-app] FATAL: required path missing from the source tree: $1" >&2
    exit 1
  fi
  install -d -m 0755 "$(dirname "${dst}")"
  cp -a "${src}" "${dst}"
}

copy_required backend/app              "${BACKEND_DIR}/app"
copy_required backend/scripts          "${BACKEND_DIR}/scripts"
copy_required backend/appliance_cli.py "${BACKEND_DIR}/appliance_cli.py"
copy_required backend/requirements.txt "${BACKEND_DIR}/requirements.txt"
copy_required frameworks               "${APP_DIR}/frameworks"
copy_required release/seed/grc_seed.db "${APP_DIR}/seed/grc_seed.db"

# Anything the allowlist let through by accident (a stray .env inside app/, a
# committed .db) is a shipping-stopper, so look again and refuse to continue.
echo "[20-app] auditing the copied tree for secrets and customer data"
LEAKS="$(find "${BACKEND_DIR}" "${APP_DIR}/frameworks" \
           \( -name '.env' -o -name '.env.*' -o -name '*.db' -o -name '*.db.bak' \
              -o -name '*.log' -o -name '*.pem' -o -name '*.key' \
              -o -name 'node_modules' -o -name '.git' -o -name 'uploads' \) \
           -print 2>/dev/null || true)"
if [ -n "${LEAKS}" ]; then
  echo "[20-app] FATAL: these must not ship inside the image:" >&2
  echo "${LEAKS}" >&2
  exit 1
fi
echo "[20-app] audit clean"

# ---------------------------------------------------------------------------
# Every migration on disk must be referenced by appliance_cli.py.
#
# The compiled binary cannot discover migrations at run time: Nuitka only bundles
# modules it can see statically, so appliance_cli.py imports all of them by name.
# Add a migration to backend/scripts and forget that list, and the appliance
# silently skips it. The database then quietly lacks a column the application
# expects, which surfaces later as a 500 on one page rather than as a build
# failure.
#
# Caught for real: "feat: add team groups management" added
# migrate_add_user_excluded_roles.py and nothing referenced it.
echo "[20-app] checking every migration is wired into the CLI"
MISSING_MIGRATIONS=""
for f in "${BACKEND_DIR}"/scripts/migrate_add_*.py; do
  [ -e "${f}" ] || continue
  m="$(basename "${f}" .py)"
  grep -q "${m}" "${BACKEND_DIR}/appliance_cli.py" || MISSING_MIGRATIONS="${MISSING_MIGRATIONS}  ${m}"$'
'
done
if [ -n "${MISSING_MIGRATIONS}" ]; then
  echo "[20-app] FATAL: these migrations exist but appliance_cli.py never imports them:" >&2
  printf '%s' "${MISSING_MIGRATIONS}" >&2
  echo "[20-app] add them to the import block AND to MIGRATIONS in appliance_cli.py" >&2
  exit 1
fi
echo "[20-app] all migrations wired"

# ---------------------------------------------------------------------------
echo "[20-app] installing Python dependencies"
python3 -m venv "${VENV}"
"${VENV}/bin/pip" install --no-cache-dir --upgrade pip wheel
"${VENV}/bin/pip" install --no-cache-dir -r "${BACKEND_DIR}/requirements.txt"

# ---------------------------------------------------------------------------
echo "[20-app] building the dashboard"
# Vite only; package.json has no tsc step, so type errors cannot fail this.
# vite.config.ts sets no base, so the bundle is served from / by nginx.
FRONTEND_BUILD=/tmp/frontend-build
rm -rf "${FRONTEND_BUILD}"
cp -a "${APP_SRC}/frontend" "${FRONTEND_BUILD}"
rm -rf "${FRONTEND_BUILD}/node_modules" "${FRONTEND_BUILD}/dist"

# VITE_API_URL is relative, so nginx can proxy /api to the backend without the
# bundle knowing the appliance's address. Written here rather than trusting a
# .env that may not have been copied.
cat > "${FRONTEND_BUILD}/.env.production" <<EOF
VITE_API_URL=/api/v1
VITE_APP_NAME=${APPLIANCE_NAME}
VITE_APP_VERSION=${APPLIANCE_VERSION}
EOF

# ---------------------------------------------------------------------------
# The sidebar's feature keys must be real.
#
# Layout.tsx maps a nav module to the entitlement its endpoints are gated
# behind. If that string does not match a key the backend publishes, the
# entitlements context treats it as unknown and fails OPEN, so the item never
# locks and the mistake is invisible. Check it here, where both sources exist.
echo "[20-app] checking the sidebar's feature keys exist in the backend"
python3 - "${FRONTEND_BUILD}/src/components/layout/Layout.tsx" "${BACKEND_DIR}" <<'PYGATE'
import ast
import re
import sys
from pathlib import Path

layout_path, backend_dir = Path(sys.argv[1]), Path(sys.argv[2])

# Pull ELITE_FEATURES and the boolean keys of TIER_LIMITS straight out of the
# model's source. Importing it would need the venv, which does not exist yet at
# this point in the build, and parsing is enough for a list of literals.
model = (backend_dir / "app" / "models" / "subscription.py").read_text(encoding="utf-8")
tree = ast.parse(model)

known = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id == "ELITE_FEATURES":
                for elt in getattr(node.value, "elts", []):
                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                        known.add(elt.value)
    # TIER_LIMITS[...] = {...} and the TIER_LIMITS literal itself
    if isinstance(node, ast.Dict):
        for k, v in zip(node.keys, node.values):
            if isinstance(k, ast.Constant) and isinstance(k.value, str) \
               and isinstance(v, ast.Constant) and isinstance(v.value, bool):
                known.add(k.value)

if not known:
    print("[20-app] FATAL: could not read any feature keys from subscription.py",
          file=sys.stderr)
    raise SystemExit(1)

layout = layout_path.read_text(encoding="utf-8")
m = re.search(r"const MODULE_FEATURES[^{]*\{(.*?)\n\};", layout, re.S)
if not m:
    # No table means no feature gating in the sidebar. Not an error: the gate
    # exists to catch wrong keys, not to require the feature.
    print("[20-app] no MODULE_FEATURES table in Layout.tsx; nothing to check")
    raise SystemExit(0)

used = set()
for arr in re.findall(r"\[([^\]]*)\]", m.group(1)):
    used.update(re.findall(r'"([a-z_][a-z0-9_]*)"', arr))

unknown = sorted(used - known)
if unknown:
    print("[20-app] FATAL: Layout.tsx gates on features the backend does not have:",
          file=sys.stderr)
    for k in unknown:
        print("[20-app]   %s" % k, file=sys.stderr)
    print("[20-app] These fail OPEN, so the item silently never locks.",
          file=sys.stderr)
    print("[20-app] Fix the key in MODULE_FEATURES, or add it to ELITE_FEATURES.",
          file=sys.stderr)
    raise SystemExit(1)

print("[20-app] sidebar feature keys all valid (%d checked)" % len(used))
PYGATE

cd "${FRONTEND_BUILD}"
npm ci
npm run build

install -d -m 0755 /var/www/appliance
cp -a dist/. /var/www/appliance/
# Source maps hand back the React source verbatim; never ship them.
find /var/www/appliance -name '*.map' -delete
chown -R root:root /var/www/appliance
find /var/www/appliance -type d -exec chmod 0755 {} +
find /var/www/appliance -type f -exec chmod 0644 {} +
rm -rf "${FRONTEND_BUILD}"

# ---------------------------------------------------------------------------
echo "[20-app] installing appliance runtime files"
install -d -m 0755 "${APP_DIR}/bin"
install -m 0755 /tmp/bin/ovfprops.py       "${APP_DIR}/bin/ovfprops.py"
install -m 0755 /tmp/bin/admin-reset       "${APP_DIR}/bin/admin-reset"
install -m 0755 /tmp/bin/support-verify    "${APP_DIR}/bin/support-verify"
# The web console URL must never be frozen at first boot.
#
# An offline install has no address while firstboot runs, so a URL written then
# reads "http:///" and stays wrong forever, on an appliance that is otherwise
# serving perfectly. That is the worst kind of fault: working software the
# operator has no way to locate. Observed on a real air-gapped ISO install.
#
# Both display paths must resolve the address at render time: /etc/issue via
# getty's \4 escape, and the console via hostname -I on every redraw.
if grep -q 'Web console : http://${IP}/' /tmp/scripts/firstboot.sh; then
  echo "[20-app] FATAL: firstboot.sh bakes the address into a console URL." >&2
  echo "[20-app]        An appliance installed without a network would show" >&2
  echo "[20-app]        http:/// forever. Resolve the address live instead." >&2
  exit 1
fi
install -m 0755 /tmp/scripts/firstboot.sh  "${APP_DIR}/bin/firstboot.sh"
install -m 0755 /tmp/scripts/netconfig.sh  "${APP_DIR}/bin/netconfig.sh"

install -m 0644 /tmp/files/systemd/appliance-api.service          /etc/systemd/system/
install -m 0644 /tmp/files/systemd/appliance-firstboot.service    /etc/systemd/system/
install -m 0644 /tmp/files/systemd/appliance-ssh-lockdown.service /etc/systemd/system/
# The security headers live in a snippet because nginx does NOT inherit
# add_header into a location that declares one of its own. Both the server
# block and every such location include this file; without it the dashboard
# shipped with no HSTS, no CSP and no X-Frame-Options while /api kept them.
install -d -m 0755 /etc/nginx/snippets
install -m 0644 /tmp/files/nginx/security-headers.conf \
                /etc/nginx/snippets/appliance-security-headers.conf
install -m 0644 /tmp/files/nginx/appliance.conf /etc/nginx/sites-available/appliance.conf
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/appliance.conf /etc/nginx/sites-enabled/appliance.conf

# ---------------------------------------------------------------------------
# Validate the web server configuration HERE, at build time.
#
# The first built OVA shipped a config carrying "http2 on;", which is nginx 1.25
# syntax. Ubuntu 24.04 ships nginx 1.24, which refuses to start on it:
#
#   nginx: [emerg] unknown directive "http2" in .../appliance.conf:10
#
# Nothing in the build noticed, because nothing in the build ever asked nginx to
# read its own config. The failure surfaced on the customer's first boot as a
# web console that simply never answered.
#
# nginx -t loads the certificate, which does not exist until firstboot generates
# it, so mint a throwaway one purely for the syntax check and delete it again. A
# TLS key baked into the image would be shared by every appliance ever deployed,
# which is the one thing this build must never do.
echo "[20-app] validating the nginx configuration"
install -d -m 0750 /etc/appliance/tls
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=build-config-check"   -keyout /etc/appliance/tls/tls.key -out /etc/appliance/tls/tls.crt >/dev/null 2>&1
NGINX_OK=0
nginx -t && NGINX_OK=1
rm -f /etc/appliance/tls/tls.key /etc/appliance/tls/tls.crt
if [ "${NGINX_OK}" -ne 1 ]; then
  echo "[20-app] FATAL: the nginx configuration is not valid for this nginx version" >&2
  exit 1
fi
echo "[20-app] nginx configuration is valid"

# Belt and braces: the throwaway key must not survive into the image.
if [ -e /etc/appliance/tls/tls.key ]; then
  echo "[20-app] FATAL: the build-time TLS key was not removed" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# The support public key is baked in from a build variable. Only the public
# half ever exists here; the private key stays on the vendor's infrastructure.
if [ -n "${SUPPORT_PUBLIC_KEY:-}" ]; then
  echo "[20-app] installing the support public key"
  printf '%s\n' "${SUPPORT_PUBLIC_KEY}" > /etc/appliance/support.pub
  chmod 0644 /etc/appliance/support.pub
else
  echo "[20-app] WARN: SUPPORT_PUBLIC_KEY not set; console support access will refuse every response"
fi

cat > /etc/appliance/version <<EOF
NAME=${APPLIANCE_NAME}
VERSION=${APPLIANCE_VERSION}
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TARGET=${APPLIANCE_TARGET:-vmware}
FAST=${APPLIANCE_FAST:-0}
EOF
chmod 0644 /etc/appliance/version

# firstboot.sh reads this to decide whether to look for vApp properties, and
# whether to configure the network at all. Kept as its own file so it can be
# read without sourcing the version file.
echo "${APPLIANCE_TARGET:-vmware}" > /etc/appliance/target
chmod 0644 /etc/appliance/target

# Seed for the fixed platform super-administrator password, when the build was
# given one. firstboot.sh consumes this file and SHREDS it, so a deployed
# appliance carries only the bcrypt hash in its database — never the cleartext.
#
# 0600 root:root. It exists only between this stage and the first boot, but
# 35-lockdown runs in between, so it must not be group- or world-readable.
if [ -n "${SUPERADMIN_PASSWORD:-}" ]; then
  install -d -m 0755 /etc/appliance
  printf '%s' "${SUPERADMIN_PASSWORD}" > /etc/appliance/superadmin.seed
  chmod 0600 /etc/appliance/superadmin.seed
  chown root:root /etc/appliance/superadmin.seed
  echo "[20-app] fixed super-administrator password staged for firstboot"
else
  echo "[20-app] no SUPERADMIN_PASSWORD; firstboot will generate a random one"
fi

chown -R root:root "${APP_DIR}"

systemctl daemon-reload
systemctl enable appliance-firstboot.service
systemctl enable appliance-api.service
systemctl enable nginx

# NOT on azure. Every other stage carves out the same exception because SSH is
# the only management path Azure has: 35-lockdown.sh leaves accounts to
# walinuxagent and keeps the serial console, and 99-seal.sh explicitly leaves
# SSH enabled for the platform agent. Enabling this unit there would mask SSH
# before sysinit on the first boot of every Azure VM and strand it.
if [ "${APPLIANCE_TARGET:-vmware}" != "azure" ]; then
  systemctl enable appliance-ssh-lockdown.service
else
  echo "[20-app] azure: not enabling appliance-ssh-lockdown.service"
  systemctl disable appliance-ssh-lockdown.service 2>/dev/null || true
fi

echo "[20-app] done"
