/**
 * Breakdown — the shared "grouped counts" list every dashboard renders.
 *
 * The nine STB dashboards all return the same shape for their groupings:
 * `Record<enumValue, count>` produced by `_count_by()` in
 * backend/app/api/v1/endpoints/dashboards.py. AnalyticsPage grew a private copy
 * of this list; ModuleDashboard needs the same thing on seven module pages, and
 * a tenth screen will need it tomorrow. It lives here so the wording, the
 * ordering and — above all — the criticality alert cannot drift into ten
 * slightly different behaviours.
 *
 * Two tender clauses are load-bearing in this file:
 *
 *   « Alertes visuelles sur criticité élevée » (objectifs 2 et 5) — a critical /
 *     high bucket is marked with an ICON and a font weight and an outline, never
 *     by colour alone. A colour-only alert disappears on a printed board pack
 *     and for a colour-blind reader, which is exactly the population an « alerte
 *     visuelle » is for.
 *
 *   The interface must be genuinely French/Arabic — the bucket keys arrive as
 *     RAW BACKEND ENUM VALUES (`in_use`, `cyber_attack`, `pending_validation`).
 *     Rendering `key.replace(/_/g, " ")` shows a French user "in use" and
 *     "cyber attack". Every key therefore goes through `useBucketLabel()`, which
 *     walks the translated vocabularies before it degrades to the humanised key.
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

/** Bar palette, matching the one AnalyticsPage uses so the two screens read as
 *  one product. Index-based, deliberately not keyed on the value: these are
 *  categories, not a scale. */
export const BAR_COLORS = [
  "bg-blue-500", "bg-indigo-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-violet-500", "bg-cyan-500", "bg-orange-500",
];

/** Hex mirror of BAR_COLORS for anything that has to draw outside Tailwind
 *  (SVG charts, PNG export). */
export const CHART_COLORS = [
  "#2185D3", "#3F92D6", "#5BBD74", "#E4C64F",
  "#DB4241", "#0C5D9E", "#72B0E4", "#EF852E",
];

/**
 * Buckets that actually carry a criticality signal. Only these raise an alert
 * and only these are touched by a severity filter — flagging `by_type` because
 * one of its values happens to be called "critical" would be noise, and
 * filtering it by severity would silently empty a chart that has nothing to do
 * with severity.
 */
export const SEVERITY_SCOPED = new Set([
  "by_severity", "by_criticality", "by_priority",
  "findings_by_severity", "gaps_by_severity",
]);

/** Values that mean "this needs attention now" across every module's vocabulary. */
export const ALERT_KEYS = new Set(["critical", "high", "very_high", "urgent", "blocker"]);

/** Rank used to order a severity-scoped breakdown. `_count_by` groups in
 *  whatever order the database returns, so without this the same dashboard can
 *  list "low, critical, medium" on one server and "critical, low, medium" on
 *  the next. A severity list that does not descend is unreadable in a board pack. */
const SEVERITY_ORDER = [
  "critical", "very_high", "urgent", "blocker", "high", "medium",
  "low", "very_low", "info", "informational", "observation",
];

/** Vocabularies tried, in order, before a key is humanised.
 *
 *  `vocab` — the Elite Pack's product-wide backend vocabulary — is tried FIRST,
 *  and that order is deliberate. AnalyticsPage's own label resolver starts at
 *  `vocab`, so putting `moduledash.vocab` ahead of it made the same enum render
 *  two different ways in the same product: a risk with status `open` read
 *  « Ouvert » on Analytics and « Ouverte » on the risk page, `in_use` read
 *  « En service » on one screen and « En exploitation » on the other (16 such
 *  divergences in FR, 34 in AR). One value, one wording.
 *
 *  `moduledash.vocab` therefore FILLS THE GAPS rather than overriding: it is
 *  what supplies the seven enum values `vocab` does not carry (the asset
 *  operating statuses `operational`/`degraded`/`out_of_service`/`quarantined`/
 *  `lost` that objectif 1's « leur statut » needs, plus `blocker` and `none`).
 *  The rest are older per-screen namespaces, kept so nothing that already
 *  translated stops translating. */
const KEY_NAMESPACES = [
  "vocab",
  "moduledash.vocab",
  "compliance.severities",
  "recommendations.statuses",
  "audit_detail.finding_statuses",
  "audit_detail.statuses",
  "audit_campaign.statuses",
  "compliance.status_options",
];

export function isAlertKey(key: string): boolean {
  return ALERT_KEYS.has(String(key ?? "").toLowerCase());
}

/**
 * Translates one raw bucket key.
 *
 * `scope` is an optional namespace tried FIRST, for buckets whose keys are not
 * self-describing. The threats dashboard is the live case: it groups on the
 * boolean `Threat.is_pending`, so SQLite hands back the keys "0" and "1" and a
 * global vocabulary cannot say what they mean — "0" is only "confirmed" inside
 * that one bucket. See ModuleDashboard's THREATS definition.
 */
export function useBucketLabel(scope?: string) {
  const { t, i18n } = useTranslation();
  return useCallback((key: string): string => {
    const raw = String(key ?? "").toLowerCase();
    const namespaces = scope ? [scope, ...KEY_NAMESPACES] : KEY_NAMESPACES;
    for (const namespace of namespaces) {
      const full = `${namespace}.${raw}`;
      if (i18n.exists(full)) return t(full);
    }
    // Last resort. Deliberately not an error: an enum value added to the backend
    // after this release must still render as something a human can read.
    return String(key ?? "").replace(/_/g, " ");
  }, [t, i18n, scope]);
}

/**
 * Severity chip — « alerte visuelle sur criticité élevée » in its smallest form.
 * Colour + icon + the word itself, so it survives greyscale printing.
 */
