import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { authSession, DEMO_USERS, type UserRole, type PlanTier } from "../store/auth";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  function redirectAfterLogin(role?: string) {
    if (role === "auditor")          navigate("/auditor/portal");
    else if (role === "super_admin") navigate("/super-admin");
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
        plan: "professional" as PlanTier,
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
          authSession.login({
            ...current,
            role: (profile.role as UserRole),
            tenant_id: profile.tenant_id,
            primary_framework_id: profile.primary_framework_id,
            selected_framework_ids: profile.selected_framework_ids,
            org_size: profile.org_size,
            primary_assessment_id: profile.primary_assessment_id,
          });
        }
      } catch {/* best-effort */}

      redirectAfterLogin(authSession.getUser()?.role);
    } catch {
      // Offline fallback for known accounts
      const demoUser = DEMO_USERS[email.trim().toLowerCase()];
      if (demoUser && (password === "demo123" || password === "super123")) {
        authSession.login(demoUser);
        redirectAfterLogin(demoUser.role);
      } else {
        setError("Invalid email or password. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="GRCEye" className="h-40 w-auto object-contain mb-4 drop-shadow-2xl" />
          <div className="mt-3"><LanguageSwitcher /></div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Welcome back</h2>
          <p className="text-sm text-gray-400 mb-6">Sign in to your account to continue.</p>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium text-gray-700 mb-1.5">
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@company.com"
                className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="block text-xs font-medium text-gray-700">
                  Password
                </label>
                <button type="button" className="text-xs text-blue-600 hover:underline">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
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
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : "Sign in"}
            </button>
          </form>

            <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-xs text-gray-400">New to GRCEye?</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          <Link
            to="/register"
            className="block w-full text-center py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Create an account
          </Link>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Link to="/landing" className="text-xs text-blue-600 hover:underline">
            Back to home
          </Link>
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} GRCEye
          </p>
        </div>
      </div>
    </div>
  );
}
