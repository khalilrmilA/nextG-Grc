#!/usr/bin/env bash
# build-ova-local.sh
#
# Builds the appliance OVA entirely on this Ubuntu machine, using VirtualBox as
# a throwaway build hypervisor. No vCenter, no ESXi, no CI server.
#
#   GRUB_PASSWORD=... ./scripts/build-ova-local.sh /path/to/GRC 1.0.0
#
# The result is output/<name>-<version>.ova, ready to import into ESXi,
# vCenter, Workstation or VirtualBox.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_SRC="${1:?usage: build-ova-local.sh <path-to-app-source> [version]}"
VERSION="${2:-1.0.0}"
NAME="${APPLIANCE_NAME:-grceye-appliance}"
VM="${NAME}-${VERSION}"

# Build variables. GRUB_PASSWORD is required by 35-lockdown.sh; the rest have
# working defaults. None of them is ever a literal in this repository.
PROTECT_LEVEL="${PROTECT_LEVEL:-binary}"
# vmware | hyperv | azure. What the image is built FOR.
APPLIANCE_TARGET="${APPLIANCE_TARGET:-vmware}"
: "${GRUB_PASSWORD:?set GRUB_PASSWORD in the build environment}"
SUPPORT_PUBLIC_KEY="${SUPPORT_PUBLIC_KEY:-}"
LICENSE_PUBLIC_KEY="${LICENSE_PUBLIC_KEY:-}"
LICENSE_ENFORCEMENT_BUILD="${LICENSE_ENFORCEMENT_BUILD:-True}"
APPLIANCE_VENDOR="${APPLIANCE_VENDOR:-Next Step IT}"

WORK="${ROOT}/.build"
OUT="${ROOT}/output"
VMDIR="${WORK}/vms"
STAGE="${WORK}/appsrc"
SSH_PORT=2222
CLOUDIMG_URL="https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img"
DISK_MB=40960

APP_SRC="$(readlink -f "$APP_SRC")"
mkdir -p "$WORK" "$OUT" "$VMDIR"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# --------------------------------------------------------------------------
say "0. preflight"
for c in VBoxManage qemu-img cloud-localds ssh rsync sha256sum; do
  command -v "$c" >/dev/null || { echo "missing: $c (see STEP-BY-STEP.md step 1)"; exit 1; }
done
if ! grep -Eqc '(vmx|svm)' /proc/cpuinfo; then
  echo "CPU virtualisation extensions are not visible."
  echo "If this machine is itself a VM, enable nested virtualisation on its host."
  exit 1
fi
VBoxManage unregistervm "$VM" --delete 2>/dev/null || true

# --------------------------------------------------------------------------
say "1. base disk from the Ubuntu cloud image"
IMG="${WORK}/ubuntu-24.04-cloudimg.img"
[ -f "$IMG" ] || curl -fL --progress-bar -o "$IMG" "$CLOUDIMG_URL"
VDI="${VMDIR}/${VM}.vdi"
rm -f "$VDI"
qemu-img convert -f qcow2 -O vdi "$IMG" "$VDI"
VBoxManage modifymedium disk "$VDI" --resize "$DISK_MB"

# --------------------------------------------------------------------------
say "2. build credentials and cloud-init seed"
KEY="${WORK}/buildkey"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N '' -f "$KEY" -C appliance-build >/dev/null
SEEDDIR="${WORK}/seed"
mkdir -p "$SEEDDIR"
sed "s|REPLACED_AT_BUILD_TIME|$(cat "${KEY}.pub")|" "${ROOT}/seed/user-data" > "${SEEDDIR}/user-data"
printf 'instance-id: appliance-build\nlocal-hostname: appliance-build\n' > "${SEEDDIR}/meta-data"
SEED="${VMDIR}/seed.iso"
cloud-localds "$SEED" "${SEEDDIR}/user-data" "${SEEDDIR}/meta-data"