export function SeverityChip({
  count,
  label,
  tone = "critical",
  className = "",
}: {
  count: number;
  label: string;
  tone?: "critical" | "warning" | "neutral";
  className?: string;
}) {
  const tones = {
    critical: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    warning: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    neutral: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {tone !== "neutral" && <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      <span className="tabular-nums">{count}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Total sitting in the alerting buckets (critical + high + …) of one grouping. */
export function countAlerting(data?: Record<string, number>): number {
  return Object.entries(data || {})
    .filter(([k]) => isAlertKey(k))
    .reduce((sum, [, v]) => sum + (Number(v) || 0), 0);
}

export interface BreakdownProps {
  /** Already-translated caption for the grouping. */
  title: string;
  /** The payload field this grouping came from (`by_severity`, `by_type`, …).
   *  Drives the alert/filter scoping — see SEVERITY_SCOPED. */
  dataKey: string;
  data?: Record<string, number>;
  /** Client-side severity filter. `/dashboards/*` take NO query parameters, so a
   *  filter can only be honest about being applied to the buckets already
   *  returned; it is ignored on groupings that carry no severity meaning. */
  severity?: string;
  /** Larger type/bars when a dashboard is shown full width. */
  focused?: boolean;
  /** Cap the rows; the remainder is folded into an « Autres » line rather than
   *  silently dropped — a hidden row is a missing figure to an auditor. */
  maxRows?: number;
  /** Rendered instead of nothing when the grouping came back empty. Empty is a
   *  real state here: `_count_by` degrades to {} when its query fails. */
  emptyLabel?: string;
  /** Optional first-choice vocabulary for this grouping's keys. */
  vocabScope?: string;
  /** Hand the rendered entries to a caller that can turn them into a PNG. */
  onExport?: (title: string, entries: { label: string; value: number; color: string }[]) => void;
  exportLabel?: string;
}

export function Breakdown({
  title,
  dataKey,
  data,
  severity = "all",
  focused = false,
  maxRows,
  emptyLabel,
  vocabScope,
  onExport,
  exportLabel,
}: BreakdownProps) {
  const { t, i18n } = useTranslation();
  const label = useBucketLabel(vocabScope);
  const scoped = SEVERITY_SCOPED.has(dataKey);

  const numberFormat = useMemo(
    // ar-TN rather than plain "ar": the Maghreb locales use Western digits, so
    // the Arabic rendering of a figure stays comparable with the French one in
    // the same board pack.
    () => new Intl.NumberFormat(i18n.language?.startsWith("ar") ? "ar-TN" : i18n.language || "en"),
    [i18n.language],
  );

  const entries = useMemo(() => {
    const all = Object.entries(data || {}).map(([k, v]) => [k, Number(v) || 0] as [string, number]);
    const filtered = scoped && severity !== "all"
      ? all.filter(([k]) => k.toLowerCase() === severity)
      : all;
    const sorted = filtered.sort((a, b) => {
      if (scoped) {
        const ra = SEVERITY_ORDER.indexOf(a[0].toLowerCase());
        const rb = SEVERITY_ORDER.indexOf(b[0].toLowerCase());
        // Unknown severities keep a stable place after the known ones instead of
        // jumping to the front on an indexOf() of -1.
        if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      }
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
    if (!maxRows || sorted.length <= maxRows) return sorted;
    const head = sorted.slice(0, maxRows);
    const rest = sorted.slice(maxRows).reduce((sum, [, v]) => sum + v, 0);
    return rest > 0 ? [...head, ["__other__", rest] as [string, number]] : head;
  }, [data, scoped, severity, maxRows]);

  const max = Math.max(1, ...entries.map(([, v]) => v));
  const empty = entries.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
        {onExport && !empty && (
          <button
            type="button"
            onClick={() =>
              onExport(
                title,
                entries.map(([k, v], i) => ({
                  label: k === "__other__" ? t("moduledash.other") : label(k),
                  value: v,
                  color: CHART_COLORS[i % CHART_COLORS.length],
                })),
              )
            }
            title={exportLabel || t("moduledash.export_image")}
            aria-label={exportLabel || t("moduledash.export_image")}
            className="text-xs text-gray-400 hover:text-blue-600 transition-colors shrink-0"
          >
            ⤓
          </button>
        )}
      </div>
      {empty ? (
        <p className="text-xs text-gray-400">{emptyLabel || t("moduledash.no_data")}</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([k, value], i) => {
            const other = k === "__other__";
            const text = other ? t("moduledash.other") : label(k);
            // Colour is only ever the SECOND signal: the icon and the weight
            // carry the alert on their own.
            const alarming = scoped && !other && isAlertKey(k) && value > 0;
            const barClass = alarming
              ? (k.toLowerCase() === "critical" ? "bg-rose-600" : "bg-orange-500")
              : BAR_COLORS[i % BAR_COLORS.length];
            return (
              <div key={k} className="flex items-center gap-2">
                <span
                  className={`${focused ? "w-40" : "w-28"} shrink-0 text-xs truncate flex items-center gap-1 ${alarming ? "font-semibold text-rose-700" : "text-gray-600"}`}
                  title={text}
                >
                  {alarming && <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />}
                  {text}
                </span>
                <div
                  className={`flex-1 ${focused ? "h-3" : "h-2"} bg-gray-100 rounded-full overflow-hidden ${alarming ? "ring-1 ring-rose-300" : ""}`}
                  role="img"
                  aria-label={`${text}: ${value}`}
                >
                  <div className={`h-full ${barClass} rounded-full`} style={{ width: `${(value / max) * 100}%` }} />
                </div>
                <span className={`w-10 text-end text-xs tabular-nums ${alarming ? "font-bold text-rose-700" : "font-semibold text-gray-700"}`}>
                  {numberFormat.format(value)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Breakdown;
