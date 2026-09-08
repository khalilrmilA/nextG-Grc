"""Fill framework_controls.domain from the free-text category — STB objectif 1.

« Chaque exigence est classée par source, domaine, type et applicabilité. »
``category`` cannot serve as the domaine: it is uncontrolled free text with 157
distinct values on the live database, and the same domain is split across case
variants — 'organizational' on 1 819 rows against 'ORGANIZATIONAL' on 56, so a
"show me everything organisationnel" filter silently drops 56 requirements.

``domain`` (added by migrate_add_stb_referential_columns.py) is the controlled
column. Its vocabulary is DOMAIN_VALUES in endpoints/frameworks.py, i.e. the
*values* of ControlCategory — the same set canonical_domain() validates writes
against — so a row written here and a row written through the API are always
comparable.

Two rules, and no third
-----------------------
1. A category that already IS a vocabulary member (in any case) maps to its
   canonical spelling. This is the bulk: 3 845 of the 4 537 rows.
2. Everything else is mapped through EXACT_MAP below — one literal entry per
   distinct raw value, reviewable line by line.

There is deliberately no keyword-matching fallback. Guessing "anything containing
'access' is Technological" would mislabel requirements in a referential a bank
audits against, and would do it silently. Anything not covered by the two rules
is left NULL and **printed in the report**; NULL already means "unclassified"
everywhere that reads this column, so an unmapped row degrades to today's
behaviour rather than to a wrong answer.

Mapping convention: the corpus's dominant vocabulary is the ISO 27002:2022
themes (Organizational / People / Physical / Technological), so a source section
maps onto the theme it belongs to; GOVERNANCE and POLICY are used where the
section is explicitly governance/risk/audit or explicitly a policy corpus; the
NIST CSF functions are used only where the source's own sections are those
functions.

Only rows where ``domain`` IS NULL are written, so a domain set by hand through
the API is never overwritten and a re-run is a no-op.

Usage:
    cd backend && venv/bin/python -m scripts.backfill_control_domain
    cd backend && venv/bin/python -m scripts.backfill_control_domain --apply

Set GRC_DB_PATH to rehearse against a snapshot before touching production.
"""
import os
import sqlite3
import sys

# The controlled vocabulary: the VALUES of ControlCategory (models/framework.py),
# which is exactly what endpoints/frameworks.py exposes as DOMAIN_VALUES. Kept as
# a literal rather than imported so the script stays a plain sqlite3 tool that can
# be run against a snapshot without importing the app.
DOMAIN_VALUES = (
    "DETECT", "GOVERNANCE", "IDENTIFY", "Organizational", "People", "Physical",
    "POLICY", "PROTECT", "RECOVER", "RESPOND", "Technological",
)
# Rule 1: case-folded lookup onto the canonical spelling.
_BY_KEY = {d.upper(): d for d in DOMAIN_VALUES}

