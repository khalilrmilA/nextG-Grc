/**
 * CheatSheetPage — Visual Admin Panel
 * Route: /cheat
 *
 * A live admin overview that fetches real data from every module:
 * risks, compliance, frameworks, dashboard — displayed with cards,
 * charts, tables, and status badges.
 * Includes a secondary "API Tests" tab for quick endpoint checks.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import {
  ArrowLeft, RefreshCw, Shield, AlertTriangle, ClipboardList,
  BookOpen, FileText, CheckCircle, XCircle,
  Loader2, Play, ChevronDown, ChevronUp, ExternalLink,
  TrendingUp, Activity, Zap, Database, Eye,
} from "lucide-react";
import { apiClient } from "@/api/client";

// ── helpers ───────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const res = await apiClient.request<T>({ method: "GET", url: path });
  return res.data;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface DashSummary {
  risk: { total_open: number; critical: number; high: number; by_severity: Record<string, number> };
  compliance: { average_score: number | null; total_assessments: number; control_coverage_percent: number; controls_by_status: Record<string, number> };
  audit: { open_findings: number };
  vendor: { total_vendors: number };
  policy: { attestation_rate_percent: number; total_attestations: number };
}
interface RiskItem { id: string; title: string; severity: string; status: string; likelihood: number; impact: number; risk_category: string }
interface RiskPage { items: RiskItem[]; total: number }
interface HeatmapData { total_risks: number; by_severity: Record<string, number>; grid: Record<string, { id: string; title: string; severity: string }[]> }
interface FwItem { id: string; name: string; short_name: string; is_builtin: boolean; status: string; control_count: number }
interface AssessItem { id: string; name: string; framework_name: string; status: string; compliance_score: number | null; document_count: number }
interface AssessPage { items: AssessItem[]; total: number }

type LoadState<T> = { data: T | null; loading: boolean; error: string | null };

function useLoad<T>(fetcher: () => Promise<T>): LoadState<T> & { reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ data: null, loading: true, error: null });
  const load = useCallback(() => {
    setState(s => ({ ...s, loading: true, error: null }));
    fetcher()
      .then(data => setState({ data, loading: false, error: null }))
      .catch(e => setState({ data: null, loading: false, error: String(e?.response?.data?.detail ?? e?.message ?? e) }));
  }, [fetcher]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// ── small UI atoms ────────────────────────────────────────────────────────────

function Spinner() { return <Loader2 className="w-4 h-4 animate-spin text-slate-400" />; }

function SeverityBadge({ sev }: { readonly sev: string }) {
  const { t } = useTranslation();
  const cls =
    sev === "CRITICAL" || sev === "critical" ? "bg-red-100 text-red-700" :
    sev === "HIGH"     || sev === "high"     ? "bg-orange-100 text-orange-700" :
    sev === "MEDIUM"   || sev === "medium"   ? "bg-yellow-100 text-yellow-700" :
                                               "bg-green-100 text-green-700";
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase ${cls}`}>{t(`vocab.${sev.toLowerCase()}`, { defaultValue: sev })}</span>;
}

function StatusBadge({ status }: { readonly status: string }) {
  const { t } = useTranslation();
  const s = status.toLowerCase().replace(/_/g, " ");
  const cls =
    s === "active" || s === "implemented" || s === "completed" ? "bg-green-100 text-green-700" :
    s === "in progress" || s === "treatment in progress"       ? "bg-blue-100 text-blue-700"   :
    s === "draft"                                              ? "bg-gray-100 text-gray-600"   :
    s === "identified" || s === "open"                        ? "bg-red-100 text-red-700"     :
                                                                "bg-slate-100 text-slate-600";
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${cls}`}>{t(`vocab.${status.toLowerCase()}`, { defaultValue: s })}</span>;
}

function ScoreBadge({ score }: { readonly score: number | null }) {
  if (score == null) return <span className="text-xs text-slate-400">—</span>;
  const cls = score >= 80 ? "text-green-600" : score >= 60 ? "text-yellow-600" : "text-red-600";
  return <span className={`text-sm font-bold ${cls}`}>{score.toFixed(0)}%</span>;
}

function ProgressBar({ value, color = "bg-blue-500" }: { readonly value: number; readonly color?: string }) {
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

function Card({ children, className = "" }: { readonly children: React.ReactNode; readonly className?: string }) {
  return <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`}>{children}</div>;
}

function CardHeader({ title, subtitle, action }: { readonly title: string; readonly subtitle?: string; readonly action?: React.ReactNode }) {
  return (
    <div className="px-5 pt-5 pb-4 flex items-start justify-between">
      <div>
        <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, bg, badge, badgePos }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; bg: string;
  badge?: string; badgePos?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bg}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {badge && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
            badgePos ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>
            <TrendingUp className="w-3 h-3" />
            {badge}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Card>
  );
}

// ── section: overview ─────────────────────────────────────────────────────────

const PIE_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#e5e7eb"];

const CustomTip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; fill: string; stroke: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill || p.stroke }} />
          <span className="text-gray-500 capitalize">{p.name}:</span>
          <span className="font-semibold text-gray-800">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

function OverviewTab({ dash }: { readonly dash: LoadState<DashSummary> & { reload: () => void } }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith("fr") ? "fr-FR" : i18n.language.startsWith("ar") ? "ar-u-nu-latn" : "en-US";
  // Simulated trend: Aug → Jan, month names follow the interface language.
  const month = (m: number) => new Date(2025, m, 1).toLocaleString(locale, { month: "short" });
  const d = dash.data;
  const totalControls = d ? Object.values(d.compliance.controls_by_status).reduce((a, b) => a + b, 0) : 0;
  const implPct = totalControls > 0 && d ? Math.round((d.compliance.controls_by_status["implemented"] ?? 0) / totalControls * 100) : 0;
  const pieData = d ? [
    { name: t("vocab.implemented"), value: d.compliance.controls_by_status["implemented"] ?? 0 },
    { name: t("vocab.in_progress"), value: d.compliance.controls_by_status["in_progress"] ?? 0 },
    { name: t("vocab.not_started"), value: d.compliance.controls_by_status["not_started"] ?? 0 },
    { name: t("dashboard.na"), value: d.compliance.controls_by_status["not_applicable"] ?? 0 },
  ] : [];

  if (dash.loading) return (
    <div className="flex items-center justify-center py-20"><Spinner /></div>
  );
  if (dash.error || !d) return (
    <div className="py-16 text-center text-slate-400">
      <XCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
      <p className="text-sm">{dash.error ?? t("common.no_data")}</p>
      <button onClick={dash.reload} className="mt-3 text-xs text-blue-600 hover:underline">{t("common.retry")}</button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={t("cheatsheet.kpi_open_risks")} value={d.risk.total_open}
          sub={t("cheatsheet.kpi_open_risks_sub", { critical: d.risk.critical, high: d.risk.high })}
          icon={AlertTriangle} bg="bg-red-500" badge="-12%" badgePos={true} />
        <Kpi label={t("cheatsheet.kpi_compliance_score")} value={d.compliance.average_score != null ? `${d.compliance.average_score}%` : "—"}
          sub={t("cheatsheet.kpi_assessments_sub", { count: d.compliance.total_assessments })}
          icon={Shield} bg="bg-blue-500" badge="+4.2%" badgePos={true} />
        <Kpi label={t("cheatsheet.kpi_open_findings")} value={d.audit.open_findings}
          sub={t("cheatsheet.kpi_open_findings_sub")}
          icon={ClipboardList} bg="bg-orange-500" badge="+2" badgePos={false} />
        <Kpi label={t("cheatsheet.kpi_policy_attestation")} value={`${d.policy.attestation_rate_percent}%`}
          sub={t("cheatsheet.kpi_attestations_sub", { count: d.policy.total_attestations })}
          icon={FileText} bg="bg-emerald-500" badge="+6.1%" badgePos={true} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Risk by severity bar */}
        <Card className="lg:col-span-2">
          <CardHeader title={t("cheatsheet.severity_breakdown")} subtitle={t("cheatsheet.severity_breakdown_sub")} />
          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={[{
                name: t("cheatsheet.now"),
                critical: d.risk.by_severity["critical"] ?? 0,
                high: d.risk.by_severity["high"] ?? 0,
                medium: d.risk.by_severity["medium"] ?? 0,
                low: d.risk.by_severity["low"] ?? 0,
              }]} barSize={40}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTip />} />
                <Bar dataKey="critical" name={t("vocab.critical")} fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="high" name={t("vocab.high")} fill="#f97316" radius={[4, 4, 0, 0]} />
                <Bar dataKey="medium" name={t("vocab.medium")} fill="#eab308" radius={[4, 4, 0, 0]} />
                <Bar dataKey="low" name={t("vocab.low")} fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Control coverage donut */}
        <Card>
          <CardHeader title={t("cheatsheet.control_coverage")} subtitle={t("cheatsheet.control_coverage_sub")} />
          <div className="px-5 pb-5">
            <div className="flex justify-center mb-3">
              <div className="relative w-36 h-36">
                <ResponsiveContainer width={144} height={144}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={62}
                      paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-gray-900">{implPct}%</span>
                  <span className="text-xs text-gray-400">{t("cheatsheet.done")}</span>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              {pieData.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-gray-500">{item.name}</span>
                  </div>
                  <span className="font-semibold text-gray-700">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Compliance score area chart (simulated trend) */}
      <Card>
        <CardHeader
          title={t("cheatsheet.score_trend")}
          subtitle={t("cheatsheet.score_trend_sub")}
          action={<span className="text-2xl font-bold text-blue-600">{d.compliance.average_score ?? "—"}%</span>}
        />
        <div className="px-5 pb-5">
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={[
              { m: month(7), v: 58 }, { m: month(8), v: 62 }, { m: month(9), v: 65 },
              { m: month(10), v: 68 }, { m: month(11), v: 71 }, { m: month(0), v: d.compliance.average_score ?? 72 },
            ]}>
              <defs>
                <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="m" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} domain={[50, 100]} />
              <Tooltip content={<CustomTip />} />
              <Area type="monotone" dataKey="v" name={t("cheatsheet.score")} stroke="#3b82f6" strokeWidth={2}
                fill="url(#cg)" dot={{ fill: "#3b82f6", r: 3 }} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

