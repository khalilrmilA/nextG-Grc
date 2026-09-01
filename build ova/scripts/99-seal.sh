#!/usr/bin/env bash
# Seal the image. This is the last thing that runs before the VM is exported.
# Everything unique to this build is destroyed here so that every deployed copy
# generates its own identity at first boot.
#
# This script is the last user of SSH: the build drives it over that connection.
# Masking SSH is therefore its final action, after everything else has run. See
# the note in 35-lockdown.sh; this is the second half of defect 2's fix.
set -euo pipefail

BUILD_USER="${BUILD_USER:-builder}"
TARGET="${APPLIANCE_TARGET:-vmware}"

echo "[99-seal] stopping services"
systemctl stop appliance-api nginx || true

echo "[99-seal] removing anything the build left behind"
# 20-app.sh copies by allowlist and audits afterwards, but a build that was
# interrupted and resumed can still leave uploads or a stray database. Nothing
# under these paths should exist in a shipped image.
rm -rf /opt/appliance/backend/venv /opt/appliance/backend/.git
rm -rf /tmp/app /tmp/files /tmp/bin /tmp/scripts /tmp/frontend-build /tmp/protect-build
rm -f  /var/lib/appliance/grc.db /var/lib/appliance/.firstboot-done
rm -rf /var/lib/appliance/uploads/*
find / -xdev -name '*.pyc' -path '*/opt/appliance/*' -delete 2>/dev/null || true

echo "[99-seal] verifying no build secret survives"
# A build that ships an environment file, a private key or the vendor's own
# database is a shipping-stopper, not a warning.
LEAKS=""
for pattern in \
  /opt/appliance/backend/.env \
  /opt/appliance/backend/app/.env \
  /etc/appliance/app.env \
  /root/.ssh/id_rsa \
  /root/.ssh/id_ed25519 \
  /etc/appliance/tls/tls.key
do
  [ -e "${pattern}" ] && LEAKS="${LEAKS}${pattern}"$'\n'
done
# The support key must be present, and must be the PUBLIC half only.
if [ -f /etc/appliance/support.pub ] && grep -qi 'PRIVATE' /etc/appliance/support.pub; then
  LEAKS="${LEAKS}/etc/appliance/support.pub contains a private key"$'\n'
fi
if [ -n "${LEAKS}" ]; then
  echo "[99-seal] FATAL: these must not ship inside the image:" >&2
  printf '%s' "${LEAKS}" >&2
  exit 1
fi
echo "[99-seal] no build secret found"

echo "[99-seal] removing the build-time service restart block"
# 10-base.sh installed this so apt could not restart sshd or networking out from
# under the build. A shipped image must be able to start services normally.
rm -f /usr/sbin/policy-rc.d

echo "[99-seal] package caches and logs"
apt-get -y autoremove --purge
apt-get -y clean
rm -rf /var/lib/apt/lists/*
journalctl --rotate || true
journalctl --vacuum-time=1s || true
find /var/log -type f -exec truncate -s 0 {} \;
rm -rf /var/log/appliance/* /tmp/* /var/tmp/*

echo "[99-seal] cloud-init state"
cloud-init clean --logs --seed 2>/dev/null || true
rm -rf /var/lib/cloud/instances/* /etc/netplan/50-cloud-init.yaml

echo "[99-seal] host identity"
# The build VM is called "appliance-build". Without resetting it here, that name
# ships, and every customer's appliance introduces itself as a build machine on
# their network and in its own console header. firstboot.sh overrides this from
# the appliance_hostname vApp property when the platform supplies one, but
# VirtualBox and bare metal never do, so the fallback has to be sane.
echo "appliance" > /etc/hostname
if [ -f /etc/hosts ]; then
  # Deliberately a plain substring, with no word-boundary anchors.
  # An earlier version used them and was written through a nested heredoc,
  # which collapsed each escape into a literal 0x08 backspace byte. grep
  # renders that invisibly and both bash -n and shellcheck accept it, so the
  # pattern silently never matched and this rewrite was a permanent no-op.
  # Only od -c showed it. The plain string is specific enough on its own.
  sed -i 's/appliance-build/appliance/g' /etc/hosts
fi
rm -f /etc/ssh/ssh_host_*
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
ln -sf /etc/machine-id /var/lib/dbus/machine-id

echo "[99-seal] build account and credentials"
rm -rf /root/.ssh /root/.bash_history /root/.cache
if id -u "${BUILD_USER}" >/dev/null 2>&1; then
  # 35-lockdown.sh deliberately left this account alone so the remaining build
  # steps could run. Lock it now: no password, no shell, no keys.
  #
  # "usermod -p" and not "passwd -l": locking only prefixes the stored hash with
  # "!", leaving the hash itself in /etc/shadow. Every OVA from one build is byte
  # identical, so that hash would ship to every customer and be crackable
  # offline at their leisure. Replacing it removes the hash outright.
  usermod -p '!' "${BUILD_USER}"
  usermod -s /usr/sbin/nologin "${BUILD_USER}" 2>/dev/null || true
  rm -rf "/home/${BUILD_USER}/.ssh" "/home/${BUILD_USER}/.bash_history"
fi
# Same treatment for root, and for any other human account 35-lockdown locked.
usermod -p '!' root
while IFS= read -r u; do
  usermod -p '!' "$u" 2>/dev/null || true
done < <(awk -F: '$3 >= 1000 && $3 < 65534 {print $1}' /etc/passwd)

# Nothing in /etc/shadow may still carry a usable hash. On Azure this is
# enforced by "waagent -deprovision+user" below instead, which removes the
# provisioned account and its credentials wholesale.
if [ "${TARGET}" != "azure" ] && awk -F: '$2 ~ /^\$/ {print $1}' /etc/shadow | grep -q .; then
  echo "[99-seal] FATAL: these accounts still have a password hash:" >&2
  awk -F: '$2 ~ /^\$/ {print "  " $1}' /etc/shadow >&2
  exit 1
fi
echo "[99-seal] no password hash remains in /etc/shadow"
rm -f /etc/sudoers.d/builder
history -c 2>/dev/null || true

# Zeroing writes ~34 GB across the free space so the exported image compresses
# well. Measured at roughly 1,400 MB/min in this guest, that is about 24 minutes
# and it buys nothing for a throwaway test build.
if [ "${APPLIANCE_FAST:-0}" = "1" ]; then
  echo "[99-seal] FAST build: skipping free-space zeroing (image will be large)"
else
  echo "[99-seal] zeroing free space (improves OVA compression)"
  dd if=/dev/zero of=/EMPTY bs=1M status=none || true
  rm -f /EMPTY
fi
sync

# ---------------------------------------------------------------------------
# Absolutely last: stop SSH coming back.
#
# "disable" and not "mask --now" is deliberate, and the distinction matters.
# Disabling changes only what happens at the NEXT boot, so the connection this
# script is running over stays up and the build driver can still issue its
# shutdown command. Masking here instead has broken builds where Packer
# reconnects between the provisioner and the shutdown step.
#
# The mask itself happens on the customer's first boot, in
# appliance-ssh-lockdown.service. Between the two, a shipped image has SSH off
# at boot even if that unit never runs.
# ---------------------------------------------------------------------------
if [ "${TARGET}" = "azure" ]; then
  # Azure reaches the appliance over SSH and the agent configures it at deploy
  # time, so disabling it here would produce an unreachable VM.
  echo "[99-seal] azure: leaving SSH enabled for the platform agent"
else
  echo "[99-seal] disabling SSH at next boot (final action)"
  systemctl disable ssh.socket ssh.service 2>/dev/null || true
fi

if [ "${TARGET}" = "azure" ]; then
  # Must be the last action on this target. "-deprovision+user" removes the
  # provisioning user, its SSH keys, the host keys, the agent cache and the
  # nameserver configuration, so the captured image has no identity of its own
  # and Azure can provision each deployment fresh. It is irreversible: the
  # connection this runs over is being dismantled underneath it.
  echo "[99-seal] azure: deprovisioning the Azure Linux Agent"
  waagent -force -deprovision+user || echo "[99-seal] WARN: waagent deprovision failed"
  rm -f /root/.bash_history /home/*/.bash_history 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Power the machine off ourselves.
