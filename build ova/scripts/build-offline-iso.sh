#!/usr/bin/env bash
# Build the OFFLINE appliance installer ISO.
#
# The difference from build-iso.sh in one sentence: that ISO ships source and
# rebuilds the appliance on the customer's machine over 40 to 60 minutes with an
# internet connection; this one ships the FINISHED appliance filesystem and the
# installer lays it down in about five minutes with no network at all.
#
# The mechanism is Ubuntu's own: /casper/install-sources.yaml lists installable
# filesystem images, and the autoinstall seed names ours with source.id. The
# stock ISO already ships a "type: fsimage" entry for its minimal squashfs, so
# this is a supported path rather than a trick.
#
# Requires a squashfs produced by capturing a BUILT appliance disk. See
# scripts/capture-rootfs.sh; the two are meant to be run in sequence.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

BASE_ISO="${BASE_ISO:-}"
SQUASHFS="${SQUASHFS:-/var/tmp/rootfs-capture/appliance.squashfs}"
OUT_ISO="${OUT_ISO:-${ROOT}/output/appliance-offline.iso}"
WORK="${WORK:-/var/tmp/offline-iso}"
APPLIANCE_HOSTNAME="${APPLIANCE_HOSTNAME:-appliance}"

say() { printf '[offline-iso] %s\n' "$*"; }
die() { printf '[offline-iso] FATAL: %s\n' "$*" >&2; exit 1; }

command -v xorriso >/dev/null || die "xorriso is not installed"
command -v openssl >/dev/null || die "openssl is not installed"
python3 -c "import yaml" 2>/dev/null \
  || die "python3 pyyaml is required (apt install python3-yaml)"
[ -n "${BASE_ISO}" ] || die "BASE_ISO is not set"
[ -f "${BASE_ISO}" ] || die "BASE_ISO does not exist: ${BASE_ISO}"
[ -f "${SQUASHFS}" ] || die "no appliance squashfs at ${SQUASHFS}; run capture-rootfs.sh first"

say "base ISO  : ${BASE_ISO}"
say "appliance : ${SQUASHFS} ($(du -h "${SQUASHFS}" | cut -f1))"
say "output    : ${OUT_ISO}"

rm -rf "${WORK}"
mkdir -p "${WORK}/nocloud" "${WORK}/appliance" "${WORK}/casper"
mkdir -p "$(dirname "${OUT_ISO}")"

# --- 1. sanity: is the squashfs actually bootable content? ------------------
say "checking the captured filesystem"

# List ONCE into a file. Piping unsquashfs into "grep -q" looks natural and is
# wrong: grep exits at the first match, unsquashfs takes SIGPIPE, and under
# "set -o pipefail" the pipeline reports failure even though the file was found.
SQ_LIST="${WORK}/squashfs.list"
unsquashfs -l "${SQUASHFS}" > "${SQ_LIST}" 2>/dev/null || true
[ -s "${SQ_LIST}" ] || die "could not list ${SQUASHFS}"

# The kernel has to be in there or the installed system will not boot. This is
# the most expensive mistake to find later, because the install itself succeeds.
grep -qE 'boot/vmlinuz' "${SQ_LIST}" \
  || die "the squashfs has no /boot/vmlinuz; capture-rootfs.sh must mount /boot before packing"
grep -qE 'boot/initrd' "${SQ_LIST}" \
  || die "the squashfs has no /boot/initrd.img"
grep -qE 'opt/appliance/runtime/appliance-api' "${SQ_LIST}" \
  || die "the squashfs does not contain the appliance binary"
say "kernel, initramfs and appliance binary all present"

# The UNCOMPRESSED size, which is what subiquity wants for its progress bar and
# its free-space check. "unsquashfs -s" reports the compressed size, so measure
# the real thing by mounting it read-only.
say "measuring the uncompressed size"
SQ_MNT="${WORK}/sqmnt"
mkdir -p "${SQ_MNT}"
UNCOMPRESSED_BYTES=""
if mount -t squashfs -o ro,loop "${SQUASHFS}" "${SQ_MNT}" 2>/dev/null; then
  UNCOMPRESSED_BYTES="$(du -sb "${SQ_MNT}" 2>/dev/null | cut -f1)"
  umount "${SQ_MNT}" 2>/dev/null || true
