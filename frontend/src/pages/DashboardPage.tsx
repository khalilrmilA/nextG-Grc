import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import {
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar,
} from "recharts";
import {
  AlertTriangle, ClipboardList, Building2, FileText, Activity,
  Shield, TrendingUp, TrendingDown, ChevronRight, Plus,
  Sparkles, Upload, CheckCircle2, XCircle,
  AlertCircle, LayoutDashboard, BookOpen, X, Loader2,
} from "lucide-react";
import { dashboardApi, frameworksApi, authApi, complianceApi } from "../api/endpoints";
import { useAuthStore, authSession } from "../store/auth";
import type { DashboardSummary, Framework } from "../types";
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

// ── Section Pivot Table ───────────────────────────────────────────────────────

function ComplianceSectionTable({ rows }: { rows: any[] }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">{t("dashboard.compliance_sections")}</h3>
        <span className="text-xs text-gray-400">{rows.length} {t("dashboard.sections_count")}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="text-left pb-2 font-medium">{t("dashboard.section")}</th>
              <th className="text-center pb-2 font-medium w-12">{t("dashboard.full")}</th>
              <th className="text-center pb-2 font-medium w-14">{t("dashboard.partial")}</th>
              <th className="text-center pb-2 font-medium w-10">{t("dashboard.gap")}</th>
              <th className="text-center pb-2 font-medium w-10">{t("dashboard.na")}</th>
              <th className="text-right pb-2 font-medium w-16">{t("compliance.score")}</th>
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
  const { t } = useTranslation();
  const pct = required > 0 ? Math.round(uploaded / required * 100) : 0;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">{t("compliance.doc_checklist_title")}</h3>
        <span className={`text-lg font-bold ${pctColor(pct)}`}>{uploaded}/{required}</span>
      </div>

      {/* Progress bar */}
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div className={`h-full rounded-full ${pctBg(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-400 mb-4">{t("dashboard.docs_uploaded_pct", { pct })}</p>

      {/* Missing docs */}
      {missingNames.length > 0 && (
        <div className="flex-1 space-y-1.5 mb-4">
          <p className="text-xs font-medium text-gray-600">{t("dashboard.missing")}:</p>
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
        <Upload className="w-4 h-4" /> {t("dashboard.upload_documents")}
      </Link>
    </div>
  );
}

// ── Top Gaps Card ─────────────────────────────────────────────────────────────

function TopGapsCard({ gaps, assessmentId }: { gaps: any[]; assessmentId: string }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">{t("dashboard.top_gaps")}</h3>
        <Link to={`/compliance/${assessmentId}`}
          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium">
          {t("common.view")} <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {gaps.length === 0 ? (
        <div className="text-center py-6 text-gray-400">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-400" />
          <p className="text-sm">{t("dashboard.no_open_gaps")}</p>
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
                    <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-semibold">{t("compliance.blocker")}</span>
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
        <Sparkles className="w-4 h-4" /> {t("dashboard.ai_remediate")}
      </Link>
    </div>
  );
}

// ── Framework Dashboard (primary) ─────────────────────────────────────────────

function FrameworkDashboard({ data }: { data: any }) {
  const { t } = useTranslation();
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
              <span className="ml-2 text-gray-400">· {t("dashboard.last_analyzed")} {new Date(data.last_analyzed).toLocaleDateString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/compliance/${data.assessment_id}`)}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg"
          >
            <LayoutDashboard className="w-4 h-4" /> {t("compliance.assessments")}
          </button>
          <button
            onClick={() => navigate(`/compliance`)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> {t("compliance.new_assessment")}
          </button>
        </div>
      </div>

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title={t("dashboard.overall_score")} value={`${kpi.compliance_score ?? 0}%`}
          icon={Shield} iconBg="bg-blue-500" />
        <KpiCard title={t("dashboard.controls_covered")}
          value={`${kpi.controls_implemented}/${kpi.controls_total}`}
          subtitle={`${kpi.controls_partial} ${t("dashboard.partial")}`}
          icon={CheckCircle2} iconBg="bg-green-500" />
        <KpiCard title={t("dashboard.open_gaps")} value={kpi.open_gaps}
          subtitle={`${kpi.certification_blockers} ${t("dashboard.blockers")}`}
          icon={AlertCircle} iconBg="bg-orange-500" />
        <KpiCard title={t("dashboard.missing_docs")}
          value={`${kpi.docs_uploaded}/${kpi.docs_required}`}
          icon={FileText} iconBg="bg-indigo-500" />
        <KpiCard title={t("dashboard.cert_readiness")} value={`${kpi.cert_readiness}%`}
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
                <p className="text-sm">{t("dashboard.run_analysis_hint")}</p>
                <button
                  onClick={() => navigate(`/compliance/${data.assessment_id}`)}
                  className="mt-3 text-xs text-blue-600 hover:underline">
                  {t("dashboard.go_to_assessment")} →
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
          <h3 className="font-semibold text-gray-900 mb-4">{t("dashboard.quick_actions")}</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: t("dashboard.run_analysis"), desc: t("dashboard.run_analysis_desc"), icon: Sparkles, color: "bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200", to: `/compliance/${data.assessment_id}` },
              { label: t("dashboard.view_gap_report"), desc: t("dashboard.all_open_gaps"), icon: AlertTriangle, color: "bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200", to: `/compliance/${data.assessment_id}` },
              { label: t("dashboard.upload_documents"), desc: t("dashboard.mandatory_docs"), icon: Upload, color: "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200", to: `/compliance/${data.assessment_id}` },
              { label: t("dashboard.generate_policies"), desc: t("dashboard.ai_doc_builder"), icon: BookOpen, color: "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200", to: "/policy-generator" },
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

