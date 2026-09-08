/**
 * ModuleDashboard — one tender dashboard, mounted ON ITS OWN MODULE PAGE.
 *
 * Eight of the nine STB dashboard objectives are phrased « Accessible depuis la
 * page dédiée aux actifs / vulnérabilités / menaces / risques / contrôles / … ».
 * The LOCATION is the requirement: the data already existed behind
 * GET /dashboards/{module}, but the only screen that ever called it was
 * AnalyticsPage, i.e. a different page in a different navigation group. A card
 * over there does not make a dashboard "accessible from the assets page".
 *
 * So this is the one component every module page mounts:
 *
 *     <ModuleDashboard module="assets" />
 *
 * and it owns every state that call can end in, because each of them is a
 * clause in the tender:
 *
 *   • data          — totals, groupings, the module's own extra metrics.
 *   • loading       — a skeleton, never a blank rectangle.
 *   • EMPTY         — an explicit "nothing recorded yet" panel. It must NEVER
 *                     fall back to sample rows: fabricated figures on a bank's
 *                     screen destroy trust in every other number on it, and the
 *                     product has already shipped that bug once (RisksPage fell
 *                     back to DEMO_RISKS on an empty register and exported the
 *                     invented rows to CSV).
 *   • 402 UPSELL    — /dashboards/* sit behind require_feature("custom_dashboards"),
 *                     an ELITE flag. That tiering is deliberate and stays. What
 *                     was a bug is its SILENCE: a non-Elite tenant got a 402 that
 *                     rendered as a blank card. It now renders a translated
 *                     upsell panel with a route to /settings.
 *   • 403 RESTRICTED— the per-objective role gates (require_roles_strict) are the
 *                     « accès filtré par profil » clause working as specified.
 *                     Say so, in the user's language; never show it as an error.
 *   • 404 / 424 / 5xx — an operator-actionable message. Never a redirect: the SPA
 *                     ejects to /service-down only when there is NO response at
 *                     all, and turning a per-tile failure into an eviction from
 *                     the application is the trap this codebase was bitten by.
 *
 * Also required by the objectives and implemented here:
 *   « Alertes visuelles sur criticité élevée » (objectifs 2 et 5) — a severity
 *     chip pairing colour with an icon AND the word, plus per-row alerts inside
 *     Breakdown. Colour is never the only carrier.
 *   « Mise à jour ... selon un intervalle configuré » + « Dernière actualisation »
 *     — a cadence selector, a manual refresh, and an HH:MM stamp.
 *   « Export PDF/Excel » — a built-in menu on GET /dashboard-export/{key}, or a
 *     page-supplied `onExport`.
 *
 * Everything user-visible goes through t(); the bucket keys the API groups on
 * are RAW ENUM VALUES and are translated by Breakdown's vocabulary chain, which
 * is why a French user no longer reads "in use" and "cyber attack".
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Boxes, Bug, ClipboardCheck, Clock, Crown, Download, ExternalLink,
  FileDown, FileSpreadsheet, FileText, Loader2, Lock, Radar, RefreshCw, ShieldCheck,
} from "lucide-react";
import { dashboardExportApi, eliteDashboardsApi, parseDashboardExportError } from "@/api/endpoints";
import type { DashboardExportKey } from "@/types";
import { useEntitlements } from "@/context/EntitlementsContext";
import Breakdown, { SeverityChip, countAlerting } from "@/components/common/Breakdown";

export type ModuleDashboardKey =
  | "assets" | "vulnerabilities" | "threats" | "risks" | "controls" | "governance" | "audit";

/** The payloads are `Record<string, unknown>` shaped by dashboards.py; the typed
 *  interfaces live in @/types (AssetsDashboard, …). This component reads them
 *  field by field through the definitions below, so it stays correct when a
 *  field is ADDED server-side and degrades to "absent" when one is missing —
 *  see `optional` on BreakdownDef. */
type Payload = Record<string, unknown>;

interface BreakdownDef {
  /** Field in the payload (`by_severity`, `policies_by_status`, …). */
  key: string;
  /** i18n key for the caption. */
  titleKey: string;
  /** First-choice vocabulary for THIS bucket's keys, when the raw values are not
   *  self-describing anywhere else. */
  vocabScope?: string;
  /**
   * Render only when the field is actually present in the payload.
   *
   * This is how the component stays forward-compatible with the backend lanes
   * landing in parallel: objectif 1 names « leur statut » AND « le cycle de vie »
   * as two separate indicators, and Asset currently has no `status` column at
   * all. The moment /dashboards/assets starts returning `by_status`, the tile
   * appears here with no change to this file — and until then nothing renders an
   * empty caption pretending the indicator exists.
   */
  optional?: boolean;
}

