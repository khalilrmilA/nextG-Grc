#!/usr/bin/env bash
# Capture a built appliance filesystem out of an OVA, as a squashfs.
#
# This is what makes the OFFLINE installer ISO possible: instead of the target
# machine downloading packages and compiling the backend for an hour, the ISO
# carries the finished filesystem and the installer writes it down in minutes.
#
# Run this, then scripts/build-offline-iso.sh.
#
# TWO TRAPS THIS SCRIPT EXISTS TO AVOID
#
# 1. /boot is a SEPARATE partition on the appliance image. Squashing only the
#    root logical volume yields an empty /boot with no kernel and no initramfs.
#    That installs perfectly and then does not boot. Both are mounted into one
#    tree before packing, and mksquashfs is allowed to cross the mount point
#    (so NOT -one-file-system).
#
# 2. /cdrom must NOT be in the image. Subiquity mounts the source filesystem and
#    then does mkdir on <source>/cdrom to bind-mount the installation media. If
#    the directory already exists that mkdir raises EEXIST and the install fails
#    at the very last step with:
#
#      configure_apt: [Errno 17] File exists: '/tmp/tmpXXXX/mount/cdrom'
#
#    Ubuntu's own ubuntu-server-minimal.squashfs contains /media and /mnt but no
#    /cdrom, which is exactly why stock installs work and ours did not. The
#    appliance has one only because the original install left it behind; it is an
#    empty mount point and nothing needs it.
#
# 3. /swap.img must NOT be in the image either, for a different reason. It is
#    4 GB of zeros, two thirds of the whole uncompressed filesystem. It packs to
#    nothing, but curtin expands it again on install and writes 4 GB of nothing
#    to the target: measured at fifteen minutes of a pinned CPU with the target
#    disk not growing at all, because zero writes allocate no blocks. It is
#    excluded here and recreated by reseal-target.sh with fallocate, which
#    allocates without writing.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

OVA="${OVA:-${ROOT}/output/grceye-appliance-1.0.0.ova}"
WORK="${WORK:-/var/tmp/rootfs-capture}"
OUT="${OUT:-${WORK}/appliance.squashfs}"

say() { printf '[capture] %s\n' "$*"; }
die() { printf '[capture] FATAL: %s\n' "$*" >&2; exit 1; }

for t in qemu-nbd mksquashfs vgchange unsquashfs; do
  command -v "$t" >/dev/null || die "$t is missing (apt install qemu-utils squashfs-tools lvm2)"
done
[ -f "${OVA}" ] || die "no OVA at ${OVA}"

# Refuse to touch a host that already has this volume group active.
if vgs --noheadings -o vg_name 2>/dev/null | grep -qw ubuntu-vg; then
  die "ubuntu-vg is already active on this host"
fi

rm -rf "${WORK}"; mkdir -p "${WORK}/mnt"

say "extracting the disk from ${OVA}"
tar -xf "${OVA}" -C "${WORK}" --wildcards '*.vmdk'
VMDK="$(find "${WORK}" -name '*.vmdk' | head -1)"
[ -n "${VMDK}" ] || die "no vmdk inside the OVA"

say "attaching read-only"
modprobe nbd max_part=16 2>/dev/null || true
qemu-nbd --disconnect /dev/nbd0 >/dev/null 2>&1 || true
qemu-nbd --read-only --connect=/dev/nbd0 -f vmdk "${VMDK}"
sleep 2
partprobe /dev/nbd0 2>/dev/null || true
udevadm settle 2>/dev/null || true

cleanup() {
  umount "${WORK}/mnt/boot" 2>/dev/null || true
  umount "${WORK}/mnt" 2>/dev/null || true
  vgchange -an ubuntu-vg >/dev/null 2>&1 || true
  qemu-nbd --disconnect /dev/nbd0 >/dev/null 2>&1 || true
}
trap cleanup EXIT

say "mounting root and /boot into one tree"
pvscan --cache /dev/nbd0p3 >/dev/null 2>&1 || true
vgchange -ay ubuntu-vg >/dev/null 2>&1
udevadm settle 2>/dev/null || true
mount -o ro,noload /dev/ubuntu-vg/ubuntu-lv "${WORK}/mnt"
mount -o ro,noload /dev/nbd0p2 "${WORK}/mnt/boot"

for f in vmlinuz initrd.img; do
  [ -e "${WORK}/mnt/boot/${f}" ] || die "/boot/${f} missing; the image would not boot"