// ── section: risks ────────────────────────────────────────────────────────────

function RisksTab({
  risks, heatmap,
}: {
  readonly risks: LoadState<RiskPage> & { reload: () => void };
  readonly heatmap: LoadState<HeatmapData> & { reload: () => void };
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="space-y-5">
      {/* Heatmap summary */}
      <Card>
        <CardHeader title={t("cheatsheet.heatmap_summary")} subtitle={t("cheatsheet.heatmap_summary_sub")}
          action={
            <button onClick={() => navigate("/risks")}
              className="text-xs text-blue-600 flex items-center gap-1 hover:underline">
              {t("cheatsheet.open_register")} <ExternalLink className="w-3 h-3 rtl:-scale-x-100" />
            </button>
          }
        />
        {heatmap.loading ? (
          <div className="px-5 pb-5 flex items-center gap-2 text-slate-400 text-sm"><Spinner /> {t("common.loading")}</div>
        ) : heatmap.data ? (
          <div className="px-5 pb-5">
            <div className="grid grid-cols-5 gap-1 mb-4">
              {[5, 4, 3, 2, 1].map(impact => (
                [1, 2, 3, 4, 5].map(likelihood => {
                  const key = `${likelihood}_${impact}`;
                  const cell = heatmap.data!.grid[key] ?? [];
                  const score = likelihood * impact;
                  const bg = score >= 20 ? "bg-red-200 border-red-300" :
                             score >= 12 ? "bg-orange-200 border-orange-300" :
                             score >= 6  ? "bg-yellow-200 border-yellow-300" :
                                           "bg-green-100 border-green-200";
                  return (
                    <div key={key} className={`rounded-lg border p-1.5 min-h-[48px] flex flex-col items-center justify-center ${bg}`}>
                      {cell.length > 0 && (
                        <span className="text-xs font-bold text-gray-700">{cell.length}</span>
                      )}
                    </div>
                  );
                })
              ))}
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{t("cartography.likelihood_axis")} →</span>
              <div className="flex gap-3">
                {[
                  { label: t("vocab.critical"), cls: "bg-red-200" },
                  { label: t("vocab.high"), cls: "bg-orange-200" },
                  { label: t("vocab.medium"), cls: "bg-yellow-200" },
                  { label: t("vocab.low"), cls: "bg-green-100" },
                ].map(({ label, cls }) => (
                  <span key={label} className="flex items-center gap-1">
                    <span className={`w-3 h-3 rounded ${cls}`} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 pb-5 text-sm text-slate-400">{heatmap.error}</div>
        )}
      </Card>

      {/* Risk list */}
      <Card>
        <CardHeader
          title={t("cheatsheet.risk_register_title", { total: risks.data?.total ?? "…" })}
          subtitle={t("cheatsheet.live_from", { endpoint: "/risks" })}
          action={
            <button onClick={risks.reload} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-gray-50">
                {[t("cheatsheet.col_title"), t("common.category"), t("cheatsheet.col_lxi"), t("common.severity"), t("common.status")].map(h => (
                  <th key={h} className="text-start px-5 py-2.5 text-xs font-semibold text-gray-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {risks.loading ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400"><Spinner /></td></tr>
              ) : risks.data?.items.map((r, i) => (
                <tr key={r.id} className={`border-t border-gray-50 hover:bg-gray-50 ${i % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                  <td className="px-5 py-3 font-medium text-gray-800 max-w-xs truncate">{r.title}</td>
                  <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{r.risk_category}</td>
                  <td className="px-5 py-3 text-gray-700 font-mono whitespace-nowrap">{r.likelihood}×{r.impact}={r.likelihood * r.impact}</td>
                  <td className="px-5 py-3"><SeverityBadge sev={r.severity} /></td>
                  <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!risks.loading && (risks.data?.items?.length ?? 0) === 0 && (
            <p className="text-center py-10 text-sm text-slate-400">{t("cheatsheet.no_risks")} <code>python seed.py</code></p>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── section: compliance ───────────────────────────────────────────────────────

function ComplianceTab({ assessments }: { readonly assessments: LoadState<AssessPage> & { reload: () => void } }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader
        title={t("cheatsheet.assessments_title", { total: assessments.data?.total ?? "…" })}
        subtitle={t("cheatsheet.live_from", { endpoint: "/compliance/assessments" })}
        action={
          <div className="flex gap-2">
            <button onClick={assessments.reload} className="text-gray-400 hover:text-gray-600"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={() => navigate("/compliance")}
              className="text-xs text-blue-600 flex items-center gap-1 hover:underline">
              {t("cartography.open")} <ExternalLink className="w-3 h-3 rtl:-scale-x-100" />
            </button>
          </div>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-gray-50">
              {[t("cheatsheet.col_assessment"), t("cheatsheet.col_framework"), t("cheatsheet.col_score"), t("common.status"), t("cheatsheet.col_docs"), ""].map(h => (
                <th key={h} className="text-start px-5 py-2.5 text-xs font-semibold text-gray-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assessments.loading ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center"><Spinner /></td></tr>
            ) : assessments.data?.items.map((a, i) => (
              <tr key={a.id} className={`border-t border-gray-50 hover:bg-gray-50 ${i % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                <td className="px-5 py-3 font-medium text-gray-800 max-w-xs">
                  <div className="truncate">{a.name}</div>
                  <div className="mt-1"><ProgressBar value={a.compliance_score ?? 0} color={
                    (a.compliance_score ?? 0) >= 80 ? "bg-green-500" :
                    (a.compliance_score ?? 0) >= 60 ? "bg-yellow-400" : "bg-red-400"
                  } /></div>
                </td>
                <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{a.framework_name}</td>
                <td className="px-5 py-3 whitespace-nowrap"><ScoreBadge score={a.compliance_score} /></td>
                <td className="px-5 py-3"><StatusBadge status={a.status} /></td>
                <td className="px-5 py-3 text-gray-400 text-xs">{t("cheatsheet.docs_count", { count: a.document_count })}</td>
                <td className="px-5 py-3">
                  <button onClick={() => navigate(`/compliance/${a.id}`)}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    {t("common.view")} <Eye className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!assessments.loading && (assessments.data?.items?.length ?? 0) === 0 && (
          <p className="text-center py-10 text-sm text-slate-400">{t("cheatsheet.no_assessments")} <code>python seed.py</code></p>
        )}
      </div>
    </Card>
  );
}

// ── section: frameworks ───────────────────────────────────────────────────────

function FrameworksTab({ frameworks }: { readonly frameworks: LoadState<FwItem[]> & { reload: () => void } }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {frameworks.loading && (
        <div className="col-span-3 flex items-center justify-center py-16"><Spinner /></div>
      )}
      {frameworks.data?.map(fw => (
        <Card key={fw.id} className="p-5 hover:shadow-md transition-shadow cursor-pointer"
          // @ts-expect-error Card wraps a div, onClick is valid here
          onClick={() => navigate("/framework")}>
          <div className="flex items-start justify-between mb-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${fw.is_builtin ? "bg-blue-100" : "bg-purple-100"}`}>
              <BookOpen className={`w-4 h-4 ${fw.is_builtin ? "text-blue-600" : "text-purple-600"}`} />
            </div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${fw.is_builtin ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>
              {fw.is_builtin ? t("frameworks.builtin") : t("frameworks.tenant")}
            </span>
          </div>
          <p className="font-semibold text-gray-900 text-sm leading-snug">{fw.name}</p>
          <p className="text-xs text-gray-400 mt-0.5 font-mono">{fw.short_name}</p>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
            <span className="text-xs text-gray-500">{t("cheatsheet.controls_count", { count: fw.control_count })}</span>
            <StatusBadge status={fw.status} />
          </div>
        </Card>
      ))}
      {/* Add new */}
      <Card className="p-5 border-dashed border-2 border-gray-200 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
        // @ts-expect-error onClick is valid on div
        onClick={() => navigate("/framework/custom/new")}>
        <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
          <Zap className="w-4 h-4 text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-400">{t("cheatsheet.build_custom")}</p>
      </Card>
    </div>
  );
}

// ── section: api tests ────────────────────────────────────────────────────────

type TestResult = {
  name: string; status: "idle" | "running" | "pass" | "fail";
  method: string; url: string; response?: unknown; duration?: number;
};

function TestBadge({ status }: { readonly status: TestResult["status"] }) {
  if (status === "idle")    return <span className="text-xs text-gray-300">—</span>;
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />;
  if (status === "pass")    return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
  return <XCircle className="w-3.5 h-3.5 text-red-500" />;
}

// Test names double as upsert keys, so they stay English in the suites; the
// row label is translated here (code-like names such as "GET /x" stay as-is).
const TEST_NAME_KEYS: Record<string, string> = {
  "Reject bad password": "reject_bad_password",
  "List risks": "list_risks",
  "Create CRITICAL risk (L4×I5)": "create_critical_risk",
  "Create LOW risk (L1×I2)": "create_low_risk",
  "Patch risk → accepted": "patch_risk_accepted",
  "List frameworks": "list_frameworks",
  "Create custom framework": "create_custom_framework",
  "Add control": "add_control",
  "Add requirement": "add_requirement",
  "List assessments": "list_assessments",
};

function TestRow({ r }: { readonly r: TestResult }) {
  const { t } = useTranslation();
  const login = r.name.match(/^Login (.+)$/);
  const label = login
    ? t("cheatsheet.test.login", { email: login[1] })
    : TEST_NAME_KEYS[r.name] ? t(`cheatsheet.test.${TEST_NAME_KEYS[r.name]}`) : r.name;
  const [open, setOpen] = useState(false);
  const bg = r.status === "pass" ? "bg-green-50/50 border-green-100" :
             r.status === "fail" ? "bg-red-50/50 border-red-100" : "bg-white border-gray-50";
  return (
    <div className={`rounded-lg border ${bg} px-4 py-2.5`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TestBadge status={r.status} />
          <span className="text-sm font-medium text-gray-700 truncate">{label}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
            r.method === "GET" ? "bg-blue-100 text-blue-700" :
            r.method === "POST" ? "bg-green-100 text-green-700" :
            r.method === "PATCH" ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
          }`}>{r.method}</span>
          <span className="text-xs text-gray-300 font-mono hidden sm:block">{r.url}</span>
          {r.duration != null && <span className="text-xs text-gray-300">{r.duration}ms</span>}
          {r.response != null && (
            <button onClick={() => setOpen(!open)} className="text-gray-300 hover:text-gray-500">
              {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
      {open && r.response != null && (
        <pre className="mt-2 p-2 bg-gray-950 text-emerald-400 rounded text-xs overflow-auto max-h-40">
          {JSON.stringify(r.response, null, 2)}
        </pre>
      )}
    </div>
  );
}

async function runCall(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ data: unknown; status: number; ms: number }> {
  const t0 = Date.now();
  try {
    const res = await apiClient.request({ method, url: path, data: body });
    return { data: res.data, status: res.status, ms: Date.now() - t0 };
  } catch (e: unknown) {
    const err = e as { response?: { data: unknown; status: number } };
    return { data: err.response?.data, status: err.response?.status ?? 0, ms: Date.now() - t0 };
  }
}

const TEST_SUITES = [
  {
    id: "auth", label: "Auth",
    run: async (set: (r: TestResult) => void) => {
      for (const [name, email, pw, expectOk] of [
        ["Login admin@demo.com", "admin@demo.com", "demo123", true],
        ["Login ciso@demo.com", "ciso@demo.com", "demo123", true],
        ["Reject bad password", "fake@x.com", "wrong", false],
      ] as const) {
        set({ name, status: "running", method: "POST", url: "/auth/login" });
        const r = await runCall("POST", "/auth/login", { email, password: pw });
        const pass = expectOk ? "access_token" in (r.data as object ?? {}) : r.status === 422 || r.status === 401;
        set({ name, status: pass ? "pass" : "fail", method: "POST", url: "/auth/login", response: r.data, duration: r.ms });
      }
    },
  },
  {
    id: "dashboard", label: "Dashboard",
    run: async (set: (r: TestResult) => void) => {
      set({ name: "GET /dashboard/summary", status: "running", method: "GET", url: "/dashboard/summary" });
      const r = await runCall("GET", "/dashboard/summary");
      const pass = !!r.data && "risk" in (r.data as object) && "compliance" in (r.data as object);
      set({ name: "GET /dashboard/summary", status: pass ? "pass" : "fail", method: "GET", url: "/dashboard/summary", response: r.data, duration: r.ms });
    },
  },
  {
    id: "risks", label: "Risks",
    run: async (set: (r: TestResult) => void) => {
      let id = "";
      // list
      set({ name: "List risks", status: "running", method: "GET", url: "/risks" });
      const list = await runCall("GET", "/risks");
      set({ name: "List risks", status: Array.isArray((list.data as { items: unknown[] })?.items) ? "pass" : "fail", method: "GET", url: "/risks", response: list.data, duration: list.ms });
      // create critical
      set({ name: "Create CRITICAL risk (L4×I5)", status: "running", method: "POST", url: "/risks" });
      const cr = await runCall("POST", "/risks", { title: "Cheat-test XSS", risk_category: "Application", likelihood: 4, impact: 5 });
      id = (cr.data as { id: string })?.id ?? "";
      set({ name: "Create CRITICAL risk (L4×I5)", status: (cr.data as { severity: string })?.severity === "CRITICAL" ? "pass" : "fail", method: "POST", url: "/risks", response: cr.data, duration: cr.ms });
      // create low
      set({ name: "Create LOW risk (L1×I2)", status: "running", method: "POST", url: "/risks" });
      const low = await runCall("POST", "/risks", { title: "Minor log verbosity", risk_category: "Technical", likelihood: 1, impact: 2 });
      set({ name: "Create LOW risk (L1×I2)", status: (low.data as { severity: string })?.severity === "LOW" ? "pass" : "fail", method: "POST", url: "/risks", response: low.data, duration: low.ms });
      // patch
      if (id) {
        set({ name: "Patch risk → accepted", status: "running", method: "PATCH", url: `/risks/${id}` });
        const pt = await runCall("PATCH", `/risks/${id}`, { status: "accepted" });
        set({ name: "Patch risk → accepted", status: (pt.data as { status: string })?.status === "accepted" ? "pass" : "fail", method: "PATCH", url: `/risks/${id}`, response: pt.data, duration: pt.ms });
      }
      // heatmap
      set({ name: "GET /risks/heatmap/data", status: "running", method: "GET", url: "/risks/heatmap/data" });
      const hm = await runCall("GET", "/risks/heatmap/data");
      set({ name: "GET /risks/heatmap/data", status: typeof (hm.data as { total_risks: number })?.total_risks === "number" ? "pass" : "fail", method: "GET", url: "/risks/heatmap/data", response: hm.data, duration: hm.ms });
    },
  },
  {
    id: "frameworks", label: "Frameworks",
    run: async (set: (r: TestResult) => void) => {
      let fwId = "", ctrlId = "";
      set({ name: "List frameworks", status: "running", method: "GET", url: "/frameworks" });
      const list = await runCall("GET", "/frameworks");
      set({ name: "List frameworks", status: Array.isArray(list.data) ? "pass" : "fail", method: "GET", url: "/frameworks", response: list.data, duration: list.ms });
      set({ name: "Create custom framework", status: "running", method: "POST", url: "/frameworks" });
      const fw = await runCall("POST", "/frameworks", { name: "Cheat Test FW", short_name: "CTFW", version: "1.0", description: "Auto-test" });
      fwId = (fw.data as { id: string })?.id ?? "";
      set({ name: "Create custom framework", status: !!fwId ? "pass" : "fail", method: "POST", url: "/frameworks", response: fw.data, duration: fw.ms });
      if (fwId) {
        set({ name: "Add control", status: "running", method: "POST", url: `/frameworks/${fwId}/controls` });
        const ctrl = await runCall("POST", `/frameworks/${fwId}/controls`, { control_id: "CT-1", title: "Test Control", category: "technical", description: "Auto" });
        ctrlId = (ctrl.data as { id: string })?.id ?? "";
        set({ name: "Add control", status: !!ctrlId ? "pass" : "fail", method: "POST", url: `/frameworks/${fwId}/controls`, response: ctrl.data, duration: ctrl.ms });
      }
      if (fwId && ctrlId) {
        set({ name: "Add requirement", status: "running", method: "POST", url: `/frameworks/${fwId}/controls/${ctrlId}/requirements` });
        const req = await runCall("POST", `/frameworks/${fwId}/controls/${ctrlId}/requirements`, { requirement_text: "Auto req", level: "must" });
        set({ name: "Add requirement", status: !!(req.data as { level: string })?.level ? "pass" : "fail", method: "POST", url: `/frameworks/${fwId}/controls/${ctrlId}/requirements`, response: req.data, duration: req.ms });
      }
    },
  },
  {
    id: "compliance", label: "Compliance",
    run: async (set: (r: TestResult) => void) => {
      set({ name: "List assessments", status: "running", method: "GET", url: "/compliance/assessments" });
      const list = await runCall("GET", "/compliance/assessments");
      set({ name: "List assessments", status: "items" in (list.data as object ?? {}) ? "pass" : "fail", method: "GET", url: "/compliance/assessments", response: list.data, duration: list.ms });
    },
  },
  {
    id: "ai", label: "AI",
    run: async (set: (r: TestResult) => void) => {
      for (const url of ["/ai/health", "/ai/models"]) {
        set({ name: `GET ${url}`, status: "running", method: "GET", url });
        const r = await runCall("GET", url);
        set({ name: `GET ${url}`, status: r.status === 200 ? "pass" : "fail", method: "GET", url, response: r.data, duration: r.ms });
      }
    },
  },
];

function ApiTestsTab() {
  const { t } = useTranslation();
  const suiteLabel = (id: string) => t(`cheatsheet.suite.${id}`, { defaultValue: TEST_SUITES.find(s => s.id === id)?.label ?? id });
  const [results, setResults] = useState<Record<string, TestResult[]>>({});
  const [running, setRunning] = useState(false);
  const [activeId, setActiveId] = useState("risks");
  const [summary, setSummary] = useState<{ pass: number; fail: number } | null>(null);

  function upsert(section: string, r: TestResult) {
    setResults(prev => {
      const list = prev[section] ?? [];
      const idx = list.findIndex(x => x.name === r.name);
      const next = idx >= 0 ? list.map((x, i) => i === idx ? r : x) : [...list, r];
      return { ...prev, [section]: next };
    });
  }

  async function runSuite(suiteId: string) {
    setRunning(true);
    setSummary(null);
    setResults(prev => ({ ...prev, [suiteId]: [] }));
    const suite = TEST_SUITES.find(s => s.id === suiteId);
    if (suite) await suite.run(r => upsert(suiteId, r));
    setRunning(false);
  }

  async function runAll() {
    setRunning(true);
    setSummary(null);
    setResults({});
    for (const suite of TEST_SUITES) {
      setActiveId(suite.id);
      await suite.run(r => upsert(suite.id, r));
    }
    setRunning(false);
    // tally — delay one tick so state has settled
    setTimeout(() => {
      setResults(prev => {
        const all = Object.values(prev).flat();
        setSummary({ pass: all.filter(r => r.status === "pass").length, fail: all.filter(r => r.status === "fail").length });
        return prev;
      });
    }, 50);
  }

  const sectionResults = results[activeId] ?? [];

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{t("cheatsheet.tests_intro")}</p>
        <button onClick={runAll} disabled={running}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          {running ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("cheatsheet.running")}</> : <><Play className="w-4 h-4 rtl:-scale-x-100" /> {t("cheatsheet.run_all")}</>}
        </button>
      </div>

      {summary && (
        <div className={`rounded-xl p-4 flex items-center gap-3 ${summary.fail === 0 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          {summary.fail === 0 ? <CheckCircle className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-600" />}
          <div>
            <p className={`font-semibold text-sm ${summary.fail === 0 ? "text-green-800" : "text-red-800"}`}>
              {summary.fail === 0 ? t("cheatsheet.all_passed") : t("cheatsheet.n_failed", { count: summary.fail })}
            </p>
            <p className="text-xs text-gray-500">{t("cheatsheet.pass_fail", { pass: summary.pass, fail: summary.fail })}</p>
          </div>
        </div>
      )}

      <Card>
        {/* Suite tabs */}
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TEST_SUITES.map(s => {
            const sr = results[s.id] ?? [];
            const pass = sr.filter(r => r.status === "pass").length;
            const fail = sr.filter(r => r.status === "fail").length;
            return (
              <button key={s.id} onClick={() => setActiveId(s.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeId === s.id ? "border-blue-500 text-blue-700 bg-blue-50/50" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}>
                {suiteLabel(s.id)}
                {sr.length > 0 && (
                  <span className={`ms-1.5 text-xs px-1.5 py-0.5 rounded-full ${fail > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                    {pass}/{sr.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Section header */}
        <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">{t("cheatsheet.suite_tests", { suite: suiteLabel(activeId) })}</span>
          <button onClick={() => runSuite(activeId)} disabled={running}
            className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> {t("cheatsheet.run_suite", { suite: suiteLabel(activeId) })}
          </button>
        </div>

        {/* Results */}
        <div className="p-4 space-y-2">
          {sectionResults.length === 0 ? (
            <div className="text-center py-10 text-gray-300">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{t("cheatsheet.press_run", { suite: suiteLabel(activeId) })}</p>
            </div>
          ) : (
            sectionResults.map(r => <TestRow key={r.name} r={r} />)
          )}
        </div>
      </Card>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

// `label` is an i18n key, resolved with t() at render time.
const TABS = [
  { id: "overview",    label: "cheatsheet.tab.overview",    icon: Activity },
  { id: "risks",       label: "cheatsheet.tab.risks",       icon: AlertTriangle },
  { id: "compliance",  label: "nav.compliance",             icon: Shield },
  { id: "frameworks",  label: "nav.frameworks",             icon: BookOpen },
  { id: "tests",       label: "cheatsheet.tab.tests",       icon: Zap },
] as const;

type TabId = typeof TABS[number]["id"];

export default function CheatSheetPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("overview");

  const fetchDash = useCallback(() => apiFetch<DashSummary>("/dashboard/summary"), []);
  const fetchRisks = useCallback(() => apiFetch<RiskPage>("/risks?page_size=50"), []);
  const fetchHeatmap = useCallback(() => apiFetch<HeatmapData>("/risks/heatmap/data"), []);
  const fetchFrameworks = useCallback(() => apiFetch<FwItem[]>("/frameworks"), []);
  const fetchAssessments = useCallback(() => apiFetch<AssessPage>("/compliance/assessments?page_size=50"), []);

  const dash = useLoad(fetchDash);
  const risks = useLoad(fetchRisks);
  const heatmap = useLoad(fetchHeatmap);
  const frameworks = useLoad(fetchFrameworks);
  const assessments = useLoad(fetchAssessments);

  function reloadAll() {
    dash.reload(); risks.reload(); heatmap.reload();
    frameworks.reload(); assessments.reload();
  }

  return (
    <div className="p-6 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => navigate("/dashboard")}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-2">
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {t("nav.dashboard")}
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{t("cheatsheet.title")}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{t("cheatsheet.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reloadAll}
            className="flex items-center gap-1.5 text-sm text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors">
            <RefreshCw className="w-4 h-4" /> {t("common.refresh")}
          </button>
          <a href="http://localhost:8000/api/v1/docs" target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg transition-colors font-medium">
            <ExternalLink className="w-4 h-4" /> Swagger
          </a>
        </div>
      </div>

      {/* Quick module nav */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: t("nav.compliance"), path: "/compliance", color: "bg-blue-50 text-blue-700 hover:bg-blue-100" },
          { label: t("nav.risks"), path: "/risks", color: "bg-red-50 text-red-700 hover:bg-red-100" },
          { label: t("nav.frameworks"), path: "/framework", color: "bg-purple-50 text-purple-700 hover:bg-purple-100" },
          { label: t("cheatsheet.custom_framework"), path: "/framework/custom/new", color: "bg-violet-50 text-violet-700 hover:bg-violet-100" },
          { label: t("nav.vendors"), path: "/vendors", color: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" },
          { label: t("nav.policies"), path: "/policies", color: "bg-amber-50 text-amber-700 hover:bg-amber-100" },
          { label: t("nav.audits"), path: "/audits", color: "bg-orange-50 text-orange-700 hover:bg-orange-100" },
        ].map(({ label, path, color }) => (
          <button key={path} onClick={() => navigate(path)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${color}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Seed reminder */}
      <div className="bg-slate-900 rounded-xl p-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Database className="w-4 h-4 text-slate-400" />
            <p className="text-sm font-semibold text-slate-200">{t("cheatsheet.seed_title")}</p>
          </div>
          <code className="text-xs text-emerald-400 font-mono">cd d:/GRC/backend &amp;&amp; python seed.py</code>
          <p className="text-xs text-slate-500 mt-1">{t("cheatsheet.seed_desc")}</p>
        </div>
        <div className="flex gap-4">
          {[
            { role: t("cheatsheet.role_admin"), email: "admin@demo.com" },
            { role: t("company_admin.roles.ciso_label"),  email: "ciso@demo.com" },
          ].map(c => (
            <div key={c.email}>
              <p className="text-xs text-slate-500">{c.role}</p>
              <p className="text-xs font-mono text-emerald-400">{c.email}</p>
              <p className="text-xs font-mono text-slate-400">demo123</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 gap-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === id ? "border-blue-500 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            <Icon className="w-3.5 h-3.5" />
            {t(label)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview"   && <OverviewTab dash={dash} />}
      {tab === "risks"      && <RisksTab risks={risks} heatmap={heatmap} />}
      {tab === "compliance" && <ComplianceTab assessments={assessments} />}
      {tab === "frameworks" && <FrameworksTab frameworks={frameworks} />}
      {tab === "tests"      && <ApiTestsTab />}
    </div>
  );
}