fi
if [ -z "${UNCOMPRESSED_BYTES}" ] || [ "${UNCOMPRESSED_BYTES}" -lt 1 ] 2>/dev/null; then
  # Could not mount (no loop device in some containers). Fall back to a
  # deliberate overestimate: subiquity uses this to check free space, so being
  # too large is safe and being too small is not.
  UNCOMPRESSED_BYTES=$(( $(stat -c%s "${SQUASHFS}") * 6 ))
  say "WARN: could not mount to measure; estimating ${UNCOMPRESSED_BYTES} bytes"
fi
say "uncompressed size: ${UNCOMPRESSED_BYTES} bytes ($(( UNCOMPRESSED_BYTES / 1024 / 1024 / 1024 )) GiB)"

# --- 2. install-sources.yaml -----------------------------------------------
# Ours is added and made the default; the stock entries stay so the recovery
# menu entry can still install plain Ubuntu, but they must not be default.
say "writing install-sources.yaml"
xorriso -osirrox on -indev "${BASE_ISO}" \
        -extract /casper/install-sources.yaml "${WORK}/stock-sources.yaml" >/dev/null 2>&1

python3 - "${WORK}/stock-sources.yaml" "${WORK}/casper/install-sources.yaml" \
         "${UNCOMPRESSED_BYTES}" <<'PYEOF'
import sys

import yaml

stock_path, out_path, size = sys.argv[1], sys.argv[2], int(sys.argv[3])

with open(stock_path, encoding="utf-8") as fh:
    entries = yaml.safe_load(fh) or []

# Exactly one source may be the default and it has to be ours. Done by editing
# the parsed structure: an earlier version did this with a regex and produced
# "-   description:", which is not valid YAML and killed subiquity's server on
# startup with no visible error.
for entry in entries:
    entry.pop("default", None)

ours = {
    "default": True,
    "id": "grceye-appliance",
    "name": {"en": "GRC Eye Appliance"},
    "description": {
        "en": "The GRC Eye appliance, already built. Nothing is downloaded "
              "and no internet connection is required."
    },
    "path": "appliance.squashfs",
    "size": size,
    "type": "fsimage",
    "variant": "server",
    "locale_support": "none",
}

entries.insert(0, ours)

with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
    yaml.safe_dump(entries, fh, default_flow_style=False, sort_keys=True,
                   allow_unicode=True, width=100)

# Read it back. A file that does not parse is worthless, and the failure mode is
# a silent hang during someone else's install.
with open(out_path, encoding="utf-8") as fh:
    check = yaml.safe_load(fh)

if not isinstance(check, list) or not check:
    sys.exit("install-sources.yaml did not round-trip to a list")
defaults = [e for e in check if e.get("default")]
if len(defaults) != 1 or defaults[0].get("id") != "grceye-appliance":
    sys.exit("exactly one default is required and it must be the appliance")
if defaults[0].get("path") != "appliance.squashfs":
    sys.exit("the default entry does not point at appliance.squashfs")
print("[offline-iso] install-sources.yaml: valid YAML, %d entries, appliance is default"
      % len(check))
PYEOF
sed 's/^/    /' "${WORK}/casper/install-sources.yaml" | head -14

# --- 3. autoinstall seed ---------------------------------------------------
say "rendering the autoinstall seed"
SETUP_PW="$(openssl rand -base64 48 | tr -d '\n=/+' | head -c 32)"
SETUP_HASH="$(openssl passwd -6 "${SETUP_PW}")"
unset SETUP_PW

python3 "${ROOT}/iso/render-seed.py" \
        "${ROOT}/iso/offline/user-data.tmpl" \
        "${WORK}/nocloud/user-data" \
        "${SETUP_HASH}" \
        "${APPLIANCE_HOSTNAME}"