# Rule 2: every remaining distinct `category` value on the live database, mapped
# explicitly. Generated from the corpus and reviewed by hand; grouped by the
# framework the value comes from so a reviewer can check a whole standard at once.
EXACT_MAP = {
    # TISAX — VDA ISA modules
    '1 IS Policies & Organization': 'Organizational',
    '2 Human Resources': 'People',
    '3 Physical Security & Business Continuity': 'Physical',
    '4 Identity & Access Management': 'Technological',
    '5 IT/Cyber Security': 'Technological',
    '6 Supplier Relationships': 'Organizational',
    '7 Compliance': 'GOVERNANCE',
    'Data Protection': 'Organizational',
    'Prototype Protection': 'Physical',

    # CIS FortiGate 7.4 benchmark — device hardening, technical throughout
    '1 Network Configuration': 'Technological',
    '2.1 System Settings': 'Technological',
    '2.2 Password Policy': 'Technological',
    '2.3 SNMP': 'Technological',
    '2.4 Administrative Access': 'Technological',
    '2.5 High Availability': 'Technological',
    '3 Firewall Policy': 'Technological',
    '4.1 Intrusion Prevention & Botnet Detection': 'Technological',
    '4.2 Antivirus': 'Technological',
    '4.3 DNS Filter': 'Technological',
    '4.4 Web Filter': 'Technological',
    '4.5 Application Control': 'Technological',
    '5 Automation & Security Fabric': 'Technological',
    '6 VPN': 'Technological',
    '7 Logging & Monitoring': 'Technological',

    # IEC 62443 — OT/ICS. -2-1/-2-4 are programme and service-provider level;
    # -3-2/-3-3/-4-2 are system and component technical requirement families.
    '62443-2-1 | Access & account management': 'Technological',
    '62443-2-1 | Asset & configuration management': 'Organizational',
    '62443-2-1 | Audit & review': 'GOVERNANCE',
    '62443-2-1 | Continuity & recovery': 'Organizational',
    '62443-2-1 | Event & incident management': 'Organizational',
    '62443-2-1 | Network & communication security': 'Technological',
    '62443-2-1 | Organizational security & governance': 'GOVERNANCE',
    '62443-2-1 | Personnel & awareness': 'People',
    '62443-2-1 | Physical & environmental security': 'Physical',
    '62443-2-1 | Risk assessment & management': 'GOVERNANCE',
    '62443-2-1 | Supplier/service-provider management': 'Organizational',
    '62443-2-4 | Account management': 'Technological',
    '62443-2-4 | Architecture': 'Technological',
    '62443-2-4 | Assurance': 'GOVERNANCE',
    '62443-2-4 | Backup / Restore': 'Technological',
    '62443-2-4 | Configuration management': 'Technological',
    '62443-2-4 | Event / Log management': 'Technological',
    '62443-2-4 | Malware protection': 'Technological',
    '62443-2-4 | Patch management': 'Technological',
    '62443-2-4 | Remote access': 'Technological',
    '62443-2-4 | SIS / Safety systems': 'Technological',
    '62443-2-4 | Solution staffing / Personnel': 'People',
    '62443-2-4 | Wireless': 'Technological',
    '62443-3-2 | Zones & Conduits': 'Technological',
    '62443-3-3 | FR1 Identification & Authentication Control': 'Technological',
    '62443-3-3 | FR2 Use Control': 'Technological',
    '62443-3-3 | FR3 System Integrity': 'Technological',
    '62443-3-3 | FR4 Data Confidentiality': 'Technological',
    '62443-3-3 | FR5 Restricted Data Flow': 'Technological',
    '62443-3-3 | FR6 Timely Response to Events': 'Technological',
    '62443-3-3 | FR7 Resource Availability': 'Technological',
    '62443-4-1 | Practice 1 – Security Management': 'Organizational',
    '62443-4-1 | Practice 2 – Specification of security requirements': 'Technological',
    '62443-4-1 | Practice 3 – Secure by design': 'Technological',
    '62443-4-1 | Practice 4 – Secure implementation': 'Technological',
    '62443-4-1 | Practice 5 – Security verification and validation testing': 'Technological',
    '62443-4-1 | Practice 6 – Management of security-related issues': 'Organizational',
    '62443-4-1 | Practice 7 – Security update management': 'Technological',
    '62443-4-1 | Practice 8 – Security guidelines': 'Organizational',
    '62443-4-2 | Component type – Embedded device': 'Technological',
    '62443-4-2 | Component type – Host device': 'Technological',
    '62443-4-2 | Component type – Network device': 'Technological',
    '62443-4-2 | Component type – Software application': 'Technological',
    '62443-4-2 | FR1 Identification & Authentication Control': 'Technological',
    '62443-4-2 | FR2 Use Control': 'Technological',
    '62443-4-2 | FR3 System Integrity': 'Technological',
    '62443-4-2 | FR4 Data Confidentiality': 'Technological',
    '62443-4-2 | FR5 Restricted Data Flow': 'Technological',
    '62443-4-2 | FR6 Timely Response to Events': 'Technological',
    '62443-4-2 | FR7 Resource Availability': 'Technological',

    # Bahrain CBB Information Security Regulation
    'BH-ISR-1: Information Security Governance': 'GOVERNANCE',
    'BH-ISR-2: Risk Management': 'GOVERNANCE',
    'BH-ISR-3: Security Controls': 'Technological',
    'BH-ISR-4: Incident Response': 'Organizational',
    'BH-ISR-5: Business Continuity': 'Organizational',
    'BH-ISR-6: Third-Party Management': 'Organizational',
    'BH-ISR-7: Audit and Compliance': 'GOVERNANCE',

    # UAE NESA IAS
    'IS-10: System Acquisition, Development and Maintenance': 'Technological',
    'IS-11: Supplier Relationships': 'Organizational',
    'IS-12: Information Security Incident Management': 'Organizational',
    'IS-13: Information Security Aspects of BCM': 'Organizational',
    'IS-14: Compliance': 'GOVERNANCE',
    'IS-1: Information Security Policy': 'POLICY',
    'IS-2: Organization of Information Security': 'Organizational',
    'IS-3: Human Resource Security': 'People',
    'IS-4: Asset Management': 'Organizational',
    'IS-5: Access Control': 'Technological',
    'IS-6: Cryptography': 'Technological',
    'IS-7: Physical and Environmental Security': 'Physical',
    'IS-8: Operations Security': 'Technological',
    'IS-9: Communications Security': 'Technological',

    # Dubai DESC ISR
    'ISR-10: Incident Management': 'Organizational',
    'ISR-11: Business Continuity and Disaster Recovery': 'Organizational',
    'ISR-12: Third-Party and Cloud Security': 'Organizational',
    'ISR-13: Compliance and Audit': 'GOVERNANCE',
    'ISR-1: Security Governance': 'GOVERNANCE',
    'ISR-2: Security Risk Management': 'GOVERNANCE',
    'ISR-3: Security Policies and Procedures': 'POLICY',
    'ISR-4: Human Resources Security': 'People',
    'ISR-5: Asset Management': 'Organizational',
    'ISR-6: Access Control': 'Technological',
    'ISR-7: Physical and Environmental Security': 'Physical',
    'ISR-8: Operations Security': 'Technological',
    'ISR-9: Network Security': 'Technological',

    # Qatar NIA CSF — the source sections ARE the NIST CSF functions, so they
    # map onto the function values rather than onto an ISO theme.
    'QCF-1: Identify': 'IDENTIFY',
    'QCF-2: Protect': 'PROTECT',
    'QCF-3: Detect': 'DETECT',
    'QCF-4: Respond': 'RESPOND',
    'QCF-5: Recover': 'RECOVER',
    'QCF-6: Qatar-Specific Requirements': 'GOVERNANCE',

    # KSA NCA ECC-2:2024
    'Domain 1: Cybersecurity Governance | 1-10: Cybersecurity Awareness and Training Program': 'People',
    'Domain 1: Cybersecurity Governance | 1-1: Cybersecurity Strategy': 'GOVERNANCE',
    'Domain 1: Cybersecurity Governance | 1-2: Cybersecurity Management': 'GOVERNANCE',
    'Domain 1: Cybersecurity Governance | 1-3: Cybersecurity Policies and Procedures': 'POLICY',
    'Domain 1: Cybersecurity Governance | 1-4: Cybersecurity Roles and Responsibilities': 'GOVERNANCE',
    'Domain 1: Cybersecurity Governance | 1-5: Cybersecurity Risk Management': 'GOVERNANCE',
    'Domain 1: Cybersecurity Governance | 1-6: Cybersecurity in IT Project Management': 'Organizational',
    'Domain 1: Cybersecurity Governance | 1-7: Compliance with Cybersecurity Standards, Laws and Regulations': 'GOVERNANCE',
    'Domain 1: Cybersecurity Governance | 1-8: Periodical Cybersecurity Review and Audit': 'GOVERNANCE',
    'Domain 1: Cybersecurity Governance | 1-9: Cybersecurity in Human Resources': 'People',
    'Domain 2: Cybersecurity Defense | 2-10: Vulnerabilities Management': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-11: Penetration Testing': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-12: Cybersecurity Event Logs and Monitoring Management': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-13: Cybersecurity Incident and Threat Management': 'Organizational',
    'Domain 2: Cybersecurity Defense | 2-14: Physical Security': 'Physical',
    'Domain 2: Cybersecurity Defense | 2-15: Web Application Security': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-1: Asset Management': 'Organizational',
    'Domain 2: Cybersecurity Defense | 2-2: Identity and Access Management': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-3: Information System and Processing Facilities Protection': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-4: Email Protection': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-5: Networks Security Management': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-6: Mobile Devices Security': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-7: Data and Information Protection': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-8: Cryptography': 'Technological',
    'Domain 2: Cybersecurity Defense | 2-9: Backup and Recovery Management': 'Technological',
    'Domain 3: Cybersecurity Resilience | 3-1: Cybersecurity Resilience Aspects of Business Continuity Management (BCM)': 'Organizational',
    'Domain 4: Third-Party and Cloud Computing Cybersecurity | 4-1: Third-Party Cybersecurity': 'Organizational',
    'Domain 4: Third-Party and Cloud Computing Cybersecurity | 4-2: Cloud Computing and Hosting Cybersecurity': 'Organizational',

}