#
# Packer's shutdown_command is "echo <password> | sudo -S shutdown -P now", and
# by this point neither half of that works: the credential wipe above replaced
# the build user's password hash, and /etc/sudoers.d/builder (the NOPASSWD
# entry) has been removed. The build therefore ends with:
#
#   [sudo] password for builder: Sorry, try again.
#   sudo: no password was provided
#
# and then sits until shutdown_timeout expires. Destroying the build identity is
# correct and must stay; what has to change is depending on it afterwards.
#
# Packer waits on the VM's POWER STATE, not on its command succeeding, so
# scheduling our own poweroff satisfies it either way. systemd-run detaches, so
# this script still exits cleanly first.
# ---------------------------------------------------------------------------
# APPLIANCE_SEAL_ACTION picks what happens here. It defaults to poweroff, so
# the OVA path is unchanged:
#
#   poweroff  the OVA and Azure paths. Packer is waiting on the VM power
#             state so it can export the disk.
#   reboot    the ISO path. There is no disk to export from a physical
#             install, and an appliance that switches itself off at the end of
#             its own installation reads as a failure to whoever is stood at
#             it.
#   none      the caller handles it.
SEAL_ACTION="${APPLIANCE_SEAL_ACTION:-poweroff}"
case "${SEAL_ACTION}" in
  none)
    echo "[99-seal] sealed (leaving the machine running as asked)"
    ;;
  reboot)
    echo "[99-seal] scheduling reboot"
    systemd-run --on-active=15 --unit=appliance-seal-reboot \
      /usr/bin/systemctl reboot >/dev/null 2>&1 \
      || (nohup sh -c 'sleep 15; /usr/sbin/reboot -f' >/dev/null 2>&1 &)
    echo "[99-seal] sealed"
    ;;
  *)
    echo "[99-seal] scheduling poweroff (the build credential is gone by design)"
    systemd-run --on-active=15 --unit=appliance-seal-poweroff \
      /usr/bin/systemctl poweroff >/dev/null 2>&1 \
      || (nohup sh -c 'sleep 15; /usr/sbin/poweroff -f' >/dev/null 2>&1 &)
    echo "[99-seal] sealed"
    ;;
esac
