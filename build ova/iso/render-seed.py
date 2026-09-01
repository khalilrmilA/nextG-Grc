#!/usr/bin/env python3
"""Render the autoinstall seed from its template.

Kept as a file rather than inlined in build-iso.sh so the substitution can fail
loudly. A seed that still carries an unsubstituted @@PLACEHOLDER@@ is not a
cosmetic problem: subiquity rejects the file, falls back to an interactive
install, and the ISO silently stops being unattended.

Usage: render-seed.py <template> <output> <password-hash> <hostname>
"""
import sys


def main(argv):
    if len(argv) != 5:
        sys.exit(__doc__)
    tmpl, out, pwhash, hostname = argv[1:5]

    with open(tmpl, "r", encoding="utf-8") as fh:
        text = fh.read()

    text = text.replace("@@SETUP_PASSWORD_HASH@@", pwhash)
    text = text.replace("@@HOSTNAME@@", hostname)

    if "@@" in text:
        sys.exit("render-seed: an unsubstituted placeholder remains in %s" % out)

    # A crypt hash, not a plaintext password. If the caller ever passes the wrong
    # one, that plaintext ships on every ISO, so refuse it here rather than
    # trusting the caller to have got it right.
    if not pwhash.startswith("$"):
        sys.exit("render-seed: the password argument is not a crypt hash")

    # Written as bytes with explicit newlines: on Windows the default text mode
    # would produce CRLF, and cloud-init will not parse a CRLF seed.
    with open(out, "wb") as fh:
        fh.write(text.replace("\r\n", "\n").encode("utf-8"))

    print("[render-seed] wrote %s" % out)


if __name__ == "__main__":
    main(sys.argv)
