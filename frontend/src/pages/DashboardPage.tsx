import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";
import {
  AlertTriangle, ClipboardList, Building2, FileText, Activity,
  Shield, TrendingUp, TrendingDown, ChevronRight, Plus,
  ArrowUpRight, Sparkles, Upload, CheckCircle2, XCircle,
  AlertCircle, LayoutDashboard, BookOpen, FolderUp, Search,
  GitBranch, UserPlus, BarChart3, CheckCheck,
} from "lucide-react";
import { dashboardApi } from "../api/endpoints";
import { useAuthStore } from "../store/auth";
import type { DashboardSummary } from "../types";
import ComplianceJourneyMap from "../components/features/compliance/ComplianceJourneyMap";
import ReadinessScoreWidget from "../components/features/compliance/ReadinessScoreWidget";

// ── Generic fallback dashboard data ───────────────────────────────────────────
const DEMO_DATA: DashboardSummary = {
  risk: { total_open: 24, critical: 3, high: 8, by_severity: { critical: 3, high: 8, medium: 9, low: 4 } },
  compliance: { average_score: 72.5, total_assessments: 4, control_coverage_percent: 68.3, controls_by_status: { implemented: 89, in_progress: 24, not_started: 31, not_applicable: 8 } },
  audit: { open_findings: 7 },
  vendor: { total_vendors: 18 },
  policy: { attestation_rate_percent: 84.2, total_attestations: 142 },
};

const RISK_TREND = [
  { month: "Aug", critical: 5, high: 12 }, { month: "Sep", critical: 4, high: 10 },
  { month: "Oct", critical: 4, high: 11 }, { month: "Nov", critical: 3, high: 9 },
  { month: "Dec", critical: 3, high: 8 },  { month: "Jan", critical: 3, high: 8 },
];

// ── Shared helpers ─────────────────────────────────────────────────────────────

function KpiCard({ title, value, subtitle, icon: Icon, iconBg, change, changePositive }: {
  title: string; value: string | number; subtitle?: string;
  icon: React.ElementType; iconBg: string; change?: string; changePositive?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {change && (
          <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
            changePositive ? "text-green-700 bg-green-50" : "text-red-700 bg-red-50"
          }`}>
            {changePositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {change}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-500 mt-0.5">{title}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function pctColor(pct: number) {
  if (pct >= 75) return "text-green-600";
  if (pct >= 50) return "text-yellow-600";
  return "text-red-500";
}

function pctBg(pct: number) {
  if (pct >= 75) return "bg-green-500";
  if (pct >= 50) return "bg-yellow-400";
  return "bg-red-400";
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
    medium: "bg-yellow-100 text-yellow-700", low: "bg-green-100 text-green-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${map[severity] ?? "bg-gray-100 text-gray-600"}`}>
      {severity}
    </span>
  );
}

// ── Certification Meter component ─────────────────────────────────────────────

