"""Backfill stored_file_versions from the files that already exist.

Version history only started recording at upload time, so every file stored
before that has no row: the history and recovery screens would show nothing for
28 evidence records, 20 documents and 3 contracts that are plainly there.

Each existing file gets one ``status="current"`` version. Where the file is
still on disk its SHA-256 is computed and stored on the version row so the
integrity report can verify it from now on.

**The owning record's own ``file_sha256`` is deliberately left alone.** That
column means "the digest taken from the bytes we received at upload". Filling it
now would assert that about a file nobody hashed at the time — including one
that may already have been altered — and the integrity report would then show it
as verified. The version row's digest is honestly a baseline taken today, and it
is labelled as such in the note.

Files missing from disk still get a row (with no digest) so the record's history
shows what was attached and that the bytes are gone, rather than showing nothing.

Usage:
    python -m scripts.backfill_file_versions [--apply]
Without --apply it only reports what it would create.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.compliance import Evidence, UploadedDocument  # noqa: E402
from app.models.stored_file_version import StoredFileVersion  # noqa: E402
from app.models.vendor import Vendor, VendorContract  # noqa: E402
from app.services import file_integrity  # noqa: E402

NOTE = "Backfilled: digest is a baseline taken at backfill time, not at upload"


async def _already_versioned(db) -> set[str]:
    """entity_ids that already have a version row — makes this re-runnable."""
    return set((await db.execute(select(StoredFileVersion.entity_id))).scalars().all())


async def main(apply: bool) -> int:
    created = 0
    missing_on_disk = 0
    skipped = 0
    root = Path(settings.UPLOADS_DIR)

    async with AsyncSessionLocal() as db:
        seen = await _already_versioned(db)

        # (rows, entity_type, parent_type, parent_id_of, path_of, name_of, size_of,
        #  content_type_of, absolute)
        sources = []

        ev_rows = (await db.execute(select(Evidence))).scalars().all()
        sources.append((
            ev_rows, file_integrity.EVIDENCE, "control_assessment",
            lambda r: r.control_assessment_id, lambda r: r.file_path,
            lambda r: r.file_name, lambda r: r.file_size_bytes,
            lambda r: r.content_type, False, lambda r: r.tenant_id,
        ))

        doc_rows = (await db.execute(select(UploadedDocument))).scalars().all()
        sources.append((
            doc_rows, file_integrity.DOCUMENT, "assessment",
            lambda r: r.assessment_id, lambda r: r.file_path,
            lambda r: r.file_name, lambda r: r.file_size_bytes,
            lambda r: r.content_type, False, lambda r: r.tenant_id,
        ))

        # Contracts carry no tenant_id of their own — it comes from the vendor.
        con_rows = (await db.execute(
            select(VendorContract, Vendor.tenant_id)
            .join(Vendor, VendorContract.vendor_id == Vendor.id)
        )).all()
        con_pairs = [(c, t) for c, t in con_rows]
        sources.append((
            [c for c, _ in con_pairs], file_integrity.CONTRACT, "vendor",
            lambda r: r.vendor_id, lambda r: r.file_path,
            lambda r: r.file_name, lambda r: r.file_size, lambda r: None, True,
            lambda r, _m={c.id: t for c, t in con_pairs}: _m.get(r.id),
        ))

        for (rows, entity_type, parent_type, parent_of, path_of, name_of,
             size_of, ctype_of, absolute, tenant_of) in sources:
            for row in rows:
                rel = path_of(row)
                if not rel:
                    skipped += 1
                    continue
                if row.id in seen:
                    skipped += 1
                    continue
                tenant_id = tenant_of(row)
                if not tenant_id:
                    skipped += 1
                    continue

                target = Path(rel) if absolute else root / rel
                digest = file_integrity.sha256_file(target) if target.is_file() else None
                if digest is None:
                    missing_on_disk += 1

                created += 1
                if apply:
                    await file_integrity.record_version(
                        db,
                        tenant_id=tenant_id,
                        entity_type=entity_type,
                        entity_id=row.id,
                        parent_type=parent_type,
                        parent_id=parent_of(row) or "",
                        file_path=rel,
                        file_name=name_of(row),
                        file_sha256=digest,
                        file_size_bytes=size_of(row),
                        content_type=ctype_of(row),
                        uploaded_by_id=getattr(row, "uploaded_by_id", None),
                        is_absolute_path=absolute,
                        note=NOTE,
                    )

        if apply:
            await db.commit()

    verb = "created" if apply else "would create"
    print(f"{verb} {created} version rows "
          f"({missing_on_disk} of them for files no longer on disk); {skipped} skipped")
    if not apply:
        print("Dry run — re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main("--apply" in sys.argv)))