unset SETUP_HASH
cp "${ROOT}/iso/offline/meta-data" "${WORK}/nocloud/meta-data"

# --- 4. the reseal script, which runs as a late-command --------------------
install -m 0755 "${ROOT}/iso/offline/reseal-target.sh" "${WORK}/appliance/reseal-target.sh"
sed -i 's/\r$//' "${WORK}/appliance/reseal-target.sh"
sed -i 's/\r$//' "${WORK}/nocloud/user-data" "${WORK}/nocloud/meta-data"

# --- 5. boot menus ---------------------------------------------------------
say "preparing the boot menus"
cp "${ROOT}/iso/offline/grub.cfg"     "${WORK}/grub.cfg"
cp "${ROOT}/iso/offline/loopback.cfg" "${WORK}/loopback.cfg"
sed -i 's/\r$//' "${WORK}/grub.cfg" "${WORK}/loopback.cfg"

# --- 6. repack -------------------------------------------------------------
# "-boot_image any replay" carries the original El Torito catalogue, protective
# MBR, GPT and appended EFI system partition across unchanged. Rebuilding those
# by hand is the usual approach and is easy to get subtly wrong, producing an
# ISO that boots on BIOS and silently fails on UEFI.
say "repacking (this moves several GB, give it a few minutes)"
rm -f "${OUT_ISO}"
xorriso \
  -indev "${BASE_ISO}" \
  -outdev "${OUT_ISO}" \
  -boot_image any replay \
  -overwrite on \
  -map "${SQUASHFS}"                          /casper/appliance.squashfs \
  -map "${WORK}/casper/install-sources.yaml"  /casper/install-sources.yaml \
  -map "${WORK}/nocloud"                      /nocloud \
  -map "${WORK}/appliance"                    /appliance \
  -map "${WORK}/grub.cfg"                     /boot/grub/grub.cfg \
  -map "${WORK}/loopback.cfg"                 /boot/grub/loopback.cfg \
  -commit

# --- 7. verify -------------------------------------------------------------
say "verifying"
for want in /casper/appliance.squashfs /casper/install-sources.yaml \
            /nocloud/user-data /appliance/reseal-target.sh; do
  xorriso -indev "${OUT_ISO}" -find "${want}" 2>/dev/null | grep -q . \
    || die "missing from the built ISO: ${want}"
done

BOOTINFO="$(xorriso -indev "${OUT_ISO}" -report_el_torito as_mkisofs 2>&1 || true)"
printf '%s' "${BOOTINFO}" | grep -q 'eltorito.img'     || die "lost the BIOS boot record"
printf '%s' "${BOOTINFO}" | grep -q 'append_partition' || die "lost the EFI system partition"

xorriso -osirrox on -indev "${OUT_ISO}" \
        -extract /boot/grub/grub.cfg "${WORK}/grub.check" >/dev/null 2>&1
grep -q 'autoinstall'    "${WORK}/grub.check" || die "boot menu has no autoinstall entry"
grep -q 'set timeout=-1' "${WORK}/grub.check" || die "boot menu can auto-boot into a disk wipe"

xorriso -osirrox on -indev "${OUT_ISO}" \
        -extract /nocloud/user-data "${WORK}/ud.check" >/dev/null 2>&1
grep -q 'id: grceye-appliance' "${WORK}/ud.check" || die "the seed does not select the appliance source"
grep -q 'reseal-target.sh'     "${WORK}/ud.check" || die "the seed does not run the reseal step"
grep -q '@@'                   "${WORK}/ud.check" && die "unsubstituted placeholder in the seed"

SIZE="$(du -h "${OUT_ISO}" | cut -f1)"
say "done"
say ""
say "  ISO   : ${OUT_ISO}"
say "  size  : ${SIZE}"
say "  boots : BIOS and UEFI"
say ""
say "Boot it and pick the first entry. It ERASES the target disk, installs the"
say "prebuilt appliance in about five minutes, and needs no internet."
