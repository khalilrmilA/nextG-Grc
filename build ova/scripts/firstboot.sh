#!/usr/bin/env bash
# Runs once, on the customer's first boot. Gives this deployment its own
# identity, secrets, database, certificate and network configuration.
#
# Everything here calls /opt/appliance/runtime/appliance-api, the compiled
# binary. There is no interpreter to shell out to at PROTECT_LEVEL=binary, and
# no application source on the image.
set -euo pipefail

APPBIN=/opt/appliance/runtime/appliance-api
SEED_DB=/opt/appliance/seed/grc_seed.db
DB_PATH=/var/lib/appliance/grc.db
UPLOADS=/var/lib/appliance/uploads
STATE=/var/lib/appliance/.firstboot-done
ENVFILE=/etc/appliance/app.env
TLS_DIR=/etc/appliance/tls
LOG=/var/log/appliance/firstboot.log
# Written by the CLI running as the service user, so it must be somewhere
# that user can write and that the AppArmor profile permits. /run is neither.
PASS_FILE=/var/lib/appliance/.admin-pass

mkdir -p /var/lib/appliance "${UPLOADS}" /var/log/appliance "${TLS_DIR}"
exec > >(tee -a "${LOG}") 2>&1

if [ -f "${STATE}" ]; then
  echo "[firstboot] already completed, nothing to do"
  exit 0
fi

echo "[firstboot] starting $(date -u +%FT%TZ)"

# --- 1. host identity ------------------------------------------------------
if [ ! -s /etc/machine-id ]; then
  systemd-machine-id-setup --commit || systemd-machine-id-setup
fi
if ! ls /etc/ssh/ssh_host_*_key >/dev/null 2>&1; then
  echo "[firstboot] generating SSH host keys"
  ssh-keygen -A
fi

# --- 2. deployment properties ----------------------------------------------
# Only vCenter has a vApp property mechanism. Hyper-V has no equivalent at all,
# and on Azure the platform agent handles networking and the admin account
# before this script runs. Every value below therefore has a working default,
# and the console menu can set a static address on any target.
TARGET="${APPLIANCE_TARGET:-vmware}"
if [ -r /etc/appliance/target ]; then
  TARGET="$(cat /etc/appliance/target)"
fi
echo "[firstboot] target: ${TARGET}"

if [ "${TARGET}" = "vmware" ]; then
  if command -v vmtoolsd >/dev/null 2>&1; then
    vmtoolsd --cmd "info-get guestinfo.ovfEnv" > /run/ovfenv.xml 2>/dev/null || true
  fi
  if [ -s /run/ovfenv.xml ]; then
    echo "[firstboot] reading OVF environment"
    /opt/appliance/bin/ovfprops.py /run/ovfenv.xml > /run/ovfprops.env || true
    # shellcheck disable=SC1091
    [ -s /run/ovfprops.env ] && . /run/ovfprops.env
  fi
fi

# --- 3. network ------------------------------------------------------------
# On Azure the platform agent and cloud-init own the network configuration;
# writing our own netplan file there would fight them.
if [ "${TARGET}" != "azure" ]; then
  /opt/appliance/bin/netconfig.sh \
    "${net_mode:-dhcp}" \
    "${net_ip:-}" "${net_prefix:-24}" "${net_gateway:-}" "${net_dns:-}"
fi

if [ -n "${appliance_hostname:-}" ]; then
  hostnamectl set-hostname "${appliance_hostname}"
fi

HOST="$(hostname -f 2>/dev/null || hostname)"
IP="$(hostname -I | awk '{print $1}')"
ORG="${appliance_org:-Appliance}"
# The default MUST contain a dot in the domain. The login endpoint validates
# with pydantic EmailStr, which rejects "admin@localhost" outright:
#   value is not a valid email address: The part after the @-sign is not
#   valid. It should have a period.
# create-admin does not apply that validation, so the account was created
# happily and then NOBODY could ever log in. Verified against a running
# appliance: the web console returned 422 on every attempt.
# NOT .local either: that is a reserved TLD and email-validator refuses it with
# "the part after the @-sign is a special-use or reserved name". Tested against a
# running appliance: .local, .invalid and .home.arpa are all rejected; .lan,
# .internal, .corp and any real domain are accepted.
ADMIN_EMAIL="${appliance_admin_email:-admin@appliance.lan}"
# Same rule applies here.
SUPER_EMAIL="${appliance_super_email:-superadmin@appliance.lan}"

