"""
Delete user-created data from the last 24 hours.

Usage:
    # Dry-run (default) — prints counts without deleting:
    python -m scripts.cleanup_recent

    # Actually delete:
    python -m scripts.cleanup_recent --apply

    # Custom cutoff (default 24h):
    python -m scripts.cleanup_recent --hours 48 --apply

What it does:
- Deletes rows in these user-created tables where created_at > now - cutoff:
  risks, risk_assessments, risk_treatments, risk_scenarios, risk_matrices,
  vendors, vendor_assessments, vendor_contracts, vendor_risks,
  audits, audit_findings, audit_evidence,
  policies, policy_versions, policy_attestations,
  assets, vulnerabilities, incidents, incident_timeline_entries,
  compliance_assessments, control_assessments, evidence, compliance_gaps,
  uploaded_documents, action_items,
  security_exceptions, risk_acceptances, regulatory_updates,
  applied_controls, contract_collaborations, contract_messages,
  evidence_upload_tokens, notifications, activity_logs,
  ai_access_requests, ai_usage_quotas, api_tokens.

What it preserves:
- Seeded reference: frameworks, framework_controls, control_requirements,
  threats, mandatory_documents.
- All users, all tenants — even if recent. (Account cleanup is manual.)
- All rows older than the cutoff.

Order matters: tables are deleted child-first to avoid FK violations.
"""
import argparse
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from app.core.database import AsyncSessionLocal


# Order matters — children before parents to satisfy FK constraints.
DELETE_ORDER: list[str] = [
    # Compliance children (must go before assessments + framework_controls)
    "action_items",
    "compliance_gaps",
    "evidence",
    "uploaded_documents",
    "control_assessments",
    "compliance_assessments",
    # Audit children
    "audit_evidence",
    "audit_findings",
    "audits",
    # Policies
    "policy_attestations",
    "policy_versions",
    "policies",
    # Vendors
    "vendor_risks",
    "vendor_contracts",
    "vendor_assessments",
    "vendors",
    # Risks
    "risk_treatments",
    "risk_assessments",
    "risk_scenarios",
    "risk_acceptances",
    "risk_matrices",
    "risks",
    # Incidents
    "incident_timeline_entries",
    "incidents",
    # Security
    "vulnerabilities",
    "applied_controls",
    "security_exceptions",
    # Other content
    "assets",
    "regulatory_updates",
    # Collaboration
    "contract_messages",
    "contract_collaborations",
    "evidence_upload_tokens",
    # User activity
    "notifications",
    "activity_logs",
    "ai_access_requests",
    "ai_usage_quotas",
    "api_tokens",
]


async def main(hours: int, apply: bool) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    cutoff_naive = cutoff.replace(tzinfo=None)  # SQLite stores naive datetimes
    print(f"[cleanup] cutoff = {cutoff_naive.isoformat()} ({hours}h ago)")
    print(f"[cleanup] mode   = {'APPLY (will delete)' if apply else 'DRY-RUN (preview only)'}")
    print()

    async with AsyncSessionLocal() as db:
        total_to_delete = 0
        for table in DELETE_ORDER:
            try:
                # Count first
                count_q = text(f"SELECT COUNT(*) FROM {table} WHERE created_at > :cutoff")
                result = await db.execute(count_q, {"cutoff": cutoff_naive})
                n = result.scalar() or 0
            except Exception as exc:
                print(f"  {table:35s} skipped ({exc.__class__.__name__})")
                continue

            if n == 0:
                continue

            print(f"  {table:35s} {n:>6} rows")
            total_to_delete += n

            if apply:
                del_q = text(f"DELETE FROM {table} WHERE created_at > :cutoff")
                await db.execute(del_q, {"cutoff": cutoff_naive})

        print()
        print(f"[cleanup] total rows {'deleted' if apply else 'matching'}: {total_to_delete}")

        if apply:
            await db.commit()
            print("[cleanup] committed.")
        else:
            print("[cleanup] no changes made. Re-run with --apply to actually delete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Delete user-created data younger than N hours.")
    parser.add_argument("--hours", type=int, default=24, help="Cutoff in hours (default 24).")
    parser.add_argument("--apply", action="store_true", help="Actually delete. Without this flag, just preview.")
    args = parser.parse_args()
    asyncio.run(main(args.hours, args.apply))
