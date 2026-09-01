#!/usr/bin/env bash
# Build the appliance installer ISO.
#
# Runs on Linux. On a Windows workstation, scripts/Build-Iso.ps1 drives this
# inside WSL, because Windows ships no ISO authoring tool: xorriso, mkisofs and
# genisoimage are all absent, and oscdimg only arrives with the 1.5 GB Windows
# ADK.
#
# WHAT THIS PRODUCES
#
# A remastered Ubuntu Server ISO that installs the appliance unattended onto
# whatever machine it is booted on, physical or virtual. It is not a live image
# and it is not a disk image: the customer boots it, it installs Ubuntu, and on
# the first boot appliance-provision.service builds the appliance using exactly
# the same scripts the OVA path uses.
#
# WHAT IS DELIBERATELY NOT IN IT
#
# No credential. Every ISO handed out is byte identical, so anything literal
# baked in here is a secret shared across the whole install base. The one
# account the Ubuntu installer insists on is given a 32 character random
# password that is generated here, hashed, and never written down.
set -euo pipefail

# --- inputs ----------------------------------------------------------------
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

APP_SOURCE="${APP_SOURCE:-$(cd "${ROOT}/.." && pwd)}"
BASE_ISO="${BASE_ISO:-}"
OUT_ISO="${OUT_ISO:-${ROOT}/out/appliance-installer.iso}"
WORK="${WORK:-/var/tmp/appliance-iso}"

APPLIANCE_NAME="${APPLIANCE_NAME:-grceye-appliance}"
APPLIANCE_VERSION="${APPLIANCE_VERSION:-1.0.0}"
APPLIANCE_VENDOR="${APPLIANCE_VENDOR:-Next Step IT}"
APPLIANCE_HOSTNAME="${APPLIANCE_HOSTNAME:-appliance}"
PROTECT_LEVEL="${PROTECT_LEVEL:-binary}"
GRUB_PASSWORD="${GRUB_PASSWORD:-}"
SUPPORT_PUBLIC_KEY="${SUPPORT_PUBLIC_KEY:-}"
LICENSE_PUBLIC_KEY="${LICENSE_PUBLIC_KEY:-}"
LICENSE_ENFORCEMENT_BUILD="${LICENSE_ENFORCEMENT_BUILD:-}"

say() { printf '[build-iso] %s\n' "$*"; }
die() { printf '[build-iso] FATAL: %s\n' "$*" >&2; exit 1; }

# --- preflight -------------------------------------------------------------
command -v xorriso >/dev/null || die "xorriso is not installed (apt install xorriso)"
command -v openssl >/dev/null || die "openssl is not installed"
command -v python3 >/dev/null || die "python3 is not installed"
[ -n "${BASE_ISO}" ] || die "BASE_ISO is not set (path to the Ubuntu Server ISO)"
[ -f "${BASE_ISO}" ] || die "BASE_ISO does not exist: ${BASE_ISO}"
[ -d "${APP_SOURCE}" ] || die "APP_SOURCE does not exist: ${APP_SOURCE}"

say "base ISO   : ${BASE_ISO}"
say "app source : ${APP_SOURCE}"
say "output     : ${OUT_ISO}"

rm -rf "${WORK}"
mkdir -p "${WORK}/payload" "${WORK}/nocloud" "${WORK}/appsrc"
mkdir -p "$(dirname "${OUT_ISO}")"

# --- 1. stage the application source, by allowlist -------------------------
# The same allowlist Build-Ova.ps1 uses, and for the same reason: this
# repository carries a backend .env with a live SECRET_KEY, tracked customer
# evidence under backend/uploads and a client data database backup. A wholesale
# copy would put all of it on every ISO.
say "staging the application source (allowlist)"
STAGE="${WORK}/appsrc"
for item in backend/app backend/scripts backend/appliance_cli.py \
            backend/requirements.txt frameworks release/seed/grc_seed.db; do
  src="${APP_SOURCE}/${item}"
  [ -e "${src}" ] || die "missing from the source tree: ${item}"
  mkdir -p "${STAGE}/$(dirname "${item}")"
  cp -a "${src}" "${STAGE}/${item}"
done

# The frontend is built during provisioning, so node_modules and any previous
# dist would only bloat the ISO. The .env files are excluded because 20-app.sh
# writes its own .env.production; carrying a developer .env into the image is
# exactly what the audit below exists to catch.
mkdir -p "${STAGE}/frontend"
tar -C "${APP_SOURCE}/frontend" \
    --exclude=node_modules --exclude=dist --exclude=.git \
    --exclude=.env --exclude='.env.*' \
    -cf - . | tar -C "${STAGE}/frontend" -xf -

