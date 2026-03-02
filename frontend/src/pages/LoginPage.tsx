import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Shield, Crown, Briefcase, ClipboardList, Eye } from "lucide-react";
import { authSession, DEMO_USERS, PLAN_FEATURES, type UserRole, type PlanTier } from "../store/auth";

const DEMO_ACCOUNTS = [
  { email: "admin@demo.com",   icon: Crown,         color: "text-yellow-500", desc: "Admin · Enterprise · Full access"  },
  { email: "ciso@demo.com",    icon: Briefcase,     color: "text-blue-500",   desc: "CISO · Professional · All modules" },
  { email: "auditor@demo.com", icon: ClipboardList, color: "text-purple-500", desc: "Auditor · Starter · Core modules"  },
  { email: "viewer@demo.com",  icon: Eye,           color: "text-gray-400",   desc: "Viewer · Free Trial · 11 days"     },
];

export default function LoginPage() {
  const [email, setEmail]       = useState("admin@demo.com");
  const [password, setPassword] = useState("demo123");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const navigate = useNavigate();

  async function loginAs(accountEmail: string) {
    const user = DEMO_USERS[accountEmail];
    if (!user) return;
    try {
      const { authApi } = await import("../api/endpoints");
      const tokenData = await authApi.login(accountEmail, "demo123");
      authSession.login({ ...user, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token });
    } catch {
      // Backend offline — login without token (demo mode)
      authSession.login(user);
    }
    navigate("/dashboard");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { authApi } = await import("../api/endpoints");
      const tokenData = await authApi.login(email.trim().toLowerCase(), password);

      // Build user profile — prefer demo profile if available, fallback to backend data
      const demoUser = DEMO_USERS[email.trim().toLowerCase()];
      const user = demoUser ?? {
        email: email.trim().toLowerCase(),
        name: email.split("@")[0],
        role: "ciso" as UserRole,
        plan: "professional" as PlanTier,
        org: "My Organization",
      };

      // Always save the real JWT so API calls are authenticated
      authSession.login({
        ...user,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      });
      navigate("/dashboard");
    } catch {
      // Backend unreachable — allow demo accounts offline
      const demoUser = DEMO_USERS[email.trim().toLowerCase()];
      if (demoUser && password === "demo123") {
        authSession.login(demoUser);
        navigate("/dashboard");
      } else {
        setError("Invalid credentials. Use demo123 with one of the demo accounts below.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-500/30">
            <Shield className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">GRC Platform</h1>
          <p className="text-slate-400 mt-1">Governance, Risk & Compliance</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {/* Quick demo login buttons */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Quick access</p>
          <div className="grid grid-cols-2 gap-2 mb-6">
            {DEMO_ACCOUNTS.map(acc => {
              const Icon  = acc.icon;
              const plan  = DEMO_USERS[acc.email]?.plan ?? "free_trial";
              return (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => loginAs(acc.email)}
                  className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all text-left group"
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${acc.color}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{acc.desc.split(" · ")[0]}</p>
                    <p className="text-xs text-gray-400">{PLAN_FEATURES[plan].label}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or sign in manually</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <h2 className="text-lg font-semibold text-gray-900 mb-4">Sign in</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            No account?{" "}
            <Link to="/register" className="text-blue-600 font-medium hover:underline">
              Start free trial
            </Link>
          </p>
        </div>

        <p className="text-center mt-4">
          <Link to="/landing" className="text-xs text-slate-400 hover:text-white transition-colors">
            ← Back to marketing site
          </Link>
        </p>
      </div>
    </div>
  );
}
