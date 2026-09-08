/**
 * ActivityLogPage — le journal de traçabilité.
 *
 * Objectif 8 of the tender asks the trail to answer three questions, filtered by
 * the reader's rights: who ACCESSED a record, who MODIFIED it, and who VALIDATED
 * it. The backend now records the access verbs (view / download) and normalises
 * the validation ones (approve / close / distribute), publishes the vocabulary
 * it actually holds through /activity-log/actions, and exposes sign-in history
 * and a per-object access report.
 *
 * This screen is the reader for all of it:
 *   • Activity  — the filterable trail (actor, verb, family, origin, period).
 *   • Sign-ins  — /activity-log/login-events, « qui s'est connecté, d'où ».
 *   • Access    — /activity-log/access/{type}/{id}, « qui a consulté CE rapport ».
 *
 * The verb list is never hard-coded: it comes from the catalogue endpoint, so a
 * verb the backend starts recording tomorrow is filterable today.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, Filter, Plus, Pencil, Trash2, LogIn, Download, Upload, Activity, Clock,
  Eye, ShieldCheck, Send, CheckCircle2, X, ChevronLeft, ChevronRight, Search,
  Lock, FileSearch, ShieldAlert, Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { activityLogApi } from "@/api/endpoints";
import type {
  ActivityLogEntry, ActivityActionCatalogue, EntityAccessReport, LoginEvent,
} from "@/types";

// ── Verb styling ──────────────────────────────────────────────────────────────
// Only the verbs with a distinct meaning get their own colour; everything else
// falls back to its family (access / validation / change), which is exactly how
// the backend groups them.

const ACTION_STYLE: Record<string, { color: string; bg: string; icon: typeof Plus }> = {
  create:     { color: "text-green-600",  bg: "bg-green-50 border-green-200",   icon: Plus },
  update:     { color: "text-blue-600",   bg: "bg-blue-50 border-blue-200",     icon: Pencil },
  delete:     { color: "text-red-600",    bg: "bg-red-50 border-red-200",       icon: Trash2 },
  login:      { color: "text-purple-600", bg: "bg-purple-50 border-purple-200", icon: LogIn },
  logout:     { color: "text-purple-600", bg: "bg-purple-50 border-purple-200", icon: LogIn },
  export:     { color: "text-gray-600",   bg: "bg-gray-50 border-gray-200",     icon: Download },
  import:     { color: "text-teal-600",   bg: "bg-teal-50 border-teal-200",     icon: Upload },
  view:       { color: "text-sky-600",    bg: "bg-sky-50 border-sky-200",       icon: Eye },
  download:   { color: "text-cyan-600",   bg: "bg-cyan-50 border-cyan-200",     icon: Download },
  approve:    { color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", icon: ShieldCheck },
  validate:   { color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", icon: ShieldCheck },
  close:      { color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  distribute: { color: "text-indigo-600", bg: "bg-indigo-50 border-indigo-200", icon: Send },
  reject:     { color: "text-rose-600",   bg: "bg-rose-50 border-rose-200",     icon: X },
};

const CATEGORY_STYLE: Record<string, { color: string; bg: string; icon: typeof Plus }> = {
  access:     { color: "text-sky-600",     bg: "bg-sky-50 border-sky-200",         icon: Eye },
  validation: { color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", icon: ShieldCheck },
  change:     { color: "text-amber-600",   bg: "bg-amber-50 border-amber-200",     icon: Pencil },
  other:      { color: "text-gray-600",    bg: "bg-gray-50 border-gray-200",       icon: Activity },
};

function styleFor(entry: { action?: string | null; category?: string | null }) {
  return (
    ACTION_STYLE[entry.action ?? ""] ??
    CATEGORY_STYLE[entry.category ?? ""] ??
    CATEGORY_STYLE.other
  );
}

/** Used only until the catalogue answers — it never overrides what the tenant
 *  actually recorded, it just keeps the dropdowns usable while it loads. */