# --- 4. database -----------------------------------------------------------
# The image ships a clean reference database: built-in frameworks, controls,
# threats and mandatory documents, and no customer data. Copy it into place on
# the first boot only, so a reboot never overwrites live data.
if [ ! -f "${DB_PATH}" ]; then
  if [ -f "${SEED_DB}" ]; then
    echo "[firstboot] installing the reference database"
    cp "${SEED_DB}" "${DB_PATH}"
  else
    echo "[firstboot] no seed database found, starting empty"
  fi
fi
# Ownership must be right BEFORE the CLI runs, because it runs as this user.
# SQLite also writes -journal/-wal files alongside the database, so the
# DIRECTORY must be writable by it, not just the file.
chown appliance:appliance "${DB_PATH}" 2>/dev/null || true
chmod 0640 "${DB_PATH}" 2>/dev/null || true
chown appliance:appliance /var/lib/appliance
chmod 0750 /var/lib/appliance
chown -R appliance:appliance "${UPLOADS}"

# --- 5. secrets and configuration -----------------------------------------
echo "[firstboot] generating secrets"
# SECRET_KEY is the name the application actually reads (app/core/config.py).
# With ENVIRONMENT=production it refuses to start on a default or short key, so
# this is load bearing rather than decorative.
SECRET_KEY="$(openssl rand -base64 64 | tr -d '\n=+/' | head -c 64)"

umask 077
cat > "${ENVFILE}" <<EOF
# Generated at first boot. Unique to this deployment.
ENVIRONMENT=production
DEBUG=false
SECRET_KEY=${SECRET_KEY}

# SQLite by default. Repoint this at PostgreSQL, Oracle or SQL Server without
# rebuilding the image; app/core/database.py picks the driver from the scheme.
DATABASE_URL=sqlite+aiosqlite:///${DB_PATH}

# Absolute, because app/core/config.py defaults UPLOADS_DIR to a RELATIVE
# "uploads" resolved against the process working directory. Under the hardened
# unit that directory is not writable, so evidence upload would fail.
UPLOADS_DIR=${UPLOADS}

APP_HOST=127.0.0.1
APP_PORT=8000
FRONTEND_URL=https://${HOST}
FRONTEND_BASE_URL=https://${HOST}

# Every outbound feed is off. Customers deploy this air-gapped, and a scheduler
# retrying a network that is not there fills the log and nothing else. Each one
# can be turned on per deployment by editing this file and restarting.
ENABLE_THREAT_SCHEDULER=0
ENABLE_CVE_AUTOSYNC=0
ENABLE_REPORT_SCHEDULER=0
ENABLE_VULN_SCANNER_SCHEDULER=0
ENABLE_AUDIT_RECURRENCE_SCHEDULER=0
ENABLE_ARCHIVING_SCHEDULER=0
ENABLE_RISK_SNAPSHOT_SCHEDULER=0

# Online licence activation. Empty means offline activation only: an
# administrator pastes the signed licence key they were issued. Set this to the
# vendor licence server to enable POST /license/activate-online. Nothing
# contacts it unless an administrator activates a licence by hand.
LICENSE_SERVER_URL=${appliance_license_server:-}

