import { useState } from "react";
import { BookOpen, GraduationCap, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

const TABS = [
  { id: "admin", label: "Administrator Guide", Icon: BookOpen },
  { id: "training", label: "Training", Icon: GraduationCap },
  { id: "sla", label: "Service Level (SLA)", Icon: FileText },
] as const;

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-gray-900 mt-5 mb-1.5">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-600 leading-relaxed mb-2">{children}</p>;
}
function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5 mb-2">
      {items.map((it, i) => (
        <li key={i} className="text-sm text-gray-600 leading-relaxed pl-4 relative">
          <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-blue-400" />{it}
        </li>
      ))}
    </ul>
  );
}
const C = ({ children }: { children: React.ReactNode }) => (
  <code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-800 text-[12px] font-mono">{children}</code>
);

export default function DocumentationPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("admin");

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("docs.title", "Documentation")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("docs.subtitle", "Administrator guide, training programme and service level for the platform")}</p>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-200">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {tab === "admin" && (
          <div>
            <H>Architecture</H>
            <P>A three-tier web application: a React/TypeScript single-page app, a FastAPI (Python 3.12) backend with SQLAlchemy, and a local Ollama model for AI (no external AI calls). Data runs on SQLite for pilot and Oracle / SQL Server / PostgreSQL in production.</P>
            <H>Roles &amp; access</H>
            <UL items={[
              <><b>Super Admin</b> — platform-wide tenants &amp; subscriptions</>,
              <><b>Tenant Admin</b> — full app + company administration + auditor management</>,
              <><b>CISO / Risk Manager / Compliance</b> — full functional access</>,
              <><b>User</b> — standard functional access</>,
              <><b>Auditor</b> — assigned audits &amp; company documents only</>,
            ]} />
            <H>Configuration (<C>backend/.env.local</C>)</H>
            <UL items={[
              <><C>SECRET_KEY</C> — 64+ random chars (also holds the license signing key)</>,
              <><C>ENVIRONMENT</C> / <C>DEBUG</C> — set <C>production</C> / <C>false</C> for go-live</>,
              <><C>ALLOWED_ORIGINS</C> — the production domain(s) only</>,
              <><C>DATABASE_URL</C> — SQLite / PostgreSQL / Oracle / SQL Server</>,
              <><C>SMTP_*</C>, <C>EMAIL_FROM</C> — notifications &amp; scheduled reports</>,
              <><C>LDAP_*</C> — Active Directory SSO</>,
            ]} />
            <H>Running &amp; operating</H>
            <UL items={[
              <>Processes run under <b>pm2</b> (<C>grceye-backend</C>, <C>grceye-frontend</C>, <C>grceye-marketing</C>).</>,
              <>Apply a backend change: <C>pm2 restart grceye-backend</C>. Frontend: <C>npm run build</C> then restart.</>,
              <>Health: <C>GET /health</C>. Logs: <C>pm2 logs grceye-backend</C>.</>,
              <>Column migrations: <C>venv/bin/python -m scripts.deploy_elite_pack</C> (idempotent).</>,
            ]} />
            <H>Backups &amp; recovery</H>
            <UL items={[
              <>Snapshot: <C>venv/bin/python -m scripts.backup_db</C> (consistent, rotated, to <C>backend/backups/</C>).</>,
              <>Schedule hourly via cron; restore by copying a snapshot over <C>grc_dev.db</C> and restarting.</>,
            ]} />
            <H>Security hardening (go-live)</H>
            <UL items={[
              <>Run <C>scripts.check_prod_readiness</C> — reports what must change before production mode.</>,
              <>Install a valid TLS certificate <b>before</b> enabling production mode (HSTS).</>,
              <>Set <C>ENVIRONMENT=production</C>, <C>DEBUG=false</C>; API docs auto-hide, HSTS turns on.</>,
              <>For multiple workers, provision Redis for shared token-revocation / rate-limit / scheduler state.</>,
            ]} />
            <H>Elite Pack &amp; troubleshooting</H>
            <UL items={[
              <>Grant the pack: <C>scripts.grant_elite_pack --tenant &lt;slug&gt;</C> or <C>PATCH /admin/subscriptions/&#123;id&#125;</C>.</>,
              <>A "Service unavailable" page = the SPA fell back on a 5xx/network error — check health &amp; logs.</>,
              <>CVE catalog refreshes daily; trigger manually with "Sync from NVD".</>,
            ]} />
          </div>
        )}

        {tab === "training" && (
          <div>
            <H>Objectives</H>
            <P>Enable STB staff to operate the platform independently — administrators to install, secure, back up and maintain it; risk &amp; compliance teams to run the GRC workflow end to end.</P>
            <H>Audience</H>
            <UL items={["Platform administrators (IT / security operations)", "CISO office, risk managers, compliance officers", "Auditors (assigned-scope usage)"]} />
            <H>Day 1 — Functional</H>
            <UL items={[
              "Platform tour, roles & navigation; assets & CIA valuation",
              "Vulnerabilities, scanner import, CVE knowledge base & triage",
              "Threat library & feeds; risk register, matrices, scenarios & appetite",
              "Lab: build a risk scenario (threat → vulnerability → asset → control) and read its residual/target score",
            ]} />
            <H>Day 2 — Compliance, governance &amp; administration</H>
            <UL items={[
              "Framework assessments, gaps, evidence & control effectiveness",
              "Governance (RACI, documents, policies), audit lifecycle, reporting & dashboards, OCR & doc generator",
              "Administration: users & roles, MFA & sessions, backups, hardening, Elite Pack grants",
              "Lab: run an assessment, generate a report, perform a backup and a readiness check",
            ]} />
            <H>Materials, handover &amp; assessment</H>
            <UL items={[
              "This documentation + in-app Help & cheat-sheet + a training tenant with sample data",
              "Scenario-based assessment and an administrator runbook walkthrough on Day 2",
              "30-day post-training support window (see SLA)",
            ]} />
          </div>
        )}

        {tab === "sla" && (
          <div>
            <P><i>Proposed terms for STB's review; figures are indicative and to be confirmed contractually.</i></P>
            <H>Scope &amp; availability</H>
            <UL items={[
              "Operation, support and maintenance of the platform on STB-approved infrastructure.",
              <>Availability target: <b>99.5%</b> monthly, excluding scheduled maintenance (announced ≥ 48h ahead).</>,
            ]} />
            <H>Support &amp; incident response</H>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-1 mb-3">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60 text-gray-500">
                    <th className="text-left px-3 py-2 font-medium">Severity</th>
                    <th className="text-left px-3 py-2 font-medium">Definition</th>
                    <th className="text-left px-3 py-2 font-medium">Response</th>
                    <th className="text-left px-3 py-2 font-medium">Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["S1 — Critical", "Platform down / data at risk", "1 business hour", "4 business hours"],
                    ["S2 — High", "Major function down, no workaround", "4 business hours", "1 business day"],
                    ["S3 — Medium", "Function degraded, workaround exists", "1 business day", "5 business days"],
                    ["S4 — Low", "Question / cosmetic / enhancement", "2 business days", "Next release"],
                  ].map((r) => (
                    <tr key={r[0]} className="border-b border-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">{r[0]}</td>
                      <td className="px-3 py-2 text-gray-600">{r[1]}</td>
                      <td className="px-3 py-2 text-gray-600">{r[2]}</td>
                      <td className="px-3 py-2 text-gray-600">{r[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <H>Backup, DR &amp; security</H>
            <UL items={[
              <>Automated backups (default hourly); recovery objectives <b>RPO ≤ 1h</b>, <b>RTO ≤ 4h</b> (to confirm with STB DR).</>,
              "Role-based access, MFA, tamper-evident audit log, session revocation; AI on a local model (no data leaves STB).",
            ]} />
            <H>Reporting, review &amp; exclusions</H>
            <UL items={[
              "Monthly availability & incident report; quarterly service review; change management for updates.",
              "Excludes issues from STB-side infrastructure/network/third parties or unsupported configurations.",
            ]} />
          </div>
        )}
      </div>
    </div>
  );
}
