import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient, useIsFetching } from "@tanstack/react-query";
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
  CheckSquare, Circle, Clock,
  SlidersHorizontal, ArrowUp, ArrowDown, Eye, EyeOff, Save, ImageDown,
  RefreshCw, Download, FileSpreadsheet, Info, Gauge, Boxes, Bug, Crosshair,
  Landmark, ShieldCheck, Timer,
} from "lucide-react";
import {
  dashboardApi, frameworksApi, authApi, complianceApi, auditsApi, eliteDashboardsApi,
  dashboardExportApi, parseDashboardExportError,
  type ActionPlanItem, type DashboardWidgetItem, type DashboardLayout,
} from "../api/endpoints";
import { useAuthStore, authSession, getUserRoles } from "../store/auth";
import { useEntitlements } from "../context/EntitlementsContext";
import { exportChartAsPng, exportBarChartAsPng, safeFileName, type BarChartEntry } from "../utils/exportUtils";
import type {
  DashboardSummary, Framework, ExecutiveSummary,
  DashboardExportKey, DashboardExportFormat, DashboardExportFailure,
} from "../types";
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

// ─────────────────────────────────────────────────────────────────────────────
// STB objectif 1 & 9 — « Données consolidées en temps quasi réel », « mise à
// jour ... selon un intervalle CONFIGURÉ », « Personnalisation des indicateurs
// affichés » and « Export multiformats », on the page that is every user's home
// screen.
//
// Before this, "temps réel" here was the user pressing F5: the whole
// application had three refetchInterval usages and not one of them was on a
// dashboard. The clause has two halves — the polling AND the fact that its
// cadence is CONFIGURED rather than hardcoded — so the cadence is read from and
// written back to GET/PUT /dashboard/layout?dashboard_key=main, next to the
// widget layout, because it is the same kind of thing: one user's preference
// about one dashboard.
//
// THE TRAP THIS PAGE HAS TO SURVIVE: dashboard_layouts.refresh_interval_seconds
// is a NEW COLUMN on an EXISTING table, and create_all() does not add columns.
// Until an operator runs scripts/migrate_add_dashboard_refresh.py the backend
// reports refresh_config_available:false and answers 424 to any PUT carrying
// that field. Losing auto-refresh on everyone's home page because a *preference*
// is unmigrated would be far worse than not storing the preference, so the
// cadence always applies in-session, is persisted server-side when the column
// exists and to localStorage when it does not, and the PUT is never even
// attempted while the server says the column is missing.
// ─────────────────────────────────────────────────────────────────────────────

const MAIN_LAYOUT_QUERY_KEY = ["dashboard", "layout", "main"];

/** Cadences on offer. 0 = off; every other value sits inside the backend's
 *  30..3600 bounds, so the select can never produce a 422. */
const REFRESH_CHOICES: { seconds: number; key: string }[] = [
  { seconds: 0, key: "dashctl.refresh_off" },
  { seconds: 30, key: "dashctl.refresh_30s" },
  { seconds: 60, key: "dashctl.refresh_1m" },
  { seconds: 300, key: "dashctl.refresh_5m" },
  { seconds: 900, key: "dashctl.refresh_15m" },
  { seconds: 1800, key: "dashctl.refresh_30m" },
  { seconds: 3600, key: "dashctl.refresh_1h" },
];
const DEFAULT_REFRESH_SECONDS = 60;

const LS_REFRESH_KEY = "grceye.dashboard.main.refresh_seconds";
const LS_LAYOUT_KEY = "grceye.dashboard.main.widget_config";

// localStorage throws outright in some privacy modes — never let a *preference*
// take the home page down with it.
function lsGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* private mode */ }
}

/** HTTP status of an axios rejection, 0 when the request never got an answer. */
function statusOf(err: unknown): number {
  return (err as { response?: { status?: number } })?.response?.status ?? 0;
}

type RefreshSaveState = "idle" | "saving" | "saved" | "failed" | "unavailable";

interface DashboardRefreshValue {
  /** Effective cadence in seconds. 0 = auto-refresh off. */
  seconds: number;
  intervalMs: number | false;
  /** The cadence column exists on this database (see the trap above). */
  configAvailable: boolean;
  minSeconds: number;
  maxSeconds: number;
  saveState: RefreshSaveState;
  setSeconds: (next: number) => void;
  refreshNow: () => void;
  /** The saved layout row, shared with the widget-personalisation panel so the
   *  page makes exactly one GET /dashboard/layout call. */
  layout: DashboardLayout | undefined;
  layoutLoaded: boolean;
}

const DashboardRefreshContext = createContext<DashboardRefreshValue | null>(null);

/** Degrades to "no auto-refresh" outside the provider: nothing on this page may
 *  depend on the provider existing, because this page is the app's home. */
function useDashboardRefresh(): DashboardRefreshValue {
  return useContext(DashboardRefreshContext) ?? {
    seconds: 0, intervalMs: false, configAvailable: false,
    minSeconds: 30, maxSeconds: 3600, saveState: "idle",
    setSeconds: () => {}, refreshNow: () => {},
    layout: undefined, layoutLoaded: false,
  };
}

/** Spread into every dashboard query on this page, so ONE configured cadence
 *  drives the whole consolidated view instead of each widget inventing its own. */
