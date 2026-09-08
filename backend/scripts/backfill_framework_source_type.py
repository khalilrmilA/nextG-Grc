"""STB objectif 1 — « Chaque exigence est classée par source (norme/réglementation) ».

The STB migration added frameworks.source_type, and seed_tn_legal_frameworks.py sets it on the five
Tunisian frameworks it creates — but the 79 built-in frameworks that were already in the database have
it NULL. Without this backfill, GET /frameworks?source_type=… returns 5 rows out of 100 and the Type
chip on FrameworksPage is blank for almost everything: the exact clause an evaluator will click.

The four values, and the rule used to assign them:

  loi              A statute or a directly-applicable act of a legislature. EU Regulations and
                   Directives count: the GDPR is Regulation (EU) 2016/679, NIS2 and PSD2 are
                   Directives, DORA and the AI Act are Regulations. So do national privacy acts.
  reglementation   Binding requirements issued by a supervisor or a government authority for the
                   entities it regulates — a central bank, a prudential authority, a national cyber
                   agency, a defence or federal programme. Not passed by a legislature, but not
                   optional for the regulated firm either.
  norme            A voluntary standard, framework or benchmark, adopted by choice or by contract:
                   ISO, NIST, CIS, PCI DSS, SOC 2, COBIT, ITIL, OWASP, MITRE ATT&CK.
  politique_interne  A tenant's own internal corpus.

Classification is EXPLICIT, never inferred from the name: a wrong label in front of a bank's evaluator
is worse than a blank one. Anything not in the table below is left NULL and reported, so a human
classifies it rather than the script guessing.

Idempotent: only ever fills a NULL, never overwrites a value somebody set.

    python -m scripts.backfill_framework_source_type            # dry run
    python -m scripts.backfill_framework_source_type --apply
"""
import os
import sqlite3
import sys

# --- keyed on frameworks.short_name, as stored ------------------------------
LOI = {
    "GDPR", "gdpr-checklist",        # Regulation (EU) 2016/679
    "NIS2",                          # Directive (EU) 2022/2555
    "DORA", "dora-detail",           # Regulation (EU) 2022/2554
    "EU-AI-ACT",                     # Regulation (EU) 2024/1689
    "PSD2",                          # Directive (EU) 2015/2366
    "CCPA",                          # California Civil Code 1798.100 et seq.
    "HIPAA", "hipaa-sec",            # Public Law 104-191
    "LGPD",                          # Lei 13.709/2018 (Brazil)
    "PIPEDA",                        # S.C. 2000, c. 5 (Canada)
    "PIPL",                          # Personal Information Protection Law (China)
    "POPIA",                         # Act 4 of 2013 (South Africa)
    "india-dpdpa",                   # Act 22 of 2023 (India)
    "pdpa-sg",                       # Act 26 of 2012 (Singapore)
    "pdpa-th",                       # B.E. 2562 (Thailand)
    "ITAR",                          # 22 CFR 120-130 — federal regulation with statutory force
}

REGLEMENTATION = {
    "dfs-500",                       # NYDFS Part 500
    "cps-234",                       # APRA prudential standard
    "finma-2023",                    # FINMA circular
    "sama-csf",                      # Saudi Central Bank
    "bahrain-cbb-isr",               # Central Bank of Bahrain
    "dubai-desc-isr",                # Dubai Electronic Security Centre
    "ksa-ecc", "nca-ecc-2024",       # Saudi National Cybersecurity Authority
    "qatar-nia-csf",                 # Qatar National Information Assurance
    "uae-ia", "uae-nesa-ias",        # UAE national information assurance
    "anssi-rgs",                     # ANSSI RGS (France) — mandatory for public bodies
    "nerc-cip",                      # NERC CIP — enforceable reliability standards
    "FEDRAMP",                       # US federal authorisation programme
    "CJIS",                          # FBI CJIS Security Policy
    "CMMC",                          # US DoD certification requirement
    "cyber-essentials",              # UK NCSC — required for certain government contracts
    "swift-csp",                     # SWIFT CSP — mandatory attestation for members
}

NORME = {
    "ISO27001", "iso27001-2013", "iso-27002", "iso-27005", "iso-27017", "iso-27018", "iso-27701",
    "iso-31000", "iso-42001", "iso-9001", "iso-20000", "iso-22301",
    "nist-800-53", "nist-800-171", "nist-800-82", "nist-csf", "nist-csf-v1", "nist-csf-smb",
    "nist-ai-rmf", "nist-ai-play", "nist-pf", "nist-rmf",
    "cis-csc", "cis-fortigate-7.4", "csa-ccm", "cobit-2019", "itil-v4",
    "owasp-asvs", "owasp-top10", "mitre-attck", "hitrust-csf", "iec-62443",
    "TISAX", "SCF", "SOC2", "soc2-type2", "pci-dss", "pci-dss-v3",
    "bsi-c5", "essential-8", "enisa-ics", "google-saif",
}

POLITIQUE_INTERNE = {
    "iso-lite",                      # "Acme Corp (internal)" — the demo tenant's own corpus
}

MAPPING = {}
for names, value in ((LOI, "loi"), (REGLEMENTATION, "reglementation"),
                     (NORME, "norme"), (POLITIQUE_INTERNE, "politique_interne")):
    for n in names:
        MAPPING[n] = value


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def main() -> int:
    apply = "--apply" in sys.argv
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2

    conn = sqlite3.connect(path)
    cur = conn.cursor()
    cols = {r[1] for r in cur.execute("PRAGMA table_info(frameworks)").fetchall()}
    if "source_type" not in cols:
        print("ERROR: frameworks.source_type is missing — run migrate_add_stb_referential_columns first")
        return 2

    rows = cur.execute(
        "SELECT id, short_name, name, source_type FROM frameworks ORDER BY short_name"
    ).fetchall()

    planned, skipped, unmapped = [], [], []
    for fid, short_name, name, existing in rows:
        if existing:
            skipped.append((short_name, existing))
            continue
        value = MAPPING.get(short_name)
        if value is None and short_name:
            # A tenant fork of a built-in keeps the built-in's nature: a customised
            # copy of SOC 2 is still a norme, and a copy of CPS 234 is still a
            # supervisor's requirement. The clone endpoint suffixes the short_name
            # with -CUSTOM (cloned_from_framework_id is new and NULL on the forks
            # that already existed), so that suffix is the only reliable link back.
            base = short_name[:-len("-CUSTOM")] if short_name.endswith("-CUSTOM") else None
            if base:
                value = MAPPING.get(base) or MAPPING.get(base.upper()) or MAPPING.get(base.lower())
        if value is None:
            unmapped.append((short_name, name))
            continue
        planned.append((fid, short_name, value))

    counts = {}
    for _, _, v in planned:
        counts[v] = counts.get(v, 0) + 1
    for v in sorted(counts):
        print(f"  {v:18s} {counts[v]:3d} framework(s)")
    print(f"\n  already classified, left untouched: {len(skipped)}")

    if unmapped:
        print(f"\n  LEFT NULL — {len(unmapped)} framework(s) are not in the mapping table.")
        print("  Classify them deliberately (PATCH /frameworks/{id}) rather than letting a script guess:")
        for sn, n in unmapped:
            print(f"     {sn or '?':24s} {n[:60]}")

    if not apply:
        print("\nDry run — re-run with --apply to write.")
        return 0

    for fid, _, value in planned:
        cur.execute(
            "UPDATE frameworks SET source_type = ? WHERE id = ? AND source_type IS NULL",
            (value, fid),
        )
    conn.commit()
    print(f"\nApplied: {len(planned)} framework(s) classified.")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
