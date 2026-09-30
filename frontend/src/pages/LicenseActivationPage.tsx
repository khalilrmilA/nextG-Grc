import { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle, KeyRound, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { useAuthStore, authSession } from "../store/auth";
import { licenseApi, type LicenseStatus } from "../api/license";
import LanguageSwitcher from "../components/LanguageSwitcher";

const STATUS_BADGES: Record<LicenseStatus["status"], string> = {
  valid:        "bg-green-100 text-green-700 border-green-200",
  expired:      "bg-red-100 text-red-700 border-red-200",
  missing:      "bg-amber-100 text-amber-700 border-amber-200",
  invalid:      "bg-amber-100 text-amber-700 border-amber-200",
  unconfigured: "bg-amber-100 text-amber-700 border-amber-200",
};

export default function LicenseActivationPage() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((u) => u);
  const navigate = useNavigate();

  const [status, setStatus]           = useState<LicenseStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [key, setKey]                 = useState("");
  const [activating, setActivating]   = useState(false);
  const [error, setError]             = useState("");
  const [activated, setActivated]     = useState(false);

  useEffect(() => {
    if (!user) return;
    licenseApi.getStatus()
      .then((s) => { setStatus(s); setLoading(false); })
      .catch(() => { setUnavailable(true); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) return <Navigate to="/login" replace />;

  const canActivate = user.role === "tenant_admin" || user.role === "super_admin";

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setActivating(true);
    setError("");
    try {
      const s = await licenseApi.activate(key.trim());
      setStatus(s);
      setActivated(true);
      setTimeout(() => navigate("/dashboard"), 1500);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("license.err_generic"));
    } finally {
      setActivating(false);
    }
  }

  function handleLogout() {
    authSession.logout();
    navigate("/login");
  }

  const expiry = status?.expires_at ? new Date(status.expires_at) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo-vertical-white.png" alt={t("auth_layout.logo_alt")} className="h-44 w-auto object-contain mb-4" />
          <div className="mt-3"><LanguageSwitcher /></div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">{t("license.title")}</h2>
          </div>
          <p className="text-sm text-gray-400 mb-6">{t("license.subtitle")}</p>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : unavailable ? (
            <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-600 text-sm">
              {t("license.unavailable")}
            </div>
          ) : (
            <>
              {/* Status card */}
              {status && (
                <div className="mb-6 px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">{t("license.status_label")}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${STATUS_BADGES[status.status]}`}>
                      {t(`license.status_${status.status}` as never)}
                    </span>
                  </div>
                  {status.customer_name && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">{t("license.customer")}</span>
                      <span className="text-xs font-semibold text-gray-800">{status.customer_name}</span>
                    </div>
                  )}
                  {status.plan && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">{t("license.plan")}</span>
                      <span className="text-xs font-semibold text-gray-800 capitalize">{status.plan}</span>
                    </div>
                  )}
                  {expiry && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">{t("license.expires")}</span>
                      <span className="text-xs font-semibold text-gray-800">{expiry.toLocaleDateString(i18n.language === "ar" ? "ar-u-nu-latn" : i18n.language === "fr" ? "fr-FR" : "en-US")}</span>
                    </div>
                  )}
                  {status.days_remaining !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">{t("license.days_remaining")}</span>
                      <span className={`text-xs font-semibold ${status.days_remaining <= 30 ? "text-amber-600" : "text-gray-800"}`}>
                        {status.days_remaining}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {activated ? (
                <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  {t("license.success")}
                </div>
              ) : canActivate ? (
                <form onSubmit={handleActivate} className="space-y-4">
                  {error && (
                    <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                      {error}
                    </div>
                  )}
                  <div>
                    <label htmlFor="license-key" className="block text-xs font-medium text-gray-700 mb-1.5">
                      {t("license.key_label")}
                    </label>
                    <textarea
                      id="license-key"
                      value={key}
                      onChange={e => setKey(e.target.value)}
                      required
                      rows={5}
                      placeholder={t("license.key_placeholder")}
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-xs font-mono break-all resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={activating || !key.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2.5 px-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {activating ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("license.activating")}</> : t("license.activate")}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
                    <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
                    {t("license.contact_admin")}
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    {t("license.logout")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} GRC Eye
        </p>
      </div>
    </div>
  );
}
