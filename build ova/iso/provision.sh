#!/usr/bin/env bash
# Build the appliance on the first boot after an ISO install.
#
# WHY THIS RUNS AT BOOT AND NOT DURING THE INSTALL
#
# The obvious place for this is the installer's late-commands, and that does not
# work. The provisioning scripts need things the installer's chroot does not
# have:
#
#   30-harden.sh    "ufw --force enable" needs a live netfilter, not a chroot
#   35-lockdown.sh  "apparmor_parser -r" needs /sys/kernel/security mounted
#   35-lockdown.sh  rehearses the first-boot sequence under the loaded AppArmor
#                   profile and reads kernel denials out of dmesg
#   25-protect-app  the Nuitka smoke test runs the compiled binary as a
#                   confined user
#
# Running them here, on a real booted system, means the ISO path executes the
# exact same scripts as the OVA path with no chroot-specific variants to keep
# in sync. That equivalence is the point: a bug fixed for one target is fixed
# for both.
#
# Cost: the appliance is ready on the SECOND boot, not the first, and this needs
# a working internet connection because it installs apt, pip and npm packages
# and compiles the backend.
set -uo pipefail

PAYLOAD=/opt/appliance-build
STATE=/var/lib/appliance-provisioned
LOG=/var/log/appliance-provision.log

mkdir -p "$(dirname "${LOG}")"
# stdout is the console (see appliance-provision.service). Tee keeps the console
# output and a durable log without choosing between them.
exec > >(tee -a "${LOG}") 2>&1

say() { printf '\n[provision] %s\n' "$*"; }

banner() {
  printf '\n'
  printf '===========================================================\n'
  printf '  %s\n' "$1"
  printf '===========================================================\n\n'
}

# ---------------------------------------------------------------------------
if [ -e "${STATE}" ]; then
  say "already provisioned, nothing to do"
  exit 0
fi

if [ ! -d "${PAYLOAD}" ]; then
  say "FATAL: ${PAYLOAD} is missing, the ISO payload did not survive the install"
  exit 1
fi

# Build variables were written into the payload when the ISO was made.
if [ -r "${PAYLOAD}/build.env" ]; then
  set -a
  # shellcheck source=/dev/null disable=SC1091
  . "${PAYLOAD}/build.env"
  set +a
fi

banner "Preparing the appliance. This takes 40 to 60 minutes."
say "Do not power the machine off. It reboots by itself when it is finished."
say "Progress is also written to ${LOG}"

# ---------------------------------------------------------------------------
# Wait for the network. apt, pip and npm all need it, and network-online.target
# is optimistic: it can be reached before DHCP has actually produced a route.
say "waiting for network"
NET_OK=0
for _ in $(seq 1 60); do
  if getent hosts archive.ubuntu.com >/dev/null 2>&1; then NET_OK=1; break; fi
  sleep 5
done
if [ "${NET_OK}" != "1" ]; then
  banner "NO NETWORK. Cannot continue."
  say "This installer downloads packages and needs a working internet"
  say "connection. Configure the network and reboot to try again."
  exit 1
fi
say "network is up"

