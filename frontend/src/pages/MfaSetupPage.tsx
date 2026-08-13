import { useState, useEffect } from "react";
import { Loader2, Crown, ShieldCheck, KeyRound, Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { mfaApi } from "@/api/endpoints";

export default function MfaSetupPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{ enabled: boolean; confirmed: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [enroll, setEnroll] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function loadStatus() {
    setLoading(true);
    try { setStatus(await mfaApi.status()); } catch { setStatus(null); } finally { setLoading(false); }
  }
  useEffect(() => { loadStatus(); }, []);

  async function startEnroll() {
    setBusy(true); setError("");
    try { setEnroll(await mfaApi.enroll()); }
    catch (e: any) { setError(e?.response?.data?.detail || "Could not start enrollment"); }
    finally { setBusy(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await mfaApi.verify(code.trim());
      setEnroll(null); setCode("");
      loadStatus();
    } catch (err: any) { setError(err?.response?.data?.detail || "Invalid code"); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true);
    try { await mfaApi.disable(); setEnroll(null); loadStatus(); } catch {} finally { setBusy(false); }
  }
  function copySecret() {
    if (enroll?.secret) { navigator.clipboard?.writeText(enroll.secret); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  }

  const confirmed = status?.confirmed;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">{t("mfa.title", "Two-Factor Authentication")}</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
            <Crown className="w-3 h-3" /> {t("mfa.elite", "Elite Pack")}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">{t("mfa.subtitle", "Protect your account with a time-based one-time password (TOTP) from an authenticator app")}</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : confirmed ? (
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center"><ShieldCheck className="w-6 h-6 text-green-600" /></div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900">{t("mfa.enabled", "Two-factor authentication is enabled")}</p>
              <p className="text-sm text-gray-500">{t("mfa.enabled_sub", "Your account is protected by an authenticator app.")}</p>
            </div>
            <button onClick={disable} disabled={busy} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-red-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("mfa.disable", "Disable")}
            </button>
          </div>
        ) : !enroll ? (
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center"><KeyRound className="w-6 h-6 text-blue-600" /></div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900">{t("mfa.not_enabled", "Two-factor is not enabled")}</p>
              <p className="text-sm text-gray-500">{t("mfa.not_enabled_sub", "Add a second factor with Google Authenticator, Microsoft Authenticator, or any TOTP app.")}</p>
            </div>
            <button onClick={startEnroll} disabled={busy} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("mfa.enable", "Enable 2FA")}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="font-semibold text-gray-900 mb-1">{t("mfa.step1", "1. Add this key to your authenticator app")}</p>
              <p className="text-sm text-gray-500 mb-3">{t("mfa.step1_sub", "Scan the setup URI, or enter the secret key manually.")}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono tracking-wider break-all">{enroll.secret}</code>
                <button onClick={copySecret} className="inline-flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-600 hover:bg-gray-50">
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2 break-all">{enroll.otpauth_uri}</p>
            </div>
            <form onSubmit={verify} className="space-y-2">
              <p className="font-semibold text-gray-900">{t("mfa.step2", "2. Enter the 6-digit code from the app")}</p>
              {error && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
              <div className="flex items-center gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" inputMode="numeric" className="w-40 border border-gray-200 rounded-xl px-4 py-2.5 text-lg tracking-[0.3em] font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button type="submit" disabled={busy || code.length !== 6} className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("mfa.verify", "Verify & enable")}
                </button>
                <button type="button" onClick={() => setEnroll(null)} className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
