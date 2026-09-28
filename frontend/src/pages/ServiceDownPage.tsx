import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WifiOff, RefreshCw, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function ServiceDownPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(d => (d.length >= 3 ? "" : d + "."));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  async function handleRetry() {
    setChecking(true);
    try {
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";
      const res = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        navigate("/login");
        return;
      }
    } catch {
      /* still down */
    }
    setChecking(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
      <div className="text-center max-w-md">

        {/* Icon */}
        <div className="flex justify-center mb-8">
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-slate-700/60 border border-slate-600 flex items-center justify-center">
              <WifiOff className="w-10 h-10 text-slate-400" />
            </div>
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500" />
            </span>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-white mb-2">
          {t("service_down.title")}
        </h1>
        <p className="text-slate-400 mb-8 text-sm leading-relaxed">
          {t("service_down.message")}
          <br />
          {t("service_down.retry_hint")}{dots}
        </p>

        {/* Status pill */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-8">
          <Clock className="w-3.5 h-3.5" />
          {t("service_down.status")}
        </div>

        {/* Retry button */}
        <div>
          <button
            onClick={handleRetry}
            disabled={checking}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} />
            {checking ? t("service_down.checking") : t("service_down.try_again")}
          </button>
        </div>

        <p className="mt-8 text-xs text-slate-600">{t("service_down.footer")}</p>
      </div>
    </div>
  );
}