# --------------------------------------------------------------------------
say "3. staging the application source (allowlist)"
# An allowlist, not a blocklist. A blocklist ships whatever it forgot to name,
# and this repository carries backend/.env with a real SECRET_KEY, 69 tracked
# customer evidence files under backend/uploads, a 13 MB client-data database
# backup and a 200 MB virtualenv. Every OVA copy is byte identical, so any one
# of those becomes a shared secret or a data breach across the whole install
# base.
rm -rf "$STAGE"
mkdir -p "$STAGE/backend" "$STAGE/release/seed"
for item in backend/app backend/scripts backend/appliance_cli.py backend/requirements.txt; do
  [ -e "${APP_SRC}/${item}" ] || { echo "missing from the source tree: ${item}"; exit 1; }
  cp -a "${APP_SRC}/${item}" "$STAGE/backend/"
done
cp -a "${APP_SRC}/frameworks" "$STAGE/frameworks"
cp -a "${APP_SRC}/release/seed/grc_seed.db" "$STAGE/release/seed/grc_seed.db"
# .env is excluded because 20-app.sh writes its own .env.production inside the
# guest; carrying a developer's .env into the image is exactly the kind of
# accident the audit below catches.
rsync -a --exclude node_modules --exclude dist --exclude .git \
      --exclude '.env' --exclude '.env.*' \
      "${APP_SRC}/frontend/" "$STAGE/frontend/"

# Refuse to upload if anything sensitive slipped through the allowlist.
FORBIDDEN="$(find "$STAGE" \
  \( -name '.env' -o -name '.env.*' -o -name '*.log' -o -name '*.pem' \
     -o -name '*.key' -o -name 'uploads' -o -name 'venv' \) -print)"
if [ -n "$FORBIDDEN" ]; then
  echo "staging area contains files that must not ship:"
  printf '%s\n' "$FORBIDDEN"
  exit 1
fi
# The reference database is the only .db allowed through.
STRAY_DB="$(find "$STAGE" -name '*.db' ! -path '*/release/seed/*' -print)"
if [ -n "$STRAY_DB" ]; then
  echo "unexpected database file in the staging area:"
  printf '%s\n' "$STRAY_DB"
  exit 1
fi
echo "staging clean: $(du -sh "$STAGE" | cut -f1)"

# --------------------------------------------------------------------------
say "4. create the build VM with ESXi-compatible virtual hardware"
VBoxManage createvm --name "$VM" --ostype Ubuntu_64 --register --basefolder "$VMDIR"
VBoxManage modifyvm "$VM" \
  --memory 4096 --cpus 2 --vram 16 \
  --firmware bios --rtcuseutc on --ioapic on \
  --audio-driver none --usb off --usbehci off \
  --graphicscontroller vmsvga \
  --nic1 nat --nictype1 82545EM \
  --natpf1 "buildssh,tcp,127.0.0.1,${SSH_PORT},,22"

VBoxManage storagectl "$VM" --name SCSI --add scsi --controller LSILogicSAS --bootable on
VBoxManage storageattach "$VM" --storagectl SCSI --port 0 --device 0 --type hdd --medium "$VDI"
VBoxManage storagectl "$VM" --name IDE --add ide
VBoxManage storageattach "$VM" --storagectl IDE --port 0 --device 0 --type dvddrive --medium "$SEED"

# --------------------------------------------------------------------------
say "5. boot and wait for SSH"
VBoxManage startvm "$VM" --type headless
SSHOPT="-i ${KEY} -p ${SSH_PORT} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
for i in $(seq 1 60); do
  # shellcheck disable=SC2086
  ssh $SSHOPT builder@127.0.0.1 true 2>/dev/null && break
  [ "$i" -eq 60 ] && { echo "guest did not come up"; exit 1; }
  sleep 5
done
echo "guest is reachable"
# shellcheck disable=SC2086
ssh $SSHOPT builder@127.0.0.1 'cloud-init status --wait' || true

# --------------------------------------------------------------------------
say "6. upload the appliance files and the staged application"
# shellcheck disable=SC2086
rsync -a -e "ssh $SSHOPT" \
  "${ROOT}/scripts" "${ROOT}/files" "${ROOT}/bin" \
  builder@127.0.0.1:/tmp/
# shellcheck disable=SC2086
rsync -a -e "ssh $SSHOPT" "$STAGE/" builder@127.0.0.1:/tmp/app/

# A Windows checkout carries CRLF line endings, which make every one of these
# scripts fail inside the guest with "bad interpreter".
# shellcheck disable=SC2086
ssh $SSHOPT builder@127.0.0.1 \
  "sudo apt-get update -qq && sudo apt-get install -y -qq dos2unix && \
   sudo find /tmp/scripts /tmp/bin -type f -exec dos2unix -q {} + && \
   sudo find /tmp/files -type f -exec dos2unix -q {} + && \
   sudo chmod +x /tmp/scripts/*.sh /tmp/bin/*"

