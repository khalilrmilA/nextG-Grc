import { useEffect, useState } from "react";
import { KeyRound, X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { licenseApi, type LicenseStatus } from "../../api/license";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../store/auth";

const STATUS_BADGE: Record<LicenseStatus["status"], string> = {
  valid:        "bg-green-100 text-green-700 border-green-200",
  expired:      "bg-red-100 text-red-700 border-red-200",
  missing:      "bg-amber-100 text-amber-700 border-amber-200",
  invalid:      "bg-amber-100 text-amber-700 border-amber-200",
  unconfigured: "bg-gray-100 text-gray-600 border-gray-200",
};

/**
 * Popup to paste a license key and activate it. On success the status panel
 * updates live. Activation itself is admin-only (tenant_admin / super_admin);
 * other roles see the current status read-only.
 */
export default function LicenseKeyModal({
  open,
  onClose,
  onActivated,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onActivated?: (status: LicenseStatus) => void;
}) {
  const { t, i18n } = useTranslation();
  const loc = i18n.language === "ar" ? "ar-u-nu-latn" : i18n.language === "fr" ? "fr-FR" : "en-US";
  const user = useAuthStore((u) => u);
  const canActivate = user?.role === "tenant_admin" || user?.role === "super_admin";

  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  // Load current status whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setError(""); setOkMsg(""); setUnavailable(false);
    licenseApi
      .getStatus()
      .then(setStatus)
      .catch(() => setUnavailable(true));
  }, [open]);

  if (!open) return null;

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true); setError(""); setOkMsg("");
    try {
      const s = await licenseApi.activate(key.trim());
      setStatus(s);
      setKey("");
      setOkMsg(t("license_modal.activated"));
      onActivated?.(s);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("license_modal.err_activate"));
    } finally {
      setBusy(false);
    }
  }

  const expiry = status?.expires_at ? new Date(status.expires_at) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{t("license_modal.title")}</h3>
              <p className="text-xs text-gray-500">{t("license_modal.subtitle")}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Current status */}
          {unavailable ? (
            <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500">
              {t("license.unavailable")}
            </div>
          ) : status ? (
            <div className="px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">{t("common.status")}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border capitalize ${STATUS_BADGE[status.status]}`}>
                  {t(`license.status_${status.status}`, status.status)}
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
                  <span className="text-xs font-semibold text-gray-800">{expiry.toLocaleDateString(loc)}</span>
                </div>
              )}
              {status.days_remaining !== null && status.days_remaining !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">{t("license.days_remaining")}</span>
                  <span className={`text-xs font-semibold ${status.days_remaining <= 30 ? "text-amber-600" : "text-gray-800"}`}>
                    {status.days_remaining}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-indigo-500" /></div>
          )}

          {/* Activation form (admins only) */}
          {canActivate ? (
            <form onSubmit={activate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{t("license.key_label")}</label>
                <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={3}
                  placeholder={t("license.key_placeholder")}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-xs font-mono break-all focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {error && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                </div>
              )}
              {okMsg && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-xl text-green-700 text-xs">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" /> {okMsg}
                </div>
              )}
              <button type="submit" disabled={busy || !key.trim()}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                {t("license_modal.activate")}
              </button>
            </form>
          ) : (
            <p className="text-xs text-gray-500">
              {t("license.contact_admin")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