done
say "kernel and initramfs present"

say "verifying this is the appliance"
for p in /opt/appliance/runtime/appliance-api /opt/appliance/seed/grc_seed.db \
         /etc/appliance/version /var/www/appliance/index.html; do
  [ -e "${WORK}/mnt${p}" ] || die "missing from the image: ${p}"
done
[ -e "${WORK}/mnt/var/lib/appliance/.firstboot-done" ] \
  && die "the image is not sealed: firstboot has already run"
say "sealed appliance confirmed:"
sed 's/^/    /' "${WORK}/mnt/etc/appliance/version"

# Optionally lay the repository's current appliance scripts over the captured
# ones. See the note below; off unless APPLIANCE_OVERLAY_SCRIPTS=1.
PSEUDO=()
if [ "${APPLIANCE_OVERLAY_SCRIPTS:-0}" = "1" ]; then
  say "overlaying the repository's current appliance scripts"
  # These live INSIDE the captured filesystem, so without this a fix to any of
  # them needs a full appliance rebuild before the ISO can carry it. Substituting
  # at pack time turns 110 minutes into 12.
  #
  # This is a deliberate, temporary divergence from the OVA the capture came
  # from: that OVA still has the old script until it is rebuilt. Every
  # substitution is printed so the divergence is visible rather than silent.
  overlay() {
    local src="$1" dst="$2" mode="$3"
    if [ ! -f "${src}" ]; then
      say "  WARN: ${src} missing, keeping the captured copy"
      return
    fi
    if ! diff -q "${src}" "${WORK}/mnt/${dst}" >/dev/null 2>&1; then
      say "  REPLACED ${dst}"
    else
      say "  same     ${dst}"
    fi
    PSEUDO+=("-p" "${dst} f ${mode} 0 0 cat ${src}")
  }
  overlay "${ROOT}/scripts/firstboot.sh"           opt/appliance/bin/firstboot.sh 0755
  overlay "${ROOT}/scripts/netconfig.sh"           opt/appliance/bin/netconfig.sh 0755
  overlay "${ROOT}/files/console/appliance-console.sh" opt/appliance/bin/console  0755
fi

say "packing (the slow part)"
# -e cdrom: see the header. Its presence makes subiquity's install fail at the
# last step with EEXIST, and stock Ubuntu images do not have it either.
# No -one-file-system: /boot is a separate mount and must be included.
mksquashfs "${WORK}/mnt" "${OUT}" \
  -comp zstd -Xcompression-level 15 \
  -noappend -no-progress \
  -e cdrom -e boot/efi -e swap.img \
  "${PSEUDO[@]}" \
  2>&1 | tail -4

say "checking what was packed"
unsquashfs -l "${OUT}" > "${WORK}/list" 2>/dev/null || die "cannot list the result"
grep -qE '^squashfs-root/boot/vmlinuz' "${WORK}/list" || die "kernel did not make it in"
grep -qE '^squashfs-root/opt/appliance/runtime/appliance-api' "${WORK}/list" \
  || die "the appliance binary did not make it in"
if grep -qE '^squashfs-root/cdrom$' "${WORK}/list"; then
  die "/cdrom is still present; subiquity will fail with EEXIST on install"
fi
if grep -qE '^squashfs-root/swap\.img$' "${WORK}/list"; then
  die "/swap.img is still present; it would add 4 GB of zeros to every install"
fi
say "no /cdrom, kernel present, appliance present"

if [ "${APPLIANCE_OVERLAY_SCRIPTS:-0}" = "1" ]; then
  # Prove the substitution happened rather than trusting mksquashfs. An overlay
  # that silently did nothing would ship the very bug it was meant to fix.
  TMPD="$(mktemp -d)"
  if unsquashfs -d "${TMPD}/x" -f "${OUT}" opt/appliance/bin/firstboot.sh >/dev/null 2>&1 \
     && diff -q "${ROOT}/scripts/firstboot.sh" "${TMPD}/x/opt/appliance/bin/firstboot.sh" >/dev/null 2>&1; then
    say "verified: firstboot.sh in the squashfs matches the repository"
  else
    rm -rf "${TMPD}"
    die "the firstboot.sh overlay did not take"
  fi
  rm -rf "${TMPD}"
fi

say "done"
say "  squashfs : ${OUT} ($(du -h "${OUT}" | cut -f1))"
say "  next     : scripts/build-offline-iso.sh"
