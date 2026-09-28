import { useEffect, useState } from "react";
import { Crown, X } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Global toast for Elite Pack feature gates. The API client (client.ts) dispatches
 * a window "elite-upsell" CustomEvent when a request 402s with
 * { error: "feature_not_in_plan", feature, pack, message }. Mount once in App.
 */
export default function EliteUpsellListener() {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    function onUpsell(e: Event) {
      const detail = (e as CustomEvent).detail as { message?: string } | undefined;
      setMessage(detail?.message || t("elite.upsell_default", "This capability is part of the Elite Pack."));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMessage(null), 6000);
    }
    window.addEventListener("elite-upsell", onUpsell);
    return () => {
      window.removeEventListener("elite-upsell", onUpsell);
      window.clearTimeout(timer);
    };
  }, [t]);

  if (!message) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rtl:left-auto rtl:right-1/2 rtl:translate-x-1/2 z-[200] flex items-start gap-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-5 py-3.5 rounded-2xl shadow-2xl max-w-md">
      <Crown className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold">{t("elite.upsell_title", "Elite Pack feature")}</p>
        <p className="text-white/90">{message}</p>
      </div>
      <button
        type="button"
        onClick={() => setMessage(null)}
        className="ml-1 text-white/70 hover:text-white flex-shrink-0"
        aria-label={t("common.close")}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
