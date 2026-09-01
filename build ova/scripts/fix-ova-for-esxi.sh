#!/usr/bin/env bash
# fix-ova-for-esxi.sh <input.ova> <output.ova> [hardware-version] [product-section.xml]
#
# VirtualBox writes VirtualSystemType "virtualbox-2.2" into the OVF descriptor.
# ESXi rejects that with "Unsupported hardware family". This script rewrites the
# descriptor to a VMware hardware version, strips the VirtualBox extension
# block, optionally injects vApp properties, regenerates the manifest, and
# repacks the OVA with the correct tar member ordering.
#
# Requires: tar, python3, sha256sum. No ovftool needed.
set -euo pipefail

SRC="${1:?usage: fix-ova-for-esxi.sh <input.ova> <output.ova> [vmx-NN] [product-section.xml]}"
DST="${2:?usage: fix-ova-for-esxi.sh <input.ova> <output.ova> [vmx-NN] [product-section.xml]}"
HWVER="${3:-vmx-15}"
PRODSEC="${4:-}"

SRC="$(readlink -f "$SRC")"
DST="$(readlink -f "$DST")"
[ -n "$PRODSEC" ] && PRODSEC="$(readlink -f "$PRODSEC")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[fix] unpacking $SRC"
tar -xf "$SRC" -C "$WORK"

OVF="$(find "$WORK" -maxdepth 1 -name '*.ovf' | head -n1)"
[ -n "$OVF" ] || { echo "[fix] no .ovf found inside the OVA" >&2; exit 1; }
BASE="$(basename "${OVF%.ovf}")"

echo "[fix] rewriting descriptor (hardware version ${HWVER})"
python3 - "$OVF" "$HWVER" "${PRODSEC}" <<'PY'
import re, sys

ovf_path, hwver, prodsec_path = sys.argv[1], sys.argv[2], sys.argv[3]
xml = open(ovf_path, encoding="utf-8").read()

# 1. VirtualBox hardware family -> VMware hardware version
xml = re.sub(r"(<vssd:VirtualSystemType>)[^<]*(</vssd:VirtualSystemType>)",
             rf"\g<1>{hwver}\g<2>", xml)

# 2. Drop the VirtualBox-specific extension block; ESXi has no use for it.
xml = re.sub(r"<vbox:Machine.*?</vbox:Machine>", "", xml, flags=re.DOTALL)

# 3. Let the guest read vApp properties through VMware Tools.
if 'ovf:transport=' not in xml:
    xml = xml.replace("<VirtualHardwareSection>",
                      '<VirtualHardwareSection ovf:transport="com.vmware.guestInfo">', 1)

# 4. Optionally inject the ProductSection that defines the vApp properties.
if prodsec_path:
    section = open(prodsec_path, encoding="utf-8").read()
    # Strip XML comments so the descriptor stays clean.
    section = re.sub(r"<!--.*?-->", "", section, flags=re.DOTALL).strip()
    if "<ProductSection" in section and "<ProductSection" not in xml:
        xml = xml.replace("</VirtualSystem>", section + "\n</VirtualSystem>", 1)

open(ovf_path, "w", encoding="utf-8").write(xml)
print("[fix] descriptor rewritten")
PY

echo "[fix] regenerating the manifest"
cd "$WORK"
rm -f ./*.mf ./*.cert
MF="${BASE}.mf"
: > "$MF"
for f in "${BASE}.ovf" *.vmdk; do
  printf 'SHA256(%s)= %s\n' "$f" "$(sha256sum "$f" | awk '{print $1}')" >> "$MF"
done

echo "[fix] repacking (descriptor first, then manifest, then disks)"
rm -f "$DST"
# Member names must match the manifest exactly, so no "./" prefixes: that rules
# out shellcheck's usual ./*glob* suggestion here.
# shellcheck disable=SC2035
tar -cf "$DST" --format=ustar "${BASE}.ovf" "$MF" *.vmdk

cd - >/dev/null
echo "[fix] wrote $DST"
sha256sum "$DST"
