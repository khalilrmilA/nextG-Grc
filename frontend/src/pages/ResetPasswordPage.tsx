import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Loader2, CheckCircle2, Lock } from "lucide-react";
import { authApi } from "../api/endpoints";
import AuthLayout from "../components/auth/AuthLayout";

/**
 * Lands the link sent by both the "forgot password" email and the new-user
 * welcome/invite email — both reuse the same PasswordResetToken mechanism on
 * the backend (see auth.py POST /auth/reset-password), so a single page here
 * serves either origin.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!token) { setError(t("public.reset.err_no_token", "This link is missing its reset token.")); return; }
    if (password.length < 12) { setError(t("public.reset.err_too_short", "Password must be at least 12 characters.")); return; }
    if (password !== confirm) { setError(t("public.reset.err_mismatch", "Passwords do not match.")); return; }
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("public.reset.err_generic", "This link is invalid or has expired. Request a new one from the login page."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold text-gray-900 mb-1.5">{t("public.reset.title", "Set your password")}</h1>
      <p className="text-sm text-gray-500 mb-7">{t("public.reset.subtitle", "Choose a password to activate your account.")}</p>

      {done ? (
        <div className="flex items-start gap-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl p-4">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{t("public.reset.success", "Password set. Redirecting you to sign in…")}</span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type={showPwd ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("public.reset.new_password_placeholder", "New password")}
              className="w-full pl-10 pr-10 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
            <button type="button" onClick={() => setShowPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type={showPwd ? "text" : "password"}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t("public.reset.confirm_placeholder", "Confirm password")}
              className="w-full pl-10 pr-3.5 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>
          <p className="text-xs text-gray-400">{t("public.reset.hint", "At least 12 characters.")}</p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60 text-white font-medium py-3 px-4 rounded-xl text-sm shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/25 transition-all inline-flex items-center justify-center gap-2 mt-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("public.reset.submit", "Set password")}
          </button>
        </form>
      )}

      <p className="text-xs text-gray-400 mt-6 text-center">
        <Link to="/login" className="text-blue-600 hover:underline">{t("public.reset.back_to_login", "Back to sign in")}</Link>
      </p>
    </AuthLayout>
  );
}