interface ModuleDef {
  icon: typeof Boxes;
  color: string;
  titleKey: string;
  subtitleKey: string;
  /** Key accepted by GET /dashboard-export/{key}. */
  exportKey: DashboardExportKey;
  /** Where the "full dashboard" link goes (AnalyticsPage's zoomed view). */
  analyticsKey: string;
  load: () => Promise<Payload>;
  totalOf: (d: Payload) => number | undefined;
  totalLabelKey: string;
  /** Payload fields carrying a criticality signal — they drive the alert chip. */
  alertFields: string[];
  breakdowns: BreakdownDef[];
  emptyKey: string;
  /**
   * True when the payload carries real data OUTSIDE the groupings and the
   * headline total. Without it, governance with three committees but no policy
   * yet would be declared "nothing recorded", because its headline total is
   * `policies_total`. Declaring real data empty is the same class of lie as
   * showing fabricated data — the panel must describe what is actually there.
   */
  hasExtra?: (d: Payload) => boolean;
}

const MODULES: Record<ModuleDashboardKey, ModuleDef> = {
  assets: {
    icon: Boxes, color: "text-blue-600 bg-blue-50",
    titleKey: "moduledash.title_assets", subtitleKey: "moduledash.sub_assets",
    exportKey: "assets", analyticsKey: "assets",
    load: () => eliteDashboardsApi.assets(),
    totalOf: (d) => num(d.total), totalLabelKey: "moduledash.metric_total_assets",
    alertFields: ["by_criticality"],
    breakdowns: [
      { key: "by_type", titleKey: "moduledash.by_type" },
      { key: "by_criticality", titleKey: "moduledash.by_criticality" },
      { key: "by_class", titleKey: "moduledash.by_class" },
      // « leur statut » — separate from the lifecycle indicator below, and
      // rendered only once the backend actually exposes it (see BreakdownDef).
      { key: "by_status", titleKey: "moduledash.by_status", optional: true },
      { key: "by_lifecycle", titleKey: "moduledash.by_lifecycle" },
    ],
    emptyKey: "moduledash.empty_assets",
  },
  vulnerabilities: {
    icon: Bug, color: "text-rose-600 bg-rose-50",
    titleKey: "moduledash.title_vulnerabilities", subtitleKey: "moduledash.sub_vulnerabilities",
    exportKey: "vulnerabilities", analyticsKey: "vulnerabilities",
    load: () => eliteDashboardsApi.vulnerabilities(),
    totalOf: (d) => num(d.total), totalLabelKey: "moduledash.metric_total_vulnerabilities",
    alertFields: ["by_severity"],
    breakdowns: [
      { key: "by_severity", titleKey: "moduledash.by_severity" },
      { key: "by_status", titleKey: "moduledash.by_status" },
    ],
    emptyKey: "moduledash.empty_vulnerabilities",
    hasExtra: (d) => ((d.cve as CveBlock | undefined)?.pertinent_count ?? 0) > 0,
  },
  threats: {
    icon: Radar, color: "text-orange-600 bg-orange-50",
    titleKey: "moduledash.title_threats", subtitleKey: "moduledash.sub_threats",
    exportKey: "threats", analyticsKey: "threats",
    load: () => eliteDashboardsApi.threats(),
    totalOf: (d) => num(d.total), totalLabelKey: "moduledash.metric_total_threats",
    alertFields: [],
    breakdowns: [
      { key: "by_category", titleKey: "moduledash.by_category" },
      // `pending` groups on the BOOLEAN Threat.is_pending, so the keys that come
      // back are "0"/"1" (SQLite) or "true"/"false" (Postgres) — meaningless as
      // labels and impossible to translate from a global vocabulary, since "0"
      // only means "confirmed" inside this one bucket. `vocabScope` gives it its
      // own dictionary. Without it the chart reads "0 — 137".
      { key: "pending", titleKey: "moduledash.by_validation", vocabScope: "moduledash.bool_pending" },
    ],
    emptyKey: "moduledash.empty_threats",
  },
  risks: {
    icon: AlertTriangle, color: "text-amber-600 bg-amber-50",
    titleKey: "moduledash.title_risks", subtitleKey: "moduledash.sub_risks",
    exportKey: "risks", analyticsKey: "risks",
    load: () => eliteDashboardsApi.risks(),
    totalOf: (d) => num(d.total), totalLabelKey: "moduledash.metric_total_risks",
    alertFields: ["by_severity"],
    breakdowns: [
      { key: "by_severity", titleKey: "moduledash.by_severity" },
      { key: "by_status", titleKey: "moduledash.by_status" },
    ],
    emptyKey: "moduledash.empty_risks",
    hasExtra: (d) => Array.isArray(d.heatmap) && (d.heatmap as unknown[]).length > 0,
  },
  controls: {
    icon: ShieldCheck, color: "text-emerald-600 bg-emerald-50",
    titleKey: "moduledash.title_controls", subtitleKey: "moduledash.sub_controls",
    exportKey: "controls", analyticsKey: "controls",
    load: () => eliteDashboardsApi.controls(),
    totalOf: (d) => num(d.total), totalLabelKey: "moduledash.metric_total_controls",
    alertFields: [],
    breakdowns: [{ key: "by_status", titleKey: "moduledash.by_control_status" }],
    emptyKey: "moduledash.empty_controls",
    hasExtra: (d) => num(d.avg_progress) != null || num(d.total_cost) != null,
  },
  governance: {
    icon: FileText, color: "text-violet-600 bg-violet-50",
    titleKey: "moduledash.title_governance", subtitleKey: "moduledash.sub_governance",
    exportKey: "governance", analyticsKey: "governance",
    load: () => eliteDashboardsApi.governance(),
    totalOf: (d) => num(d.policies_total), totalLabelKey: "moduledash.metric_total_policies",
    alertFields: [],
    breakdowns: [
      { key: "policies_by_status", titleKey: "moduledash.by_policy_status" },
      { key: "attestations_by_status", titleKey: "moduledash.by_attestation_status" },
    ],
    emptyKey: "moduledash.empty_governance",
    hasExtra: (d) => (((d.committees as { total?: number } | undefined)?.total) ?? 0) > 0,
  },
  audit: {
    icon: ClipboardCheck, color: "text-cyan-600 bg-cyan-50",
    titleKey: "moduledash.title_audit", subtitleKey: "moduledash.sub_audit",
    exportKey: "audit", analyticsKey: "audit",
    load: () => eliteDashboardsApi.audit(),
    totalOf: (d) => num(d.audits_total), totalLabelKey: "moduledash.metric_total_audits",
    alertFields: ["findings_by_severity"],
    breakdowns: [
      { key: "audits_by_status", titleKey: "moduledash.by_audit_status" },
      { key: "findings_by_severity", titleKey: "moduledash.by_finding_severity" },
      { key: "findings_by_status", titleKey: "moduledash.by_finding_status" },
    ],
    emptyKey: "moduledash.empty_audit",
  },
};