# Bring your own AI. All empty means the appliance behaves exactly as before:
# the bundled model over the native API, with no Authorization header sent.
#
# A customer who wants their own AI sets these from the console menu, which
# rewrites this file and restarts the API. Nothing is baked into the image:
# every OVA copy is byte identical, so a key here would be shared by every
# deployment.
#
#   AI_PROVIDER   ollama | openai   ("openai" covers OpenAI, Azure OpenAI,
#                                    vLLM, LiteLLM, Groq, Together and
#                                    Anthropic's OpenAI-compatible endpoint)
#   AI_BASE_URL   include the version segment, e.g. https://api.openai.com/v1
AI_PROVIDER=
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
# Plain http is refused to public hosts. Private addresses are always allowed.
AI_ALLOW_INSECURE_ENDPOINTS=false
# A private CA bundle, for a customer behind an inspecting proxy.
AI_CA_BUNDLE=
EOF
chown root:appliance "${ENVFILE}"
chmod 0640 "${ENVFILE}"
umask 022

# --- 6. TLS certificate ----------------------------------------------------
if [ ! -f "${TLS_DIR}/tls.crt" ]; then
  echo "[firstboot] generating a self-signed certificate for ${HOST} / ${IP}"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -sha256 \
    -keyout "${TLS_DIR}/tls.key" -out "${TLS_DIR}/tls.crt" \
    -subj "/CN=${HOST}" \
    -addext "subjectAltName=DNS:${HOST},IP:${IP}" \
    -addext "keyUsage=digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"
  chmod 600 "${TLS_DIR}/tls.key"
  chmod 644 "${TLS_DIR}/tls.crt"
  chown root:appliance "${TLS_DIR}"/tls.*
fi

# --- 7. schema and initial administrator -----------------------------------
# Order matters and was established by testing against the shipped seed:
#   migrate       the seed predates several columns, including
#                 must_change_password, so it has to be brought forward first
#   prepare-seed  removes the placeholder account the seed ships with, which
#                 would otherwise be the same login on every OVA
#   create-admin  per-deployment random password, forced change at first login
set -a
# shellcheck disable=SC1090
. "${ENVFILE}"
set +a

# Run the CLI as the SERVICE user, not as root.
#
# The database and uploads are owned by "appliance" (mode 0640), and 35-lockdown
# loads an AppArmor profile that grants no capabilities. A confined root process
# therefore has no CAP_DAC_OVERRIDE and falls into "other" on files it does not
# own, which produced:
#
#   sqlalchemy.exc.OperationalError: unable to open database file
#   [firstboot] FATAL: database migration failed
#
# Running as the owner is both the fix and the correct least-privilege design:
# these commands only ever touch appliance-owned state.
run_app() {
  runuser -u appliance -- env \
    ENVIRONMENT=production \
    DEBUG=false \
    SECRET_KEY="${SECRET_KEY}" \
    DATABASE_URL="sqlite+aiosqlite:///${DB_PATH}" \
    UPLOADS_DIR="${UPLOADS}" \
    APPLIANCE_STATE_DIR=/var/lib/appliance \
    "${APPBIN}" "$@"
}

echo "[firstboot] applying database schema"
if ! run_app migrate; then
  echo "[firstboot] FATAL: database migration failed"
  echo "[firstboot] the command was: runuser -u appliance -- ${APPBIN} migrate"
  # Diagnostic only: show who owns the database and its directory, which is
  # what every failure of this kind has come down to.
  # shellcheck disable=SC2012  # fixed paths, and ls output is what a human needs here
  ls -ld "${DB_PATH}" /var/lib/appliance 2>&1 | head -5
  exit 1
fi

echo "[firstboot] removing accounts shipped in the reference database"
# Fatal, not a warning. This is what removes the placeholder account the
# reference database ships with; if it fails silently, every appliance built
# from this image keeps the SAME login, which is the exact shared-credential
# problem the whole seed pipeline exists to prevent.
if ! run_app prepare-seed; then
  echo "[firstboot] FATAL: could not remove the accounts shipped in the seed database"
  exit 1
fi

echo "[firstboot] creating the administrator account"
rm -f "${PASS_FILE}"
if run_app create-admin \
      --email "${ADMIN_EMAIL}" \
      --company "${ORG}" \
      --rename-tenant \
      --generate \
      --must-change-password \
      --password-out "${PASS_FILE}"; then
  ADMIN_PASS="$(cat "${PASS_FILE}")"
  # /run is tmpfs, so this never reaches the disk, but do not leave it readable
  # for the life of the boot either.
  rm -f "${PASS_FILE}"