# --------------------------------------------------------------------------
say "7. provision, build the app, protect, harden, lock down"
# Stages 10, 20, 25, 30, 35. 25 and 35 were written but never wired in, which
# was defect 5.
# The build variables are expanded here, on the client, on purpose: they are
# local values being carried into the guest.
# shellcheck disable=SC2086,SC2029
ssh $SSHOPT builder@127.0.0.1 "sudo env \
  APPLIANCE_NAME='${NAME}' \
  APPLIANCE_VERSION='${VERSION}' \
  APPLIANCE_VENDOR='${APPLIANCE_VENDOR}' \
  BUILD_USER=builder \
  PROTECT_LEVEL='${PROTECT_LEVEL}' \
  APPLIANCE_TARGET='${APPLIANCE_TARGET}' \
  GRUB_PASSWORD='${GRUB_PASSWORD}' \
  SUPPORT_PUBLIC_KEY='${SUPPORT_PUBLIC_KEY}' \
  LICENSE_PUBLIC_KEY='${LICENSE_PUBLIC_KEY}' \
  LICENSE_ENFORCEMENT_BUILD='${LICENSE_ENFORCEMENT_BUILD}' \
  bash -e -c '
  bash /tmp/scripts/10-base.sh &&
  bash /tmp/scripts/20-app.sh &&
  bash /tmp/scripts/25-protect-app.sh &&
  bash /tmp/scripts/30-harden.sh &&
  bash /tmp/scripts/35-lockdown.sh
'"

# --------------------------------------------------------------------------
say "8. seal the image"
# 99-seal.sh disables SSH at next boot as its final action, so nothing may run
# over this connection afterwards except the shutdown itself.
# APPLIANCE_TARGET expands here, on the client, on purpose: it is a local value
# being carried into the guest.
# shellcheck disable=SC2086,SC2029
ssh $SSHOPT builder@127.0.0.1 \
  "sudo env BUILD_USER=builder APPLIANCE_TARGET='${APPLIANCE_TARGET}' bash /tmp/scripts/99-seal.sh" || true
# shellcheck disable=SC2086
ssh $SSHOPT builder@127.0.0.1 "sudo shutdown -P now" 2>/dev/null || true

for i in $(seq 1 60); do
  VBoxManage showvminfo "$VM" --machinereadable | grep -q 'VMState="poweroff"' && break
  [ "$i" -eq 60 ] && VBoxManage controlvm "$VM" poweroff
  sleep 5
done
echo "guest powered off"

# --------------------------------------------------------------------------
say "9. detach build-only devices"
VBoxManage storageattach "$VM" --storagectl IDE --port 0 --device 0 --type dvddrive --medium none
VBoxManage storagectl   "$VM" --name IDE --remove
VBoxManage modifyvm     "$VM" --natpf1 delete buildssh

# --------------------------------------------------------------------------
say "10. export to OVA"
RAW="${WORK}/${VM}-vbox.ova"
rm -f "$RAW"
VBoxManage export "$VM" -o "$RAW" --ovf10 \
  --vsys 0 \
  --product "${NAME}" \
  --producturl "https://www.grceye.com/" \
  --vendor "${APPLIANCE_VENDOR}" \
  --vendorurl "https://www.grceye.com/" \
  --version "${VERSION}"

# --------------------------------------------------------------------------
say "11. make the OVA importable on ESXi"
FINAL="${OUT}/${VM}.ova"
bash "${ROOT}/scripts/fix-ova-for-esxi.sh" "$RAW" "$FINAL" vmx-15 "${ROOT}/ovf/product-section.xml"

sha256sum "$FINAL" > "${FINAL}.sha256"

# Leave nothing behind that contains the staged source.
rm -rf "$STAGE"

say "done"
ls -lh "$FINAL" "${FINAL}.sha256"
echo
echo "Copy it to another machine with:"
echo "  scp ${FINAL} ${FINAL}.sha256 user@target:/path/"
echo "Then verify there with:  sha256sum -c $(basename "$FINAL").sha256"