const FALLBACK_ACTIONS = [
  "create", "update", "delete", "login", "export", "import",
  "view", "download", "approve", "close", "distribute",
];
const FALLBACK_ENTITIES = ["risk", "vendor", "audit", "policy", "compliance", "asset", "incident", "report"];
const CATEGORIES = ["access", "validation", "change", "other"];

const LIMIT = 25;

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function isForbidden(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 403;
}
function isLocked(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 402;
}

function useTimeAgo() {
  const { t } = useTranslation();
  return function timeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.max(0, now - then);
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return t("activity_log.time_just_now");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    return new Date(dateStr).toLocaleDateString();
  };
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function ActorCell({ entry }: { entry: ActivityLogEntry }) {
  const { t } = useTranslation();
  const name = entry.actor_name?.trim();
  const email = entry.actor_email || entry.user_email;
  if (entry.is_system) {
    return (
      <span className="inline-flex items-center gap-1.5 text-gray-500">
        <ShieldAlert className="w-3.5 h-3.5" /> {t("activity_log.actor_system")}
      </span>
    );
  }
  if (!name && !email) {
    return <span className="text-gray-400">{t("activity_log.actor_unknown")}</span>;
  }
  return (
    <span className="min-w-0 block">
      <span className="block font-medium text-gray-900 truncate">{name || email}</span>
      {name && email && <span className="block text-xs text-gray-400 truncate">{email}</span>}
    </span>
  );
}