else
  echo "[firstboot] FATAL: could not create the administrator account"
  exit 1
fi

echo "[firstboot] creating the platform super administrator"
# A SECOND account, on purpose. The frontend sends a super_admin to the
# /super-admin portal, so if the only account were a super_admin the operator
# would land in tenant administration and never see the application. One account
# runs the business, the other administers the platform.
#
# Non-fatal: an appliance with a working tenant admin is usable, and refusing to
# boot because the optional second account failed would be the wrong trade.
rm -f "${PASS_FILE}"
SUPER_PASS=""
if run_app create-admin \
      --email "${SUPER_EMAIL}" \
      --company "${ORG}" \
      --role super_admin \
      --first-name Platform \
      --last-name "Super Admin" \
      --generate \
      --must-change-password \
      --password-out "${PASS_FILE}"; then
  SUPER_PASS="$(cat "${PASS_FILE}")"
  rm -f "${PASS_FILE}"
else
  echo "[firstboot] WARN: could not create the super administrator account"
fi

chown appliance:appliance "${DB_PATH}"
chmod 0640 "${DB_PATH}"

# --- 8. console banner -----------------------------------------------------
# shellcheck disable=SC1091
. /etc/appliance/version

# Two places, deliberately.
#
# /etc/issue is the conventional location and is what a getty renders, so it
# still works on any target that keeps a login prompt (Azure's serial console,
# for instance).
cat > /etc/issue <<EOF

  ${NAME} ${VERSION}

  Web console : https://${IP}/

  Administrator
    Username  : ${ADMIN_EMAIL}
    Password  : ${ADMIN_PASS}

  Platform super administrator (/super-admin)
    Username  : ${SUPER_EMAIL}
    Password  : ${SUPER_PASS:-<not created>}

  Both passwords must be changed at first login.

EOF
# 0600, not 0644: this file holds the generated administrator password in clear
# text until it is changed. A getty renders it as root before login, so it does
# not need to be world readable.
chmod 0600 /etc/issue

# The restricted console is what tty1 actually runs on the vmware and hyperv
# targets, and it does NOT render /etc/issue. Without this file the generated
# password would be written and then shown to nobody, leaving the operator with
# no way into the appliance they just deployed.
install -d -m 0750 -o root -g appliance /etc/appliance
cat > /etc/appliance/initial-credentials <<EOF
Web console : https://${IP}/

Administrator
  Username  : ${ADMIN_EMAIL}
  Password  : ${ADMIN_PASS}

Platform super administrator (/super-admin)
  Username  : ${SUPER_EMAIL}
  Password  : ${SUPER_PASS:-<not created>}
EOF
chmod 0640 /etc/appliance/initial-credentials
chown root:appliance /etc/appliance/initial-credentials

# --- 9. done ---------------------------------------------------------------
# Do NOT "systemctl start appliance-api" here.
#
# This script IS the ExecStart of appliance-firstboot.service (Type=oneshot), so
# the unit stays in "activating" for as long as this runs. appliance-api.service
# declares After= and Requires= appliance-firstboot.service, and
# appliance-firstboot.service declares Before=appliance-api.service nginx.service.
# systemd will not run a start job for a unit ordered after one whose job is
# still pending, so a blocking "systemctl start" here can never complete:
#
#   firstboot waits for the start job -> the start job waits for firstboot
#   -> deadlock until TimeoutStartSec=600 kills firstboot as failed
#   -> the "touch ${STATE}" below never runs
#   -> ConditionPathExists still passes next boot, so it deadlocks again, forever
#
# Nothing needs to be started by hand: 20-app.sh enables both units, so systemd
# already has their start jobs queued in the boot transaction, held behind this
# one by that same ordering. They dispatch on their own the moment this script
# exits 0 and the unit goes active (RemainAfterExit=yes).
touch "${STATE}"
echo "[firstboot] completed $(date -u +%FT%TZ)"