# ---------------------------------------------------------------------------
# Lay the payload out at the paths the scripts already expect. 20-app.sh reads
# /tmp/app, /tmp/bin, /tmp/scripts and /tmp/files because that is where Packer's
# file provisioners put them; reproducing the same layout is what lets both
# targets share one set of scripts.
say "unpacking the payload"
rm -rf /tmp/app /tmp/bin /tmp/scripts /tmp/files
mkdir -p /tmp/app
tar -xzf "${PAYLOAD}/app-source.tar.gz" -C /tmp/app || { say "FATAL: payload is corrupt"; exit 1; }
cp -a "${PAYLOAD}/bin"     /tmp/bin
cp -a "${PAYLOAD}/scripts" /tmp/scripts
cp -a "${PAYLOAD}/files"   /tmp/files
chmod +x /tmp/scripts/*.sh /tmp/bin/* 2>/dev/null || true

# ---------------------------------------------------------------------------
export APPLIANCE_NAME="${APPLIANCE_NAME:-appliance}"
export APPLIANCE_VERSION="${APPLIANCE_VERSION:-1.0.0}"
export APPLIANCE_VENDOR="${APPLIANCE_VENDOR:-}"
export APPLIANCE_TARGET="${APPLIANCE_TARGET:-baremetal}"
export APPLIANCE_FAST="${APPLIANCE_FAST:-1}"
export PROTECT_LEVEL="${PROTECT_LEVEL:-binary}"
export GRUB_PASSWORD="${GRUB_PASSWORD:-}"
export SUPPORT_PUBLIC_KEY="${SUPPORT_PUBLIC_KEY:-}"
export LICENSE_PUBLIC_KEY="${LICENSE_PUBLIC_KEY:-}"
export LICENSE_ENFORCEMENT_BUILD="${LICENSE_ENFORCEMENT_BUILD:-}"
export BUILD_USER=setup
export DEBIAN_FRONTEND=noninteractive

FAILED_STAGE=""
for stage in 10-base 20-app 25-protect-app 30-harden 35-lockdown; do
  banner "Stage ${stage}"
  if ! bash "/tmp/scripts/${stage}.sh"; then
    FAILED_STAGE="${stage}"
    break
  fi
done

# ---------------------------------------------------------------------------
if [ -n "${FAILED_STAGE}" ]; then
  banner "PROVISIONING FAILED at stage ${FAILED_STAGE}"
  say "The full log is at ${LOG}"
  say ""
  # Without this the machine is unreachable: the installer account's password is
  # a random string nobody recorded, and whether the console menu got installed
  # depends on how far 35-lockdown.sh got before it failed. Minting a recovery
  # credential here is deliberate. It is generated on this machine, shown only
  # on this local console, and exists only on a build that already failed; a
  # successful run reaches 99-seal.sh, which replaces every password hash with
  # "!" and never prints anything.
  RECOVERY="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  if id -u setup >/dev/null 2>&1 && [ -n "${RECOVERY}" ]; then
    usermod -s /bin/bash -U setup >/dev/null 2>&1 || true
    printf 'setup:%s\n' "${RECOVERY}" | chpasswd
    say "Log in on this console to investigate:"
    say "    user     : setup"
    say "    password : ${RECOVERY}"
    say ""
    say "This credential exists only because provisioning failed."
  fi
  say "Reinstalling from the ISO is usually faster than repairing by hand."
  exit 1
fi

# ---------------------------------------------------------------------------
# Written before sealing, because 99-seal.sh reboots the machine and must not be
# able to leave this file unwritten. If it were written afterwards, a reboot
# racing the write would provision the machine twice.
touch "${STATE}"
systemctl disable appliance-provision.service >/dev/null 2>&1 || true

banner "Finalising"
# APPLIANCE_SEAL_ACTION=reboot: the OVA path powers the VM off here so Packer can
# export the disk. There is nothing to export on a physical install, and an
# appliance that switches itself off at the end of its own installation looks
# broken. Rebooting lands straight on the first-boot sequence instead.
# Run the sealer from /run, not from /tmp. One of the first things 99-seal.sh
# does is "rm -rf /tmp/*", which unlinks the very file it is executing. Linux
# keeps the inode alive while bash holds the descriptor so it would most likely
# survive, but the last step of an unattended install is not the place to lean
# on that. /run is a tmpfs the sealer does not touch.
install -m 0755 /tmp/scripts/99-seal.sh /run/99-seal.sh
APPLIANCE_SEAL_ACTION=reboot APPLIANCE_FAST=1 BUILD_USER=setup bash /run/99-seal.sh || {
  say "WARN: sealing reported an error, rebooting anyway"
  systemctl reboot
}

banner "Done. Rebooting into the appliance."