/** Auto-refresh choices, in seconds. 0 = off.
 *
 *  This list MUST cover every cadence the main dashboard can persist (see
 *  DashboardPage's REFRESH_CHOICES: 0/30/60/300/900/1800/3600), because the
 *  cadence read below comes from exactly that setting. A `<select>` whose value
 *  matches no option renders blank — so a user who chose « toutes les 30
 *  minutes » on the home page saw a module dashboard whose control read
 *  « Désactivée » while it was in fact polling every 30 minutes. A control that
 *  misreports the configured interval fails the same clause it implements. */
const REFRESH_CHOICES: { seconds: number; labelKey: string }[] = [
  { seconds: 0, labelKey: "moduledash.refresh_off" },
  { seconds: 30, labelKey: "moduledash.refresh_30s" },
  { seconds: 60, labelKey: "moduledash.refresh_1m" },
  { seconds: 300, labelKey: "moduledash.refresh_5m" },
  { seconds: 900, labelKey: "moduledash.refresh_15m" },
  { seconds: 1800, labelKey: "moduledash.refresh_30m" },
  { seconds: 3600, labelKey: "moduledash.refresh_1h" },
];

/** The cadence the user configured on the main dashboard, so one setting drives
 *  every dashboard in the product. Read from localStorage rather than
 *  GET /dashboard/layout on purpose: this component is mounted on seven module
 *  pages and must not add a request per page just to learn a preference.
 *  localStorage THROWS outright in some privacy modes — a preference may never
 *  take a page down with it. */
const LS_REFRESH_KEY = "grceye.dashboard.main.refresh_seconds";
const DEFAULT_REFRESH_SECONDS = 60;

