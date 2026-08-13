"""Seed a tenant with realistic Elite-Pack demo data via the API.

Run AFTER the tenant has the Elite Pack (scripts.grant_elite_pack --tenant <slug>)
and the backend is restarted. Idempotent-ish: safe to re-run (dedup on the server
skips scanner dupes; other creates just add more).

Usage:
    cd backend && venv/bin/python -m scripts.seed_demo_data \
        --base http://127.0.0.1:8000/api/v1 --email admin@demo.com --password demo123
"""
import argparse
import sys

import httpx


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000/api/v1")
    ap.add_argument("--email", default="admin@demo.com")
    ap.add_argument("--password", default="demo123")
    ap.add_argument("--sync-cve", action="store_true", help="also pull recent CVEs from NVD")
    args = ap.parse_args()

    c = httpx.Client(base_url=args.base, timeout=60)
    r = c.post("/auth/login", json={"email": args.email, "password": args.password})
    if r.status_code != 200:
        print(f"login failed ({r.status_code}): {r.text[:200]}")
        return 1
    tok = r.json()["access_token"]
    H = {"Authorization": f"Bearer {tok}"}
    owner = c.get("/auth/me", headers=H).json()["id"]

    created: dict[str, int] = {}

    def post(path, body, key, label):
        rr = c.post(path, json=body, headers=H)
        if rr.status_code in (200, 201):
            created[key] = created.get(key, 0) + 1
            return rr.json()
        print(f"  ERR {rr.status_code} {label} :: {rr.text[:160]}")
        return None

    assets = [
        ("Core Banking Application", "application", "primary", "critical", "in_use", "critical", 5, 5, 4),
        ("Customer Database (Oracle)", "database", "primary", "critical", "in_use", "critical", 5, 5, 5),
        ("Internet Banking Portal", "application", "primary", "high", "in_use", "high", 4, 4, 5),
        ("Domain Controller AD", "server", "support", "high", "in_use", "high", 3, 5, 4),
        ("Branch Workstations", "workstation", "support", "medium", "maintenance", "medium", 2, 3, 3),
        ("SWIFT Gateway", "server", "primary", "critical", "in_use", "critical", 5, 5, 5),
        ("Backup Storage Array", "server", "support", "medium", "in_use", "high", 3, 4, 5),
        ("Legacy Mainframe", "server", "support", "high", "retired", "medium", 2, 3, 2),
    ]
    for name, atype, acls, crit, life, bv, ci, ii, ai in assets:
        post("/assets", {"name": name, "asset_type": atype, "asset_class": acls, "criticality": crit,
                          "owner_id": owner, "data_classification": "confidential", "lifecycle_state": life,
                          "business_value": bv, "security_objectives": {"confidentiality": ci, "integrity": ii, "availability": ai}},
             "asset", name)

    controls = [("AC-01", "Multi-factor authentication", 45000), ("AC-02", "Network segmentation", 120000),
                ("AC-03", "SIEM & log monitoring", 200000), ("AC-04", "Encryption at rest", 30000),
                ("AC-05", "Quarterly access reviews", 15000)]
    ctrl_ids = []
    for ref, name, cost in controls:
        rr = post("/applied-controls", {"ref_id": ref, "name": name, "cost": cost, "owner_id": owner}, "control", name)
        if rr:
            ctrl_ids.append(rr["id"])
    scores = [(2, 2, 2, 2, 2), (2, 2, 1, 1, 1), (1, 1, 1, 0, 0), (2, 1, 2, 1, 2), (1, 1, 0, 1, 0)]
    for cid, (f, tc, ti, tr, qy) in zip(ctrl_ids, scores):
        post("/control-evaluations", {"applied_control_id": cid, "formalisme": f, "type_controle": tc,
                                       "timing": ti, "tracabilite": tr, "quatre_yeux": qy}, "eval", "eval")

    vulns = [("CVE-2024-3400", "PAN-OS command injection", "critical", 10.0, "scan"),
             ("CVE-2023-34362", "MOVEit SQL injection", "critical", 9.8, "scan"),
             ("VLN-1007", "Weak TLS ciphers on portal", "medium", 5.3, "pen_test"),
             ("VLN-1008", "Default credentials on switch", "high", 8.1, "manual"),
             ("CVE-2021-44228", "Log4Shell", "critical", 10.0, "scan"),
             ("VLN-1010", "Missing security headers", "low", 3.1, "scan")]
    for ref, title, sev, cvss, src in vulns:
        post("/vulnerabilities", {"ref_id": ref, "title": title, "severity": sev, "cvss_score": cvss,
                                  "source": src, "affected_systems": ["Internet Banking Portal"]}, "vuln", title)

    threats = [("THR-01", "Ransomware operator", "cyber_attack"), ("THR-02", "Malicious insider", "insider_threat"),
               ("THR-03", "Phishing campaign", "social_engineering"), ("THR-04", "Supply-chain compromise", "supply_chain")]
    for ref, name, cat in threats:
        post("/threats", {"ref_id": ref, "name": name, "category": cat, "require_validation": False}, "threat", name)

    risks = c.get("/risks", params={"page_size": 20}, headers=H).json().get("items", [])
    plan = [("mitigate", 60, 25000), ("mitigate", 30, 80000), ("transfer", 100, 0), ("accept", 0, 0), ("avoid", 80, 15000)]
    for rk, (opt, prog, cost) in zip(risks, plan):
        body = {"risk_id": rk["id"], "treatment_option": opt, "progress_percentage": prog, "estimated_cost": cost}
        if opt == "accept":
            body["acceptance_justification"] = "Residual risk within appetite; approved by CISO"
        post("/risk-treatment", body, "treatment", rk.get("title", "risk"))

    raci = [("Risk assessment sign-off", "ciso", "R"), ("Risk assessment sign-off", "tenant_admin", "A"),
            ("Control implementation", "control_owner", "R"), ("Compliance reporting", "compliance_manager", "C"),
            ("Audit follow-up", "auditor", "I")]
    for act, role, r in raci:
        post("/governance/raci", {"activity": act, "responsible_type": "role", "role": role, "raci": r, "module": "risks"}, "raci", act)
    for title, typ in [("Information Security Policy", "policy"), ("Business Continuity Plan", "plan"), ("Access Control Charter", "charter")]:
        post("/governance/documents", {"title": title, "typology": typ, "access_level": "read", "content": f"{title} v1"}, "doc", title)
    for etype, reason, days in [("audit", "2024 SOC 2 audit report", 365), ("policy", "Superseded remote-work policy", 730), ("risk", "Closed risk: legacy VPN", 1095)]:
        post("/archiving", {"entity_type": etype, "reason": reason, "retention_days": days, "payload": {}}, "archive", reason)

    if args.sync_cve:
        s = c.post("/cve/sync", params={"days": 7}, headers=H)
        print("CVE sync:", s.json() if s.status_code == 200 else s.status_code)

    print("SEED SUMMARY:", created)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