// ── Generic fallback dashboard ────────────────────────────────────────────────

function GenericDashboard({ d, isDemo }: { d: DashboardSummary; isDemo: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("dashboard.security_dashboard")}</h1>
          <p className="text-gray-500 text-sm mt-1">{t("dashboard.executive_overview")}</p>
        </div>
        {isDemo && (
          <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
            <Activity className="w-3.5 h-3.5" /> Demo data
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <KpiCard title={t("dashboard.open_risks")} value={d.risk.total_open}
          subtitle={`${d.risk.critical} ${t("compliance.severities.critical")} · ${d.risk.high} ${t("compliance.severities.high")}`}
          icon={AlertTriangle} iconBg="bg-red-500" change="-12%" changePositive />
        <KpiCard title={t("dashboard.compliance_score")} value={`${d.compliance.average_score}%`}
          subtitle={`${d.compliance.total_assessments} ${t("compliance.assessments")}`}
          icon={Shield} iconBg="bg-blue-500" change="+4.2%" changePositive />
        <KpiCard title={t("dashboard.open_audit_findings")} value={d.audit.open_findings}
          subtitle={t("dashboard.requires_remediation")}
          icon={ClipboardList} iconBg="bg-orange-500" />
        <KpiCard title={t("nav.vendors")} value={d.vendor.total_vendors}
          icon={Building2} iconBg="bg-indigo-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">{t("dashboard.risk_trend")}</h3>
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
            <h3 className="font-semibold text-gray-900">{t("dashboard.policy_attestation")}</h3>
            <span className="text-2xl font-bold text-blue-600">{d.policy.attestation_rate_percent}%</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${d.policy.attestation_rate_percent}%` }} />
          </div>
          <p className="text-xs text-gray-400">{d.policy.total_attestations} {t("dashboard.total_attestations")}</p>
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-500">{t("dashboard.compliance_coverage")}</span>
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

// ── Framework Overview Card ────────────────────────────────────────────────────

function FrameworkOverviewCard({ fw, onSelect }: { fw: any; onSelect: () => void }) {
  const { t } = useTranslation();
  const score = fw.compliance_score ?? null;
  const readiness = fw.cert_readiness ?? null;

  function scoreColor(v: number | null) {
    if (v == null) return "text-gray-400";
    if (v >= 75) return "text-green-600";
    if (v >= 50) return "text-yellow-600";
    return "text-red-500";
  }
  function scoreBg(v: number | null) {
    if (v == null) return "bg-gray-100";
    if (v >= 75) return "bg-green-500";
    if (v >= 50) return "bg-yellow-400";
    return "bg-red-400";
  }

  return (
    <button
      onClick={onSelect}
      className="group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all p-6 text-left flex flex-col gap-4 w-full"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-mono">
              {fw.framework_short_name}
            </span>
            {fw.is_primary && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-purple-50 text-purple-600">
                {t("dashboard.primary")}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-800 leading-snug">{fw.framework_name}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors mt-1 flex-shrink-0" />
      </div>

      {/* Score ring + bar */}
      {fw.has_assessment ? (
        <>
          <div className="flex items-center gap-4">
            {/* Big score */}
            <div className="text-center">
              <p className={`text-3xl font-bold ${scoreColor(score)}`}>
                {score != null ? `${score}%` : "—"}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Compliance</p>
            </div>
            {/* Mini stats */}
            <div className="flex-1 space-y-2">
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                  <span>{t("compliance.controls")}</span>
                  <span className="font-medium">{fw.controls_implemented}/{fw.controls_total}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${scoreBg(score)}`}
                    style={{ width: `${score ?? 0}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                  <span>{t("dashboard.cert_readiness")}</span>
                  <span className="font-medium">{readiness != null ? `${readiness}%` : "—"}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${scoreBg(readiness)}`}
                    style={{ width: `${readiness ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer chips */}
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-50">
            {fw.open_gaps > 0 && (
              <span className="text-xs bg-orange-50 text-orange-600 border border-orange-100 px-2 py-0.5 rounded-lg font-medium">
                {t("dashboard.open_gaps_count", { count: fw.open_gaps })}
              </span>
            )}
            {fw.open_blockers > 0 && (
              <span className="text-xs bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-lg font-medium">
                🔴 {t("dashboard.blockers_count", { count: fw.open_blockers })}
              </span>
            )}
            {fw.open_gaps === 0 && (
              <span className="text-xs bg-green-50 text-green-600 border border-green-100 px-2 py-0.5 rounded-lg font-medium">
                ✓ {t("dashboard.no_open_gaps")}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
          <Shield className="w-8 h-8 text-gray-200 mb-2" />
          <p className="text-sm text-gray-400">{t("dashboard.no_assessment_yet")}</p>
          <p className="text-xs text-blue-500 mt-1 group-hover:underline">{t("dashboard.click_to_start")} →</p>
        </div>
      )}
    </button>
  );
}

// ── Framework Management Modal ────────────────────────────────────────────────

function FrameworkManagementModal({
  isOpen,
  onClose,
  currentFrameworkIds,
  primaryFrameworkId,
  onFrameworkAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentFrameworkIds: string[];
  primaryFrameworkId: string | null;
  onFrameworkAdded: () => void;
}) {
  const queryClient = useQueryClient();
  const [allFrameworks, setAllFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    loadFrameworks();
  }, [isOpen]);

  async function loadFrameworks() {
    try {
      setLoading(true);
      const fws = await frameworksApi.list();
      setAllFrameworks(fws);
      setSelectedId(null);
    } catch {
      setAllFrameworks([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddFramework() {
    if (!selectedId) return;
    setAdding(true);
    try {
      // Always read the live store value — the prop may be stale if the user
      // has already added a framework in this session without re-logging in.
      const liveIds = authSession.getUser()?.selected_framework_ids ?? currentFrameworkIds;
      const livePrimary = authSession.getUser()?.primary_framework_id ?? primaryFrameworkId;

      const updatedFrameworks = liveIds.includes(selectedId)
        ? liveIds
        : [...liveIds, selectedId];
      const primaryId = livePrimary || selectedId;

      const profile = await authApi.updateSelectedFrameworks(primaryId, updatedFrameworks);

      // Patch the auth store immediately so the next open of this modal
      // sees the correct (up-to-date) list and doesn't overwrite previous adds.
      authSession.patchUser({
        selected_framework_ids: profile.selected_framework_ids ?? updatedFrameworks,
        primary_framework_id: profile.primary_framework_id ?? primaryId,
      });

      // Auto-create an assessment for the new framework if it doesn't exist
      const selectedFramework = allFrameworks.find((fw) => fw.id === selectedId);
      if (selectedFramework && !liveIds.includes(selectedId)) {
        try {
          await complianceApi.createAssessment({
            framework_id: selectedId,
            name: `${selectedFramework.short_name} Assessment`,
            description: `Compliance assessment for ${selectedFramework.name}`,
            scope_description: `Assessment scope for ${selectedFramework.short_name} framework`,
          });
        } catch (err) {
          console.error("Failed to auto-create assessment:", err);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["compliance"] });

      onFrameworkAdded();
      onClose();
    } catch (err) {
      console.error("Failed to add framework:", err);
    } finally {
      setAdding(false);
    }
  }

  if (!isOpen) return null;

  const selectedFramework = allFrameworks.find((fw) => fw.id === selectedId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Add Framework</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Available frameworks list */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Select Framework</h3>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              </div>
            ) : allFrameworks.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">No frameworks available.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-2">
                {allFrameworks.map((fw) => (
                  <button
                    key={fw.id}
                    onClick={() => setSelectedId(fw.id)}
                    className={`p-3 border-2 rounded-lg transition-all text-left ${
                      selectedId === fw.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                    }`}
                  >
                    <p className="text-xs font-mono font-bold text-gray-600">{fw.short_name}</p>
                    <p className="text-sm font-medium text-gray-800 mt-0.5">{fw.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{fw.control_count ?? 0} controls</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected framework details */}
          {selectedFramework && (
            <div className="border-t border-gray-100 pt-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-600 font-medium mb-1">Selected:</p>
                <p className="text-sm font-semibold text-blue-900">{selectedFramework.name}</p>
                <p className="text-xs text-blue-700 mt-1">{selectedFramework.control_count ?? 0} controls</p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 font-medium text-sm rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddFramework}
              disabled={!selectedId || adding}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Framework
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Overview dashboard (Stage 1) ──────────────────────────────────────────────

function OverviewDashboard({
  overviewData,
  genericData,
  isDemo,
  onSelectFramework,
}: {
  overviewData: any;
  genericData: any;
  isDemo: boolean;
  onSelectFramework: (fwId: string) => void;
}) {
  const { t } = useTranslation();
  const d = genericData ?? DEMO_DATA;
  const frameworks: any[] = overviewData?.frameworks ?? [];
  const [showFrameworkModal, setShowFrameworkModal] = useState(false);
  const authUser = useAuthStore((state) => state);
  const currentFrameworkIds = authUser?.selected_framework_ids || [];
  const primaryFrameworkId = authUser?.primary_framework_id || null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("dashboard.grc_overview")}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {t("dashboard.frameworks_count", { count: frameworks.length })} · {t("dashboard.select_to_drill")}
          </p>
        </div>
        {isDemo && (
          <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
            <Activity className="w-3.5 h-3.5" /> Demo data
          </span>
        )}
      </div>

      {/* Framework cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          {t("dashboard.your_frameworks")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {frameworks.map((fw: any) => (
            <FrameworkOverviewCard
              key={fw.framework_id}
              fw={fw}
              onSelect={() => onSelectFramework(fw.framework_id)}
            />
          ))}
          {/* Add framework card */}
          <button
            onClick={() => setShowFrameworkModal(true)}
            className="group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all p-6 text-left flex flex-col gap-4 w-full min-h-[240px] items-center justify-center"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <Plus className="w-6 h-6 text-blue-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-800">{t("dashboard.add_framework")}</p>
                <p className="text-xs text-gray-400 mt-1">Select from available frameworks</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Framework management modal */}
      <FrameworkManagementModal
        isOpen={showFrameworkModal}
        onClose={() => setShowFrameworkModal(false)}
        currentFrameworkIds={currentFrameworkIds}
        primaryFrameworkId={primaryFrameworkId}
        onFrameworkAdded={() => {
          setShowFrameworkModal(false);
        }}
      />

      {/* Cross-module KPIs */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          {t("dashboard.platform_overview")}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title={t("dashboard.open_risks")} value={d.risk.total_open}
            subtitle={`${d.risk.critical} ${t("compliance.severities.critical")} · ${d.risk.high} ${t("compliance.severities.high")}`}
            icon={AlertTriangle} iconBg="bg-red-500" />
          <KpiCard title={t("dashboard.avg_compliance")} value={`${d.compliance.average_score}%`}
            subtitle={`${d.compliance.total_assessments} ${t("compliance.assessments")}`}
            icon={Shield} iconBg="bg-blue-500" />
          <KpiCard title={t("dashboard.open_audit_findings")} value={d.audit.open_findings}
            icon={ClipboardList} iconBg="bg-orange-500" />
          <KpiCard title={t("dashboard.policy_attestation")} value={`${d.policy.attestation_rate_percent}%`}
            subtitle={`${d.policy.total_attestations} ${t("dashboard.attestations")}`}
            icon={BookOpen} iconBg="bg-indigo-500" />
        </div>
      </div>
    </div>
  );
}

// ── Main dashboard page ───────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useTranslation();
  const primaryFrameworkId = useAuthStore((u) => u?.primary_framework_id);
  // null = overview, string = drilled into a specific framework
  const [selectedFwId, setSelectedFwId] = useState<string | null>(null);

  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ["dashboard", "frameworks-overview"],
    queryFn: dashboardApi.getFrameworksOverview,
    retry: false,
    enabled: !!primaryFrameworkId,
  });

  const { data: fwData, isLoading: fwLoading } = useQuery({
    queryKey: ["dashboard", "framework-summary", selectedFwId],
    queryFn: () => dashboardApi.getFrameworkSummary(selectedFwId ?? undefined),
    retry: false,
    enabled: !!selectedFwId,
  });

  const { data: genericData, isError: genericError } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: dashboardApi.getSummary,
    retry: false,
  });

  const isDemo = genericError || !genericData;

  // No framework set at all → onboarding
  if (!primaryFrameworkId) {
    return (
      <div className="p-8 max-w-5xl space-y-6">
        <WelcomeCard />
        <GenericDashboard d={genericData ?? DEMO_DATA} isDemo={isDemo} />
      </div>
    );
  }

  // Loading overview
  if (overviewLoading) {
    return (
      <div className="p-8 max-w-7xl">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-52 bg-gray-200 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  // Drilled into a framework
  if (selectedFwId) {
    if (fwLoading) {
      return (
        <div className="p-8 max-w-7xl">
          <div className="h-6 w-48 bg-gray-200 rounded animate-pulse mb-6" />
          <div className="grid grid-cols-5 gap-4 mb-6">
            {[1,2,3,4,5].map((i) => <div key={i} className="h-24 bg-gray-200 rounded-2xl animate-pulse" />)}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 h-64 bg-gray-200 rounded-2xl animate-pulse" />
            <div className="h-64 bg-gray-200 rounded-2xl animate-pulse" />
          </div>
        </div>
      );
    }

    // Find framework info from overview for the back button label
    const fwInfo = overviewData?.frameworks?.find((f: any) => f.framework_id === selectedFwId);

    return (
      <div className="p-8 max-w-7xl space-y-5">
        {/* Back to overview breadcrumb */}
        <button
          onClick={() => setSelectedFwId(null)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <LayoutDashboard className="w-4 h-4" />
          {t("dashboard.overview")}
          <span className="text-gray-300 mx-1">/</span>
          <span className="font-medium text-gray-800">{fwInfo?.framework_short_name ?? "Framework"}</span>
        </button>

        {fwData && fwData.has_assessment !== false ? (
          <FrameworkDashboard data={fwData} />
        ) : (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-10 text-center">
            <Shield className="w-10 h-10 text-blue-400 mx-auto mb-3" />
            <h2 className="font-semibold text-blue-900 mb-1">{t("dashboard.no_assessment_for_fw", { name: fwInfo?.framework_name })}</h2>
            <p className="text-blue-700 text-sm mb-4">{t("dashboard.create_assessment_desc")}</p>
            <Link to="/compliance"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl">
              <Plus className="w-4 h-4" /> {t("dashboard.start_assessment")}
            </Link>
          </div>
        )}
      </div>
    );
  }

  // Stage 1 — Overview
  return (
    <div className="p-8 max-w-7xl">
      <OverviewDashboard
        overviewData={overviewData}
        genericData={genericData}
        isDemo={isDemo}
        onSelectFramework={(fwId) => setSelectedFwId(fwId)}
      />
    </div>
  );
}

// ── Welcome card (shown when no framework set) ────────────────────────────────

function WelcomeCard() {
  const { t } = useTranslation();
  return (
    <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-7 text-white">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <Shield className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold mb-1">{t("dashboard.welcome_title")}</h1>
          <p className="text-blue-100 text-sm leading-relaxed max-w-2xl">
            {t("dashboard.welcome_desc")}
          </p>
        </div>
        <Link
          to="/help"
          className="flex-shrink-0 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          {t("dashboard.full_guide")} →
        </Link>
      </div>

      {/* Quick links */}
      <div className="mt-5 flex flex-wrap gap-2">
        {[
          { label: t("compliance.new_assessment"), href: "/compliance", icon: Plus },
          { label: t("nav.risks"),  href: "/risks",      icon: AlertTriangle },
          { label: t("nav.frameworks"),     href: "/frameworks",  icon: BookOpen },
          { label: t("nav.audits"),         href: "/audits",      icon: ClipboardList },
          { label: t("nav.policies"),       href: "/policies",    icon: FileText },
        ].map(({ label, href, icon: Icon }) => (
          <Link
            key={label}
            to={href}
            className="flex items-center gap-1.5 text-xs font-semibold bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