def _db_path() -> str:
    env = os.environ.get("GRC_DB_PATH")
    if env:
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(here, "grc_dev.db")


def resolve(category: str | None) -> str | None:
    """Raw `category` -> controlled domain, or None when it cannot be resolved."""
    if category is None:
        return None
    raw = category.strip()
    if not raw:
        return None
    # Rule 1: already a vocabulary member, in whatever case the seeder used.
    canonical = _BY_KEY.get(raw.upper())
    if canonical:
        return canonical
    # Rule 2: explicit table. No fuzzy fallback — see the module docstring.
    return EXACT_MAP.get(raw)


def main(apply: bool) -> int:
    path = _db_path()
    if not os.path.exists(path):
        print(f"ERROR: database not found at {path}")
        return 2
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    cols = {r[1] for r in cur.execute("PRAGMA table_info(framework_controls)").fetchall()}
    if "domain" not in cols:
        print("ERROR: framework_controls.domain does not exist.")
        print("       Run: python -m scripts.migrate_add_stb_referential_columns")
        conn.close()
        return 2

    total = cur.execute("SELECT COUNT(*) FROM framework_controls").fetchone()[0]
    already = cur.execute(
        "SELECT COUNT(*) FROM framework_controls WHERE domain IS NOT NULL").fetchone()[0]

    # Grouped, not row-by-row: 4 537 rows collapse to ~158 distinct categories, so
    # the report is readable and the UPDATE is one statement per category.
    groups = cur.execute(
        "SELECT category, COUNT(*) FROM framework_controls "
        "WHERE domain IS NULL GROUP BY category ORDER BY COUNT(*) DESC"
    ).fetchall()

    mapped: list[tuple[str, str, int]] = []   # (category, domain, rows)
    null_category = 0
    unmapped: list[tuple[str, int]] = []
    for category, n in groups:
        if category is None or not category.strip():
            null_category += n
            continue
        domain = resolve(category)
        if domain is None:
            unmapped.append((category, n))
        else:
            mapped.append((category, domain, n))

    by_domain: dict[str, int] = {}
    for _c, d, n in mapped:
        by_domain[d] = by_domain.get(d, 0) + n

    distinct_categories = sum(
        1 for c, _n in groups if c is not None and c.strip())
    print(f"framework_controls: {total} rows, {already} already classified")
    print(f"{distinct_categories} distinct category value(s) still unclassified\n")
    print(f"WILL CLASSIFY {sum(n for _c, _d, n in mapped)} row(s) "
          f"from {len(mapped)} distinct category value(s):")
    for domain in sorted(by_domain):
        print(f"   {domain:<16} {by_domain[domain]:5} rows")

    print("\nPer category:")
    for category, domain, n in mapped:
        print(f"   {n:5}  {category[:78]:<78} -> {domain}")

    # The two honest failure modes, always printed, never silently skipped.
    if null_category:
        print(f"\nLEFT NULL — {null_category} row(s) have no category at all.")
        print("   Nothing to map from. Classify them through PATCH /frameworks/.../controls/{id}.")
    if unmapped:
        print(f"\nLEFT NULL — {sum(n for _c, n in unmapped)} row(s) across "
              f"{len(unmapped)} category value(s) NOT in the vocabulary or EXACT_MAP:")
        for category, n in unmapped:
            print(f"   {n:5}  {category!r}")
        print("   These are almost certainly categories authored since this table was")
        print("   written (a tenant's custom framework). Add them to EXACT_MAP and re-run;")
        print("   they keep today's behaviour (domain NULL = unclassified) until you do.")
    else:
        print("\nEvery non-empty category value is covered by the mapping.")

    if not mapped:
        print("\nNothing to write.")
        conn.close()
        return 0
    if not apply:
        print("\nDry run — re-run with --apply to write.")
        conn.close()
        return 0

    written = 0
    for category, domain, _n in mapped:
        cur.execute(
            "UPDATE framework_controls SET domain = ? WHERE domain IS NULL AND category = ?",
            (domain, category),
        )
        written += cur.rowcount
    conn.commit()
    conn.close()
    print(f"\nClassified {written} row(s). `category` is untouched — it stays the")
    print("free-text label the frameworks were seeded with.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
