import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";
import {
  AlertTriangle, ClipboardList, Building2,
  FileText, Activity, Shield, TrendingUp, TrendingDown,
  ArrowUpRight, Plus, ChevronRight
} from "lucide-react";
import { dashboardApi } from "../api/endpoints";
import type { DashboardSummary } from "../types";

const RISK_TREND = [
  { month: "Aug", critical: 5, high: 12, medium: 14, low: 6 },
  { month: "Sep", critical: 4, high: 10, medium: 13, low: 5 },
  { month: "Oct", critical: 4, high: 11, medium: 11, low: 6 },
  { month: "Nov", critical: 3, high: 9, medium: 10, low: 5 },
  { month: "Dec", critical: 3, high: 8, medium: 10, low: 4 },
  { month: "Jan", critical: 3, high: 8, medium: 9, low: 4 },
];

const COMPLIANCE_TREND = [
  { month: "Aug", score: 58 },
  { month: "Sep", score: 62 },
  { month: "Oct", score: 65 },
  { month: "Nov", score: 68 },
  { month: "Dec", score: 71 },
  { month: "Jan", score: 72.5 },
];

const CONTROL_COLORS = ["#22c55e", "#3b82f6", "#d1d5db", "#f3f4f6"];

function KpiCard({ title, value, subtitle, icon: Icon, iconBg, change, changePositive }: {
  title: string; value: string | number; subtitle?: string;
  icon: React.ElementType; iconBg: string;
  change?: string; changePositive?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${iconBg}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {change && (
          <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
            changePositive ? "text-green-700 bg-green-50" : "text-red-700 bg-red-50"
          }`}>
            {changePositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {change}
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-500 mt-1">{title}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill || p.stroke }} />
          <span className="text-gray-500 capitalize">{p.name}:</span>
          <span className="font-semibold text-gray-800">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

const DEMO_DATA: DashboardSummary = {
  risk: { total_open: 24, critical: 3, high: 8, by_severity: { critical: 3, high: 8, medium: 9, low: 4 } },
  compliance: { average_score: 72.5, total_assessments: 4, control_coverage_percent: 68.3, controls_by_status: { implemented: 89, in_progress: 24, not_started: 31, not_applicable: 8 } },
  audit: { open_findings: 7 },
  vendor: { total_vendors: 18 },
  policy: { attestation_rate_percent: 84.2, total_attestations: 142 },
};

const VENDOR_TIERS = [
  { label: "Critical", count: 2, bar: "bg-red-500", badge: "text-red-700 bg-red-50" },
  { label: "High", count: 5, bar: "bg-orange-500", badge: "text-orange-700 bg-orange-50" },
  { label: "Medium", count: 8, bar: "bg-yellow-500", badge: "text-yellow-700 bg-yellow-50" },
  { label: "Low", count: 3, bar: "bg-green-500", badge: "text-green-700 bg-green-50" },
];

const ASSESSMENTS_PREVIEW = [
  { name: "ISO 27001:2022", score: 72, color: "bg-blue-500" },
  { name: "SOC 2 Type II", score: 85, color: "bg-green-500" },
  { name: "GDPR Compliance", score: 61, color: "bg-yellow-500" },
  { name: "HIPAA Security Rule", score: 0, color: "bg-gray-200" },
];

const RECENT_RISKS = [
  { title: "Unpatched production servers", severity: "critical", score: 20 },
  { title: "S3 buckets — insufficient access controls", severity: "high", score: 15 },
  { title: "No MFA for privileged accounts", severity: "high", score: 12 },
  { title: "Missing data backup procedures", severity: "medium", score: 10 },
];

function severityDot(severity: string) {
  if (severity === "critical") return "bg-red-500";
  if (severity === "high") return "bg-orange-500";
  return "bg-yellow-500";
}

function severityScoreBadge(severity: string) {
  if (severity === "critical") return "bg-red-50 text-red-700";
  if (severity === "high") return "bg-orange-50 text-orange-700";
  return "bg-yellow-50 text-yellow-700";
}

function assessmentScoreColor(score: number) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  if (score > 0) return "text-red-600";
  return "text-gray-400";
}

export default function DashboardPage() {
  const { data, isError } = useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.getSummary,
    retry: false,
  });

  const d = data ?? DEMO_DATA;
  const isDemo = isError || !data;

  const totalControls = Object.values(d.compliance.controls_by_status).reduce((a, b) => a + b, 0);
  const donePct = totalControls > 0
    ? Math.round((d.compliance.controls_by_status.implemented / totalControls) * 100)
    : 0;

  const pieData = [
    { name: "Implemented", value: d.compliance.controls_by_status.implemented },
    { name: "In Progress", value: d.compliance.controls_by_status.in_progress },
    { name: "Not Started", value: d.compliance.controls_by_status.not_started },
    { name: "N/A", value: d.compliance.controls_by_status.not_applicable },
  ];

  return (
    <div className="p-8 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Security Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            Executive overview &middot; <span className="font-medium">Acme Corp (Demo)</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isDemo && (
            <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
              <Activity className="w-3.5 h-3.5" />
              Demo data
            </span>
          )}
          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />
            Add Risk
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <KpiCard title="Open Risks" value={d.risk.total_open}
          subtitle={`${d.risk.critical} critical · ${d.risk.high} high`}
          icon={AlertTriangle} iconBg="bg-red-500" change="-12%" changePositive={true} />
        <KpiCard title="Compliance Score" value={`${d.compliance.average_score}%`}
          subtitle={`${d.compliance.total_assessments} assessments`}
          icon={Shield} iconBg="bg-blue-500" change="+4.2%" changePositive={true} />
        <KpiCard title="Open Audit Findings" value={d.audit.open_findings}
          subtitle="Requires remediation"
          icon={ClipboardList} iconBg="bg-orange-500" change="+2" changePositive={false} />
        <KpiCard title="Policy Attestation" value={`${d.policy.attestation_rate_percent}%`}
          subtitle={`${d.policy.total_attestations} total`}
          icon={FileText} iconBg="bg-emerald-500" change="+6.1%" changePositive={true} />
      </div>

      {/* Charts row 1: Risk trend + Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-gray-900">Risk Trend</h3>
              <p className="text-xs text-gray-400 mt-0.5">Open risks by severity · last 6 months</p>
            </div>
            <button className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium">
              View all <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={RISK_TREND} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="critical" stackId="a" fill="#ef4444" />
              <Bar dataKey="high" stackId="a" fill="#f97316" />
              <Bar dataKey="medium" stackId="a" fill="#eab308" />
              <Bar dataKey="low" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="mb-4">
            <h3 className="font-semibold text-gray-900">Control Coverage</h3>
            <p className="text-xs text-gray-400 mt-0.5">Across all assessments</p>
          </div>
          <div className="flex justify-center mb-4">
            <div className="relative w-[168px] h-[168px]">
              <ResponsiveContainer width={168} height={168}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                    paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
                    {pieData.map((_, i) => <Cell key={i} fill={CONTROL_COLORS[i]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold text-gray-900">{donePct}%</span>
                <span className="text-xs text-gray-400">done</span>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {pieData.map((item, i) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CONTROL_COLORS[i] }} />
                  <span className="text-gray-500">{item.name}</span>
                </div>
                <span className="font-semibold text-gray-700">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts row 2: Compliance trend + Vendor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-gray-900">Compliance Score Trend</h3>
              <p className="text-xs text-gray-400 mt-0.5">Average across all frameworks</p>
            </div>
            <span className="text-2xl font-bold text-blue-600">{d.compliance.average_score}%</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={COMPLIANCE_TREND}>
              <defs>
                <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} domain={[50, 100]} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2.5}
                fill="url(#compGrad)" dot={{ fill: "#3b82f6", r: 3 }} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-gray-900">Vendor Risk</h3>
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5" />
              {d.vendor.total_vendors} vendors
            </span>
          </div>
          <div className="space-y-3 mb-5">
            {VENDOR_TIERS.map(({ label, count, bar, badge }) => (
              <div key={label} className="flex items-center gap-3">
                <span className={`text-xs font-medium w-14 px-2 py-0.5 rounded-full text-center ${badge}`}>{label}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${bar}`}
                    style={{ width: `${(count / d.vendor.total_vendors) * 100}%` }} />
                </div>
                <span className="text-sm font-bold text-gray-800 w-4 text-right">{count}</span>
              </div>
            ))}
          </div>
          <button className="w-full text-center text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center justify-center gap-1">
            Manage vendors <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Bottom row: Assessments + Recent Risks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Active Assessments</h3>
            <button className="text-xs text-blue-600 font-medium flex items-center gap-1 hover:text-blue-700">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-4">
            {ASSESSMENTS_PREVIEW.map((fw) => (
              <div key={fw.name} className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-800 truncate">{fw.name}</span>
                    <span className={`text-xs font-bold ml-2 flex-shrink-0 ${assessmentScoreColor(fw.score)}`}>
                      {fw.score > 0 ? `${fw.score}%` : "—"}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${fw.color} transition-all`} style={{ width: `${fw.score}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Recent Risks</h3>
            <button className="text-xs text-blue-600 font-medium flex items-center gap-1 hover:text-blue-700">
              Risk Register <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-0.5">
            {RECENT_RISKS.map((r) => (
              <div key={r.title} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <span className={`flex-shrink-0 w-2 h-2 rounded-full ${severityDot(r.severity)}`} />
                <span className="text-sm text-gray-700 flex-1 truncate">{r.title}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-lg flex-shrink-0 ${severityScoreBadge(r.severity)}`}>
                  {r.score}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
