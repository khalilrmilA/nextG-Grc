/**
 * AnalyticsPage — seven of the nine dashboards the STB tender asks for
 * (actifs, vulnérabilités, menaces, risques, contrôles, gouvernance, audit),
 * plus the recommendation follow-up that hangs off the audit objective.
 *
 * What each tender clause maps to on this screen:
 *
 *   « Accessible depuis la page dédiée à X » — every dashboard is deep-linkable:
 *     /analytics?dashboard=<key> (a #<key> hash works too) opens that dashboard
 *     on its own. The module pages only have to carry the link; the exact
 *     targets are listed at the end of this comment.
 *   « Mise à jour en temps réel / automatique ... ou selon un intervalle
 *     configuré » — the useState/useEffect fetch is gone. Every tile is a
 *     react-query query with a refetchInterval driven by the *saved* cadence
 *     (GET /dashboard/layout → refresh_interval_seconds) rather than a constant,
 *     with refetchOnWindowFocus and a « Dernière actualisation » stamp so an
 *     evaluator can see the freshness rather than take it on faith.
 *   « Accès filtré par profil » — each module carries the same role list its
 *     backend route carries, and a tile the profile cannot read is not rendered.
 *     This MIRRORS the server gate, it never replaces it: a 403 that still comes
 *     back (group-granted roles, delegations) is rendered as a restricted-view
 *     notice rather than an empty card or a crash.
 *   « Interaction possible (filtrage, zoom) » — a filter bar (period, severity)
 *     plus a per-dashboard zoom that focuses one dashboard full width and adds
 *     the detail views (risk heatmap, trend) that do not fit in a tile.
 *   « Alertes visuelles sur criticité élevée » — critical/high buckets are
 *     flagged with an icon AND a weight/outline change, never colour alone, so
 *     the alert survives a black-and-white print and a colour-blind reader.
 *   « Export PDF/Excel » — a per-dashboard export calling /dashboard-export/{key}.
 *
 * Traps this file is written around:
 *   • GET /dashboards/* take NO query parameters. The severity filter is
 *     therefore applied client-side to the buckets the server returned, and only
 *     the period reaches a server (the risk-trend series, which does take
 *     `months`). Nothing here pretends to filter server-side.
 *   • /dashboard-export/* answers 404 until its router is registered, and can
 *     answer 424 while its schema is behind the code. Both are shown as a
 *     message; neither is a 5xx, so neither can eject the SPA to /service-down.
 *   • The refresh cadence is saved against dashboard_key="main" — the same row
 *     the central dashboard uses — so a user configures their cadence once. The
 *     save is best-effort: viewers are blocked from every PUT client-side and
 *     the column may not exist yet (424), so the chosen cadence always applies
 *     locally even when it cannot be persisted.
 *
 * Deep links for the module pages:
 *   /analytics?dashboard=assets | vulnerabilities | threats | risks | controls |
 *                        governance | audit | recommendations
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Boxes, Bug, ClipboardCheck, Clock, Crown, Download,
  ExternalLink, FileDown, FileSpreadsheet, FileText, Filter, ImageDown,
  ListChecks, Loader2, Lock, Maximize2, Radar, RefreshCw, ShieldCheck,
} from "lucide-react";
import {
  auditsApi, dashboardApi, dashboardExportApi, eliteDashboardsApi,
  parseDashboardExportError, reportBuilderApi,
} from "@/api/endpoints";
import type { DashboardExportKey } from "@/types";
import { hasAnyRole, useAuthStore, type AuthUser } from "@/store/auth";
import { exportBarChartAsPng, safeFileName, type BarChartEntry } from "@/utils/exportUtils";

const BAR_COLORS = ["bg-blue-500", "bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-violet-500", "bg-cyan-500", "bg-orange-500"];
const CHART_COLORS = ["#2185D3", "#3F92D6", "#5BBD74", "#E4C64F", "#DB4241", "#0C5D9E", "#72B0E4", "#EF852E"];

/** Buckets that carry a criticality signal — the only ones the severity filter
 *  touches, and the only ones that raise a visual alert. Filtering "by_type" by
 *  severity would silently empty a chart that has nothing to do with severity. */
const SEVERITY_SCOPED = new Set(["by_severity", "by_criticality", "by_priority", "findings_by_severity"]);
const SEVERITIES = ["critical", "high", "medium", "low"];
/** Bucket keys that must be shown as an alert when they are not empty. */
const ALERT_KEYS = new Set(["critical", "high", "very_high", "urgent", "blocker"]);

/** Auto-refresh choices, in seconds. 0 = off; the rest are inside the backend's
 *  30..3600 bounds (a value outside them is a 422 on save). */
const REFRESH_CHOICES: { seconds: number; labelKey: string }[] = [
  { seconds: 0, labelKey: "dashctl.refresh_off" },
  { seconds: 30, labelKey: "dashctl.refresh_30s" },
  { seconds: 60, labelKey: "dashctl.refresh_1m" },
  { seconds: 300, labelKey: "dashctl.refresh_5m" },
  { seconds: 900, labelKey: "dashctl.refresh_15m" },
  { seconds: 1800, labelKey: "dashctl.refresh_30m" },
  { seconds: 3600, labelKey: "dashctl.refresh_1h" },
];
/** Applied only when the user has never configured a cadence (null from the
 *  layout API). A saved 0 means "off" and is honoured as such. */
const DEFAULT_REFRESH_SECONDS = 60;

/** Periods offered by the filter bar. `months` is what actually reaches the
 *  server (GET /dashboard/risk-trend?months=), so the shortest window offered is
 *  a month: the series is monthly and a 7-day option would be a lie. */
const PERIODS: { id: string; labelKey: string; months: number | "ytd" }[] = [
  { id: "30d", labelKey: "dashctl.period_30d", months: 1 },
  { id: "90d", labelKey: "dashctl.period_90d", months: 3 },
  { id: "12m", labelKey: "dashctl.period_12m", months: 12 },
  { id: "ytd", labelKey: "dashctl.period_ytd", months: "ytd" },
  { id: "all", labelKey: "dashctl.period_all", months: 24 },
];
const DEFAULT_PERIOD = "12m";

