#!/usr/bin/env python3
"""Update md5sum.txt on the remastered ISO for the boot menu we replaced.

The Ubuntu ISO ships /md5sum.txt, which is what casper's "Check disc for
defects" boot entry verifies. Replacing /boot/grub/grub.cfg without updating its
line there turns that check into a false failure report on a perfectly good
disc, which is the kind of thing a customer reports as a corrupt download.

Usage: fix-md5sum.py <md5sum.txt> <new md5 of grub.cfg>
"""
import sys

TARGET = "./boot/grub/grub.cfg"


def main(argv):
    if len(argv) != 3:
        sys.exit(__doc__)
    path, newmd5 = argv[1], argv[2]

    if len(newmd5) != 32 or not all(c in "0123456789abcdef" for c in newmd5.lower()):
        sys.exit("fix-md5sum: %r is not an md5 hex digest" % newmd5)

    # errors="replace": the file is ASCII in practice, but a decode error here
    # would abort a build for no useful reason.
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        lines = fh.readlines()

    out, hits = [], 0
    for line in lines:
        if line.rstrip("\r\n").endswith(TARGET):
            out.append("%s  %s\n" % (newmd5, TARGET))
            hits += 1
        else:
            out.append(line)

    if hits != 1:
        # Not fatal in itself, but it means Ubuntu changed the layout of this
        # file and the assumption above needs revisiting.
        print("[fix-md5sum] WARNING: expected 1 line for %s, found %d" % (TARGET, hits))

    with open(path, "wb") as fh:
        fh.write("".join(out).encode("utf-8"))

    print("[fix-md5sum] rewrote %d line(s) for %s" % (hits, TARGET))


if __name__ == "__main__":
    main(sys.argv)
