import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Shield } from "lucide-react";
import { authApi } from "../api/endpoints";
import { authSession } from "../store/auth";

export default function RegisterPage() {
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "",
    password: "", organization_name: "", organization_slug: "",
    country: "", industry: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.value,
      ...(k === "organization_name"
        ? { organization_slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-") }
        : {}),
    }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await authApi.register(form);
      authSession.login({
        email: form.email, name: `${form.first_name} ${form.last_name}`.trim(),
        role: "ciso", plan: "free_trial", daysRemaining: 14, org: form.organization_name,
      });
      navigate("/dashboard");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-500 rounded-2xl flex items-center justify-center mb-4">
            <Shield className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Start Free Trial</h1>
          <p className="text-slate-400 mt-1">14 days free, no credit card required</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
                <input type="text" value={form.first_name} onChange={set("first_name")} required
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
                <input type="text" value={form.last_name} onChange={set("last_name")} required
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Work email</label>
              <input type="email" value={form.email} onChange={set("email")} required
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" value={form.password} onChange={set("password")} required minLength={8}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Organization name</label>
              <input type="text" value={form.organization_name} onChange={set("organization_name")} required
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {form.organization_slug && (
                <p className="text-xs text-gray-400 mt-1">URL: grcplatform.com/<strong>{form.organization_slug}</strong></p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                <select value={form.country} onChange={set("country")}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select country</option>
                  <option value="US">United States</option>
                  <option value="GB">United Kingdom</option>
                  <option value="FR">France</option>
                  <option value="DE">Germany</option>
                  <option value="CA">Canada</option>
                  <option value="AU">Australia</option>
                  <option value="SA">Saudi Arabia</option>
                  <option value="MA">Morocco</option>
                  <option value="DZ">Algeria</option>
                  <option value="TN">Tunisia</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                <select value={form.industry} onChange={set("industry")}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select industry</option>
                  <option value="technology">Technology</option>
                  <option value="financial">Financial Services</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="government">Government</option>
                  <option value="retail">Retail</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="telecom">Telecommunications</option>
                  <option value="energy">Energy & Utilities</option>
                </select>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors mt-2">
              {loading ? "Creating account..." : "Start Free Trial"}
            </button>
          </form>
          <p className="text-center text-sm text-gray-500 mt-4">
            Already have an account?{" "}
            <Link to="/login" className="text-blue-600 font-medium hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