say "auditing the staged tree"
LEAKS="$(find "${STAGE}" \
          \( -name '.env' -o -name '.env.*' -o -name '*.log' -o -name '*.pem' \
             -o -name '*.key' -o -name 'node_modules' -o -name '.git' \
             -o -name 'uploads' -o -name '*.db.bak' \) -print 2>/dev/null || true)"
# The seed database is the one .db allowed through.
STRAY_DB="$(find "${STAGE}" -name '*.db' ! -path '*/release/seed/*' -print 2>/dev/null || true)"
if [ -n "${LEAKS}${STRAY_DB}" ]; then
  printf '%s\n%s\n' "${LEAKS}" "${STRAY_DB}" >&2
  die "the staging area contains files that must not ship"
fi
say "audit clean"

# --- 2. build the payload --------------------------------------------------
say "building the payload"
PAY="${WORK}/payload"
tar -C "${STAGE}" -czf "${PAY}/app-source.tar.gz" .
cp -a "${ROOT}/bin"     "${PAY}/bin"
cp -a "${ROOT}/scripts" "${PAY}/scripts"
cp -a "${ROOT}/files"   "${PAY}/files"
install -m 0755 "${ROOT}/iso/provision.sh" "${PAY}/provision.sh"
install -m 0644 "${ROOT}/files/systemd/appliance-provision.service" \
                "${PAY}/appliance-provision.service"