function ChangedFields({ details }: { details: Record<string, unknown> | null }) {
  const { t } = useTranslation();
  const changed = details?.changed as Record<string, { from?: unknown; to?: unknown }> | undefined;
  if (!changed || typeof changed !== "object" || !Object.keys(changed).length) return null;
  return (
    <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-500 mb-1.5">{t("activity_log.changed_fields")}</p>
      <div className="space-y-1">
        {Object.entries(changed).map(([field, delta]) => (
          <div key={field} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-mono text-gray-600">{field}</span>
            <span className="text-gray-400">{t("activity_log.changed_from")}</span>
            <span className="text-gray-700">{String(delta?.from ?? "—")}</span>
            <span className="text-gray-400">{t("activity_log.changed_to")}</span>
            <span className="font-medium text-gray-900">{String(delta?.to ?? "—")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab 1: the trail ──────────────────────────────────────────────────────────

function TrailTab({
  catalogue,
  onInspectEntity,
}: {
  catalogue: ActivityActionCatalogue | null;
  onInspectEntity: (entityType: string, entityId: string) => void;
}) {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();

  const [items, setItems] = useState<ActivityLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [offset, setOffset] = useState(0);

  const [entityFilter, setEntityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const actions = catalogue?.actions_present?.length ? catalogue.actions_present : FALLBACK_ACTIONS;
  const entities = catalogue?.entity_types_present?.length ? catalogue.entity_types_present : FALLBACK_ENTITIES;
  const origins = catalogue?.origins_present ?? [];
  const categories = catalogue?.category_choices?.length ? catalogue.category_choices : CATEGORIES;

  const hasFilters =
    !!(entityFilter || actionFilter || categoryFilter || originFilter || dateFrom || dateTo);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: {
        entity_type?: string; action?: string; category?: string; origin?: string;
        date_from?: string; date_to?: string; limit: number; offset: number;
      } = { limit: LIMIT, offset };
      if (entityFilter) params.entity_type = entityFilter;
      if (actionFilter) params.action = actionFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (originFilter) params.origin = originFilter;
      // The API takes datetimes; a date picker gives a day, so the range is
      // widened to cover it end to end rather than stopping at midnight.
      if (dateFrom) params.date_from = `${dateFrom}T00:00:00`;
      if (dateTo) params.date_to = `${dateTo}T23:59:59`;
      const data = await activityLogApi.list(params);
      setItems(data?.items ?? []);
      setTotal(data?.total ?? 0);
      setForbidden(false);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setForbidden(isForbidden(err));
    } finally {
      setLoading(false);
    }
  }, [offset, entityFilter, actionFilter, categoryFilter, originFilter, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  function resetFilters() {
    setEntityFilter(""); setActionFilter(""); setCategoryFilter("");
    setOriginFilter(""); setDateFrom(""); setDateTo(""); setOffset(0);
  }

  function onFilterChange(setter: (v: string) => void) {
    return (value: string) => { setter(value); setOffset(0); };
  }

  const selectClass =
    "border border-gray-200 rounded-xl text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />

          <select value={entityFilter} onChange={(e) => onFilterChange(setEntityFilter)(e.target.value)} className={selectClass} aria-label={t("activity_log.all_entities")}>
            <option value="">{t("activity_log.all_entities")}</option>
            {entities.map((et) => (
              <option key={et} value={et}>{t(`activity_log.entities.${et}`, { defaultValue: et })}</option>
            ))}
          </select>

          <select value={actionFilter} onChange={(e) => onFilterChange(setActionFilter)(e.target.value)} className={selectClass} aria-label={t("activity_log.all_actions")}>
            <option value="">{t("activity_log.all_actions")}</option>
            {actions.map((a) => (
              <option key={a} value={a}>{t(`activity_log.actions.${a}`, { defaultValue: a })}</option>
            ))}
          </select>

          <select value={categoryFilter} onChange={(e) => onFilterChange(setCategoryFilter)(e.target.value)} className={selectClass} aria-label={t("activity_log.category")}>
            <option value="">{t("activity_log.all_categories")}</option>
            {categories.map((c) => (
              <option key={c} value={c}>{t(`activity_log.categories.${c}`, { defaultValue: c })}</option>
            ))}
          </select>

          {origins.length > 0 && (
            <select value={originFilter} onChange={(e) => onFilterChange(setOriginFilter)(e.target.value)} className={selectClass} aria-label={t("activity_log.origin")}>
              <option value="">{t("activity_log.all_origins")}</option>
              {origins.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500" htmlFor="activity-date-from">
              {t("activity_log.date_from", { defaultValue: t("audit_campaign.period_start") })}
            </label>
            <input
              id="activity-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => onFilterChange(setDateFrom)(e.target.value)}
              className={selectClass}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500" htmlFor="activity-date-to">
              {t("activity_log.date_to", { defaultValue: t("audit_campaign.period_end") })}
            </label>
            <input
              id="activity-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => onFilterChange(setDateTo)(e.target.value)}
              className={selectClass}
            />
          </div>

          {hasFilters && (
            <button
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded-lg px-3 py-2 transition-colors"
            >
              <X className="w-3 h-3" /> {t("activity_log.clear_filters")}
            </button>
          )}
        </div>
      </div>

      {/* Entries */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : forbidden ? (
          <div className="text-center py-16 text-gray-500">
            <Lock className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">{t("activity_log.forbidden")}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">{hasFilters ? t("activity_log.no_activity") : t("activity_log.no_entries")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500 whitespace-nowrap">{t("common.date")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("activity_log.actor")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("common.actions")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("activity_log.entity_name_col")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("activity_log.origin")}</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => {
                  const style = styleFor(entry);
                  const Icon = style.icon;
                  return (
                    <tr key={entry.id} className="border-b border-gray-50 align-top hover:bg-gray-50/50">
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-gray-400" />
                          {entry.created_at ? timeAgo(entry.created_at) : "—"}
                        </span>
                        <span className="block text-xs text-gray-400 mt-0.5">{fmtDateTime(entry.created_at)}</span>
                      </td>
                      <td className="px-6 py-4 max-w-[220px]"><ActorCell entry={entry} /></td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${style.bg} ${style.color}`}>
                          <Icon className="w-3 h-3" />
                          {t(`activity_log.actions.${entry.action}`, { defaultValue: entry.action })}
                        </span>
                        {entry.category && (
                          <span className="block text-xs text-gray-400 mt-1">
                            {t(`activity_log.categories.${entry.category}`, { defaultValue: entry.category })}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="block text-gray-900">
                          {t(`activity_log.entities.${entry.entity_type}`, { defaultValue: entry.entity_type })}
                        </span>
                        {entry.entity_name && (
                          <span className="block text-xs font-medium text-gray-600 mt-0.5">{entry.entity_name}</span>
                        )}
                        <ChangedFields details={entry.details} />
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        <span className="block">{entry.origin || "—"}</span>
                        {entry.ip_address && <span className="block text-xs text-gray-400">{entry.ip_address}</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {entry.entity_id && (
                          <button
                            type="button"
                            onClick={() => onInspectEntity(entry.entity_type, entry.entity_id as string)}
                            title={t("activity_log.access_report_title")}
                            aria-label={t("activity_log.access_report_title")}
                            className="text-gray-400 hover:text-blue-600"
                          >
                            <FileSearch className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !forbidden && items.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-50">
            <p className="text-xs text-gray-400">
              {offset + 1}–{offset + items.length} {t("common.of")} {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" /> {t("common.previous")}
              </button>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + items.length >= total}
                className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-30"
              >
                {t("common.next")} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 2: sign-ins ───────────────────────────────────────────────────────────

function LoginsTab() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [onlyFailures, setOnlyFailures] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    activityLogApi
      .loginEvents(onlyFailures ? { success: false, limit: 100 } : { limit: 100 })
      .then((rows) => {
        if (cancelled) return;
        setEvents(Array.isArray(rows) ? rows : []);
        setLocked(false);
        setForbidden(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setEvents([]);
        setLocked(isLocked(err));
        setForbidden(isForbidden(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onlyFailures]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{t("activity_log.login_events_title")}</h2>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={onlyFailures}
            onChange={(e) => setOnlyFailures(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          {t("activity_log.login_failure")}
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
      ) : forbidden ? (
        <div className="text-center py-16 text-gray-500">
          <Lock className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">{t("activity_log.forbidden")}</p>
        </div>
      ) : locked ? (
        <div className="text-center py-16 text-sm text-gray-400">{t("elite.upsell_default", "This capability is part of the Elite Pack.")}</div>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-400">{t("activity_log.no_login_events")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("common.date")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("activity_log.login_account")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("activity_log.login_result")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("activity_log.login_ip")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("activity_log.login_device")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-4 whitespace-nowrap text-gray-500">{fmtDateTime(event.created_at)}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{event.email}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                      event.success
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-red-50 text-red-700 border-red-200"
                    }`}>
                      {event.success ? t("activity_log.login_success") : t("activity_log.login_failure")}
                    </span>
                    {!event.success && event.reason && (
                      <span className="block text-xs text-gray-400 mt-1">{event.reason}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-500">{event.ip_address || "—"}</td>
                  <td className="px-6 py-4 text-gray-400 max-w-xs truncate" title={event.user_agent ?? ""}>
                    {event.user_agent || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab 3: who consulted this record ──────────────────────────────────────────

function AccessTab({
  initial,
  entityTypes,
}: {
  initial: { entityType: string; entityId: string } | null;
  entityTypes: string[];
}) {
  const { t } = useTranslation();
  const [entityType, setEntityType] = useState(initial?.entityType ?? "report");
  const [entityId, setEntityId] = useState(initial?.entityId ?? "");
  const [report, setReport] = useState<EntityAccessReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [searched, setSearched] = useState(false);

  const run = useCallback(async (type: string, id: string) => {
    if (!type || !id.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const data = await activityLogApi.entityAccessReport(type, id.trim(), { category: "access", recent_limit: 25 });
      setReport(data);
      setForbidden(false);
    } catch (err) {
      setReport(null);
      setForbidden(isForbidden(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initial?.entityId) {
      setEntityType(initial.entityType);
      setEntityId(initial.entityId);
      run(initial.entityType, initial.entityId);
    }
  }, [initial, run]);

  // The selected type always appears in the list, even when the tenant's trail
  // holds no entry of that type yet — otherwise the select renders blank.
  const options = useMemo(() => {
    const base = entityTypes.length ? entityTypes : FALLBACK_ENTITIES;
    return base.includes(entityType) ? base : [entityType, ...base];
  }, [entityTypes, entityType]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-base font-semibold text-gray-900">{t("activity_log.access_report_title")}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{t("activity_log.access_report_subtitle")}</p>
        <form
          className="flex flex-wrap items-end gap-3 mt-4"
          onSubmit={(e) => { e.preventDefault(); run(entityType, entityId); }}
        >
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="access-entity-type">
              {t("common.type")}
            </label>
            <select
              id="access-entity-type"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="border border-gray-200 rounded-xl text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {options.map((et) => (
                <option key={et} value={et}>{t(`activity_log.entities.${et}`, { defaultValue: et })}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="access-entity-id">
              {t("activity_log.entity_name_col")}
            </label>
            <input
              id="access-entity-id"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder={t("activity_log.access_entity_id_placeholder", { defaultValue: t("common.search") })}
              className="w-full border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !entityId.trim()}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {t("common.search")}
          </button>
        </form>
      </div>

      {forbidden ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 text-gray-500">
          <Lock className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">{t("activity_log.forbidden")}</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : report ? (
        <>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {report.entity_name || report.entity_id}
                </p>
                <p className="text-xs text-gray-500">
                  {t(`activity_log.entities.${report.entity_type}`, { defaultValue: report.entity_type })} · {report.total}
                </p>
              </div>
            </div>

            {report.actors.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">{t("activity_log.access_report_empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">{t("activity_log.actor")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">{t("activity_log.access_views")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">{t("activity_log.access_downloads")}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">{t("common.date")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.actors.map((actor) => (
                      <tr key={actor.user_id} className="border-b border-gray-50">
                        <td className="px-4 py-3">
                          <span className="block font-medium text-gray-900">
                            {actor.is_system
                              ? t("activity_log.actor_system")
                              : actor.user_name || actor.user_email || t("activity_log.actor_unknown")}
                          </span>
                          {actor.user_name && actor.user_email && (
                            <span className="block text-xs text-gray-400">{actor.user_email}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-gray-700">{actor.actions?.view ?? 0}</td>
                        <td className="px-4 py-3 tabular-nums text-gray-700">{actor.actions?.download ?? 0}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDateTime(actor.last_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {report.recent.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">{t("activity_log.tab_access")}</h3>
              <div className="space-y-2">
                {report.recent.map((entry) => {
                  const style = styleFor(entry);
                  const Icon = style.icon;
                  return (
                    <div key={entry.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-xl px-4 py-2.5">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${style.bg} ${style.color}`}>
                          <Icon className="w-3 h-3" />
                          {t(`activity_log.actions.${entry.action}`, { defaultValue: entry.action })}
                        </span>
                        <span className="text-sm text-gray-700 truncate">
                          {entry.actor_name || entry.actor_email || entry.user_email || t("activity_log.actor_unknown")}
                        </span>
                      </span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{fmtDateTime(entry.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : searched ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 text-sm text-gray-400">
          {t("activity_log.access_report_empty")}
        </div>
      ) : null}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TabKey = "activity" | "logins" | "access";

export default function ActivityLogPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>("activity");
  const [catalogue, setCatalogue] = useState<ActivityActionCatalogue | null>(null);
  const [inspect, setInspect] = useState<{ entityType: string; entityId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    activityLogApi
      .actions()
      .then((data) => { if (!cancelled) setCatalogue(data); })
      // A missing catalogue is not an error the reader can act on — the filters
      // fall back to the built-in verb list and the page keeps working.
      .catch(() => { if (!cancelled) setCatalogue(null); });
    return () => { cancelled = true; };
  }, []);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "activity", label: t("activity_log.tab_activity") },
    { key: "logins", label: t("activity_log.tab_logins") },
    { key: "access", label: t("activity_log.tab_access") },
  ];

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("activity_log.title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("activity_log.subtitle")}</p>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-100">
        {tabs.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === item.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "activity" && (
        <TrailTab
          catalogue={catalogue}
          onInspectEntity={(entityType, entityId) => {
            setInspect({ entityType, entityId });
            setTab("access");
          }}
        />
      )}
      {tab === "logins" && <LoginsTab />}
      {tab === "access" && (
        <AccessTab initial={inspect} entityTypes={catalogue?.entity_types_present ?? []} />
      )}
    </div>
  );
}
