import { useState, useEffect } from "react";
import {
  Loader2,
  Filter,
  Plus,
  Pencil,
  Trash2,
  LogIn,
  Download,
  Upload,
  Activity,
  Clock,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { activityLogApi } from "@/api/endpoints";

const ACTION_STYLE: Record<string, { color: string; bg: string; icon: typeof Plus }> = {
  create: { color: "text-green-600", bg: "bg-green-50 border-green-200", icon: Plus },
  update: { color: "text-blue-600", bg: "bg-blue-50 border-blue-200", icon: Pencil },
  delete: { color: "text-red-600", bg: "bg-red-50 border-red-200", icon: Trash2 },
  login: { color: "text-purple-600", bg: "bg-purple-50 border-purple-200", icon: LogIn },
  export: { color: "text-gray-600", bg: "bg-gray-50 border-gray-200", icon: Download },
  import: { color: "text-teal-600", bg: "bg-teal-50 border-teal-200", icon: Upload },
};

const ENTITY_TYPES = [
  "risk",
  "vendor",
  "audit",
  "policy",
  "compliance",
  "asset",
  "incident",
];
const ACTION_TYPES = ["create", "update", "delete", "login", "export", "import"];

function useTimeAgo() {
  const { t } = useTranslation();
  return function timeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.max(0, now - then);
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return t("activity_log.time_just_now");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };
}

export default function ActivityLogPage() {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const LIMIT = 25;

  const [entityFilter, setEntityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  async function load(reset = true) {
    const newOffset = reset ? 0 : offset;
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const params: any = { limit: LIMIT, offset: newOffset };
      if (entityFilter) params.entity_type = entityFilter;
      if (actionFilter) params.action = actionFilter;
      const data = await activityLogApi.list(params);
      const entries = Array.isArray(data) ? data : data.items || [];
      if (reset) {
        setItems(entries);
      } else {
        setItems((prev) => [...prev, ...entries]);
      }
      setHasMore(entries.length === LIMIT);
      setOffset(newOffset + entries.length);
    } catch {
      if (reset) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load(true);
  }, [entityFilter, actionFilter]);

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("activity_log.title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("activity_log.subtitle")}</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("activity_log.all_entities")}</option>
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {et.charAt(0).toUpperCase() + et.slice(1)}
              </option>
            ))}
          </select>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("activity_log.all_actions")}</option>
            {ACTION_TYPES.map((a) => (
              <option key={a} value={a}>
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">{t("activity_log.no_entries")}</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-200" />

            <div className="space-y-0">
              {items.map((entry: any, idx: number) => {
                const style = ACTION_STYLE[entry.action] || ACTION_STYLE.update;
                const Icon = style.icon;
                return (
                  <div key={entry.id || idx} className="relative flex gap-4 pb-6">
                    {/* Icon */}
                    <div
                      className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border ${style.bg}`}
                    >
                      <Icon className={`w-4 h-4 ${style.color}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm text-gray-900">
                            <span className="font-medium">{entry.user_email || "System"}</span>{" "}
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${style.bg} ${style.color}`}
                            >
                              {entry.action}
                            </span>{" "}
                            {entry.entity_type && (
                              <span className="text-gray-500">
                                {entry.entity_type}
                                {entry.entity_name && (
                                  <>
                                    {" "}
                                    &mdash;{" "}
                                    <span className="font-medium text-gray-700">
                                      {entry.entity_name}
                                    </span>
                                  </>
                                )}
                              </span>
                            )}
                          </p>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                          <Clock className="w-3 h-3" />
                          {entry.timestamp || entry.created_at
                            ? timeAgo(entry.timestamp || entry.created_at)
                            : "-"}
                        </span>
                      </div>

                      {/* Details */}
                      {entry.details && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-xl border border-gray-100 overflow-x-auto">
                          <pre className="text-xs text-gray-600 whitespace-pre-wrap">
                            {typeof entry.details === "string"
                              ? entry.details
                              : JSON.stringify(entry.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="text-center pt-2">
                <button
                  onClick={() => load(false)}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                >
                  {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t("activity_log.load_more")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