# A Windows checkout carries CRLF, which makes every one of these fail inside
# the installed system with "bad interpreter: No such file or directory".
find "${PAY}/scripts" "${PAY}/bin" "${PAY}/files" -type f -exec sed -i 's/\r$//' {} +
sed -i 's/\r$//' "${PAY}/provision.sh"
chmod +x "${PAY}/provision.sh"
chmod +x "${PAY}/scripts"/*.sh
chmod +x "${PAY}"/bin/* 2>/dev/null || true

# Build variables, read back by provision.sh on the target. No secret belongs
# in here: the two keys it can carry are public halves.
{
  printf 'APPLIANCE_NAME=%s\n'            "${APPLIANCE_NAME}"
  printf 'APPLIANCE_VERSION=%s\n'         "${APPLIANCE_VERSION}"
  printf 'APPLIANCE_VENDOR=%s\n'          "${APPLIANCE_VENDOR}"
  printf 'APPLIANCE_TARGET=baremetal\n'
  printf 'APPLIANCE_FAST=1\n'
  printf 'PROTECT_LEVEL=%s\n'             "${PROTECT_LEVEL}"
  printf 'GRUB_PASSWORD=%s\n'             "${GRUB_PASSWORD}"
  printf 'SUPPORT_PUBLIC_KEY=%s\n'        "${SUPPORT_PUBLIC_KEY}"
  printf 'LICENSE_PUBLIC_KEY=%s\n'        "${LICENSE_PUBLIC_KEY}"
  printf 'LICENSE_ENFORCEMENT_BUILD=%s\n' "${LICENSE_ENFORCEMENT_BUILD}"
} > "${PAY}/build.env"
chmod 0644 "${PAY}/build.env"

if grep -qi 'PRIVATE KEY' "${PAY}/build.env"; then
  die "a private key reached build.env; only public halves may ship"
fi

# --- 3. render the autoinstall seed ----------------------------------------
say "rendering the autoinstall seed"
# Generated here, hashed, and immediately discarded. subiquity will not install
# without an identity, so the account has to exist; nobody knows its password,
# and 99-seal.sh replaces the hash with "!" at the end of provisioning anyway.
SETUP_PW="$(openssl rand -base64 48 | tr -d '\n=/+' | head -c 32)"
SETUP_HASH="$(openssl passwd -6 "${SETUP_PW}")"
unset SETUP_PW

python3 "${ROOT}/iso/render-seed.py" \
        "${ROOT}/iso/user-data.tmpl" \
        "${WORK}/nocloud/user-data" \
        "${SETUP_HASH}" \
        "${APPLIANCE_HOSTNAME}"
unset SETUP_HASH

cp "${ROOT}/iso/meta-data" "${WORK}/nocloud/meta-data"
sed -i 's/\r$//' "${WORK}/nocloud/meta-data"

# --- 4. boot menu and integrity list ---------------------------------------
say "preparing the boot menu"
cp "${ROOT}/iso/grub.cfg" "${WORK}/grub.cfg"
sed -i 's/\r$//' "${WORK}/grub.cfg"

# loopback.cfg has to be replaced as well as grub.cfg. The stock one carries no
# autoinstall argument, so booting this ISO through Ventoy or any other loopback
# loader bypasses our menu completely and lands the operator in the plain
# interactive Ubuntu installer: they get Ubuntu, not the appliance.
cp "${ROOT}/iso/loopback.cfg" "${WORK}/loopback.cfg"
sed -i 's/\r$//' "${WORK}/loopback.cfg"

# md5sum.txt is what casper's "Check disc for defects" entry verifies. Leaving a
# stale hash for grub.cfg in it turns that check into a false failure report on
# a perfectly good disc.
say "updating md5sum.txt for the replaced grub.cfg"
xorriso -osirrox on -indev "${BASE_ISO}" \
        -extract /md5sum.txt "${WORK}/md5sum.txt" >/dev/null 2>&1
NEWMD5="$(md5sum "${WORK}/grub.cfg" | cut -d' ' -f1)"
python3 "${ROOT}/iso/fix-md5sum.py" "${WORK}/md5sum.txt" "${NEWMD5}"

# --- 5. repack -------------------------------------------------------------
# "-boot_image any replay" carries the original El Torito catalogue, the
# protective MBR, the GPT and the appended EFI system partition across to the
# new image. Reconstructing those by hand from the -report_el_torito output is
# the usual approach and it is far easier to get subtly wrong; a mistake there
# produces an ISO that boots on BIOS and silently fails on UEFI, or the reverse.
say "repacking the ISO (this takes a few minutes)"
rm -f "${OUT_ISO}"
xorriso \
  -indev "${BASE_ISO}" \
  -outdev "${OUT_ISO}" \
  -boot_image any replay \
  -overwrite on \
  -map "${WORK}/nocloud"    /nocloud \
  -map "${PAY}"             /appliance \
  -map "${WORK}/grub.cfg"   /boot/grub/grub.cfg \
  -map "${WORK}/loopback.cfg" /boot/grub/loopback.cfg \
  -map "${WORK}/md5sum.txt" /md5sum.txt \
  -commit

# --- 6. verify -------------------------------------------------------------
say "verifying the result"
for want in /nocloud/user-data /nocloud/meta-data /appliance/provision.sh \
            /appliance/build.env /appliance/app-source.tar.gz; do
  xorriso -indev "${OUT_ISO}" -find "${want}" 2>/dev/null | grep -q . \
    || die "missing from the built ISO: ${want}"
done

BOOTINFO="$(xorriso -indev "${OUT_ISO}" -report_el_torito as_mkisofs 2>&1 || true)"
printf '%s' "${BOOTINFO}" | grep -q 'eltorito.img' \
  || die "the built ISO lost its BIOS boot record"
printf '%s' "${BOOTINFO}" | grep -q 'append_partition' \
  || die "the built ISO lost its EFI system partition"

# The autoinstall kernel argument is the whole point of the remaster. If the
# boot menu were copied without it, the ISO would boot to a stock interactive
# Ubuntu installer and nobody would notice until a customer tried it.
xorriso -osirrox on -indev "${OUT_ISO}" \
        -extract /boot/grub/grub.cfg "${WORK}/grub.check" >/dev/null 2>&1
grep -q 'autoinstall' "${WORK}/grub.check" \
  || die "the boot menu on the built ISO has no autoinstall entry"

# A finite timeout on a menu whose default entry erases the disk means an ISO
# left in iDRAC/iLO virtual media, or a USB stick left in a front panel,
# re-wipes the machine on EVERY reboot with nobody touching it. Refuse to
# ship that.
grep -q 'set timeout=-1' "${WORK}/grub.check" \
  || die "the boot menu can auto-boot into a disk wipe (timeout is not -1)"

xorriso -osirrox on -indev "${OUT_ISO}" \
        -extract /boot/grub/loopback.cfg "${WORK}/loopback.check" >/dev/null 2>&1
grep -q 'autoinstall' "${WORK}/loopback.check" \
  || die "loopback.cfg is the stock one; a Ventoy boot would bypass our menu"
grep -q 'set timeout=-1' "${WORK}/loopback.check" \
  || die "loopback.cfg can auto-boot into a disk wipe (timeout is not -1)"

SIZE="$(du -h "${OUT_ISO}" | cut -f1)"
say "done"
say ""
say "  ISO   : ${OUT_ISO}"
say "  size  : ${SIZE}"
say "  boots : BIOS and UEFI"
say ""
say "Write it to a USB stick, or attach it to a VM and boot it. The first"
say "menu entry installs unattended and ERASES the target disk."