function savedCadence(): number | null {
  try {
    const raw = window.localStorage.getItem(LS_REFRESH_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Numeric field, or `undefined` when the server said it could not compute one.
 *
 * The null guard is load-bearing, not defensive noise. `_agg()` in
 * dashboards.py returns JSON `null` for an aggregate it has no rows for — a
 * tenant with no applied control has `avg_progress: null` and `total_cost:
 * null`, and a vulnerability register with no CVSS score has `avg_cvss: null`.
 * `Number(null)` is `0` and `Number("")` is `0`, so a plain `Number()` turned
 * every one of those into a figure the backend never asserted: "Average CVSS
 * 0.0", "Average progress 0%", "Total cost 0". That is a fabricated number on a
 * bank's screen — the exact failure this component's empty state exists to
 * avoid — and it also made `hasExtra` permanently true for the controls module,
 * which made its « rien n'est encore enregistré » panel unreachable.
 */
function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buckets(payload: Payload | undefined, key: string): Record<string, number> | undefined {
  const raw = payload?.[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as Record<string, number>;
}

/** HTTP status behind an axios rejection; 0 when the request never got an answer. */
function statusOf(error: unknown): number {
  return (error as { response?: { status?: number } } | undefined)?.response?.status ?? 0;
}

/** Never retry a refusal. A 402 (plan) or 403 (role) is a settled answer — a
 *  retry just produces the same refusal twice and delays the panel that
 *  explains it. */
function retryPolicy(failureCount: number, error: unknown): boolean {
  const status = statusOf(error);
  if (status >= 400 && status < 500) return false;
  return failureCount < 1;
}

/** The operator-actionable message for a failed load, by status. */
function errorMessageKey(status: number): string {
  if (status === 403) return "moduledash.restricted_hint";
  if (status === 404) return "moduledash.error_not_published";
  if (status === 424) return "moduledash.error_not_ready";
  if (status === 0) return "moduledash.error_unreachable";
  return "moduledash.error_generic";
}

/** A refusal the server has already settled: the plan does not include the
 *  feature, the role is not allowed, the route is not published, the parameters
 *  are wrong. Asking again on a timer cannot change any of those answers — it
 *  only repeats the refusal, and for a 402 it re-fires the application's global
 *  upgrade toast (client.ts dispatches "elite-upsell" before rejecting) once per
 *  cadence tick. 5xx and "no answer at all" are NOT settled and keep polling. */
function isSettledRefusal(error: unknown): boolean {
  const status = statusOf(error);
  return status >= 400 && status < 500;
}

function uiLang(raw: string | undefined): "en" | "fr" | "ar" {
  const value = (raw || "en").toLowerCase();
  if (value.startsWith("fr")) return "fr";
  if (value.startsWith("ar")) return "ar";
  return "en";
}

function intlLocale(lang: "en" | "fr" | "ar"): string {
  return lang === "ar" ? "ar-TN" : lang;
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

export interface ModuleDashboardProps {
  module: ModuleDashboardKey;
  className?: string;
  /** INITIAL auto-refresh cadence in seconds; 0 disables it. Defaults to the
   *  cadence configured on the main dashboard, then to 60s. The selector in the
   *  header owns it afterwards, so a later change to this prop is ignored. */
  refreshSeconds?: number;
  /** Hide the header — for a page that provides its own chrome. Note that the
   *  refresh controls, the freshness stamp, the export menu AND the criticality
   *  chip live in that header, so a page that turns it off has to carry those
   *  tender clauses itself. */
  showHeader?: boolean;
  /** Render nothing at all when the server refuses on role (403). Off by
   *  default: an explicit « accès restreint » panel is more honest than a page
   *  that silently lacks a section the tender says is there. */
  hideWhenForbidden?: boolean;
  /** Replaces the built-in PDF/Excel export. */
  onExport?: (format: "pdf" | "xlsx") => void | Promise<void>;
  /** false removes the export control entirely. */
  exportable?: boolean;
  /** false removes the « voir le tableau de bord complet » link. */
  showAnalyticsLink?: boolean;
  /** Extra content (a trend chart the page owns, for instance) rendered inside
   *  the card, under the groupings. */
  children?: React.ReactNode;
}

export default function ModuleDashboard({
  module,
  className = "",
  refreshSeconds,
  showHeader = true,
  hideWhenForbidden = false,
  onExport,
  exportable = true,
  showAnalyticsLink = true,
  children,
}: ModuleDashboardProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const def = MODULES[module];
  const { hasFeature } = useEntitlements();

  // Plan gate, checked before the request so a non-Elite tenant sees the upsell
  // instead of a 402 round trip. The context FAILS OPEN (unknown feature or a
  // failed entitlements call ⇒ true), so the 402 branch below is still the
  // authoritative one — this only spares the pointless request.
  const entitled = hasFeature("custom_dashboards");

  const [cadence, setCadence] = useState<number>(
    () => refreshSeconds ?? savedCadence() ?? DEFAULT_REFRESH_SECONDS,
  );
  const [exporting, setExporting] = useState<"" | "pdf" | "xlsx">("");
  const [exportMessage, setExportMessage] = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const query = useQuery({
    queryKey: ["module-dashboard", module],
    queryFn: () => def.load(),
    enabled: entitled,
    retry: retryPolicy,
    // `retry` already refuses to re-ask after a 4xx — but it only governs the
    // attempts inside ONE fetch. Without the same rule here, the cadence asked
    // again 60 seconds later, forever: the role gates on this router are strict
    // (a tenant_admin is 403'd on five of the seven dashboards), so seven module
    // pages would each hammer a refusal on a timer.
    refetchInterval: (query) =>
      cadence > 0 && !isSettledRefusal(query.state.error) ? cadence * 1000 : false,
    // Polling a tab nobody is looking at is load without a reader; the clause
    // asks for data that is fresh when READ, which is what focus covers.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) => !isSettledRefusal(query.state.error),
  });

  // Belt and braces on top of the list above: whatever cadence is actually in
  // force gets an option, so the control can never display something other than
  // what it is doing (a value hand-written into localStorage, or one added by a
  // later version of the main dashboard).
  const refreshChoices = useMemo(() => {
    if (REFRESH_CHOICES.some((c) => c.seconds === cadence)) return REFRESH_CHOICES;
    return [...REFRESH_CHOICES, { seconds: cadence, labelKey: "" }].sort((a, b) => a.seconds - b.seconds);
  }, [cadence]);

  const numberFormat = useMemo(() => new Intl.NumberFormat(intlLocale(lang)), [lang]);
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(intlLocale(lang), { hour: "2-digit", minute: "2-digit" }),
    [lang],
  );
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(intlLocale(lang)), [lang]);

  const data = query.data as Payload | undefined;
  const status = query.error ? statusOf(query.error) : 0;
  const total = data ? def.totalOf(data) : undefined;

  // Groupings actually present in this payload — an `optional` one that the
  // server does not send yet is simply not rendered.
  const shownBreakdowns = useMemo(
    () => def.breakdowns.filter((b) => !b.optional || buckets(data, b.key) !== undefined),
    [def.breakdowns, data],
  );

  const alerting = useMemo(
    () => def.alertFields.reduce((sum, field) => sum + countAlerting(buckets(data, field)), 0),
    [def.alertFields, data],
  );

  // Empty vs degraded are DIFFERENT answers and must not look alike:
  //  • empty    — the register really holds nothing yet (total 0, no buckets).
  //  • degraded — there are records, but every grouping came back {}, which is
  //    what `_count_by` returns when its query fails (a column missing on this
  //    database, for instance). Saying "no data" there would hide a fault.
  const anyBucketFilled = useMemo(
    () => def.breakdowns.some((b) => Object.keys(buckets(data, b.key) || {}).length > 0),
    [def.breakdowns, data],
  );
  const hasExtra = !!data && !!def.hasExtra?.(data);
  const isEmpty = !!data && (total ?? 0) === 0 && !anyBucketFilled && !hasExtra;
  const isDegraded = !!data && (total ?? 0) > 0 && !anyBucketFilled;

  const runExport = useCallback(async (format: "pdf" | "xlsx") => {
    setExportMessage("");
    if (onExport) {
      // A page-supplied handler is foreign code: an exception here would become
      // an unhandled rejection and take the console (and any error overlay)
      // with it, on a page whose data is perfectly fine.
      try {
        await onExport(format);
      } catch {
        setExportMessage(t("moduledash.export_failed"));
      }
      return;
    }
    setExporting(format);
    try {
      const { blob, filename } = await dashboardExportApi.exportDashboardFile(def.exportKey, format, lang);
      downloadBlob(blob, filename);
    } catch (err) {
      // Every failure here is a MESSAGE, never a crash and never a redirect.
      // 404 is the live case today: /dashboard-export is implemented but its
      // router is not registered yet, so the call answers 404 until it is.
      const failure = await parseDashboardExportError(err);
      if (failure.status === 402) setExportMessage(t("moduledash.export_upgrade"));
      else if (failure.status === 403) setExportMessage(t("moduledash.export_forbidden"));
      else if (failure.status === 404) setExportMessage(t("moduledash.export_unavailable"));
      else if (failure.status === 424) setExportMessage(t("moduledash.export_not_ready"));
      else setExportMessage(t("moduledash.export_failed"));
    } finally {
      setExporting("");
    }
  }, [def.exportKey, lang, onExport, t]);

  // `!data` on both 403 branches, for the same reason the isError branch below
  // carries it: react-query keeps the last successful payload, so a refusal on a
  // REFRESH (a role changed mid-session, a token rotated) must not blank a card
  // that has real figures on it. Only a 403 with nothing to show is the
  // « accès filtré par profil » state.
  if (status === 403 && !data && hideWhenForbidden) return null;

  const Icon = def.icon;
  const card = "bg-white rounded-2xl border border-gray-100 shadow-sm";

  // ── Plan gate: an explicit, translated upsell. NOT a blank card, NOT an
  //    error. The gate itself stays exactly where it is — Elite. ─────────────
  if (!entitled || status === 402) {
    return (
      <section className={`${card} p-6 ${className}`} aria-labelledby={`moduledash-${module}-title`}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-amber-50 text-amber-600">
            <Crown className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <p id={`moduledash-${module}-title`} className="text-sm font-semibold text-gray-900">
              {t("moduledash.upsell_title")}
            </p>
            <p className="text-sm text-gray-500">
              {t("moduledash.upsell_body", { module: t(def.titleKey) })}
            </p>
            <Link
              to="/settings"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              {t("moduledash.upsell_cta")}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      id={`module-dashboard-${module}`}
      className={`${card} p-5 space-y-4 ${className}`}
      // The element carrying that id lives in the header, so a page that turns
      // the header off would leave aria-labelledby pointing at nothing and the
      // section would announce as unnamed.
      {...(showHeader
        ? { "aria-labelledby": `moduledash-${module}-title` }
        : { "aria-label": t(def.titleKey) })}
    >
      {showHeader && (
        <div className="flex items-start gap-3 flex-wrap">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${def.color}`}>
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p id={`moduledash-${module}-title`} className="text-sm font-semibold text-gray-900">
              {t(def.titleKey)}
            </p>
            <p className="text-xs text-gray-500">{t(def.subtitleKey)}</p>
          </div>

          <div className="ms-auto flex items-center gap-2 flex-wrap">
            {/* « Alertes visuelles sur criticité élevée » — colour AND icon AND word. */}
            {alerting > 0 && (
              <SeverityChip count={alerting} label={t("moduledash.alert_critical_high")} tone="critical" />
            )}

            {/* « Dernière actualisation HH:MM » */}
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600"
              title={query.dataUpdatedAt
                ? t("moduledash.last_updated_at", { time: timeFormat.format(new Date(query.dataUpdatedAt)) })
                : t("moduledash.never_updated")}
            >
              <Clock className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
              {query.isFetching
                ? t("moduledash.refreshing")
                : query.dataUpdatedAt
                  ? t("moduledash.last_updated_at", { time: timeFormat.format(new Date(query.dataUpdatedAt)) })
                  : t("moduledash.never_updated")}
            </span>

            <label className="sr-only" htmlFor={`moduledash-${module}-cadence`}>
              {t("moduledash.refresh_interval")}
            </label>
            <select
              id={`moduledash-${module}-cadence`}
              value={String(cadence)}
              onChange={(e) => setCadence(Number(e.target.value))}
              title={t("moduledash.auto_refresh")}
              className="border border-gray-200 rounded-xl text-xs px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {refreshChoices.map((c) => (
                <option key={c.seconds} value={c.seconds}>
                  {c.labelKey ? t(c.labelKey) : t("moduledash.refresh_custom", { n: c.seconds })}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => { void query.refetch(); }}
              title={t("moduledash.refresh_now")}
              aria-label={t("moduledash.refresh_now")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
              {t("moduledash.refresh")}
            </button>

            {exportable && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setExportMenuOpen((o) => !o)}
                  disabled={!!exporting}
                  aria-expanded={exportMenuOpen}
                  title={t("moduledash.export_menu")}
                  aria-label={t("moduledash.export_menu")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {exporting
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    : <Download className="w-3.5 h-3.5" aria-hidden="true" />}
                  {t("moduledash.export")}
                </button>
                {exportMenuOpen && (
                  <>
                    {/* Backdrop so a click anywhere closes the menu. */}
                    <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                    <div className="absolute z-50 mt-1 end-0 min-w-[9rem] bg-white border border-gray-100 rounded-xl shadow-lg p-1">
                      <button
                        type="button"
                        onClick={() => { setExportMenuOpen(false); void runExport("pdf"); }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 rounded-lg hover:bg-gray-50"
                      >
                        <FileDown className="w-3.5 h-3.5" aria-hidden="true" /> {t("moduledash.export_pdf")}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setExportMenuOpen(false); void runExport("xlsx"); }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 rounded-lg hover:bg-gray-50"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" /> {t("moduledash.export_excel")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {exportMessage && (
        <p className="p-3 bg-amber-50 text-amber-800 rounded-xl text-xs" role="status">{exportMessage}</p>
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      {query.isLoading ? (
        <DashboardSkeleton rows={def.breakdowns.length} />
      ) : status === 403 && !data ? (
        <RestrictedPanel />
      ) : query.isError && !data ? (
        // Only when there is nothing to show. A failed AUTO-REFRESH must not
        // wipe a dashboard that loaded correctly: react-query keeps the last
        // successful payload and flips isError, so replacing the card with an
        // error panel on a 60-second cadence means one transient blip erases
        // every figure on the page. When data survives, the failure is shown as
        // a banner over the (stale but real) numbers instead — see below.
        <ErrorPanel status={status} onRetry={() => { void query.refetch(); }} />
      ) : isEmpty ? (
        <EmptyPanel messageKey={def.emptyKey} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <p className="text-xs text-gray-500">{t(def.totalLabelKey)}</p>
              <p className="text-3xl font-bold text-gray-900 tabular-nums leading-tight">
                {total != null ? numberFormat.format(total) : t("moduledash.not_available")}
              </p>
            </div>
            <ModuleMetrics module={module} data={data} numberFormat={numberFormat} dateFormat={dateFormat} />
          </div>

          {/* A refresh failed but the previous payload is still on screen. Say
              which figures the user is looking at rather than either hiding the
              fault or throwing away the data. */}
          {query.isError && (
            <div className="p-3 bg-amber-50 text-amber-800 rounded-xl text-xs flex items-start gap-2" role="status">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                {t(errorMessageKey(status))}{" "}
                {query.dataUpdatedAt
                  ? t("moduledash.last_updated_at", { time: timeFormat.format(new Date(query.dataUpdatedAt)) })
                  : null}
              </span>
              <button
                type="button"
                onClick={() => { void query.refetch(); }}
                className="ms-auto shrink-0 underline font-medium"
              >
                {t("moduledash.retry")}
              </button>
            </div>
          )}

          {isDegraded && (
            <p className="p-3 bg-amber-50 text-amber-800 rounded-xl text-xs" role="status">
              {t("moduledash.degraded")}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {shownBreakdowns.map((b) => (
              <Breakdown
                key={b.key}
                title={t(b.titleKey)}
                dataKey={b.key}
                data={buckets(data, b.key)}
                vocabScope={b.vocabScope}
                emptyLabel={t("moduledash.no_data")}
              />
            ))}
          </div>

          {module === "risks" && <RiskHeatmap cells={(data?.heatmap as HeatmapCell[]) || []} />}
          {module === "vulnerabilities" && <CveSummary cve={data?.cve as CveBlock | undefined} />}

          {children}

          {showAnalyticsLink && (
            <Link
              to={`/analytics?dashboard=${def.analyticsKey}`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              {t("moduledash.open_full")}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

/* ── States ────────────────────────────────────────────────────────────── */

function DashboardSkeleton({ rows }: { rows: number }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t("moduledash.loading")}</span>
      <div className="h-8 w-24 bg-gray-100 rounded-lg animate-pulse" />
      {Array.from({ length: Math.max(2, rows) }).map((_, i) => (
        <div key={i} className="h-2.5 bg-gray-100 rounded-full animate-pulse" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

/** 403 — the role gate doing its job. Objectif « accès filtré par profil ». */
function RestrictedPanel() {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
        <Lock className="w-4 h-4 text-gray-400" aria-hidden="true" />
        {t("moduledash.restricted_title")}
      </p>
      <p className="text-xs text-gray-500">{t("moduledash.restricted_hint")}</p>
    </div>
  );
}

/**
 * Anything else. Each status gets a message an operator can act on — a 404 says
 * the dashboard is not published on this server, a 424 that its schema is behind
 * the code. None of them redirect, none of them retry silently.
 */
function ErrorPanel({ status, onRetry }: { status: number; onRetry: () => void }) {
  const { t } = useTranslation();
  const key = errorMessageKey(status);
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
        {t("moduledash.error_title")}
      </p>
      <p className="text-xs text-gray-500">{t(key)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        {t("moduledash.retry")}
      </button>
    </div>
  );
}

/** The register is genuinely empty. Say so — never substitute sample data. */
function EmptyPanel({ messageKey }: { messageKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="py-4 space-y-1">
      <p className="text-sm font-semibold text-gray-700">{t("moduledash.empty_title")}</p>
      <p className="text-xs text-gray-500">{t(messageKey)}</p>
    </div>
  );
}

/* ── Per-module extra metrics ──────────────────────────────────────────── */

interface CveBlock {
  pertinent_count?: number;
  top?: { cve_id: string; cvss_score: number | null }[];
}

interface HeatmapCell {
  likelihood: number | null;
  impact: number | null;
  count: number;
}

/** One "label — value" pair. The backend returns null for anything it could not
 *  compute and never fabricates a 0, so null renders « non disponible ». */
function MiniMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2 min-w-[7.5rem]">
      <p className="text-[11px] text-gray-500 truncate" title={label}>{label}</p>
      <p className="text-sm font-semibold text-gray-800 tabular-nums">{value}</p>
    </div>
  );
}

function ModuleMetrics({
  module, data, numberFormat, dateFormat,
}: {
  module: ModuleDashboardKey;
  data: Payload | undefined;
  numberFormat: Intl.NumberFormat;
  dateFormat: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation();
  if (!data) return null;
  const na = t("moduledash.not_available");

  if (module === "vulnerabilities") {
    const avg = num(data.avg_cvss);
    const cve = data.cve as CveBlock | undefined;
    return (
      <div className="flex items-end gap-2 flex-wrap">
        <MiniMetric label={t("moduledash.metric_avg_cvss")} value={avg != null ? avg.toFixed(1) : na} />
        <MiniMetric
          label={t("moduledash.metric_pertinent_cves")}
          value={cve?.pertinent_count != null ? numberFormat.format(cve.pertinent_count) : na}
        />
      </div>
    );
  }
  if (module === "controls") {
    const progress = num(data.avg_progress);
    const cost = num(data.total_cost);
    return (
      <div className="flex items-end gap-2 flex-wrap">
        <MiniMetric label={t("moduledash.metric_avg_progress")} value={progress != null ? `${Math.round(progress)}%` : na} />
        <MiniMetric label={t("moduledash.metric_total_cost")} value={cost != null ? numberFormat.format(cost) : na} />
      </div>
    );
  }
  if (module === "governance") {
    const committees = data.committees as { total?: number; next_meeting?: { next_meeting_date?: string } | null } | undefined;
    const nextDate = committees?.next_meeting?.next_meeting_date;
    // The date is a free-text ISO string in this schema, so an unparseable value
    // must degrade to « non disponible » rather than render "Invalid Date".
    const parsed = nextDate ? new Date(nextDate) : null;
    return (
      <div className="flex items-end gap-2 flex-wrap">
        <MiniMetric
          label={t("moduledash.metric_committees")}
          value={committees?.total != null ? numberFormat.format(committees.total) : na}
        />
        <MiniMetric
          label={t("moduledash.metric_next_meeting")}
          value={parsed && !Number.isNaN(parsed.getTime()) ? dateFormat.format(parsed) : na}
        />
      </div>
    );
  }
  return null;
}

/** Top pertinent CVEs — objectif 2's « vulnérabilités les plus critiques ». */
function CveSummary({ cve }: { cve?: CveBlock }) {
  const { t } = useTranslation();
  const top = cve?.top || [];
  if (!top.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {t("moduledash.top_cves")}
      </p>
      <div className="space-y-1">
        {top.map((e) => (
          <div key={e.cve_id} className="flex items-center justify-between text-xs gap-2">
            <span className="font-mono text-gray-700 truncate">{e.cve_id}</span>
            <span className="font-semibold text-rose-600 tabular-nums shrink-0">
              {e.cvss_score != null ? Number(e.cvss_score).toFixed(1) : t("moduledash.not_available")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 5x5 likelihood x impact grid — objectif 4's « cartographie des risques »,
 *  rendered from the `heatmap` cells the risks dashboard already returns. */
function RiskHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const { t } = useTranslation();
  const counts = new Map<string, number>();
  // Risk.likelihood/impact are FLOAT columns and the product ships configurable
  // matrices (3x3, 5x5, custom), so a cell can legitimately land outside this
  // 1-5 grid. Dropping it silently would understate the cartography — the same
  // class of lie as inventing a figure — so what does not fit is counted and
  // declared under the grid.
  let outside = 0;
  for (const cell of cells || []) {
    const l = Number(cell?.likelihood);
    const i = Number(cell?.impact);
    const n = Number(cell?.count) || 0;
    if (!Number.isInteger(l) || !Number.isInteger(i) || l < 1 || l > 5 || i < 1 || i > 5) {
      // likelihood/impact null is "not scored yet", not a missing plot.
      if (cell?.likelihood != null && cell?.impact != null) outside += n;
      continue;
    }
    const id = `${l}:${i}`;
    counts.set(id, (counts.get(id) || 0) + n);
  }
  if (counts.size === 0 && outside === 0) return null;
  const impacts = [5, 4, 3, 2, 1];
  const likelihoods = [1, 2, 3, 4, 5];
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {t("moduledash.heatmap")}
      </p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1">
          <caption className="sr-only">{t("moduledash.heatmap")}</caption>
          <tbody>
            {impacts.map((impact) => (
              <tr key={impact}>
                <th scope="row" className="text-[10px] font-normal text-gray-400 pe-1 align-middle">{impact}</th>
                {likelihoods.map((likelihood) => {
                  const n = counts.get(`${likelihood}:${impact}`) || 0;
                  const score = likelihood * impact;
                  // Colour is a hint; the COUNT is written in every cell, so the
                  // grid is readable without relying on the colour at all.
                  const tone = n === 0
                    ? "bg-gray-50 text-gray-300"
                    : score >= 15 ? "bg-rose-100 text-rose-800 ring-1 ring-rose-300"
                      : score >= 8 ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-50 text-emerald-800";
                  return (
                    <td
                      key={likelihood}
                      className={`w-8 h-7 text-center text-xs font-semibold rounded ${tone}`}
                      // `n`, not `count`: passing `count` to t() switches i18next into plural
                      // resolution and looks for _one/_other keys that do not exist here.
                      title={t("moduledash.heatmap_cell", { n, likelihood, impact })}
                    >
                      {n || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" aria-hidden="true" />
              {likelihoods.map((l) => (
                <td key={l} className="text-[10px] text-gray-400 text-center">{l}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        {t("moduledash.axis_likelihood")} → · ↑ {t("moduledash.axis_impact")}
      </p>
      {outside > 0 && (
        <p className="text-[11px] text-amber-700 mt-1">
          {/* `n`, not `count` — see the heatmap_cell note above. */}
          {t("moduledash.heatmap_outside", { n: outside })}
        </p>
      )}
    </div>
  );
}