function useLiveQueryOptions() {
  const { intervalMs } = useDashboardRefresh();
  return {
    // A query that is currently FAILING is not polled. This matters on this
    // exact page today: /audits/recommendations/summary reads
    // `audit_recommendations`, one of the tables that does not physically exist
    // until the next restart, so it answers 500 on every call. Without this
    // guard every open dashboard tab would fire that 500 once a minute — ~1400
    // stack traces a day per tab, on a two-worker box with no supervisor —
    // while showing exactly the same (empty) tile it already shows.
    // Recovery is not lost: refetchOnWindowFocus below and the « Actualiser
    // maintenant » button both retry, and one success resumes the cadence.
    refetchInterval: (query: { state: { status: string } }) =>
      query.state.status === "error" ? false : intervalMs,
    // Polling a hidden tab is load with nobody reading it. The clause asks for
    // data that is fresh when READ, and refetchOnWindowFocus covers exactly the
    // moment it is read again.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  };
}

function useDashboardRefreshController(): DashboardRefreshValue {
  const queryClient = useQueryClient();
  const { data: layout, isFetched } = useQuery({
    queryKey: MAIN_LAYOUT_QUERY_KEY,
    queryFn: () => dashboardApi.getLayout("main"),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const [override, setOverride] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<RefreshSaveState>("idle");

  // Read once. A cadence chosen on this browser before the column existed has
  // to survive a reload, otherwise the feature only works on a migrated server.
  const stored = useMemo(() => {
    const raw = lsGet(LS_REFRESH_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, []);

  const configAvailable = layout?.refresh_config_available === true;
  // `??` and not `||`: 0 is "explicitly off", a real choice, not a missing one.
  const seconds = override ?? layout?.refresh_interval_seconds ?? stored ?? DEFAULT_REFRESH_SECONDS;

  const setSeconds = useCallback((next: number) => {
    setOverride(next);
    lsSet(LS_REFRESH_KEY, String(next));
    if (!configAvailable) {
      // Do not even send it: the server already told us the column is missing
      // and would answer 424. The cadence still applies for this session.
      setSaveState("unavailable");
      return;
    }
    setSaveState("saving");
    dashboardApi.saveRefreshInterval(next, "main")
      .then((saved) => {
        queryClient.setQueryData(MAIN_LAYOUT_QUERY_KEY, saved);
        setSaveState("saved");
      })
      .catch((err) => setSaveState(statusOf(err) === 424 ? "unavailable" : "failed"));
  }, [configAvailable, queryClient]);

  // The confirmation is transient; the two failure states are not — they stay
  // until the user tries again.
  useEffect(() => {
    if (saveState !== "saved") return;
    const id = window.setTimeout(() => setSaveState("idle"), 4000);
    return () => window.clearTimeout(id);
  }, [saveState]);

  const refreshNow = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient]);

  return useMemo<DashboardRefreshValue>(() => ({
    seconds,
    intervalMs: seconds > 0 ? seconds * 1000 : false,
    configAvailable,
    minSeconds: layout?.refresh_min_seconds ?? 30,
    maxSeconds: layout?.refresh_max_seconds ?? 3600,
    saveState, setSeconds, refreshNow,
    layout, layoutLoaded: isFetched,
  }), [seconds, configAvailable, layout, saveState, setSeconds, refreshNow, isFetched]);
}

// ── Export multiformats (PDF / Excel) ────────────────────────────────────────
//
// « Export PDF/Excel » appears in seven of the nine objectives and nothing in
// the product exported a DASHBOARD: the Report Builder exports a flat dataset
// from another screen and the five canned PDFs are narrative reports. This menu
// drives GET /dashboard-export/{key}, in the UI language, with the server's own
// date-stamped filename.

/** The user's roles as a stable CSV — useSyncExternalStore compares snapshots
 *  with Object.is, so a selector that builds a fresh array every call loops. */
function useRoleList(): string[] {
  const roleCsv = useAuthStore((u) => getUserRoles(u).join(","));
  return useMemo(() => roleCsv.split(",").filter(Boolean), [roleCsv]);
}

/** i18next may hold "fr-FR"; the backend wants the base tag. */
function useApiLang(): string {
  const { i18n } = useTranslation();
  return (i18n.language || "en").split("-")[0];
}

function useExportFailureMessage() {
  const { t } = useTranslation();
  return useCallback((failure: DashboardExportFailure): string => {
    switch (failure.status) {
      case 402: return t("dashctl.export_upgrade");
      case 403: return t("dashctl.export_forbidden");
      // 404 and 424 are the same thing seen from the user's chair: the server is
      // not serving this export yet — the router mount or the migration is still
      // pending. Operator-actionable, never a crash. The backend's own detail is
      // developer English and is deliberately not shown raw.
      case 404:
      case 424: return t("dashctl.export_not_ready");
      default: return t("dashctl.export_failed");
    }
  }, [t]);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

function DashboardExportMenu() {
  const { t } = useTranslation();
  const lang = useApiLang();
  const roles = useRoleList();
  const failureMessage = useExportFailureMessage();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<DashboardExportFormat>("pdf");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Fetched only once the dialog is opened. /dashboard-export has to be mounted
  // on the API router before it answers at all, and firing a request that may
  // 404 on every dashboard load, for every user, would be noise for no benefit.
  const { data: catalogue, isLoading, isError, error: catalogueError } = useQuery({
    queryKey: ["dashboard", "export-catalogue", lang],
    queryFn: () => dashboardExportApi.keys(lang),
    enabled: open,
    retry: false,
    staleTime: 10 * 60_000,
  });

  const isAdmin = roles.includes("tenant_admin") || roles.includes("super_admin");
  // `roles` on a catalogue entry is ADVISORY — the binding check runs on the
  // export itself and can still refuse. It is used here for exactly what the
  // backend offered it for: not showing a viewer eight buttons that all 403.
  // Admins keep every entry because require_roles auto-passes them on the three
  // non-strict dashboards (assets, audit, compliance); on a strict one they get
  // the 403 message below,
  // which is the tender exclusion working rather than a defect.
  const entries = (catalogue?.dashboards ?? []).filter(
    (e) => isAdmin || e.roles.length === 0 || e.roles.some((r) => roles.includes(r)),
  );

  async function download(key: DashboardExportKey) {
    setBusyKey(key);
    setError("");
    try {
      const { blob, filename } = await dashboardExportApi.exportDashboardFile(key, format, lang);
      triggerBlobDownload(blob, filename);
      setOpen(false);
    } catch (err) {
      // responseType:"blob" makes axios hand back the ERROR body as a Blob too,
      // so the status has to be read through the shared parser.
      setError(failureMessage(await parseDashboardExportError(err)));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(""); setOpen(true); }}
        title={t("dashctl.export_menu")}
        aria-label={t("dashctl.export_menu")}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        {t("dashctl.export")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3.5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">{t("dashctl.export_menu")}</h2>
              <button onClick={() => setOpen(false)} title={t("common.close")} aria-label={t("common.close")} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Format */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t("dashctl.export_format")}</p>
                <div className="flex gap-2">
                  {([
                    { value: "pdf" as DashboardExportFormat, label: t("dashctl.export_pdf"), icon: FileText },
                    { value: "xlsx" as DashboardExportFormat, label: t("dashctl.export_excel"), icon: FileSpreadsheet },
                  ]).map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setFormat(f.value)}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border transition-colors ${
                        format === f.value
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <f.icon className="w-4 h-4" /> {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dashboards */}
              {isLoading && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                </div>
              )}

              {isError && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  {failureMessage({ status: statusOf(catalogueError), error: "", message: "" })}
                </p>
              )}

              {!isLoading && !isError && entries.length === 0 && (
                <p className="text-sm text-gray-400">{t("dashctl.restricted_hint")}</p>
              )}

              {entries.length > 0 && (
                <div className="space-y-1.5">
                  {entries.map((entry) => {
                    const advisoryOk = entry.roles.length === 0 || entry.roles.some((r) => roles.includes(r));
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => download(entry.key)}
                        title={advisoryOk ? entry.label : t("dashctl.restricted_hint")}
                        className="w-full flex items-center justify-between gap-2 border border-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        <span className="truncate text-start">{entry.label}</span>
                        <span className="flex items-center gap-2 flex-shrink-0">
                          {!advisoryOk && (
                            <span className="text-xs font-medium text-amber-600">{t("dashctl.restricted")}</span>
                          )}
                          {busyKey === entry.key
                            ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                            : <Download className="w-4 h-4 text-gray-300" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {busyKey && <p className="text-xs text-gray-500">{t("dashctl.exporting")}</p>}
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Toolbar: last-updated stamp, live chip, manual refresh, cadence, export ──

function DashboardToolbar() {
  const { t } = useTranslation();
  const { seconds, configAvailable, saveState, setSeconds, refreshNow } = useDashboardRefresh();
  const live = useLiveQueryOptions();

  // Same key AND same queryFn as the page's own summary query, so this is the
  // shared cache entry, not a second HTTP call; it is subscribed to here only
  // to observe dataUpdatedAt, which is the honest « dernière actualisation ».
  const { dataUpdatedAt } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: dashboardApi.getSummary,
    retry: false,
    ...live,
  });

  const inFlight = useIsFetching({ queryKey: ["dashboard"] }) > 0;

  // The relative stamp ages on its own clock; nothing else on the page changes
  // when a minute passes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const updatedLabel = (() => {
    if (!dataUpdatedAt) return t("dashctl.never_updated");
    const minutes = Math.floor(Math.max(0, now - dataUpdatedAt) / 60_000);
    if (minutes < 1) return t("dashctl.updated_just_now");
    if (minutes < 60) return t("dashctl.updated_minutes_ago", { count: minutes });
    return t("dashctl.last_updated_at", { time: new Date(dataUpdatedAt).toLocaleTimeString() });
  })();

  // Anything the server or localStorage held that is not on the menu would leave
  // the select showing nothing; fall back to the default for DISPLAY only.
  const selected = REFRESH_CHOICES.some((c) => c.seconds === seconds) ? seconds : DEFAULT_REFRESH_SECONDS;

  const saveNotice =
    saveState === "saved" ? { text: t("dashctl.refresh_saved"), tone: "text-green-600" } :
    saveState === "failed" ? { text: t("dashctl.refresh_save_failed"), tone: "text-red-600" } :
    saveState === "unavailable" ? { text: t("dashctl.refresh_unavailable"), tone: "text-amber-600" } :
    null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="inline-flex items-center gap-1.5 text-xs text-gray-500"
        title={dataUpdatedAt ? `${t("dashctl.last_updated")}: ${new Date(dataUpdatedAt).toLocaleString()}` : t("dashctl.never_updated")}
      >
        <Timer className="w-3.5 h-3.5 text-gray-400" />
        {updatedLabel}
      </span>

      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
          seconds > 0 ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${seconds > 0 ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
        {seconds > 0 ? t("dashctl.live") : t("dashctl.paused")}
      </span>

      <button
        type="button"
        onClick={refreshNow}
        disabled={inFlight}
        title={t("dashctl.refresh_now")}
        aria-label={t("dashctl.refresh_now")}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${inFlight ? "animate-spin" : ""}`} />
        {inFlight ? t("dashctl.refreshing") : t("dashctl.refresh")}
      </button>

      <select
        value={String(selected)}
        onChange={(e) => setSeconds(Number(e.target.value))}
        title={configAvailable ? t("dashctl.refresh_interval") : t("dashctl.refresh_unavailable")}
        aria-label={t("dashctl.refresh_interval")}
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
      >
        {REFRESH_CHOICES.map((c) => (
          <option key={c.seconds} value={c.seconds}>{t(c.key)}</option>
        ))}
      </select>

      <DashboardExportMenu />

      {saveNotice && (
        <span className={`basis-full text-xs ${saveNotice.tone}`}>{saveNotice.text}</span>
      )}
    </div>
  );
}

// ── Objectif 9 — the consolidated executive view ─────────────────────────────
//
// GET /dashboard/executive-summary is gated with require_roles_strict: a
// tenant_admin who is not also `executive`/`ciso` is refused, and that refusal
// IS the clause « accessible uniquement aux profils exécutifs ». The section is
// therefore only mounted for those two roles — the entry point is hidden rather
// than letting every other user walk into a 403 on their home page — and the
// rest of this dashboard is untouched for everyone else.

const EXECUTIVE_ROLES = ["executive", "ciso"];

function useIsExecutive(): boolean {
  const roles = useRoleList();
  return roles.some((r) => EXECUTIVE_ROLES.includes(r));
}

/** One figure. A null from the backend is « non disponible », never a 0 — the
 *  backend never fabricates one, and printing 0 would tell a board that an
 *  unmeasured control base is a failing one. */
function ExecMetric({ label, value, suffix }: {
  label: string; value: number | string | null | undefined; suffix?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-gray-500 truncate" title={label}>{label}</span>
      {value == null || value === "" ? (
        <span className="text-xs text-gray-400">{t("dashctl.not_available")}</span>
      ) : (
        <span className="text-sm font-semibold text-gray-900 tabular-nums flex-shrink-0">
          {value}{suffix ?? ""}
        </span>
      )}
    </div>
  );
}

function ExecBlock({ title, icon: Icon, iconColor, children }: {
  title: string; icon: React.ElementType; iconColor: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide truncate">{title}</h4>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ExecutiveSummarySection() {
  const { t } = useTranslation();
  const isExecutive = useIsExecutive();
  const live = useLiveQueryOptions();

  const { data, isLoading, error } = useQuery<ExecutiveSummary>({
    queryKey: ["dashboard", "executive-summary"],
    queryFn: () => dashboardApi.getExecutiveSummary(),
    enabled: isExecutive,
    retry: false,
    ...live,
  });

  if (!isExecutive) return null;

  // Only reachable when the backend's effective-role resolution disagrees with
  // the scalar role this client holds (groups / delegations). Saying so is more
  // useful than an empty panel — and it is expected behaviour, not a fault.
  if (statusOf(error) === 403) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-semibold text-gray-800">{t("execdash.forbidden_title")}</p>
        <p className="text-xs text-gray-500 mt-1">{t("execdash.forbidden_hint")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm text-gray-400">{t("dashctl.data_unavailable")}</p>
      </div>
    );
  }

  const componentLabel: Record<string, string> = {
    compliance: t("execdash.component_compliance"),
    control_coverage: t("execdash.component_control_coverage"),
    risk_exposure: t("execdash.component_risk_exposure"),
  };

  const backlog = data.risk.backlog_change;
  const backlogText = !backlog
    ? t("execdash.backlog_no_history")
    : backlog.change === 0
      ? t("execdash.backlog_unchanged")
      : backlog.change < 0
        ? t("execdash.backlog_improved", { count: Math.abs(backlog.change) })
        : t("execdash.backlog_worsened", { count: backlog.change });

  const nextMeeting = data.governance.next_committee_meeting;
  const posture = data.posture.score;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{t("execdash.title")}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t("execdash.subtitle")}</p>
        </div>
      </div>

      {/* The backend lists the blocks whose query failed instead of drawing a
          convincing zero over them; the labels inside are operator text, so only
          the count is shown to the reader. */}
      {data.degraded.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-800">{t("execdash.blocks_unavailable")}</p>
            <p className="text-xs text-amber-700 mt-0.5">
              {t("execdash.blocks_unavailable_hint", { count: data.degraded.length })} {t("dashctl.degraded_notice")}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Posture — the one headline number, with its inputs shown */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 lg:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="w-4 h-4 text-blue-500" />
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t("execdash.posture")}</h3>
          </div>
          {posture == null ? (
            <p className="text-sm text-gray-400">{t("execdash.posture_unmeasured")}</p>
          ) : (
            <p className={`text-4xl font-bold ${pctColor(posture)}`}>{posture}%</p>
          )}
          <div className="mt-4 space-y-1.5">
            <p className="text-xs font-semibold text-gray-500">{t("execdash.posture_components")}</p>
            {Object.entries(data.posture.weights).map(([name, weight]) => (
              <ExecMetric
                key={name}
                label={`${componentLabel[name] ?? name} · ${t("execdash.weight")} ${Math.round(weight * 100)}%`}
                value={data.posture.components[name] ?? null}
                suffix="%"
              />
            ))}
          </div>
          {/* Auditor-facing and deliberately untranslated server-side, so it
              sits behind a disclosure rather than in the reading flow. */}
          <details className="mt-3">
            <summary className="text-xs text-blue-600 cursor-pointer inline-flex items-center gap-1">
              <Info className="w-3 h-3" /> {t("execdash.posture_formula")}
            </summary>
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{data.posture.formula}</p>
          </details>
        </div>

        {/* Top risks + backlog movement */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t("execdash.top_risks")}</h3>
            <Link to="/risks" className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 font-medium">
              {t("common.view")} <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {data.risk.top.length === 0 ? (
            <p className="text-sm text-gray-400">{t("dashctl.no_data")}</p>
          ) : (
            <div className="space-y-2">
              {data.risk.top.map((r, i) => (
                <div key={r.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-4 flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm text-gray-800 truncate" title={r.title}>{r.title}</span>
                  <SeverityBadge severity={r.severity} />
                  <span className="text-xs font-semibold text-gray-600 tabular-nums w-10 text-end" title={t("execdash.risk_score")}>
                    {r.score}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-gray-50 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs text-gray-500">{t("execdash.backlog_change")}</span>
            <span className={`text-xs font-semibold ${!backlog || backlog.change === 0 ? "text-gray-600" : backlog.change < 0 ? "text-green-600" : "text-red-600"}`}>
              {backlogText}
            </span>
            {backlog && (
              <span className="text-xs text-gray-400">
                {t("execdash.backlog_since", { date: new Date(backlog.from_date).toLocaleDateString() })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* One tile per tender objective, plus the three cross-cutting blocks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ExecBlock title={t("analytics.module_assets")} icon={Boxes} iconColor="text-sky-500">
          <ExecMetric label={t("analytics.metric_total")} value={data.assets.total} />
          <ExecMetric label={t("compliance.severities.critical")} value={data.assets.critical} />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_vulnerabilities")} icon={Bug} iconColor="text-rose-500">
          <ExecMetric label={t("analytics.metric_open")} value={data.vulnerabilities.open} />
          <ExecMetric label={t("analytics.metric_critical_high")} value={data.vulnerabilities.critical_high_open} />
          <ExecMetric label={t("analytics.metric_avg_cvss")} value={data.vulnerabilities.avg_cvss} />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_threats")} icon={Crosshair} iconColor="text-orange-500">
          <ExecMetric label={t("analytics.metric_total")} value={data.threats.total} />
          {/* Threats specific to this organisation, as opposed to the shared
              built-in catalogue every tenant sees. */}
          <ExecMetric label={t("settings.organization")} value={data.threats.tenant_specific} />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_risks")} icon={AlertTriangle} iconColor="text-red-500">
          <ExecMetric label={t("analytics.metric_open")} value={data.risk.total_open} />
          <ExecMetric label={t("compliance.severities.critical")} value={data.risk.critical} />
          <ExecMetric label={t("compliance.severities.high")} value={data.risk.high} />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_controls")} icon={ShieldCheck} iconColor="text-emerald-500">
          <ExecMetric label={t("analytics.metric_coverage")} value={data.controls.coverage_percent} suffix="%" />
          <ExecMetric label={t("analytics.metric_avg_progress")} value={data.controls.avg_progress_percent} suffix="%" />
          <ExecMetric label={t("analytics.metric_total_cost")} value={data.controls.total_cost} />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_governance")} icon={Landmark} iconColor="text-indigo-500">
          <ExecMetric label={t("analytics.metric_attestation_rate")} value={data.governance.attestation_rate_percent} suffix="%" />
          <ExecMetric label={t("analytics.metric_committees")} value={data.governance.committees_total} />
          <ExecMetric
            label={t("execdash.next_committee")}
            value={nextMeeting ? new Date(nextMeeting.next_meeting_date).toLocaleDateString() : t("execdash.no_committee")}
          />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_compliance")} icon={Shield} iconColor="text-blue-500">
          <ExecMetric label={t("analytics.metric_score")} value={data.compliance.average_score} suffix="%" />
          <ExecMetric label={t("dashboard.open_gaps")} value={data.compliance.open_gaps} />
          <ExecMetric label={t("analytics.metric_blockers")} value={data.compliance.certification_blockers} />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_audit")} icon={ClipboardList} iconColor="text-amber-500">
          <ExecMetric label={t("analytics.metric_total")} value={data.audit.audits_total} />
          <ExecMetric label={t("dashboard.open_audit_findings")} value={data.audit.open_findings} />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_incidents")} icon={AlertCircle} iconColor="text-fuchsia-500">
          <ExecMetric label={t("analytics.metric_open")} value={data.incidents.open} />
          <ExecMetric label={t("analytics.metric_total")} value={data.incidents.total} />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_vendors")} icon={Building2} iconColor="text-teal-500">
          <ExecMetric label={t("analytics.metric_total")} value={data.vendors.total} />
        </ExecBlock>

        <ExecBlock title={t("analytics.module_exceptions")} icon={FileText} iconColor="text-violet-500">
          <ExecMetric label={t("analytics.metric_total")} value={data.exceptions.total} />
          <ExecMetric label={t("vocab.active")} value={data.exceptions.active} />
        </ExecBlock>

        <ExecBlock title={t("dashboard.policy_attestation")} icon={BookOpen} iconColor="text-cyan-500">
          <ExecMetric label={t("analytics.metric_total")} value={data.governance.policies_total} />
          <ExecMetric label={t("dashboard.total_attestations")} value={data.governance.total_attestations} />
        </ExecBlock>
      </div>
    </div>
  );
}

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

// ── Per-assessment to-do widget ───────────────────────────────────────────────

function AssessmentToDoWidget({
  assessmentId,
  assessmentName,
  frameworkShortName,
  items,
}: {
  assessmentId: string;
  assessmentName: string;
  frameworkShortName: string;
  items: ActionPlanItem[];
}) {
  const { t } = useTranslation();
  const todo       = items.filter(i => i.status === "open").length;
  const inProgress = items.filter(i => i.status === "in_progress").length;
  const done       = items.filter(i => i.status === "completed").length;
  const total      = items.length;
  const pct        = total > 0 ? Math.round((done / total) * 100) : 0;

  const topItems = items
    .filter(i => i.status !== "completed")
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] ?? 99) - (order[b.priority] ?? 99);
    })
    .slice(0, 3);

  const priorityDot: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-400",
    medium: "bg-yellow-400",
    low: "bg-green-400",
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-mono">{frameworkShortName}</span>
          <p className="text-sm font-semibold text-gray-800 mt-1 leading-snug">{assessmentName}</p>
        </div>
        <Link
          to={`/compliance/${assessmentId}`}
          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5 font-medium flex-shrink-0"
        >
          {t("common.view")} <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Status counts */}
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-gray-500">
          <Circle className="w-3 h-3 text-gray-400" />
          <span className="font-semibold text-gray-700">{todo}</span> {t("action_plan.status_todo")}
        </span>
        <span className="flex items-center gap-1 text-gray-500">
          <Clock className="w-3 h-3 text-blue-400" />
          <span className="font-semibold text-gray-700">{inProgress}</span> {t("action_plan.status_in_progress")}
        </span>
        <span className="flex items-center gap-1 text-gray-500">
          <CheckSquare className="w-3 h-3 text-green-500" />
          <span className="font-semibold text-gray-700">{done}</span> {t("action_plan.status_done")}
        </span>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>{t("action_plan.overall_progress")}</span>
          <span className={`font-semibold ${pct >= 75 ? "text-green-600" : pct >= 40 ? "text-yellow-600" : "text-red-500"}`}>{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct >= 75 ? "bg-green-500" : pct >= 40 ? "bg-yellow-400" : "bg-red-400"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Top pending items */}
      {topItems.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-50 pt-2">
          {topItems.map(item => (
            <div key={item.id} className="flex items-start gap-2 text-xs text-gray-600">
              <span className={`w-2 h-2 rounded-full mt-0.5 flex-shrink-0 ${priorityDot[item.priority] ?? "bg-gray-300"}`} />
              <span className="truncate">{item.control_identifier ? `${item.control_identifier} – ` : ""}{item.title}</span>
            </div>
          ))}
        </div>
      )}

      {total === 0 && (
        <p className="text-xs text-gray-400 text-center py-2">{t("action_plan.no_items")}</p>
      )}
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
          {/* The framework name alone: the old `{name} Dashboard` was English
              on a French and an Arabic UI, and the page title says it already. */}
          <h1 className="text-2xl font-bold text-gray-900">{data.framework_name}</h1>
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
            className="flex items-center gap-2 text-sm font-medium text-indigo-600 border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-400 px-4 py-2 rounded-lg transition-colors shadow-sm"
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
  // Real risk-trend series (new risks logged per month, by severity) — replaces
  // the old hardcoded RISK_TREND constant. See dashboard.py:get_risk_trend for
  // why this is intake volume rather than a historical open-risk backlog.
  const live = useLiveQueryOptions();
  const { data: trendData } = useQuery({
    queryKey: ["dashboard", "risk-trend"],
    queryFn: () => dashboardApi.getRiskTrend(6),
    retry: false,
    ...live,
  });
  const riskTrend = trendData?.series ?? [];

  // Month-over-month change in open critical+high risks, computed from the real
  // risk_snapshots series the trend chart already uses. The two KPI cards below
  // previously displayed a hard-coded "-12%" and "+4.2%" styled as measured trend:
  // invented figures on an executive dashboard, which is worse than showing none.
  // Returns undefined when there is not enough history, and the card then renders
  // no change indicator at all — the same as the other two cards.
  const openRiskChange = (() => {
    if (riskTrend.length < 2) return undefined;
    const at = (i: number) => (riskTrend[i]?.critical ?? 0) + (riskTrend[i]?.high ?? 0);
    const prev = at(riskTrend.length - 2);
    const curr = at(riskTrend.length - 1);
    if (prev === 0) return undefined;
    const pct = ((curr - prev) / prev) * 100;
    return { label: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`, positive: pct <= 0 };
  })();
  // The recharts chart is inline <svg> in the DOM, so « exporter en image »
  // serialises that node rather than pulling in a rasteriser library.
  const trendChartRef = useRef<HTMLDivElement>(null);
  const [chartExporting, setChartExporting] = useState(false);
  const [chartExportError, setChartExportError] = useState("");

  async function exportTrendChart() {
    setChartExporting(true);
    setChartExportError("");
    try {
      // Returns false rather than throwing when the browser refuses the
      // conversion — swallowing that would look like a silent success.
      const ok = await exportChartAsPng(trendChartRef.current, safeFileName(t("dashboard.risk_trend")), {
        title: t("dashboard.risk_trend"),
        subtitle: new Date().toLocaleDateString(),
        rtl: document.documentElement.dir === "rtl",
      });
      if (!ok) setChartExportError(t("errors.load_failed"));
    } catch {
      setChartExportError(t("errors.load_failed"));
    } finally {
      setChartExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("dashboard.security_dashboard")}</h1>
          <p className="text-gray-500 text-sm mt-1">{t("dashboard.executive_overview")}</p>
        </div>
        {isDemo && (
          <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
            <Activity className="w-3.5 h-3.5" /> {t("nav.demo_data")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <KpiCard title={t("dashboard.open_risks")} value={d.risk.total_open}
          subtitle={`${d.risk.critical} ${t("compliance.severities.critical")} · ${d.risk.high} ${t("compliance.severities.high")}`}
          icon={AlertTriangle} iconBg="bg-red-500"
          change={openRiskChange?.label} changePositive={openRiskChange?.positive} />
        <KpiCard title={t("dashboard.compliance_score")} value={`${d.compliance.average_score ?? 0}%`}
          subtitle={`${d.compliance.total_assessments} ${t("compliance.assessments")}`}
          icon={Shield} iconBg="bg-blue-500" />
        <KpiCard title={t("dashboard.open_audit_findings")} value={d.audit.open_findings}
          subtitle={t("dashboard.requires_remediation")}
          icon={ClipboardList} iconBg="bg-orange-500" />
        <KpiCard title={t("nav.vendors")} value={d.vendor.total_vendors}
          icon={Building2} iconBg="bg-indigo-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">{t("dashboard.risk_trend")}</h3>
            <button
              type="button"
              onClick={exportTrendChart}
              disabled={chartExporting || riskTrend.length === 0}
              title={t("analytics.export_image")}
              aria-label={t("analytics.export_image")}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-blue-600 disabled:opacity-40"
            >
              {chartExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageDown className="w-3.5 h-3.5" />}
              {t("analytics.export_image")}
            </button>
          </div>
          {chartExportError && (
            <p className="text-xs text-red-600 mb-2">{chartExportError}</p>
          )}
          <div ref={trendChartRef}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={riskTrend} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="critical" stackId="a" fill="#ef4444" />
              <Bar dataKey="high" stackId="a" fill="#f97316" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">{t("dashboard.policy_attestation")}</h3>
            <span className="text-2xl font-bold text-blue-600">{d.policy.attestation_rate_percent ?? 0}%</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${d.policy.attestation_rate_percent ?? 0}%` }} />
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
              <p className="text-xs text-gray-400 mt-0.5">{t("nav.compliance")}</p>
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

// ── Audit follow-up widget ────────────────────────────────────────────────────
//
// Objectif 7 asks for « un tableau de bord des recommandations » and objectif 8
// for the state of the constats. Both are read from routes that sit under
// /audits and are NOT behind the dashboards feature gate, so this widget works
// for every tenant; the fuller findings_by_status split comes from the gated
// module dashboard and is only requested when the tenant is entitled to it —
// asking for it otherwise would fire the Elite upsell toast on every visit.

const BUCKET_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#06b6d4"];

function useBucketLabel() {
  const { t, i18n } = useTranslation();
  return (key: string): string => {
    for (const namespace of [
      "recommendations.statuses",
      "audit_detail.finding_statuses",
      "compliance.severities",
      "audit_detail.statuses",
    ]) {
      const full = `${namespace}.${key}`;
      if (i18n.exists(full)) return t(full);
    }
    return key.replace(/_/g, " ");
  };
}

function MiniBars({
  title,
  data,
  onExport,
}: {
  title: string;
  data: Record<string, number>;
  onExport?: (title: string, entries: BarChartEntry[]) => void;
}) {
  const { t } = useTranslation();
  const label = useBucketLabel();
  const entries = Object.entries(data).filter(([, v]) => Number.isFinite(Number(v)));
  if (!entries.length) return null;
  const max = Math.max(1, ...entries.map(([, v]) => Number(v) || 0));
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
        {onExport && (
          <button
            type="button"
            onClick={() =>
              onExport(
                title,
                entries.map(([k, v], i) => ({
                  label: label(k),
                  value: Number(v) || 0,
                  color: BUCKET_COLORS[i % BUCKET_COLORS.length],
                })),
              )
            }
            title={t("analytics.export_image")}
            aria-label={t("analytics.export_image")}
            className="text-gray-300 hover:text-blue-600 transition-colors"
          >
            <ImageDown className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {entries.map(([k, v], i) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-xs text-gray-600 truncate" title={label(k)}>{label(k)}</span>
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${((Number(v) || 0) / max) * 100}%`, backgroundColor: BUCKET_COLORS[i % BUCKET_COLORS.length] }}
              />
            </div>
            <span className="w-8 text-right text-xs font-semibold text-gray-700 tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditFollowUpSection() {
  const { t } = useTranslation();
  const { hasFeature } = useEntitlements();
  const canReadModuleDashboards = hasFeature("custom_dashboards");

  const live = useLiveQueryOptions();
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["dashboard", "recommendations-summary"],
    queryFn: () => auditsApi.recommendationsSummary(),
    retry: false,
    ...live,
  });
  const { data: overdue = [] } = useQuery({
    queryKey: ["dashboard", "overdue-findings"],
    queryFn: () => auditsApi.overdueFindings(),
    retry: false,
    ...live,
  });
  const { data: auditDashboard } = useQuery({
    queryKey: ["dashboard", "audit-module"],
    queryFn: () => eliteDashboardsApi.audit(),
    enabled: canReadModuleDashboards,
    retry: false,
    ...live,
  });

  async function exportBars(title: string, entries: BarChartEntry[]) {
    await exportBarChartAsPng(title, entries, safeFileName(title), {
      rtl: document.documentElement.dir === "rtl",
      subtitle: new Date().toLocaleDateString(),
    });
  }

  // Findings by status: the entitled tenant gets the full split from the module
  // dashboard; otherwise the overdue feed still answers "how many, in what
  // state" for the constats that actually need attention.
  const findingsByStatus: Record<string, number> =
    (auditDashboard as { findings_by_status?: Record<string, number> } | undefined)?.findings_by_status ??
    overdue.reduce<Record<string, number>>((acc, finding) => {
      acc[finding.status] = (acc[finding.status] ?? 0) + 1;
      return acc;
    }, {});

  const recommendationsByBucket: Record<string, number> = summary
    ? {
        pending: summary.pending,
        in_progress: summary.in_progress,
        closed: summary.closed,
        rejected: summary.rejected,
      }
    : {};

  const closureRate = summary && summary.total > 0 ? Math.round((summary.closed / summary.total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          {t("recommendations.dashboard_title")}
        </h2>
        <Link to="/audits" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium">
          {t("nav.audits")} <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {summaryLoading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title={t("recommendations.stat_total")}
              value={summary?.total ?? 0}
              subtitle={t("recommendations.stat_total_sub")}
              icon={ClipboardList}
              iconBg="bg-teal-500"
            />
            <KpiCard
              title={t("recommendations.stat_in_progress")}
              value={summary?.in_progress ?? 0}
              subtitle={t("recommendations.stat_in_progress_sub")}
              icon={Clock}
              iconBg="bg-blue-500"
            />
            <KpiCard
              title={t("recommendations.stat_overdue")}
              value={summary?.overdue ?? 0}
              subtitle={t("recommendations.stat_overdue_sub")}
              icon={AlertTriangle}
              iconBg="bg-red-500"
            />
            <KpiCard
              title={t("recommendations.stat_closure_rate")}
              value={`${closureRate}%`}
              subtitle={t("recommendations.stat_closure_rate_sub")}
              icon={CheckCircle2}
              iconBg="bg-green-500"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              {summary && summary.total > 0 ? (
                <MiniBars
                  title={t("recommendations.by_status")}
                  data={recommendationsByBucket}
                  onExport={exportBars}
                />
              ) : (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    {t("recommendations.by_status")}
                  </p>
                  <p className="text-sm text-gray-400">{t("recommendations.empty_title")}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t("recommendations.empty_hint")}</p>
                </div>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              {Object.keys(findingsByStatus).length > 0 ? (
                <MiniBars
                  // Pre-composed key, not `${a} — ${b}`: a template literal puts
                  // the em dash in the wrong place once the page is in Arabic.
                  title={t("analytics.break_findings_status")}
                  data={findingsByStatus}
                  onExport={exportBars}
                />
              ) : (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    {t("analytics.break_findings_status")}
                  </p>
                  <p className="text-sm text-gray-400">{t("audits.none_identified")}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── « Personnalisation des indicateurs affichés » ────────────────────────────
//
// The sections of this page could already be hidden and reordered per user and
// persisted through GET/PUT /dashboard/layout. What the clause asks for is one
// level finer: the INDICATORS. The four platform KPI tiles were an
// all-or-nothing block, so "choose which indicators are displayed" was not
// actually possible — hence the second catalogue below, whose ids are laid out
// inside the KPI row rather than as sections of their own.
//
// Persistence has two tiers on purpose. Writing widget_config server-side is
// gated on custom_dashboards (402, handled globally by the elite-upsell
// listener in client.ts) and 16 of the 18 tenants on this database are not
// Elite; a personalisation that silently does nothing for them would not close
// the clause. So the choice is ALWAYS applied and always mirrored to
// localStorage, and the server copy is the portable-across-devices upgrade.
const MAIN_SECTION_IDS = [
  "executive_summary", "frameworks_grid", "action_plan", "audit_followup", "platform_kpis",
] as const;
const MAIN_KPI_IDS = [
  "kpi_open_risks", "kpi_compliance", "kpi_findings", "kpi_attestation",
] as const;

type MainSectionId = (typeof MAIN_SECTION_IDS)[number];
type MainKpiId = (typeof MAIN_KPI_IDS)[number];
type MainWidgetId = MainSectionId | MainKpiId;

const MAIN_WIDGET_IDS: readonly MainWidgetId[] = [...MAIN_SECTION_IDS, ...MAIN_KPI_IDS];
const SECTION_ID_SET = new Set<string>(MAIN_SECTION_IDS);
const KPI_ID_SET = new Set<string>(MAIN_KPI_IDS);

function defaultMainWidgetConfig(): DashboardWidgetItem[] {
  return MAIN_WIDGET_IDS.map((id) => ({ id, visible: true }));
}

/** Merge a stored choice onto the current catalogue: ids we no longer know are
 *  dropped, ids added since it was saved appear (visible) at the end. */
function mergeWidgetConfig(saved: DashboardWidgetItem[]): DashboardWidgetItem[] {
  // `saved` can come straight out of localStorage, which is a value this page
  // does not control the integrity of (a truncated write, a browser sync, a
  // hand-edited entry). JSON.parse already succeeded by the time we get here,
  // so a null or a number in the array would throw on `w.id` INSIDE the effect
  // below — an uncaught throw in a render effect blanks the application's home
  // page. Anything that is not a well-formed entry is simply not a saved
  // choice, and the missing ids are re-added visible on the next line.
  const kept = saved.filter(
    (w) => !!w && typeof w === "object" && typeof w.id === "string" &&
      (SECTION_ID_SET.has(w.id) || KPI_ID_SET.has(w.id)),
  );
  const seen = new Set(kept.map((w) => w.id));
  const missing = MAIN_WIDGET_IDS.filter((id) => !seen.has(id)).map((id) => ({ id, visible: true }));
  return [...kept, ...missing];
}

function CustomizePanel({
  groups, labels, onChange, onSave, onCancel, saving, error,
}: {
  groups: { title: string; items: DashboardWidgetItem[] }[];
  labels: Record<string, string>;
  onChange: (groupIndex: number, next: DashboardWidgetItem[]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error?: string;
}) {
  const { t } = useTranslation();

  function toggle(g: number, idx: number) {
    const next = groups[g].items.slice();
    next[idx] = { ...next[idx], visible: !next[idx].visible };
    onChange(g, next);
  }
  function move(g: number, idx: number, dir: -1 | 1) {
    const items = groups[g].items;
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(g, next);
  }

  return (
    <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        {/* framework_editor.customize / compliance_scale.move_* are reused
            deliberately: they are the only "Customize" / "Move up" / "Move down"
            strings that exist in all three locales. The dashboard.* keys this
            panel used to name (customize_title, hide_widget, move_up, …) were
            never added to en/fr/ar, so every one of them rendered its English
            defaultValue even when the UI was in French or Arabic — on a page
            being shown to a French-language tender. */}
        <h3 className="font-semibold text-gray-900 text-sm">{t("framework_editor.customize")}</h3>
        <button onClick={onCancel} title={t("common.close")} aria-label={t("common.close")} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* The index handed to toggle/move/onChange must be the index in `groups`,
          NOT the index after the empty groups are dropped: those handlers read
          `groups[g].items`. Mapping first and returning null second keeps the
          two in step — filtering first silently writes group 1's reordering
          into group 0 (and throws on the first toggle) the day either group can
          be empty. */}
      {groups.map((group, g) => group.items.length === 0 ? null : (
        <div key={group.title} className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{group.title}</p>
          {group.items.map((w, idx) => (
            <div key={w.id} className="flex items-center gap-2 border border-gray-100 rounded-xl px-3 py-2">
              <button
                type="button"
                onClick={() => toggle(g, idx)}
                aria-pressed={w.visible}
                title={labels[w.id] ?? w.id}
                aria-label={labels[w.id] ?? w.id}
                className={`flex-shrink-0 ${w.visible ? "text-blue-600" : "text-gray-300"}`}
              >
                {w.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              <span className={`flex-1 text-sm ${w.visible ? "text-gray-800" : "text-gray-400"}`}>{labels[w.id] ?? w.id}</span>
              <button type="button" onClick={() => move(g, idx, -1)} disabled={idx === 0} title={t("compliance_scale.move_up")} aria-label={t("compliance_scale.move_up")} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => move(g, idx, 1)} disabled={idx === group.items.length - 1} title={t("compliance_scale.move_down")} aria-label={t("compliance_scale.move_down")} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ))}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-3.5 py-1.5 rounded-lg transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {t("common.save")}
        </button>
      </div>
    </div>
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
  const { t } = useTranslation();
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
          <h2 className="text-lg font-semibold text-gray-900">{t("dashboard.add_framework")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Available frameworks list */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">{t("dashboard.select_framework_modal")}</h3>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              </div>
            ) : allFrameworks.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">{t("dashboard.no_frameworks")}</p>
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
                    <p className="text-xs text-gray-400 mt-1">{t("dashboard.controls_count", { count: fw.control_count ?? 0, defaultValue: t("framework_editor.controls_count", { count: fw.control_count ?? 0 }) })}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected framework details */}
          {selectedFramework && (
            <div className="border-t border-gray-100 pt-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-600 font-medium mb-1">{t("dashboard.selected_label")}</p>
                <p className="text-sm font-semibold text-blue-900">{selectedFramework.name}</p>
                <p className="text-xs text-blue-700 mt-1">{t("dashboard.controls_count", { count: selectedFramework.control_count ?? 0, defaultValue: t("framework_editor.controls_count", { count: selectedFramework.control_count ?? 0 }) })}</p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 font-medium text-sm rounded-lg hover:bg-gray-50 transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleAddFramework}
              disabled={!selectedId || adding}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {t("dashboard.add_framework")}
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
  const navigate = useNavigate();
  const d = genericData ?? DEMO_DATA;
  const frameworks: any[] = overviewData?.frameworks ?? [];
  const [showFrameworkModal, setShowFrameworkModal] = useState(false);
  const authUser = useAuthStore((state) => state);
  const currentFrameworkIds = authUser?.selected_framework_ids || [];
  const primaryFrameworkId = authUser?.primary_framework_id || null;

  const live = useLiveQueryOptions();
  const { data: allActionItems = [] } = useQuery({
    queryKey: ["dashboard", "action-plan-all"],
    queryFn: () => complianceApi.listActionPlan(),
    enabled: frameworks.length > 0,
    ...live,
  });

  // Group action items by assessment_id
  const itemsByAssessment = allActionItems.reduce<Record<string, ActionPlanItem[]>>((acc, item) => {
    const key = item.assessment_id ?? "__none__";
    (acc[key] ??= []).push(item);
    return acc;
  }, {});

  // Only show assessments that have items and match frameworks in the overview
  const assessmentsWithItems = frameworks
    .filter((fw: any) => fw.has_assessment && fw.assessment_id)
    .map((fw: any) => ({
      assessmentId: fw.assessment_id,
      assessmentName: fw.assessment_name ?? `${fw.framework_short_name} Assessment`,
      frameworkShortName: fw.framework_short_name,
      items: itemsByAssessment[fw.assessment_id] ?? [],
    }))
    .filter(a => a.items.length > 0);

  // ── Widget + indicator personalization ──────────────────────────────────
  // The layout row is read through the shared refresh controller so the page
  // makes exactly one GET /dashboard/layout, whose response also carries the
  // configured auto-refresh cadence.
  const { layout: serverLayout, layoutLoaded } = useDashboardRefresh();
  const layoutQueryClient = useQueryClient();
  const [customizing, setCustomizing] = useState(false);
  const [layout, setLayout] = useState<DashboardWidgetItem[]>(defaultMainWidgetConfig);
  const [draftLayout, setDraftLayout] = useState<DashboardWidgetItem[]>(defaultMainWidgetConfig);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutError, setLayoutError] = useState("");

  useEffect(() => {
    if (!layoutLoaded) return;
    // Never clobber a panel the user is editing — the layout query shares the
    // "dashboard" key prefix, so the manual refresh button refetches it too.
    if (customizing) return;
    // is_default === true means nothing was ever saved for this user: the array
    // the backend returns is its own placeholder catalogue (it does not know the
    // indicator-level ids this page added), not a choice, so it is ignored.
    const savedOnServer =
      serverLayout && serverLayout.is_default === false && serverLayout.widget_config?.length
        ? serverLayout.widget_config
        : null;
    const savedLocally = (() => {
      const raw = lsGet(LS_LAYOUT_KEY);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as DashboardWidgetItem[]) : null;
      } catch {
        return null;
      }
    })();
    const source = savedOnServer ?? savedLocally;
    const merged = source ? mergeWidgetConfig(source) : defaultMainWidgetConfig();
    setLayout(merged);
    setDraftLayout(merged);
  }, [layoutLoaded, serverLayout, customizing]);

  async function handleSaveLayout() {
    setSavingLayout(true);
    setLayoutError("");
    // Apply and mirror locally FIRST. Saving widget_config is gated on
    // custom_dashboards, so on a non-Elite tenant the server answers 402 and the
    // global elite-upsell listener opens the upgrade dialog; without the local
    // mirror the user's choice would be discarded on the next reload and the
    // « personnalisation des indicateurs affichés » clause would be false for
    // every tenant that is not Elite.
    lsSet(LS_LAYOUT_KEY, JSON.stringify(draftLayout));
    setLayout(draftLayout);
    try {
      const saved = await dashboardApi.saveLayout(draftLayout, "main");
      // Push the server's answer into the cache the effect above reads. Without
      // this the still-cached PREVIOUS layout would be re-applied the moment the
      // panel closes, silently undoing the save the user just made.
      layoutQueryClient.setQueryData(MAIN_LAYOUT_QUERY_KEY, saved);
    } catch (err) {
      // 402 already raised the upgrade dialog and the choice is applied anyway;
      // anything else is worth naming, because the user asked us to store it.
      if (statusOf(err) !== 402) setLayoutError(t("errors.save_failed"));
    } finally {
      setSavingLayout(false);
      setCustomizing(false);
    }
  }

  const widgetLabels: Record<string, string> = {
    // Reuse the headings the sections themselves render: those keys exist in
    // en/fr/ar, whereas the dashboard.widget_* keys this map used to name were
    // never added to any locale and rendered English everywhere.
    executive_summary: t("execdash.title"),
    frameworks_grid: t("dashboard.your_frameworks"),
    action_plan: t("action_plan.page_title"),
    audit_followup: t("recommendations.dashboard_title"),
    platform_kpis: t("dashboard.platform_overview"),
    kpi_open_risks: t("dashboard.open_risks"),
    kpi_compliance: t("dashboard.avg_compliance"),
    kpi_findings: t("dashboard.open_audit_findings"),
    kpi_attestation: t("dashboard.policy_attestation"),
  };

  // The consolidated executive block exists only for `executive`/`ciso`: listing
  // it in the panel for anyone else would offer a section that can never render.
  const isExecutive = useIsExecutive();
  const sectionSetForUser = new Set<string>(
    MAIN_SECTION_IDS.filter((id) => id !== "executive_summary" || isExecutive),
  );

  const isWidgetVisible = (id: MainWidgetId) => layout.find((w) => w.id === id)?.visible !== false;
  const visibleOrder = layout.length ? layout : defaultMainWidgetConfig();
  const sectionOrder = visibleOrder.filter((w) => sectionSetForUser.has(w.id));
  const kpiOrder = visibleOrder.filter((w) => KPI_ID_SET.has(w.id) && w.visible !== false);

  const draftSections = draftLayout.filter((w) => sectionSetForUser.has(w.id));
  const draftKpis = draftLayout.filter((w) => KPI_ID_SET.has(w.id));
  // Rows the panel does not show still have to survive a save, or a user who is
  // not an executive today would silently strip the block from their stored
  // choice and never get it back on the day they become one.
  const hiddenSections = draftLayout.filter((w) => SECTION_ID_SET.has(w.id) && !sectionSetForUser.has(w.id));
  const recombineDraft = (sections: DashboardWidgetItem[], kpis: DashboardWidgetItem[]) =>
    [...sections, ...hiddenSections, ...kpis];

  const frameworksSection = (
    <div>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        {t("dashboard.your_frameworks")}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {frameworks.map((fw: any) => (
          <FrameworkOverviewCard
            key={fw.framework_id}
            fw={fw}
            onSelect={() => {
              if (fw.has_assessment) {
                onSelectFramework(fw.framework_id);
              } else {
                // No assessment yet — create one then navigate directly to it
                complianceApi.createAssessment({
                  framework_id: fw.framework_id,
                  name: `${fw.framework_short_name} Assessment`,
                  description: `Compliance assessment for ${fw.framework_name}`,
                  scope_description: `Assessment scope for ${fw.framework_short_name} framework`,
                }).then((a) => {
                  navigate(`/compliance/${a.id}`);
                }).catch(() => {
                  onSelectFramework(fw.framework_id);
                });
              }
            }}
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
              <p className="text-xs text-gray-400 mt-1">{t("dashboard.select_from_available")}</p>
            </div>
          </div>
        </button>
      </div>
    </div>
  );

  const actionPlanSection = assessmentsWithItems.length > 0 && (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          {t("action_plan.page_title")}
        </h2>
        <Link
          to="/action-plan"
          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium"
        >
          {t("action_plan.view_global")} <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {assessmentsWithItems.map(a => (
          <AssessmentToDoWidget
            key={a.assessmentId}
            assessmentId={a.assessmentId}
            assessmentName={a.assessmentName}
            frameworkShortName={a.frameworkShortName}
            items={a.items}
          />
        ))}
      </div>
    </div>
  );

  // One entry per indicator, so the KPI row can be composed from the user's own
  // ordered selection rather than being a fixed block of four.
  const kpiCards: Record<MainKpiId, React.ReactNode> = {
    kpi_open_risks: (
      <KpiCard title={t("dashboard.open_risks")} value={d.risk.total_open}
        subtitle={`${d.risk.critical} ${t("compliance.severities.critical")} · ${d.risk.high} ${t("compliance.severities.high")}`}
        icon={AlertTriangle} iconBg="bg-red-500" />
    ),
    kpi_compliance: (
      <KpiCard title={t("dashboard.avg_compliance")} value={`${d.compliance.average_score ?? 0}%`}
        subtitle={`${d.compliance.total_assessments} ${t("compliance.assessments")}`}
        icon={Shield} iconBg="bg-blue-500" />
    ),
    kpi_findings: (
      <KpiCard title={t("dashboard.open_audit_findings")} value={d.audit.open_findings}
        icon={ClipboardList} iconBg="bg-orange-500" />
    ),
    kpi_attestation: (
      <KpiCard title={t("dashboard.policy_attestation")} value={`${d.policy.attestation_rate_percent ?? 0}%`}
        subtitle={`${d.policy.total_attestations} ${t("dashboard.attestations")}`}
        icon={BookOpen} iconBg="bg-indigo-500" />
    ),
  };

  // Hiding every indicator hides the row: an empty headed section would read as
  // "no data" rather than "you turned these off".
  const kpisSection = kpiOrder.length > 0 && (
    <div>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        {t("dashboard.platform_overview")}
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiOrder.map((w) => (
          <div key={w.id}>{kpiCards[w.id as MainKpiId]}</div>
        ))}
      </div>
    </div>
  );

  const sectionsById: Record<MainSectionId, React.ReactNode> = {
    // Renders null for everyone who is not `executive`/`ciso`, so this page is
    // byte-for-byte what it was for every other user.
    executive_summary: <ExecutiveSummarySection />,
    frameworks_grid: frameworksSection,
    action_plan: actionPlanSection,
    audit_followup: <AuditFollowUpSection />,
    platform_kpis: kpisSection,
  };

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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isDemo && (
            <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
              <Activity className="w-3.5 h-3.5" /> {t("nav.demo_data")}
            </span>
          )}
          <DashboardToolbar />
          <button
            onClick={() => { setDraftLayout(layout); setCustomizing((v) => !v); }}
            title={t("framework_editor.customize")}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> {t("framework_editor.customize")}
          </button>
        </div>
      </div>

      {customizing && (
        <CustomizePanel
          groups={[
            // Group 1 = the page's sections, group 2 = the indicators inside the
            // "Platform overview" row. Both titles reuse keys that exist in
            // en/fr/ar rather than inventing an English-only one.
            { title: t("audit_grid.sections"), items: draftSections },
            { title: t("dashboard.platform_overview"), items: draftKpis },
          ]}
          labels={widgetLabels}
          onChange={(groupIndex, next) =>
            setDraftLayout(groupIndex === 0 ? recombineDraft(next, draftKpis) : recombineDraft(draftSections, next))
          }
          onSave={handleSaveLayout}
          onCancel={() => { setDraftLayout(layout); setCustomizing(false); }}
          saving={savingLayout}
          error={layoutError}
        />
      )}

      {!customizing && layoutError && <p className="text-xs text-red-600">{layoutError}</p>}

      {sectionOrder.map((w) => {
        if (!isWidgetVisible(w.id as MainWidgetId)) return null;
        const node = sectionsById[w.id as MainSectionId];
        // A section can decide it has nothing to show (no action items, every
        // indicator hidden) and evaluate to `false`. Wrapping that leaves an
        // empty div and a stray gap in the space-y-8 stack.
        if (!node) return null;
        return <div key={w.id}>{node}</div>;
      })}

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
    </div>
  );
}

// ── Main dashboard page ───────────────────────────────────────────────────────

// The refresh controller has to sit ABOVE every query on this page: one
// configured cadence drives them all, and the widget-personalisation panel reads
// the same GET /dashboard/layout row that carries that cadence.
export default function DashboardPage() {
  const refresh = useDashboardRefreshController();
  return (
    <DashboardRefreshContext.Provider value={refresh}>
      <DashboardStages />
    </DashboardRefreshContext.Provider>
  );
}

function DashboardStages() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const primaryFrameworkId = useAuthStore((u) => u?.primary_framework_id);
  // null = overview, string = drilled into a specific framework
  const [selectedFwId, setSelectedFwId] = useState<string | null>(null);
  const [creatingAssessment, setCreatingAssessment] = useState(false);
  const live = useLiveQueryOptions();

  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ["dashboard", "frameworks-overview"],
    queryFn: dashboardApi.getFrameworksOverview,
    retry: false,
    enabled: !!primaryFrameworkId,
    ...live,
  });

  const { data: fwData, isLoading: fwLoading } = useQuery({
    queryKey: ["dashboard", "framework-summary", selectedFwId],
    queryFn: () => dashboardApi.getFrameworkSummary(selectedFwId ?? undefined),
    retry: false,
    enabled: !!selectedFwId,
    ...live,
  });

  const { data: genericData, isError: genericError } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: dashboardApi.getSummary,
    retry: false,
    ...live,
  });

  const isDemo = genericError || !genericData;

  // No framework set at all → onboarding
  if (!primaryFrameworkId) {
    return (
      <div className="p-8 max-w-5xl space-y-6">
        <div className="flex justify-end"><DashboardToolbar /></div>
        <WelcomeCard />
        <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl border border-purple-200 p-8 text-center">
          <Shield className="w-12 h-12 text-purple-500 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">{t("dashboard.get_started")}</h2>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">{t("dashboard.select_framework_desc")}</p>
          <Link
            to="/framework"
            className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            <Plus className="w-5 h-5" />
            {t("dashboard.select_frameworks")}
          </Link>
        </div>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Back to overview breadcrumb */}
          <button
            onClick={() => setSelectedFwId(null)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" />
            {t("dashboard.overview")}
            <span className="text-gray-300 mx-1">/</span>
            <span className="font-medium text-gray-800">{fwInfo?.framework_short_name ?? t("nav.frameworks")}</span>
          </button>
          <DashboardToolbar />
        </div>

        {fwData && fwData.has_assessment !== false ? (
          <FrameworkDashboard data={fwData} />
        ) : (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-10 text-center">
            <Shield className="w-10 h-10 text-blue-400 mx-auto mb-3" />
            <h2 className="font-semibold text-blue-900 mb-1">{t("dashboard.no_assessment_for_fw", { name: fwInfo?.framework_name, defaultValue: t("dashboard.no_assessment_yet") })}</h2>
            <p className="text-blue-700 text-sm mb-4">{t("dashboard.create_assessment_desc")}</p>
            <button
              disabled={creatingAssessment}
              onClick={async () => {
                if (!selectedFwId || !fwInfo) return;
                setCreatingAssessment(true);
                try {
                  const a = await complianceApi.createAssessment({
                    framework_id: selectedFwId,
                    name: `${fwInfo.framework_short_name} Assessment`,
                    description: `Compliance assessment for ${fwInfo.framework_name}`,
                    scope_description: `Assessment scope for ${fwInfo.framework_short_name} framework`,
                  });
                  navigate(`/compliance/${a.id}`);
                } catch {
                  navigate("/compliance");
                } finally {
                  setCreatingAssessment(false);
                }
              }}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-xl"
            >
              {creatingAssessment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creatingAssessment ? t("common.loading") : t("dashboard.start_assessment")}
            </button>
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
          { label: t("nav.frameworks"),     href: "/framework",  icon: BookOpen },
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