/** super_admin / tenant_admin, i.e. the accounts require_roles() auto-passes and
 *  require_roles_strict() does not. Mirrored here so a tile is hidden exactly
 *  where its route would answer 403. */
const ADMIN_ROLES = ["super_admin", "tenant_admin"];

type ModuleKey =
  | "assets" | "vulnerabilities" | "threats" | "risks"
  | "controls" | "governance" | "audit" | "recommendations";

type ModuleData = Record<string, any>;

type ModuleDef = {
  key: ModuleKey;
  label: string;
  icon: typeof Boxes;
  color: string;
  /** The module's own page — the other end of the « accessible depuis la page
   *  dédiée » round trip. */
  route: string;
  /** Key accepted by /dashboard-export/{key}; null when the backend has no
   *  export for this dashboard (the recommendation follow-up has none). */
  exportKey: DashboardExportKey | null;
  /** Roles the backend route accepts. null = every authenticated profile. */
  roles: string[] | null;
  /** true when the route uses require_roles (admins auto-pass), false when it
   *  uses require_roles_strict (« réservé à » / « uniquement » / « limité à »). */
  adminAutoPass: boolean;
  load: () => Promise<ModuleData>;
  total: (d: ModuleData) => number | undefined;
  breaks: [string, string][];
  extra?: (d: ModuleData) => React.ReactNode;
};

/** UI language as the 2-letter code the export endpoints accept. */
function uiLang(raw: string | undefined): "en" | "fr" | "ar" {
  const value = (raw || "en").toLowerCase();
  if (value.startsWith("fr")) return "fr";
  if (value.startsWith("ar")) return "ar";
  return "en";
}

/** Intl locale for numbers and dates. Arabic is pinned to ar-TN: the client is
 *  Tunisian and the Maghreb locales use Western digits, so the figures stay
 *  comparable with the French and English renderings of the same dashboard. */
function intlLocale(lang: "en" | "fr" | "ar"): string {
  return lang === "ar" ? "ar-TN" : lang;
}

/** HTTP status behind an axios rejection, 0 when there was no response. */
function statusOf(error: unknown): number {
  return (error as { response?: { status?: number } } | undefined)?.response?.status ?? 0;
}

/**
 * Format a date that came from the API, never throwing.
 *
 * `Intl.DateTimeFormat.format()` raises RangeError on an invalid Date, and a
 * throw during render is caught by the ROOT error boundary (main.tsx), which
 * replaces the whole application with a developer stack trace. The one date
 * this page renders from the API — the steering committee's
 * `next_meeting_date` — is a free-text string the backend explicitly does not
 * validate ("project convention, not a SQL Date column", _committee_summary in
 * endpoints/dashboards.py), so "T.B.D." in that field would take the page down.
 * An unparseable value is shown verbatim: the operator has to see what is
 * actually stored, and a silent « non disponible » would hide it.
 */
function formatDateSafe(fmt: Intl.DateTimeFormat, raw: unknown, fallback: string): string {
  if (typeof raw !== "string" && typeof raw !== "number") return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return String(raw);
  return fmt.format(parsed);
}

/** Never retry a refusal (401/402/403/404/422): retrying a role gate just makes
 *  the same 403 twice and delays the restricted notice. */
function retryPolicy(failureCount: number, error: unknown): boolean {
  const status = statusOf(error);
  if (status >= 400 && status < 500) return false;
  return failureCount < 1;
}

/**
 * Bucket keys come back from the API as raw enum values (`critical`,
 * `in_progress`, `cyber_attack`). They are data, not UI copy — but the platform
 * translates these vocabularies, so each key goes through `vocab` first (the
 * namespace that covers every enum in app/models) and then through the older
 * per-screen namespaces, before degrading to the humanised key.
 */
const KEY_NAMESPACES = [
  "vocab",
  "compliance.severities",
  "recommendations.statuses",
  "audit_detail.finding_statuses",
  "audit_detail.statuses",
  "audit_campaign.statuses",
  "compliance.status_options",
  // There is a SECOND enum dictionary, moduledash.vocab in locales/*.ts, and it
  // carries seven asset-state values the top-level one does not (operational,
  // degraded, quarantined, out_of_service, lost, blocker, none). It is consulted
  // LAST, not first: on the keys the two share it disagrees with the per-screen
  // namespaces ("Implemented" vs the compliance screen's "Compliant"), and the
  // screen-specific wording is the correct one where it exists. At the end it
  // can only add labels that used to fall through to the humanised key.
  "moduledash.vocab",
];

function useBucketLabel() {
  const { t, i18n } = useTranslation();
  return useCallback((key: string): string => {
    const raw = String(key ?? "").toLowerCase();
    for (const namespace of KEY_NAMESPACES) {
      const full = `${namespace}.${raw}`;
      if (i18n.exists(full)) return t(full);
    }
    return String(key ?? "").replace(/_/g, " ");
  }, [t, i18n]);
}

