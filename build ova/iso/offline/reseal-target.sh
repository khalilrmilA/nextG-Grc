#!/bin/bash
# Re-seal the freshly laid-down appliance before its first boot.
#
# Runs from the ISO, as a late-command, with the installed system mounted at
# $1 (normally /target) and /cdrom still available.
#
# WHY THIS IS MANDATORY
#
# The squashfs we shipped was sealed: no password hashes, no machine id, no SSH
# host keys, firstboot pending. The INSTALLER then undoes part of that:
#
#   - it creates the autoinstall identity account with a real SHA-512 hash. Every
#     ISO is byte identical, so that one hash would be shared by every customer.
#   - subiquity copies /var/log/installer/ into the installed system, including
#     autoinstall-user-data, a file whose own upstream comment says it "contains
#     a password hash".
#   - it may write its own machine id, netplan and cloud-init state.
#
# So the image is sealed, unsealed by the installer, and must be sealed again
# here. Anything this misses ships to every customer.
set -uo pipefail

T="${1:-/target}"
say() { printf '[reseal] %s\n' "$*"; }

[ -d "$T" ] || { echo "[reseal] FATAL: no target at $T" >&2; exit 1; }
[ -x "$T/opt/appliance/runtime/appliance-api" ] || {
  echo "[reseal] FATAL: $T does not look like the appliance" >&2; exit 1; }

say "removing the installer's own log, which carries a password hash"
if [ -d "$T/var/log/installer" ]; then
  find "$T/var/log/installer" -type f -exec shred -u {} + 2>/dev/null || true
  rm -rf "$T/var/log/installer"
fi
rm -f "$T/var/log/cloud-init.log" "$T/var/log/cloud-init-output.log" 2>/dev/null || true

say "removing the account the installer had to create"
if [ -f "$T/etc/shadow" ]; then
  # Replace every stored hash with "!". Locking with passwd -l would only
  # prefix the hash, leaving it in the file and crackable offline at leisure.
  awk -F: 'BEGIN{OFS=":"} { if ($2 ~ /^\$/) $2="!"; print }' \
      "$T/etc/shadow" > "$T/etc/shadow.resealed" 2>/dev/null \
    && cat "$T/etc/shadow.resealed" > "$T/etc/shadow" \
    && rm -f "$T/etc/shadow.resealed"
  chmod 0640 "$T/etc/shadow" 2>/dev/null || true
fi
rm -f "$T/etc/sudoers.d/setup" "$T/etc/sudoers.d/90-cloud-init-users" 2>/dev/null || true
rm -rf "$T/home/setup" 2>/dev/null || true

say "verifying no usable password hash survives"
if [ -f "$T/etc/shadow" ] && awk -F: '$2 ~ /^\$/ {print $1}' "$T/etc/shadow" | grep -q .; then
  echo "[reseal] FATAL: these accounts still have a password hash:" >&2
  awk -F: '$2 ~ /^\$/ {print "  " $1}' "$T/etc/shadow" >&2
  exit 1
fi

say "clearing host identity so each deployment generates its own"
: > "$T/etc/machine-id" 2>/dev/null || true
rm -f "$T/var/lib/dbus/machine-id" 2>/dev/null || true
rm -f "$T/etc/ssh/ssh_host_"* 2>/dev/null || true
rm -f "$T/var/lib/systemd/random-seed" "$T/var/lib/systemd/credential.secret" 2>/dev/null || true

say "clearing installer-written network and cloud-init state"
rm -rf "$T/var/lib/cloud/instances/"* "$T/var/lib/cloud/data/"* 2>/dev/null || true
rm -f "$T/etc/cloud/cloud.cfg.d/99-installer.cfg" \
      "$T/etc/cloud/cloud.cfg.d/50-curtin-networking.cfg" \
      "$T/etc/netplan/50-cloud-init.yaml" 2>/dev/null || true
# The appliance writes its own netplan on first boot, from the console menu or
# DHCP. Leaving the installer's file would fight it.

say "recreating the swap file"
# Excluded from the image on purpose: it is 4 GB of zeros that would otherwise be
# decompressed and written to this disk for no benefit. fallocate reserves the
# space without writing it, so this takes a moment instead of minutes.
#
# /etc/fstab in the image already references /swap.img, so it has to exist or the
# swap unit fails on every boot. Non-fatal if it cannot be created: a machine
# with no swap boots fine, and failing the whole install over it would be wrong.
if [ ! -e "$T/swap.img" ]; then
  if fallocate -l 4G "$T/swap.img" 2>/dev/null; then
    chmod 0600 "$T/swap.img"
    mkswap "$T/swap.img" >/dev/null 2>&1 || true
    say "  4 GB swap file created"
  else
    say "  WARN: could not create the swap file; the appliance will boot without swap"
    # Do not leave fstab pointing at a file that does not exist.
    sed -i '/^\/swap\.img/d' "$T/etc/fstab" 2>/dev/null || true
  fi
fi

say "re-arming first boot"
rm -f "$T/var/lib/appliance/.firstboot-done" 2>/dev/null || true
rm -f "$T/var/lib/appliance/.admin-pass" 2>/dev/null || true
# The unit is enabled inside the shipped image; make certain the installer did
# not disable it while rewriting systemd state.
if [ -f "$T/etc/systemd/system/appliance-firstboot.service" ]; then
  mkdir -p "$T/etc/systemd/system/multi-user.target.wants"
  ln -sf /etc/systemd/system/appliance-firstboot.service \
     "$T/etc/systemd/system/multi-user.target.wants/appliance-firstboot.service" 2>/dev/null || true
fi

say "final check"
FAIL=0
[ -s "$T/etc/machine-id" ]                    && { echo "[reseal]   machine-id not cleared" >&2; FAIL=1; }
ls "$T/etc/ssh/ssh_host_"* >/dev/null 2>&1    && { echo "[reseal]   ssh host keys survived" >&2; FAIL=1; }
[ -e "$T/var/lib/appliance/.firstboot-done" ] && { echo "[reseal]   firstboot already marked done" >&2; FAIL=1; }
[ -d "$T/var/log/installer" ]                 && { echo "[reseal]   installer log survived" >&2; FAIL=1; }
if [ "$FAIL" -ne 0 ]; then
  echo "[reseal] FATAL: the installed system is not properly sealed" >&2
  exit 1
fi

say "sealed; the appliance will configure itself on first boot"
