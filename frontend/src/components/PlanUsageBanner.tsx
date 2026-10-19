import { useState } from "react";
import { Gauge, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PlanUsage, PlanUsageKey } from "../api/endpoints";
import { contactUrl, planDisplayName } from "../lib/plans";

const QUOTA: Record<PlanUsageKey, keyof PlanUsage["limits"]> = {
  contributors: "max_contributors",
  frameworks: "max_frameworks",
  vendors: "max_vendors",
};
const DISMISS_KEY = "grc_plan_usage_banner_dismissed";

/**
 * Tenant-admin banner shown when the tenant is at >= 90 % of a plan quota
 * (contributors, active frameworks, third parties) or above it. `usage` comes
 * from GET /subscriptions/current/usage (fetched once by Layout, which swallows
 * any error — then this renders nothing). Dismissal is per browser session.
 */
export default function PlanUsageBanner({ enabled, usage }: { enabled: boolean; usage: PlanUsage | null }) {
  const { t, i18n } = useTranslation();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  if (!enabled || dismissed || !usage) return null;
  const over = usage.over_limit ?? [];
  const near = (usage.near_limit ?? []).filter((k) => !over.includes(k));
  if (!over.length && !near.length) return null;

  const plan = planDisplayName(usage.plan_tier || usage.tier, t);
  const item = (k: PlanUsageKey) => String(t(`plan_limits.item_${k}` as never, {
    used: usage.usage?.[k] ?? 0, max: usage.limits?.[QUOTA[k]] ?? 0,
  }));
  const isOver = over.length > 0;
  const text = isOver
    ? t("plan_limits.banner_over", { plan, items: [...over, ...near].map(item).join(", ") })
    : t("plan_limits.banner_near", { plan, items: near.map(item).join(", ") });

  function dismiss() {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  }

  return (
    <div className={`flex items-center gap-2 px-4 py-2 border-b text-xs font-medium flex-shrink-0 ${
      isOver ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
      <Gauge className={`w-3.5 h-3.5 flex-shrink-0 ${isOver ? "text-red-600" : "text-amber-600"}`} />
      <span className="flex-1 min-w-0">{String(text)}</span>
      <a href={contactUrl(i18n.language)} className="underline underline-offset-2 font-semibold whitespace-nowrap">
        {t("plan_limits.contact")}
      </a>
      <button type="button" onClick={dismiss} aria-label={String(t("plan_limits.dismiss"))}
        className="ms-1 opacity-70 hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