function Breakdown({
  title,
  dataKey,
  data,
  severity,
  focused,
  onExport,
}: {
  title: string;
  dataKey: string;
  data?: Record<string, number>;
  severity: string;
  focused: boolean;
  onExport?: (title: string, entries: BarChartEntry[]) => void;
}) {
  const { t } = useTranslation();
  const label = useBucketLabel();
  const all = Object.entries(data || {});
  if (!all.length) return null;

  // The severity filter is client-side: /dashboards/* accept no query params, so
  // the honest thing is to filter the buckets the server already returned and to
  // leave the non-criticality breakdowns alone.
  const scoped = SEVERITY_SCOPED.has(dataKey);
  const entries = scoped && severity !== "all"
    ? all.filter(([k]) => k.toLowerCase() === severity)
    : all;

  const max = Math.max(1, ...entries.map(([, v]) => Number(v) || 0));
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
        {onExport && entries.length > 0 && (
          <button
            type="button"
            onClick={() =>
              onExport(
                title,
                entries.map(([k, v], i) => ({
                  label: label(k),
                  value: Number(v) || 0,
                  color: CHART_COLORS[i % CHART_COLORS.length],
                })),
              )
            }
            title={t("analytics.export_image")}
            aria-label={t("analytics.export_image")}
            className="text-gray-300 hover:text-blue-600 transition-colors shrink-0"
          >
            <ImageDown className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400">{t("dashctl.no_data")}</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([k, v], i) => {
            const value = Number(v) || 0;
            // « Alertes visuelles sur criticité élevée »: icon + weight + outline,
            // so the alert is not carried by colour alone (print, colour blindness).
            const alarming = scoped && ALERT_KEYS.has(k.toLowerCase()) && value > 0;
            const barClass = alarming
              ? (k.toLowerCase() === "critical" ? "bg-rose-600" : "bg-orange-500")
              : BAR_COLORS[i % BAR_COLORS.length];
            return (
              <div key={k} className="flex items-center gap-2">
                <span
                  className={`${focused ? "w-40" : "w-28"} shrink-0 text-xs truncate flex items-center gap-1 ${alarming ? "font-semibold text-rose-700" : "text-gray-600"}`}
                  title={label(k)}
                >
                  {alarming && <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />}
                  {label(k)}
                </span>
                <div className={`flex-1 ${focused ? "h-3" : "h-2"} bg-gray-100 rounded-full overflow-hidden ${alarming ? "ring-1 ring-rose-300" : ""}`}>
                  <div className={`h-full ${barClass} rounded-full`} style={{ width: `${(value / max) * 100}%` }} />
                </div>
                <span className={`w-10 text-right text-xs tabular-nums ${alarming ? "font-bold text-rose-700" : "font-semibold text-gray-700"}`}>{value}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CveSummary({ cve }: { cve?: { pertinent_count?: number; top?: { cve_id: string; cvss_score: number | null }[] } }) {
  const { t } = useTranslation();
  if (!cve || !cve.pertinent_count) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("analytics.pertinent_cves")}</p>
        <span className="text-xs font-semibold text-gray-700 tabular-nums">{cve.pertinent_count}</span>
      </div>
      <div className="space-y-1">
        {(cve.top || []).map((e) => (
          <div key={e.cve_id} className="flex items-center justify-between text-xs gap-2">
            <span className="font-mono text-gray-700 truncate">{e.cve_id}</span>
            <span className="font-semibold text-rose-600 tabular-nums">
              {e.cvss_score != null ? e.cvss_score.toFixed(1) : t("dashctl.not_available")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One "label — value" line. The backend returns null for anything it could not
 *  compute and never fabricates a 0, so null renders as « non disponible ». */
function MiniMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs gap-2">
      <span className="text-gray-500 truncate">{label}</span>
      <span className="font-semibold text-gray-800 tabular-nums shrink-0">{value}</span>
    </div>
  );
}

/** 5x5 likelihood x impact heatmap — the detail the risks tile is too small for,
 *  shown when that dashboard is zoomed. */
function RiskHeatmap({ cells }: { cells: { likelihood: number | null; impact: number | null; count: number }[] }) {
  const { t } = useTranslation();
  const counts = new Map<string, number>();
  for (const cell of cells || []) {
    if (!cell.likelihood || !cell.impact) continue;
    const id = `${cell.likelihood}:${cell.impact}`;
    counts.set(id, (counts.get(id) || 0) + (Number(cell.count) || 0));
  }
  const impacts = [5, 4, 3, 2, 1];
  const likelihoods = [1, 2, 3, 4, 5];
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t("analytics.axis_impact")}</p>
      <div className="space-y-1">
        {impacts.map((impact) => (
          <div key={impact} className="flex items-center gap-1">
            <span className="w-4 text-[10px] text-gray-400 tabular-nums">{impact}</span>
            {likelihoods.map((likelihood) => {
              const count = counts.get(`${likelihood}:${impact}`) || 0;
              const score = likelihood * impact;
              const alarming = score >= 15 && count > 0;
              const tone = count === 0
                ? "bg-gray-50 text-gray-300"
                : score >= 15 ? "bg-rose-100 text-rose-800 ring-1 ring-rose-400"
                  : score >= 8 ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-50 text-emerald-800";
              return (
                <div
                  key={likelihood}
                  title={t("analytics.tooltip_cell", { count, likelihood, impact })}
                  className={`flex-1 h-8 rounded-md flex items-center justify-center gap-0.5 text-xs font-semibold tabular-nums ${tone}`}
                >
                  {alarming && <AlertTriangle className="w-3 h-3" aria-hidden="true" />}
                  {count || ""}
                </div>
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-1">
          <span className="w-4" />
          {likelihoods.map((likelihood) => (
            <span key={likelihood} className="flex-1 text-center text-[10px] text-gray-400 tabular-nums">{likelihood}</span>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">{t("analytics.axis_likelihood")}</p>
    </div>
  );
}

/** Monthly critical/high series — the one panel the period filter really drives,
 *  because /dashboard/risk-trend is the only dashboard source that takes a
 *  window (`months`). */
function TrendCard({
  series,
  loading,
  periodLabel,
  lang,
}: {
  series: { period: string; critical: number; high: number }[];
  loading: boolean;
  periodLabel: string;
  lang: "en" | "fr" | "ar";
}) {
  const { t } = useTranslation();
  const width = 640;
  const height = 150;
  const pad = 26;
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(intlLocale(lang), { month: "short" }),
    [lang],
  );
  const monthLabel = (period: string) => {
    const [y, m] = (period || "").split("-").map((n) => Number(n));
    if (!y || !m) return period;
    return monthFormatter.format(new Date(y, m - 1, 1));
  };
  const max = Math.max(1, ...series.flatMap((p) => [Number(p.critical) || 0, Number(p.high) || 0]));
  const x = (i: number) => pad + (i * (width - 2 * pad)) / Math.max(1, series.length - 1);
  const y = (v: number) => height - pad - ((Number(v) || 0) / max) * (height - 2 * pad);
  const line = (pick: (p: { critical: number; high: number }) => number) =>
    series.map((p, i) => `${x(i)},${y(pick(p))}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">{t("dashboard.risk_trend")}</p>
          <span className="text-xs text-gray-500">{t("analytics.tooltip_period", { period: periodLabel })}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" aria-hidden="true" />
            {t("vocab.critical")}
          </span>
          <span className="inline-flex items-center gap-1 text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" aria-hidden="true" />
            {t("vocab.high")}
          </span>
        </div>
      </div>
      {loading ? (
        <p className="text-xs text-gray-400">{t("analytics.chart_loading")}</p>
      ) : series.length === 0 ? (
        <p className="text-xs text-gray-400">{t("analytics.chart_no_data")}</p>
      ) : (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[320px]" role="img" aria-label={t("dashboard.risk_trend")}>
            <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#D9DAD6" strokeWidth="1" />
            <polyline points={line((p) => p.high)} fill="none" stroke="#E4C64F" strokeWidth="2" />
            <polyline points={line((p) => p.critical)} fill="none" stroke="#DB4241" strokeWidth="2" />
            {series.map((p, i) => (
              <g key={p.period}>
                <circle cx={x(i)} cy={y(p.high)} r="2.5" fill="#E4C64F">
                  <title>{`${monthLabel(p.period)} · ${t("vocab.high")} · ${p.high}`}</title>
                </circle>
                <circle cx={x(i)} cy={y(p.critical)} r="2.5" fill="#DB4241">
                  <title>{`${monthLabel(p.period)} · ${t("vocab.critical")} · ${p.critical}`}</title>
                </circle>
                {i % labelEvery === 0 && (
                  <text x={x(i)} y={height - pad + 14} textAnchor="middle" fontSize="10" fill="#8E9299">
                    {monthLabel(p.period)}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

/** Per-dashboard PDF / Excel export. */
function ExportMenu({
  exportKey,
  busy,
  onExport,
}: {
  exportKey: DashboardExportKey;
  busy: string;
  onExport: (key: DashboardExportKey, format: "pdf" | "xlsx") => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isBusy = busy.startsWith(`${exportKey}:`);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isBusy}
        aria-expanded={open}
        title={t("dashctl.export_menu")}
        aria-label={t("dashctl.export_menu")}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {t("dashctl.export")}
      </button>
      {open && (
        <>
          {/* Backdrop so a click anywhere closes the menu. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 end-0 min-w-[9rem] bg-white border border-gray-100 rounded-xl shadow-lg p-1">
            <button
              type="button"
              onClick={() => { setOpen(false); onExport(exportKey, "pdf"); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 rounded-lg hover:bg-gray-50"
            >
              <FileDown className="w-3.5 h-3.5" /> {t("dashctl.export_pdf")}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); onExport(exportKey, "xlsx"); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 rounded-lg hover:bg-gray-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> {t("dashctl.export_excel")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Mirrors the server gate: require_roles auto-passes the two admin roles,
 *  require_roles_strict does not. `roles` on the user is the EFFECTIVE set
 *  (/auth/me resolves groups and delegations), so this stays faithful. */
function canSeeModule(user: AuthUser | null, module: ModuleDef): boolean {
  if (!module.roles) return true;
  // Follow-up D (decision 2026-10-18): the tenant owner sees every dashboard —
  // the strict gates now pass admins too (allow_admin=True); `adminAutoPass`
  // only documents which clause a route implements.
  if (user && ADMIN_ROLES.includes(user.role)) return true;
  return hasAnyRole(user, module.roles);
}

/**
 * Sum of one bucket across every criticality-bearing breakdown of a module.
 *
 * Feeds two things at once: the headline alert (« alertes visuelles sur
 * criticité élevée » — a tile with open critical items says so at the top, not
 * only three bars down) and the headline subtotal while a severity filter is
 * active, so the filter visibly moves the number an evaluator is looking at.
 */
function bucketTotal(d: ModuleData | undefined, module: ModuleDef, bucket: string): number {
  if (!d) return 0;
  let sum = 0;
  for (const [, key] of module.breaks) {
    if (!SEVERITY_SCOPED.has(key)) continue;
    const value = (d[key] as Record<string, number> | undefined)?.[bucket];
    if (typeof value === "number") sum += value;
  }
  return sum;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const user = useAuthStore((u) => u);
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [dataset, setDataset] = useState("risks");
  const [exporting, setExporting] = useState("");
  const [imageError, setImageError] = useState("");
  const [dashboardExporting, setDashboardExporting] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  // Cadence chosen in this session. Wins over the saved one so the selector
  // still works when the PUT is refused (viewer, or the column not migrated).
  const [cadenceOverride, setCadenceOverride] = useState<number | null>(null);
  // Re-renders the « Dernière actualisation » stamp; the value itself is read
  // from Date.now() at render time.
  const [, setClockTick] = useState(0);

  const numberFormat = useMemo(() => new Intl.NumberFormat(intlLocale(lang)), [lang]);
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(intlLocale(lang), { hour: "2-digit", minute: "2-digit" }),
    [lang],
  );
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(intlLocale(lang)), [lang]);

  // ── Filters and focus live in the URL, which is what makes a dashboard
  //    linkable from its module page with its filters already applied. ────────
  const focusKey = searchParams.get("dashboard") || "";
  const periodParam = searchParams.get("period") || "";
  const period = PERIODS.some((p) => p.id === periodParam) ? periodParam : DEFAULT_PERIOD;
  const severityParam = searchParams.get("severity") || "";
  const severity = SEVERITIES.includes(severityParam) ? severityParam : "all";

  // One call per user action, never two in a row: react-router hands the updater
  // the search params of the CURRENT RENDER, so two setSearchParams() in the same
  // handler both start from the same value and the second silently discards the
  // first (which is how a "reset filters" that clears two params loses one).
  const updateParams = useCallback((patch: Record<string, string>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [name, value] of Object.entries(patch)) {
        if (!value) next.delete(name);
        else next.set(name, value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const updateParam = useCallback(
    (name: string, value: string) => updateParams({ [name]: value }),
    [updateParams],
  );

  const modules: ModuleDef[] = useMemo(() => [
    {
      key: "assets", label: t("analytics.module_assets"), icon: Boxes, color: "text-blue-600 bg-blue-50",
      route: "/assets", exportKey: "assets",
      // GET /dashboards/assets — require_roles(...), so admins auto-pass.
      roles: ["ciso", "business_owner", "risk_manager", "compliance_manager", "executive", "viewer"],
      adminAutoPass: true,
      load: () => eliteDashboardsApi.assets(), total: (d) => d.total,
      breaks: [
        [t("analytics.by_type"), "by_type"],
        [t("analytics.by_criticality"), "by_criticality"],
        [t("analytics.by_class"), "by_class"],
        [t("analytics.by_lifecycle"), "by_lifecycle"],
      ],
    },
    {
      key: "vulnerabilities", label: t("analytics.module_vulnerabilities"), icon: Bug, color: "text-rose-600 bg-rose-50",
      route: "/vulnerabilities", exportKey: "vulnerabilities",
      // « limité aux analystes sécurité » — require_roles_strict, no admin pass.
      roles: ["security_analyst", "ciso"], adminAutoPass: false,
      load: () => eliteDashboardsApi.vulnerabilities(), total: (d) => d.total,
      breaks: [
        [t("analytics.by_severity"), "by_severity"],
        [t("analytics.by_status"), "by_status"],
      ],
      extra: (d) => (
        <div className="space-y-3">
          <MiniMetric
            label={t("analytics.metric_avg_cvss")}
            value={d.avg_cvss != null ? Number(d.avg_cvss).toFixed(1) : t("dashctl.not_available")}
          />
          <CveSummary cve={d.cve} />
        </div>
      ),
    },
    {
      key: "threats", label: t("analytics.module_threats"), icon: Radar, color: "text-orange-600 bg-orange-50",
      route: "/threats", exportKey: "threats",
      roles: ["security_analyst", "ciso"], adminAutoPass: false,
      load: () => eliteDashboardsApi.threats(), total: (d) => d.total,
      breaks: [
        [t("analytics.by_category"), "by_category"],
        [t("analytics.metric_pending"), "pending"],
      ],
    },
    {
      key: "risks", label: t("analytics.module_risks"), icon: AlertTriangle, color: "text-amber-600 bg-amber-50",
      route: "/risks", exportKey: "risks",
      // « réservé aux responsables sécurité » — strict.
      roles: ["ciso", "risk_manager", "control_owner"], adminAutoPass: false,
      load: () => eliteDashboardsApi.risks(), total: (d) => d.total,
      breaks: [
        [t("analytics.by_severity"), "by_severity"],
        [t("analytics.by_status"), "by_status"],
      ],
    },
    {
      key: "controls", label: t("analytics.module_controls"), icon: ShieldCheck, color: "text-emerald-600 bg-emerald-50",
      route: "/applied-controls", exportKey: "controls",
      roles: ["ciso", "risk_manager", "control_owner"], adminAutoPass: false,
      load: () => eliteDashboardsApi.controls(), total: (d) => d.total,
      breaks: [[t("analytics.break_controls_status"), "by_status"]],
      extra: (d) => (
        <div className="space-y-1">
          <MiniMetric
            label={t("analytics.metric_avg_progress")}
            value={d.avg_progress != null ? `${Math.round(Number(d.avg_progress))}%` : t("dashctl.not_available")}
          />
          <MiniMetric
            label={t("analytics.metric_total_cost")}
            value={d.total_cost != null ? numberFormat.format(Number(d.total_cost)) : t("dashctl.not_available")}
          />
        </div>
      ),
    },
    {
      key: "governance", label: t("analytics.module_governance"), icon: FileText, color: "text-violet-600 bg-violet-50",
      route: "/governance", exportKey: "governance",
      // « réservé aux fonctions de direction » — strict, the tenant owner included.
      roles: ["executive", "ciso"], adminAutoPass: false,
      load: () => eliteDashboardsApi.governance(), total: (d) => d.policies_total,
      breaks: [
        [t("analytics.break_policies_status"), "policies_by_status"],
        [t("analytics.break_attestations_status"), "attestations_by_status"],
      ],
      extra: (d) => (
        <div className="space-y-1">
          <MiniMetric label={t("analytics.metric_committees")} value={d.committees?.total ?? 0} />
          <MiniMetric
            label={t("analytics.metric_next_meeting")}
            value={formatDateSafe(
              dateFormat,
              d.committees?.next_meeting?.next_meeting_date,
              t("dashctl.not_available"),
            )}
          />
        </div>
      ),
    },
    {
      key: "audit", label: t("analytics.module_audit"), icon: ClipboardCheck, color: "text-cyan-600 bg-cyan-50",
      route: "/audits", exportKey: "audit",
      // « accès filtré par profil » — a filter, not an exclusion: admins pass.
      roles: ["ciso", "compliance_manager", "auditor"], adminAutoPass: true,
      load: () => eliteDashboardsApi.audit(), total: (d) => d.audits_total,
      breaks: [
        [t("analytics.break_audits_status"), "audits_by_status"],
        [t("analytics.break_findings_severity"), "findings_by_severity"],
        // Objectif 7: « suivre l'état d'avancement » needs the status split, not
        // only the severity one.
        [t("analytics.break_findings_status"), "findings_by_status"],
      ],
    },
    {
      key: "recommendations", label: t("analytics.module_recommendations"), icon: ListChecks, color: "text-teal-600 bg-teal-50",
      route: "/recommendations",
      // No /dashboard-export key: the backend exports the nine tender dashboards
      // and the recommendation follow-up is not one of them.
      exportKey: null,
      // GET /audits/recommendations/summary takes get_current_user only — no role
      // gate at all, so hiding the tile would be stricter than the server.
      roles: null, adminAutoPass: true,
      // Not an eliteDashboards call on purpose: the summary lives under /audits
      // so the recommendation follow-up is readable without the dashboards
      // feature gate.
      load: () =>
        auditsApi.recommendationsSummary().then((s) => ({
          total: s.total,
          overdue: s.overdue,
          avg_progress: s.avg_progress,
          by_status: {
            pending: s.pending,
            in_progress: s.in_progress,
            closed: s.closed,
            rejected: s.rejected,
          },
          by_priority: s.by_priority ?? {},
        })),
      total: (d) => d.total,
      breaks: [
        [t("analytics.break_recommendations_status"), "by_status"],
        [t("analytics.by_priority"), "by_priority"],
      ],
      extra: (d) => (
        <div className="space-y-1 pt-1 border-t border-gray-50">
          <MiniMetric
            label={t("analytics.metric_avg_progress")}
            value={d.avg_progress != null ? `${Math.round(Number(d.avg_progress))}%` : t("dashctl.not_available")}
          />
          <div className="flex items-center justify-between text-xs gap-2">
            <span className="text-gray-500 flex items-center gap-1">
              {Number(d.overdue) > 0 && <AlertTriangle className="w-3 h-3 text-rose-600" aria-hidden="true" />}
              {t("analytics.metric_overdue")}
            </span>
            <span className={`tabular-nums shrink-0 ${Number(d.overdue) > 0 ? "font-bold text-rose-700" : "font-semibold text-gray-800"}`}>
              {d.overdue ?? 0}
            </span>
          </div>
        </div>
      ),
    },
  ], [t, numberFormat, dateFormat]);

  const visibleModules = useMemo(() => modules.filter((m) => canSeeModule(user, m)), [modules, user]);

  const exportDatasets = useMemo(() => [
    { name: "risks", label: t("analytics.dataset_risks") },
    { name: "vulnerabilities", label: t("analytics.dataset_vulnerabilities") },
    { name: "assets", label: t("analytics.dataset_assets") },
    { name: "applied_controls", label: t("analytics.dataset_applied_controls") },
    { name: "audits", label: t("analytics.dataset_audits") },
    { name: "threats", label: t("analytics.dataset_threats") },
  ], [t]);

  // ── Cadence: the tenant's saved interval, not a constant ───────────────────
  // dashboard_key "main" on purpose — one cadence per user, shared with the
  // central dashboard, rather than a second setting that silently disagrees.
  const layoutQuery = useQuery({
    queryKey: ["analytics", "layout"],
    queryFn: () => dashboardApi.getLayout("main"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const savedCadence = layoutQuery.data?.refresh_interval_seconds;
  const cadence = cadenceOverride ?? (savedCadence == null ? DEFAULT_REFRESH_SECONDS : savedCadence);
  const cadencePersistable = layoutQuery.data?.refresh_config_available !== false;

  /**
   * The auto-refresh cadence, per query, as a function rather than a constant.
   *
   * A route that has REFUSED this account does not stop refusing on the next
   * tick: /dashboards/* answer 402 for the 16 of 18 tenants that are not on the
   * Elite plan, 403 where a strict role gate applies, and 404 for as long as
   * dashboard-export is unregistered. Re-polling those on a timer re-fires the
   * refusal forever — and a 402 re-dispatches the GLOBAL elite-upsell toast
   * (components/EliteUpsellListener), so a non-Elite tenant sitting on this
   * page would see the up-sell pop up again on every cadence tick, on top of
   * seven pointless queries a minute against two uvicorn workers.
   *
   * A 5xx keeps polling on purpose: several tables this page reads
   * (audit_recommendations among them) only come into existence at the next
   * restart via create_all(), and that tile has to heal on its own rather than
   * stay dead until somebody reloads the page.
   */
  const autoRefresh = useCallback(
    (query: { state: { error: unknown } }): number | false => {
      if (cadence <= 0) return false;
      const status = statusOf(query.state.error);
      if (status >= 400 && status < 500) return false;
      return cadence * 1000;
    },
    [cadence],
  );

  const moduleQueries = useQueries({
    queries: visibleModules.map((m) => ({
      queryKey: ["analytics", "module", m.key],
      queryFn: m.load,
      refetchInterval: autoRefresh,
      refetchOnWindowFocus: true,
      staleTime: 15_000,
      retry: retryPolicy,
    })),
  });

  const risksVisible = visibleModules.some((m) => m.key === "risks");
  const periodDef = PERIODS.find((p) => p.id === period) ?? PERIODS[2];
  const months = periodDef.months === "ytd" ? new Date().getMonth() + 1 : periodDef.months;
  const trendQuery = useQuery({
    queryKey: ["analytics", "risk-trend", months],
    queryFn: () => dashboardApi.getRiskTrend(months),
    enabled: risksVisible,
    refetchInterval: autoRefresh,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: retryPolicy,
  });

  // Keep the relative « Dernière actualisation » label honest without polling
  // the API: only the label re-renders.
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((v) => v + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // A #hash deep link is accepted as well as ?dashboard=, because an anchor is
  // the cheaper thing for a module page to add.
  useEffect(() => {
    const hash = location.hash.replace(/^#(dashboard-)?/, "");
    if (!hash || searchParams.get("dashboard")) return;
    if (modules.some((m) => m.key === hash)) updateParam("dashboard", hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.hash]);

  const stamps = moduleQueries.map((q) => q.dataUpdatedAt).filter((n) => n > 0);
  if (trendQuery.dataUpdatedAt) stamps.push(trendQuery.dataUpdatedAt);
  const lastUpdated = stamps.length ? Math.max(...stamps) : 0;
  const isFetching = moduleQueries.some((q) => q.isFetching) || trendQuery.isFetching;
  const initialLoading = moduleQueries.length > 0 && moduleQueries.every((q) => q.isLoading);

  function freshnessLabel(): string {
    if (!lastUpdated) return t("dashctl.never_updated");
    const minutes = Math.floor((Date.now() - lastUpdated) / 60_000);
    if (minutes < 1) return t("dashctl.updated_just_now");
    return t("dashctl.updated_minutes_ago", { count: minutes });
  }

  async function applyCadence(seconds: number) {
    setCadenceOverride(seconds);
    setRefreshMessage("");
    if (!cadencePersistable) {
      // The column is not on this database yet — the cadence still applies for
      // this session, it just cannot be remembered. Say so rather than pretend.
      setRefreshMessage(t("dashctl.refresh_unavailable"));
      return;
    }
    try {
      await dashboardApi.saveRefreshInterval(seconds, "main");
      queryClient.invalidateQueries({ queryKey: ["analytics", "layout"] });
    } catch (err) {
      // A viewer is blocked from every PUT client-side (its own toast fires);
      // anything else is worth a line, and neither loses the local cadence.
      if (!(err as { isDemoBlock?: boolean })?.isDemoBlock) {
        setRefreshMessage(statusOf(err) === 424 ? t("dashctl.refresh_unavailable") : t("dashctl.refresh_save_failed"));
      }
    }
  }

  function refreshNow() {
    queryClient.invalidateQueries({ queryKey: ["analytics", "module"] });
    queryClient.invalidateQueries({ queryKey: ["analytics", "risk-trend"] });
  }

  async function handleExport(format: "xlsx" | "csv") {
    setExporting(format);
    try {
      const blob = await reportBuilderApi.exportFile(dataset, format);
      downloadBlob(blob as Blob, `${dataset}.${format}`);
    } catch {
      /* 402 is handled globally by the elite-upsell listener */
    } finally {
      setExporting("");
    }
  }

  async function handleDashboardExport(key: DashboardExportKey, format: "pdf" | "xlsx") {
    setDashboardExporting(`${key}:${format}`);
    setExportMessage("");
    try {
      const { blob, filename } = await dashboardExportApi.exportDashboardFile(key, format, lang);
      downloadBlob(blob, filename);
    } catch (err) {
      // 402 already opened the upgrade dialog through the global listener.
      if ((err as { isEliteUpsell?: boolean })?.isEliteUpsell) return;
      const failure = await parseDashboardExportError(err);
      // failure.message is operator/developer English — logged, never rendered.
      if (failure.message) console.warn("dashboard export failed:", failure.error, failure.message);
      setExportMessage(
        failure.status === 403 ? t("dashctl.export_forbidden")
          : failure.status === 402 ? t("dashctl.export_upgrade")
            : failure.status === 424 ? t("dashctl.export_not_ready")
              : t("dashctl.export_failed"),
      );
    } finally {
      setDashboardExporting("");
    }
  }

  async function handleChartExport(moduleLabel: string, chartTitle: string, entries: BarChartEntry[]) {
    setImageError("");
    const ok = await exportBarChartAsPng(
      `${moduleLabel} — ${chartTitle}`,
      entries,
      safeFileName(`${moduleLabel}-${chartTitle}`),
      { rtl: document.documentElement.dir === "rtl", subtitle: dateFormat.format(new Date()) },
    );
    if (!ok) setImageError(t("analytics.export_image_failed"));
  }

  const focusModule = focusKey ? visibleModules.find((m) => m.key === focusKey) ?? null : null;
  // A deep link to a dashboard this profile cannot read must land on a notice,
  // not on a 403 the user walked into.
  const focusDenied = !!focusKey && !focusModule;
  const shownModules = focusModule ? [focusModule] : visibleModules;
  const activeFilters = (severity !== "all" ? 1 : 0) + (period !== DEFAULT_PERIOD ? 1 : 0);

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("analytics.title")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
              <Crown className="w-3 h-3" /> {t("analytics.elite")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("analytics.subtitle")}</p>
        </div>

        {/* « Mise à jour en temps réel » controls + freshness stamp */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600"
            title={lastUpdated ? t("dashctl.last_updated_at", { time: timeFormat.format(new Date(lastUpdated)) }) : t("dashctl.never_updated")}
          >
            <Clock className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
            {isFetching ? t("dashctl.refreshing") : freshnessLabel()}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cadence > 0 ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cadence > 0 ? "bg-emerald-500 animate-pulse" : "bg-gray-400"}`} aria-hidden="true" />
            {cadence > 0 ? t("dashctl.live") : t("dashctl.paused")}
          </span>
          <div className="flex items-center gap-1">
            <label className="sr-only" htmlFor="analytics-cadence">{t("dashctl.refresh_interval")}</label>
            <select
              id="analytics-cadence"
              value={String(cadence)}
              onChange={(e) => applyCadence(Number(e.target.value))}
              title={t("dashctl.auto_refresh")}
              className="border border-gray-200 rounded-xl text-xs px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {REFRESH_CHOICES.map((c) => (
                <option key={c.seconds} value={c.seconds}>{t(c.labelKey)}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={refreshNow}
            title={t("dashctl.refresh_now")}
            aria-label={t("dashctl.refresh_now")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {t("dashctl.refresh")}
          </button>
        </div>
      </div>

      {refreshMessage && <div className="p-3 bg-amber-50 text-amber-800 rounded-xl text-sm">{refreshMessage}</div>}
      {exportMessage && <div className="p-3 bg-amber-50 text-amber-800 rounded-xl text-sm">{exportMessage}</div>}
      {imageError && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{imageError}</div>}

      {/* « Interaction possible (filtrage) » — period drives the trend series
          server-side; severity filters the criticality buckets client-side. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Filter className="w-4 h-4 text-gray-400" aria-hidden="true" />
            {t("dashctl.filters")}
            {activeFilters > 0 && (
              <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs font-semibold">
                {t("dashctl.filters_active", { count: activeFilters })}
              </span>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="analytics-period">{t("dashctl.filter_period")}</label>
            <select
              id="analytics-period"
              value={period}
              onChange={(e) => updateParam("period", e.target.value)}
              className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PERIODS.map((p) => <option key={p.id} value={p.id}>{t(p.labelKey)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="analytics-severity">{t("dashctl.filter_severity")}</label>
            <select
              id="analytics-severity"
              value={severity}
              onChange={(e) => updateParam("severity", e.target.value)}
              className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">{t("dashctl.filter_all")}</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{t(`vocab.${s}`)}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => updateParams({ period: "", severity: "" })}
            disabled={activeFilters === 0}
            className="ml-auto inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {t("dashctl.filter_reset")}
          </button>
        </div>
      </div>

      {/* Report Builder dataset export — a flat dataset, kept alongside the
          per-dashboard export because it answers a different question. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">{t("analytics.export_title")}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t("analytics.export_sub")}</p>
          </div>
          <div className="flex items-end gap-2 ml-auto">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="analytics-dataset">{t("analytics.dataset")}</label>
              <select
                id="analytics-dataset"
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
                className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {exportDatasets.map((d) => <option key={d.name} value={d.name}>{d.label}</option>)}
              </select>
            </div>
            <button onClick={() => handleExport("xlsx")} disabled={!!exporting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {exporting === "xlsx" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t("audit_report.download_excel")}
            </button>
            <button onClick={() => handleExport("csv")} disabled={!!exporting} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
              {exporting === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t("archiving.export_csv")}
            </button>
          </div>
        </div>
      </div>

      {/* Zoomed on one dashboard: a way back, and the module page it belongs to */}
      {focusModule && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => updateParam("dashboard", "")}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
            {t("common.back")}
          </button>
          <Link
            to={focusModule.route}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
            {focusModule.label}
          </Link>
        </div>
      )}

      {focusDenied && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-2">
          <div className="flex items-center gap-2 text-gray-900 font-semibold">
            <Lock className="w-4 h-4 text-gray-400" aria-hidden="true" />
            {t("dashctl.restricted")}
          </div>
          <p className="text-sm text-gray-500">{t("dashctl.restricted_hint")}</p>
          <button
            type="button"
            onClick={() => updateParam("dashboard", "")}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
            {t("common.back")}
          </button>
        </div>
      )}

      {/* Objectif 4's period-driven series. Shown with the risks dashboard, and
          only to the profiles that may see it. */}
      {risksVisible && (!focusModule || focusModule.key === "risks") && (
        <TrendCard
          series={(trendQuery.data?.series ?? []) as { period: string; critical: number; high: number }[]}
          loading={trendQuery.isLoading}
          periodLabel={t(periodDef.labelKey)}
          lang={lang}
        />
      )}

      {/* Dashboards grid */}
      {initialLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : visibleModules.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-1">
          <div className="flex items-center gap-2 text-gray-900 font-semibold">
            <Lock className="w-4 h-4 text-gray-400" aria-hidden="true" />
            {t("common.access_restricted")}
          </div>
          <p className="text-sm text-gray-500">{t("common.access_restricted_hint")}</p>
        </div>
      ) : (
        <div className={focusModule ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"}>
          {shownModules.map((m) => {
            const query = moduleQueries[visibleModules.indexOf(m)];
            const d = query?.data as ModuleData | undefined;
            const total = d ? m.total(d) : undefined;
            const errorStatus = query?.error ? statusOf(query.error) : 0;
            const focused = focusModule?.key === m.key;
            return (
              <div
                key={m.key}
                id={`dashboard-${m.key}`}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${m.color}`}>
                    <m.icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{m.label}</p>
                    <p className={`${focused ? "text-3xl" : "text-2xl"} font-bold text-gray-900 tabular-nums leading-tight`}>
                      {total != null ? numberFormat.format(total) : t("dashctl.not_available")}
                    </p>
                    {/* Headline criticality alert, and the filtered subtotal while a
                        severity filter is on. Icon + wording, never colour alone. */}
                    {!m.breaks.some(([, key]) => SEVERITY_SCOPED.has(key)) ? null : severity !== "all" ? (
                      <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                        <span>{t(`vocab.${severity}`)}</span>
                        <span className="tabular-nums">{numberFormat.format(bucketTotal(d, m, severity))}</span>
                      </span>
                    ) : bucketTotal(d, m, "critical") > 0 ? (
                      <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-rose-50 ring-1 ring-rose-300 px-2 py-0.5 text-xs font-semibold text-rose-700">
                        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                        <span>{t("vocab.critical")}</span>
                        <span className="tabular-nums">{numberFormat.format(bucketTotal(d, m, "critical"))}</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="ml-auto flex items-center gap-1 shrink-0">
                    {m.exportKey && (
                      <ExportMenu exportKey={m.exportKey} busy={dashboardExporting} onExport={handleDashboardExport} />
                    )}
                    {!focused && (
                      <button
                        type="button"
                        onClick={() => updateParam("dashboard", m.key)}
                        title={t("common.view")}
                        aria-label={t("common.view")}
                        className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {errorStatus === 403 ? (
                  // The client-side gate above mirrors the server's, but group
                  // grants and delegations can disagree — say why, never crash.
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
                      {t("dashctl.restricted")}
                    </p>
                    <p className="text-xs text-gray-500">{t("dashctl.restricted_hint")}</p>
                  </div>
                ) : query?.isError ? (
                  <p className="text-xs text-gray-400">{t("dashctl.data_unavailable")}</p>
                ) : d ? (
                  <div className="space-y-3">
                    {m.breaks.map(([label, key]) => (
                      <Breakdown
                        key={key}
                        title={label}
                        dataKey={key}
                        data={d[key]}
                        severity={severity}
                        focused={focused}
                        onExport={(chartTitle, entries) => handleChartExport(m.label, chartTitle, entries)}
                      />
                    ))}
                    {m.extra?.(d)}
                    {focused && m.key === "risks" && Array.isArray(d.heatmap) && d.heatmap.length > 0 && (
                      <RiskHeatmap cells={d.heatmap} />
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">{t("analytics.unavailable")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
