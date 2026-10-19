import { useEffect, useState } from "react";
import { Crown, Gauge, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { contactUrl, isPlanLimitDetail, planLimitMessage } from "../lib/plans";

/**
 * Global toast for plan gates. The API client (client.ts) dispatches:
 *  - "elite-upsell" when a request 402s with { error: "feature_not_in_plan",
 *    feature, pack, message } — pack "elite" (Elite Pack) or "enterprise"
 *    (e.g. the AI assistant, included from Enterprise up);
 *  - "plan-limit" when a request 402s with { code: "plan_limit", limit, current,
 *    max, tier } — a contributor / framework / third-party quota was reached.
 * Neither redirects. Mount once in App.
 */
type Toast = { kind: "elite" | "enterprise" | "limit"; message: string };

export default function EliteUpsellListener() {
  const { t, i18n } = useTranslation();
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    function show(next: Toast, ms: number) {
      setToast(next);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), ms);
    }
    function onUpsell(e: Event) {
      const detail = (e as CustomEvent).detail as { message?: string; pack?: string; feature?: string } | undefined;
      if (detail?.pack === "enterprise") {
        const msg = detail.feature === "ai_copilot"
          ? t("plan_limits.copilot_locked")
          : (detail.message || t("plan_limits.copilot_locked"));
        show({ kind: "enterprise", message: String(msg) }, 8000);
        return;
      }
      show({ kind: "elite", message: detail?.message || t("elite.upsell_default", "This capability is part of the Elite Pack.") }, 6000);
    }
    function onLimit(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!isPlanLimitDetail(detail)) return;
      show({ kind: "limit", message: planLimitMessage(detail, t) }, 10000);
    }
    window.addEventListener("elite-upsell", onUpsell);
    window.addEventListener("plan-limit", onLimit);
    return () => {
      window.removeEventListener("elite-upsell", onUpsell);
      window.removeEventListener("plan-limit", onLimit);
      window.clearTimeout(timer);
    };
  }, [t]);

  if (!toast) return null;

  const title = toast.kind === "limit"
    ? t("plan_limits.title", "Plan limit reached")
    : toast.kind === "enterprise"
      ? t("plan_limits.enterprise_title", "Enterprise feature")
      : t("elite.upsell_title", "Elite Pack feature");
  const colors = toast.kind === "elite"
    ? "from-yellow-500 to-orange-500"
    : "from-blue-600 to-indigo-600";
  const Icon = toast.kind === "limit" ? Gauge : Crown;

  return (
    <div role="alert" className={`fixed bottom-6 left-1/2 -translate-x-1/2 rtl:left-auto rtl:right-1/2 rtl:translate-x-1/2 z-[200] flex items-start gap-3 bg-gradient-to-r ${colors} text-white px-5 py-3.5 rounded-2xl shadow-2xl max-w-md w-[calc(100vw-2rem)] sm:w-auto`}>
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold">{title}</p>
        <p className="text-white/90">{toast.message}</p>
        {toast.kind !== "elite" && (
          <a href={contactUrl(i18n.language)} className="inline-block mt-1.5 text-xs font-semibold underline underline-offset-2 text-white">
            {t("plan_limits.contact", "Contact us to upgrade")}
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={() => setToast(null)}
        className="ml-1 text-white/70 hover:text-white flex-shrink-0"
        aria-label={t("common.close")}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
