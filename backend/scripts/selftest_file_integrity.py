"""Self-test for app/services/file_integrity.py.

Covers the four outcomes the integrity report and the evidence-download guard
depend on, including the one that matters most: a file whose bytes changed on
disk after upload must be reported as MODIFIED, not quietly served.

Run:  venv/bin/python scripts/selftest_file_integrity.py
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import file_integrity as fi  # noqa: E402

failures: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "evidence.pdf"
        original = b"%PDF-1.4 signed-off control evidence\n" * 40
        path.write_bytes(original)
        digest = fi.sha256_bytes(original)

        print("\ndigests")
        check("bytes digest is 64 hex chars", len(digest), 64)
        check("file digest matches the bytes digest", fi.sha256_file(path), digest)
        check("digest is stable across calls", fi.sha256_file(path), fi.sha256_file(path))
        check("digest of a missing file is None", fi.sha256_file(Path(tmp) / "nope"), None)

        print("\nverification outcomes")
        status, actual = fi.verify_file(path, digest)
        check("untouched file verifies OK", status, fi.OK)
        check("OK reports the actual digest", actual, digest)

        status, _ = fi.verify_file(path, None)
        check("no recorded digest -> unrecorded, not a failure", status, fi.UNRECORDED)

        # The whole point: a single altered byte must be caught.
        tampered = bytearray(original)
        tampered[10] ^= 0x01
        path.write_bytes(bytes(tampered))
        status, actual = fi.verify_file(path, digest)
        check("one flipped byte -> MODIFIED", status, fi.MODIFIED)
        check("MODIFIED reports the new digest, not the old", actual != digest, True)

        # Same length, different content — a size check alone would miss this.
        path.write_bytes(b"X" * len(original))
        status, _ = fi.verify_file(path, digest)
        check("same-size replacement -> MODIFIED", status, fi.MODIFIED)

        # Appended content.
        path.write_bytes(original + b"appended")
        status, _ = fi.verify_file(path, digest)
        check("appended bytes -> MODIFIED", status, fi.MODIFIED)

        # Restored exactly -> OK again (the check is on content, not mtime).
        path.write_bytes(original)
        os.utime(path, (0, 0))
        status, _ = fi.verify_file(path, digest)
        check("restored bytes verify OK despite a changed mtime", status, fi.OK)

        path.unlink()
        status, actual = fi.verify_file(path, digest)
        check("deleted file -> MISSING", status, fi.MISSING)
        check("MISSING reports no digest", actual, None)

        check("a directory in place of a file -> MISSING",
              fi.verify_file(Path(tmp), digest)[0], fi.MISSING)

        # A permissions fault must not masquerade as a deletion — the two need
        # different responses from whoever reads the report.
        locked = Path(tmp) / "locked.bin"
        locked.write_bytes(original)
        os.chmod(locked, 0o000)
        if os.geteuid() == 0:
            print("  skip unreadable check (running as root; chmod 000 is not enforced)")
        else:
            check("present but unreadable -> UNREADABLE, not MISSING",
                  fi.verify_file(locked, digest)[0], fi.UNREADABLE)
        os.chmod(locked, 0o600)

        print("\nlarge file (streamed, not loaded)")
        big = Path(tmp) / "big.bin"
        payload = os.urandom(3 * 1024 * 1024)   # 3 MiB, larger than the 1 MiB chunk
        big.write_bytes(payload)
        check("multi-chunk digest matches a one-shot digest",
              fi.sha256_file(big), fi.sha256_bytes(payload))

    print()
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("all file-integrity self-tests passed")


if __name__ == "__main__":
    main()
