"""MITRE CWE catalog — the weakness taxonomy behind a CVE's `cwe_ids`.

NVD tells us *that* CVE-2026-75431 is a CWE-321, and nothing more. A bare code
is not a "fiche détaillée": it names the flaw type in a vocabulary the reader
has to go and look up somewhere else, which is the opposite of a centralised
knowledge base.

This table holds MITRE's own text for each weakness, synced from the official
CWE list at cwe.mitre.org. Two fields carry most of the value:

* ``name`` turns "CWE-321" into "Use of Hard-coded Cryptographic Key", so the
  flaw-type filter and the CVE sheet read in plain language.
* ``mitigations`` is MITRE's ``<Potential_Mitigations>`` — the published,
  vendor-neutral workarounds for that class of weakness. Together with the
  Patch/Mitigation-tagged NVD references on :class:`CveEntry`, that is what
  answers "contournements connus et liens vers des solutions correctives":
  MITRE says how the weakness class is contained, NVD links the specific fix.

The catalog is platform-global and read-only to tenants, exactly like
``CveEntry`` — it is public reference data, not tenant data, so it carries no
``tenant_id``. Per-tenant judgement about a weakness belongs on the CVE
annotation, where the triage already lives.
"""
from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CweEntry(Base):
    __tablename__ = "cwe_entries"

    # "CWE-79". Stored with the prefix so it joins directly against the strings
    # NVD puts in CveEntry.cwe_ids, with no formatting step in between.
    cwe_id: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    extended_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # MITRE's Potential_Mitigations, flattened to a list of
    # {"phase", "strategy", "description"} — the known workarounds.
    mitigations: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Related_Attack_Patterns, e.g. ["CAPEC-63"]. Kept because CAPEC is one of
    # the referentials named in the requirement and this is where MITRE
    # publishes the CVE -> CWE -> CAPEC bridge; the CAPEC catalog itself is not
    # synced (see TODO-KNOWN-ISSUES.md).
    capec_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # "Draft" / "Incomplete" / "Stable" — MITRE's own maturity flag. Shown so a
    # reader knows how settled the weakness definition is.
    status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Abstraction level: Pillar / Class / Base / Variant. A Base weakness is the
    # actionable one; a Pillar is far too broad to act on.
    abstraction: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # CWE list version this row came from, e.g. "4.15".
    catalog_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="MITRE")
