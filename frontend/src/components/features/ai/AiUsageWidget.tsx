import { useQuery } from "@tanstack/react-query";
import { Sparkles, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { authApi } from "@/api/endpoints";

export default function AiUsageWidget() {
  const { t, i18n } = useTranslation();
  const loc = i18n.language === "ar" ? "ar-u-nu-latn" : i18n.language === "fr" ? "fr-FR" : "en-US";
  const { data: usage, isLoading, error } = useQuery({
    queryKey: ["auth", "ai-usage"],
    queryFn: authApi.getAiUsage,
    refetchInterval: 30000, // Refresh every 30 seconds
    retry: false,
  });

  if (isLoading || error) return null;
  if (!usage) return null;

  const percentage = usage.percentage_used;
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          <p className="text-sm font-semibold text-gray-900">{t("ai_access.widget_title")}</p>
        </div>
        {isAtLimit && (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
            <AlertCircle className="w-3 h-3" /> {t("ai_access.limit_reached")}
          </span>
        )}
        {isNearLimit && !isAtLimit && (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
            <AlertCircle className="w-3 h-3" /> {t("ai_access.near_limit")}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {/* Token usage */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-600">{t("ai_access.tokens_used")}</p>
            <p className="text-xs font-mono font-semibold text-gray-800">
              {usage.tokens_used.toLocaleString(loc)} / {usage.tokens_limit.toLocaleString(loc)}
            </p>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                percentage >= 100 ? "bg-red-500" : percentage >= 80 ? "bg-amber-500" : "bg-blue-500"
              }`}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
        </div>

        {/* Requests usage */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-600">{t("ai_access.requests_made")}</p>
            <p className="text-xs font-mono font-semibold text-gray-800">
              {usage.requests_made.toLocaleString(loc)} / {usage.requests_limit.toLocaleString(loc)}
            </p>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${Math.min((usage.requests_made / usage.requests_limit) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        {t("ai_access.resets_on_label")} <strong>{new Date(usage.reset_at).toLocaleDateString(loc)}</strong>
      </p>
    </div>
  );
}
