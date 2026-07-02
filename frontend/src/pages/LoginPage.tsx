import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { authSession, DEMO_USERS, type UserRole, type PlanTier } from "../store/auth";
import LanguageSwitcher from "../components/LanguageSwitcher";
import SEO from "../components/seo/SEO";

function calculateDaysRemaining(trialEndsAt?: string): number {
  if (!trialEndsAt) return 14;
  const endDate = new Date(trialEndsAt);
  const now = new Date();
  const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, daysLeft);
}

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  // Forgot password modal state
  const [showForgot, setShowForgot]   = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent]   = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError("");
    try {
      const { authApi } = await import("../api/endpoints");
      await authApi.forgotPassword(forgotEmail.trim().toLowerCase());
      setForgotSent(true);
    } catch {
      setForgotError(t("public.login.err_reset_generic"));
    } finally {
      setForgotLoading(false);
    }
  }

  function closeForgot() {
    setShowForgot(false);
    setForgotEmail("");
    setForgotSent(false);
    setForgotError("");
  }

  function redirectAfterLogin(role?: string) {
    if (role === "auditor")          navigate("/auditor/portal");
    else if (role === "super_admin") navigate("/super-admin");
    else if (role === "tenant_admin") navigate("/dashboard");
    else                             navigate("/dashboard");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { authApi } = await import("../api/endpoints");
      const tokenData = await authApi.login(email.trim().toLowerCase(), password);

      const demoUser = DEMO_USERS[email.trim().toLowerCase()];
      const user = demoUser ?? {
        email: email.trim().toLowerCase(),
        name: email.split("@")[0],
        role: "ciso" as UserRole,
        plan: "enterprise" as PlanTier,
        org: "My Organization",
      };

      authSession.login({
        ...user,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      });

      try {
        const { authApi: api } = await import("../api/endpoints");
        const profile = await api.getProfile();
        const current = authSession.getUser();
        if (current) {
          const daysRemaining = calculateDaysRemaining();
          authSession.login({
            ...current,
            role: (profile.role as UserRole),
            roles: profile.roles ?? [],
            org: profile.tenant_name || current.org,
            name: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || current.name,
            daysRemaining: current.plan === "free_trial" ? daysRemaining : undefined,
            tenant_id: profile.tenant_id,
            primary_framework_id: profile.primary_framework_id,
            selected_framework_ids: profile.selected_framework_ids,
            org_size: profile.org_size,
            primary_assessment_id: profile.primary_assessment_id,
            accessible_modules: profile.accessible_modules,
          });
        }
      } catch {/* best-effort profile enrichment — token already valid */}

      redirectAfterLogin(authSession.getUser()?.role);
    } catch (err: unknown) {
      authSession.logout();
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        setError(t("public.login.err_invalid"));
      } else if (status === 422) {
        setError(t("public.login.err_invalid_request"));
      } else {
        setError(t("public.login.err_generic"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <SEO title={t("public.login.submit")} description="Sign in to GRCEye." path="/login" noIndex />
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo-vertical.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-44 w-auto object-contain mb-4 drop-shadow-2xl bg-white/95 rounded-2xl p-3" />
          <div className="mt-3"><LanguageSwitcher /></div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">{t("public.login.welcome_back")}</h2>
          <p className="text-sm text-gray-400 mb-6">{t("public.login.subtitle")}</p>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium text-gray-700 mb-1.5">
                {t("public.login.email_label")}
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder={t("public.login.email_placeholder")}
                className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="block text-xs font-medium text-gray-700">
                  {t("public.login.password_label")}
                </label>
                <button type="button" onClick={() => { setShowForgot(true); setForgotEmail(email); }} className="text-xs text-blue-600 hover:underline">
                  {t("public.login.forgot")}
                </button>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder={t("public.login.password_placeholder")}
                  className="w-full px-3.5 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2.5 px-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 mt-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("public.login.submitting")}</> : t("public.login.submit")}
            </button>
          </form>

            <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-xs text-gray-400">{t("public.login.divider")}</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          <Link
            to="/register"
            className="block w-full text-center py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t("public.login.create_account")}
          </Link>
        </div>

        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between">
            <a href="/" className="text-xs text-blue-600 hover:underline">
              {t("public.login.back_home")}
            </a>
            <p className="text-xs text-slate-500">
              © {new Date().getFullYear()} GRCEye
            </p>
          </div>
          <p className="text-center text-xs text-slate-600">
            {t("public.footer.powered_by")}{" "}
            <a
              href="https://silentwolf.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold hover:text-slate-300 transition-colors"
            >
              SilentWolf
            </a>
          </p>
        </div>
      </div>
    </div>

    {/* Forgot password modal */}
    {showForgot && (
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-900">{t("public.login.reset_title")}</h3>
            <button type="button" onClick={closeForgot} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          {forgotSent ? (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl p-4">
              {t("public.login.reset_sent")}
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <p className="text-sm text-gray-500">{t("public.login.reset_intro")}</p>
              <input
                type="email"
                required
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                placeholder={t("public.login.email_placeholder")}
                className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {forgotError && <p className="text-xs text-red-500">{forgotError}</p>}
              <button type="submit" disabled={forgotLoading}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                {forgotLoading ? t("public.login.reset_sending") : t("public.login.reset_submit")}
              </button>
            </form>
          )}
        </div>
      </div>
    )}
    </>
  );
}