function CertificationMeter({ readiness }: { readiness: number }) {
  const milestones = [
    { pct: 0, label: "Start" },
    { pct: 25, label: "Initial" },
    { pct: 50, label: "Defined" },
    { pct: 75, label: "Managed" },
    { pct: 100, label: "Certified" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Certification Readiness</h3>
          <p className="text-xs text-gray-400 mt-0.5">Compliance × 0.5 + Docs × 0.3 + Blockers × 0.2</p>
        </div>
        <span className={`text-2xl font-bold ${pctColor(readiness)}`}>{readiness}%</span>
      </div>

      {/* Track */}
      <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full rounded-full transition-all ${pctBg(readiness)}`}
          style={{ width: `${readiness}%` }}
        />
      </div>

      {/* Milestones */}
      <div className="flex justify-between mt-1">
        {milestones.map((m) => (
          <div key={m.pct} className="flex flex-col items-center gap-0.5">
            <div className={`w-0.5 h-2 ${readiness >= m.pct ? pctBg(readiness) : "bg-gray-200"}`} />
            <span className={`text-xs ${readiness >= m.pct ? "font-semibold text-gray-700" : "text-gray-400"}`}>
              {m.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section Pivot Table ───────────────────────────────────────────────────────

function ComplianceSectionTable({ rows }: { rows: any[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">Compliance by Section</h3>
        <span className="text-xs text-gray-400">{rows.length} sections</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="text-left pb-2 font-medium">Section</th>
              <th className="text-center pb-2 font-medium w-12">Full</th>
              <th className="text-center pb-2 font-medium w-14">Partial</th>
              <th className="text-center pb-2 font-medium w-10">Gap</th>
              <th className="text-center pb-2 font-medium w-10">N/A</th>
              <th className="text-right pb-2 font-medium w-16">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => (
              <tr key={row.section} className="hover:bg-gray-50">
                <td className="py-2.5 text-gray-700 font-medium text-xs">{row.section}</td>
                <td className="py-2.5 text-center text-green-600 font-semibold">{row.full}</td>
                <td className="py-2.5 text-center text-yellow-600 font-semibold">{row.partial}</td>
                <td className="py-2.5 text-center text-red-500 font-semibold">{row.not_impl}</td>
                <td className="py-2.5 text-center text-gray-400">{row.na}</td>
                <td className="py-2.5 text-right">
                  <span className={`text-xs font-bold ${pctColor(row.percent)}`}>{row.percent}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Document Progress Card ────────────────────────────────────────────────────

function DocumentProgressCard({ uploaded, required, missingNames, assessmentId }: {
  uploaded: number; required: number; missingNames: string[]; assessmentId: string;
}) {
  const pct = required > 0 ? Math.round(uploaded / required * 100) : 0;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">Mandatory Documents</h3>
        <span className={`text-lg font-bold ${pctColor(pct)}`}>{uploaded}/{required}</span>
      </div>

      {/* Progress bar */}
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div className={`h-full rounded-full ${pctBg(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-400 mb-4">{pct}% of required documents uploaded</p>

      {/* Missing docs */}
      {missingNames.length > 0 && (
        <div className="flex-1 space-y-1.5 mb-4">
          <p className="text-xs font-medium text-gray-600">Missing:</p>
          {missingNames.map((name) => (
            <div key={name} className="flex items-center gap-2 text-xs text-gray-500">
              <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              <span className="truncate">{name}</span>
            </div>
          ))}
        </div>
      )}

      <Link
        to={`/compliance/${assessmentId}`}
        className="mt-auto flex items-center justify-center gap-2 w-full bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium text-sm py-2.5 rounded-xl transition-colors"
      >
        <Upload className="w-4 h-4" /> Upload Documents
      </Link>
    </div>
  );
}

// ── Top Gaps Card ─────────────────────────────────────────────────────────────

function TopGapsCard({ gaps, assessmentId }: { gaps: any[]; assessmentId: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">Top Priority Gaps</h3>
        <Link to={`/compliance/${assessmentId}`}
          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium">
          View all <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {gaps.length === 0 ? (
        <div className="text-center py-6 text-gray-400">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-400" />
          <p className="text-sm">No open gaps — great work!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {gaps.map((g, i) => (
            <div key={g.gap_id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
              <span className="text-xs font-bold text-gray-400 w-4 flex-shrink-0 mt-0.5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-gray-500">{g.control_identifier}</span>
                  {g.is_certification_blocker && (
                    <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">Blocker</span>
                  )}
                  <SeverityBadge severity={g.severity} />
                </div>
                <p className="text-sm font-medium text-gray-800 mt-0.5 truncate">{g.control_title}</p>
              </div>
              {g.recommendation_status === "accepted" && (
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
              )}
            </div>
          ))}
        </div>
      )}

      <Link
        to={`/compliance/${assessmentId}`}
        className="mt-4 flex items-center justify-center gap-2 w-full border border-purple-200 hover:bg-purple-50 text-purple-700 font-medium text-sm py-2.5 rounded-xl transition-colors"
      >
        <Sparkles className="w-4 h-4" /> AI Remediate All
      </Link>
    </div>
  );
}

// ── Framework Dashboard (primary) ─────────────────────────────────────────────

function FrameworkDashboard({ data }: { data: any }) {
  const navigate = useNavigate();
  const kpi = data.kpi;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{data.framework_name} Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {data.assessment_name}
            {data.last_analyzed && (
              <span className="ml-2 text-gray-400">· Last analyzed {new Date(data.last_analyzed).toLocaleDateString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/compliance/${data.assessment_id}`)}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg"
          >
            <LayoutDashboard className="w-4 h-4" /> Assessment
          </button>
          <button
            onClick={() => navigate(`/compliance`)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Assessment
          </button>
        </div>
      </div>

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title="Overall Score" value={`${kpi.compliance_score ?? 0}%`}
          icon={Shield} iconBg="bg-blue-500" />
        <KpiCard title="Controls"
          value={`${kpi.controls_implemented}/${kpi.controls_total}`}
          subtitle={`${kpi.controls_partial} partial`}
          icon={CheckCircle2} iconBg="bg-green-500" />
        <KpiCard title="Open Gaps" value={kpi.open_gaps}
          subtitle={`${kpi.certification_blockers} blockers`}
          icon={AlertCircle} iconBg="bg-orange-500" />
        <KpiCard title="Documents"
          value={`${kpi.docs_uploaded}/${kpi.docs_required}`}
          icon={FileText} iconBg="bg-indigo-500" />
        <KpiCard title="Cert Readiness" value={`${kpi.cert_readiness}%`}
          icon={TrendingUp} iconBg={kpi.cert_readiness >= 75 ? "bg-emerald-500" : "bg-amber-500"} />
      </div>

      {/* Readiness Score + Journey Map */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ReadinessScoreWidget
          score={kpi.cert_readiness ?? 0}
          compliancePct={kpi.compliance_score ?? 0}
          docPct={kpi.docs_required > 0 ? Math.round((kpi.docs_uploaded / kpi.docs_required) * 100) : 0}
          blockerPct={kpi.certification_blockers === 0 ? 100 : Math.max(0, 100 - kpi.certification_blockers * 10)}
        />
        <ComplianceJourneyMap
          complianceScore={kpi.compliance_score ?? 0}
          docCompleteness={kpi.docs_required > 0 ? Math.round((kpi.docs_uploaded / kpi.docs_required) * 100) : 0}
          openBlockers={kpi.certification_blockers ?? 0}
          openActions={kpi.open_gaps ?? 0}
          certReadiness={kpi.cert_readiness ?? 0}
        />
      </div>

      {/* Section pivot + Doc progress */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          {data.section_pivot?.length > 0
            ? <ComplianceSectionTable rows={data.section_pivot} />
            : (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center text-gray-400">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Run AI analysis to see section breakdown</p>
                <button
                  onClick={() => navigate(`/compliance/${data.assessment_id}`)}
                  className="mt-3 text-xs text-blue-600 hover:underline">
                  Go to Assessment →
                </button>
              </div>
            )
          }
        </div>
        <DocumentProgressCard
          uploaded={kpi.docs_uploaded}
          required={kpi.docs_required}
          missingNames={data.doc_progress?.missing_names ?? []}
          assessmentId={data.assessment_id}
        />
      </div>

      {/* Top Gaps + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TopGapsCard gaps={data.top_gaps ?? []} assessmentId={data.assessment_id} />

        {/* Quick Actions */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Run Analysis", desc: "AI gap assessment", icon: Sparkles, color: "bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200", to: `/compliance/${data.assessment_id}` },
              { label: "View Gap Report", desc: "All open gaps", icon: AlertTriangle, color: "bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200", to: `/compliance/${data.assessment_id}` },
              { label: "Upload Documents", desc: "Mandatory docs", icon: Upload, color: "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200", to: `/compliance/${data.assessment_id}` },
              { label: "Traceability Matrix", desc: "Control → gap → action", icon: ClipboardList, color: "bg-green-50 hover:bg-green-100 text-green-700 border-green-200", to: `/compliance/${data.assessment_id}/traceability` },
            ].map((action) => (
              <Link key={action.label} to={action.to}
                className={`flex flex-col gap-1.5 p-4 rounded-xl border transition-colors ${action.color}`}>
                <action.icon className="w-5 h-5" />
                <div>
                  <div className="text-sm font-semibold">{action.label}</div>
                  <div className="text-xs opacity-70">{action.desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── No-framework onboarding card ──────────────────────────────────────────────

function NoFrameworkCard() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-4">
        <Shield className="w-8 h-8 text-blue-500" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Select your compliance framework</h2>
      <p className="text-gray-500 text-sm max-w-md mb-6">
        Your dashboard, document checklist, and gap report are all framework-driven.
        Pick your primary framework to get started.
      </p>
      <button
        onClick={() => navigate("/compliance")}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl flex items-center gap-2">
        <Plus className="w-4 h-4" /> Start Compliance Assessment
      </button>
    </div>
  );
}

// ── Generic fallback dashboard ────────────────────────────────────────────────

function GenericDashboard({ d, isDemo }: { d: DashboardSummary; isDemo: boolean }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Security Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Executive overview</p>
        </div>
        {isDemo && (
          <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
            <Activity className="w-3.5 h-3.5" /> Demo data
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <KpiCard title="Open Risks" value={d.risk.total_open}
          subtitle={`${d.risk.critical} critical · ${d.risk.high} high`}
          icon={AlertTriangle} iconBg="bg-red-500" change="-12%" changePositive />
        <KpiCard title="Compliance Score" value={`${d.compliance.average_score}%`}
          subtitle={`${d.compliance.total_assessments} assessments`}
          icon={Shield} iconBg="bg-blue-500" change="+4.2%" changePositive />
        <KpiCard title="Open Audit Findings" value={d.audit.open_findings}
          subtitle="Requires remediation"
          icon={ClipboardList} iconBg="bg-orange-500" />
        <KpiCard title="Vendors" value={d.vendor.total_vendors}
          icon={Building2} iconBg="bg-indigo-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Risk Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={RISK_TREND} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="critical" stackId="a" fill="#ef4444" />
              <Bar dataKey="high" stackId="a" fill="#f97316" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Policy Attestation</h3>
            <span className="text-2xl font-bold text-blue-600">{d.policy.attestation_rate_percent}%</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${d.policy.attestation_rate_percent}%` }} />
          </div>
          <p className="text-xs text-gray-400">{d.policy.total_attestations} total attestations</p>
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-500">Compliance coverage</span>
            <span className="font-bold text-gray-800">{d.compliance.control_coverage_percent}%</span>
          </div>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full" style={{ width: `${d.compliance.control_coverage_percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main dashboard page ───────────────────────────────────────────────────────

export default function DashboardPage() {
  const primaryFrameworkId = useAuthStore((u) => u?.primary_framework_id);

  // Framework-specific summary (only when primary framework is set)
  const { data: fwData, isLoading: fwLoading } = useQuery({
    queryKey: ["dashboard", "framework-summary"],
    queryFn: dashboardApi.getFrameworkSummary,
    retry: false,
    enabled: !!primaryFrameworkId,
  });

  // Generic summary (always fetched as fallback)
  const { data: genericData, isError: genericError } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: dashboardApi.getSummary,
    retry: false,
  });

  const d = genericData ?? DEMO_DATA;
  const isDemo = genericError || !genericData;

  // Show framework dashboard if we have a primary framework + data
  if (primaryFrameworkId) {
    if (fwLoading) {
      return (
        <div className="p-8 max-w-7xl">
          <div className="h-8 w-64 bg-gray-200 rounded animate-pulse mb-4" />
          <div className="grid grid-cols-5 gap-4 mb-6">
            {[1,2,3,4,5].map((i) => <div key={i} className="h-24 bg-gray-200 rounded-2xl animate-pulse" />)}
          </div>
          <div className="h-20 bg-gray-200 rounded-2xl animate-pulse mb-4" />
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 h-64 bg-gray-200 rounded-2xl animate-pulse" />
            <div className="h-64 bg-gray-200 rounded-2xl animate-pulse" />
          </div>
        </div>
      );
    }

    if (!fwData || fwData.has_framework === false) {
      return (
        <div className="p-8 max-w-7xl">
          <NoFrameworkCard />
        </div>
      );
    }

    if (fwData.has_assessment === false) {
      return (
        <div className="p-8 max-w-7xl">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">{fwData.framework_name} Dashboard</h1>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-8 text-center">
            <Shield className="w-10 h-10 text-blue-400 mx-auto mb-3" />
            <h2 className="font-semibold text-blue-900 mb-1">Framework selected — create your assessment</h2>
            <p className="text-blue-700 text-sm mb-4">
              Your {fwData.framework_short_name} compliance assessment will be created automatically.
            </p>
            <Link to="/compliance"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl">
              <Plus className="w-4 h-4" /> Start Assessment
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="p-8 max-w-7xl">
        <FrameworkDashboard data={fwData} />
      </div>
    );
  }

  // No primary framework set — show Getting Started guide
  return (
    <div className="p-8 max-w-5xl space-y-6">
      <GettingStartedGuide />
      <GenericDashboard d={d} isDemo={isDemo} />
    </div>
  );
}

// ── Getting Started Guide ──────────────────────────────────────────────────────

const STEPS = [
  {
    num: 1,
    icon: BookOpen,
    color: "bg-blue-100 text-blue-600",
    title: "Create a Compliance Assessment",
    desc: "Go to Compliance → click 'New Assessment'. Choose your framework (e.g. ISO 27001), give it a name, and save.",
    action: "Go to Compliance",
    href: "/compliance",
  },
  {
    num: 2,
    icon: FolderUp,
    color: "bg-purple-100 text-purple-600",
    title: "Upload your documents",
    desc: "Open the assessment → \"Upload & Analyze\" tab → drag-and-drop your policies, procedures, or any PDF/Word/TXT files.",
    action: "Go to Compliance",
    href: "/compliance",
  },
  {
    num: 3,
    icon: Search,
    color: "bg-orange-100 text-orange-600",
    title: "Run AI Analysis",
    desc: "Click \"Run AI Analysis\" — the AI reads your documents and automatically scores every control against your framework.",
    action: "Go to Compliance",
    href: "/compliance",
  },
  {
    num: 4,
    icon: BarChart3,
    color: "bg-green-100 text-green-600",
    title: "Review your Gap Report",
    desc: "Open the \"Gap Report\" tab to see which controls are failing. Accept gaps to create action items, or reject if not applicable.",
    action: "Go to Compliance",
    href: "/compliance",
  },
  {
    num: 5,
    icon: CheckCheck,
    color: "bg-teal-100 text-teal-600",
    title: "Review the Document Checklist",
    desc: "The \"Document Checklist\" tab shows all mandatory documents for your framework (e.g. ISO 27001 requires 40 docs). Upload missing ones inline.",
    action: "Go to Compliance",
    href: "/compliance",
  },
  {
    num: 6,
    icon: GitBranch,
    color: "bg-indigo-100 text-indigo-600",
    title: "View Traceability Matrix",
    desc: "See how each control links to gaps and action items in one scrollable table. Use it to prove compliance coverage.",
    action: "Go to Compliance",
    href: "/compliance",
  },
  {
    num: 7,
    icon: UserPlus,
    color: "bg-pink-100 text-pink-600",
    title: "Invite an External Auditor (optional)",
    desc: "Go to Audits → \"Add Auditor\" to create an auditor account. They get a restricted portal to verify controls and generate a formal audit report.",
    action: "Go to Audits",
    href: "/audits",
  },
];

function GettingStartedGuide() {
  return (
    <div className="space-y-5">
      {/* Hero banner */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-7 text-white">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold mb-1">Welcome to your GRC Platform</h1>
            <p className="text-blue-100 text-sm leading-relaxed max-w-2xl">
              This platform helps you manage compliance (ISO 27001, SOC 2, etc.), track risks, run audits, and generate reports — all in one place.
              Follow the steps below to get your first compliance assessment running in minutes.
            </p>
          </div>
          <Link
            to="/help"
            className="flex-shrink-0 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            Full Guide →
          </Link>
        </div>
      </div>

      {/* Steps */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-gray-50">
          <h2 className="font-bold text-gray-900">How to get started — 7 steps</h2>
          <p className="text-xs text-gray-400 mt-0.5">Complete these steps to have a fully working compliance assessment</p>
        </div>
        <div className="divide-y divide-gray-50">
          {STEPS.map((step) => (
            <div key={step.num} className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${step.color}`}>
                <step.icon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-300">STEP {step.num}</span>
                </div>
                <p className="font-semibold text-gray-900 text-sm mt-0.5">{step.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.desc}</p>
              </div>
              <Link
                to={step.href}
                className="flex-shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              >
                {step.action} →
              </Link>
            </div>
          ))}
        </div>

        {/* Quick links row */}
        <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Quick navigation</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "New Assessment", href: "/compliance", icon: Plus },
              { label: "Upload Documents", href: "/compliance", icon: Upload },
              { label: "Risk Register", href: "/risks", icon: AlertTriangle },
              { label: "Frameworks", href: "/frameworks", icon: BookOpen },
              { label: "Audits", href: "/audits", icon: ClipboardList },
              { label: "Policies", href: "/policies", icon: FileText },
            ].map(({ label, href, icon: Icon }) => (
              <Link
                key={label}
                to={href}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:border-blue-300 hover:text-blue-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
