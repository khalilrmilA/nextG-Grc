#!/usr/bin/env python3
"""Turn a vSphere OVF environment document into shell-sourceable assignments.

Usage: ovfprops.py /run/ovfenv.xml > /run/ovfprops.env
"""
import re
import shlex
import sys
import xml.etree.ElementTree as ET

NS = "{http://schemas.dmtf.org/ovf/environment/1}"
SAFE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def main(path: str) -> int:
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError) as exc:
        print(f"# could not parse OVF environment: {exc}", file=sys.stderr)
        return 1

    for prop in root.iter(f"{NS}Property"):
        key = prop.get(f"{NS}key") or ""
        value = prop.get(f"{NS}value") or ""
        # Ignore anything that is not a plain shell-safe identifier.
        if not SAFE_KEY.match(key):
            continue
        print(f"{key}={shlex.quote(value)}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: ovfprops.py <ovfenv.xml>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
