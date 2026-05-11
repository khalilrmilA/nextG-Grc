import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { authSession } from "../store/auth";
import {
  superAdminUsersApi,
  superAdminFrameworksApi,
  superAdminAccessApi,
  superAdminAiAccessApi,
  superAdminSubscriptionsApi,
  type SuperAdminUser,
  type SuperAdminFramework,
  type AccessControlEntry,
  type TenantSubscription,
} from "../api/superadmin";
import type { AiAccessRequest } from "../types";
import {
  Users, Shield, BookOpen, LogOut, Settings, Sparkles, CreditCard,
  ToggleLeft, ToggleRight, Trash2, Upload,
  Plus, AlertCircle, Loader2, X, CheckCircle, ThumbsUp, ThumbsDown, Pencil,
  Headphones, MessageSquare, Video, Send, PhoneOff, ChevronRight, RefreshCw,
} from "lucide-react";
import {
  supportApi,
  type SupportTicketListItem,
  type SupportTicketDetail,
  type ChatSessionData,
  type TicketStatus,
  type TicketPriority,
} from "../api/endpoints";

// ── Mock data (offline / demo fallback) ──────────────────────────────────────

const MOCK_USERS: SuperAdminUser[] = [
  { id: "u1", email: "admin@demo.com",   first_name: "Admin",  last_name: "Demo",   role: "ciso", tenant_id: "t1", tenant_name: "Acme Corp", is_active: true,  created_at: "2026-01-01T00:00:00Z" },
  { id: "u2", email: "ciso@demo.com",    first_name: "Sophie", last_name: "Martin", role: "ciso",         tenant_id: "t1", tenant_name: "Acme Corp", is_active: true,  created_at: "2026-01-02T00:00:00Z" },
  { id: "u3", email: "auditor@demo.com", first_name: "Jean",   last_name: "Dupont", role: "auditor",      tenant_id: "t2", tenant_name: "Beta GmbH", is_active: true,  created_at: "2026-01-05T00:00:00Z" },
  { id: "u4", email: "viewer@demo.com",  first_name: "Trial",  last_name: "User",   role: "viewer",       tenant_id: "t3", tenant_name: "Gamma Inc", is_active: false, created_at: "2026-02-10T00:00:00Z" },
];

const MOCK_FRAMEWORKS: SuperAdminFramework[] = [
  { id: "f1", name: "ISO 27001:2022",               short_name: "ISO27001",  version: "2022", controls_count: 93,  created_at: "2026-01-01T00:00:00Z" },
  { id: "f2", name: "NIST Cybersecurity Framework", short_name: "NIST-CSF",  version: "2.0",  controls_count: 103, created_at: "2026-01-01T00:00:00Z" },
  { id: "f3", name: "SOC 2",                        short_name: "SOC2",      version: "2017", controls_count: 61,  created_at: "2026-01-01T00:00:00Z" },
  { id: "f4", name: "GDPR",                         short_name: "GDPR",      version: "2018", controls_count: 99,  created_at: "2026-01-01T00:00:00Z" },
  { id: "f5", name: "HIPAA",                        short_name: "HIPAA",     version: "2013", controls_count: 54,  created_at: "2026-01-01T00:00:00Z" },
  { id: "f6", name: "PCI DSS 4.0",                  short_name: "PCI-DSS",   version: "4.0",  controls_count: 264, created_at: "2026-01-01T00:00:00Z" },
];

const MOCK_ACCESS: AccessControlEntry[] = [
  { tenant_id: "t1", tenant_name: "Acme Corp",  plan: "enterprise", enabled_modules: ["dashboard","risks","compliance","frameworks","audits","policies","vendors","policy-generator"] },
  { tenant_id: "t2", tenant_name: "Beta GmbH",  plan: "starter",    enabled_modules: ["dashboard","risks","compliance","audits"] },
  { tenant_id: "t3", tenant_name: "Gamma Inc",  plan: "free_trial", enabled_modules: ["dashboard","risks"] },
];

const ALL_MODULES = ["dashboard","risks","compliance","frameworks","audits","policies","vendors","policy-generator"];

// ── Shared: Demo Banner ───────────────────────────────────────────────────────

function DemoBanner() {
  return (
    <div className="flex items-center gap-2 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      Backend offline — showing demo data. Changes update local state only.
    </div>
  );
}

// ── Subscription helpers (shared by UsersTab + SubscriptionsTab) ──────────────

const TIER_OPTIONS = ["starter", "professional", "enterprise"] as const;
const STATUS_OPTIONS = ["active", "trialing", "past_due", "canceled", "paused"] as const;

const TIER_COLORS: Record<string, string> = {
  starter:      "bg-gray-100 text-gray-700",
  professional: "bg-blue-100 text-blue-700",
  enterprise:   "bg-purple-100 text-purple-700",
};

const STATUS_COLORS: Record<string, string> = {
  active:   "bg-emerald-100 text-emerald-700",
  trialing: "bg-amber-100 text-amber-700",
  past_due: "bg-red-100 text-red-700",
  canceled: "bg-gray-100 text-gray-500",
  paused:   "bg-orange-100 text-orange-700",
};

function EditSubscriptionModal({
  sub,
  onClose,
  onSaved,
}: {
  readonly sub: TenantSubscription;
  readonly onClose: () => void;
  readonly onSaved: (updated: TenantSubscription) => void;
}) {
  const [tier, setTier]     = useState(sub.tier);
  const [status, setStatus] = useState(sub.status);
  const [expiresAt, setExpiresAt] = useState(
    sub.trial_ends_at ? sub.trial_ends_at.slice(0, 10) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload: { tier: string; status: string; trial_ends_at?: string | null } = { tier, status };
      payload.trial_ends_at = (status === "trialing" && expiresAt)
        ? `${expiresAt}T00:00:00Z`
        : null;
      const updated = await superAdminSubscriptionsApi.update(sub.tenant_id, payload);
      onSaved(updated);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-indigo-600" /> Edit Subscription — {sub.tenant_name}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Plan / Tier</label>
            <div className="grid grid-cols-3 gap-2">
              {TIER_OPTIONS.map(t => (
                <button key={t} type="button" onClick={() => setTier(t)}
                  className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all capitalize ${
                    tier === t ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-200 text-gray-600 hover:border-indigo-400"
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map(s => (
                <button key={s} type="button" onClick={() => setStatus(s)}
                  className={`py-2.5 rounded-xl text-sm font-medium border-2 transition-all capitalize ${
                    status === s ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-200 text-gray-600 hover:border-indigo-400"
                  }`}>
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {status === "trialing" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Trial Expiry Date</label>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <p className="text-xs text-gray-400 mt-1">Leave blank to clear the expiry date.</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2.5 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab: Users ────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers]       = useState<SuperAdminUser[]>([]);
  const [subs, setSubs]         = useState<Record<string, TenantSubscription>>({});
  const [loading, setLoading]   = useState(true);
  const [isDemo, setIsDemo]     = useState(false);
  const [busy, setBusy]         = useState<string | null>(null);
  const [editSub, setEditSub]   = useState<TenantSubscription | null>(null);

  useEffect(() => {
    Promise.all([
      superAdminUsersApi.listAll(),
      superAdminSubscriptionsApi.listAll(),
    ])
      .then(([usersData, subsData]) => {
        setUsers(usersData);
        const map: Record<string, TenantSubscription> = {};
        subsData.forEach(s => { map[s.tenant_id] = s; });
        setSubs(map);
        setLoading(false);
      })
      .catch(() => { setUsers(MOCK_USERS); setIsDemo(true); setLoading(false); });
  }, []);

  function handleSubSaved(updated: TenantSubscription) {
    setSubs(prev => ({ ...prev, [updated.tenant_id]: updated }));
    setEditSub(null);
  }

  async function toggleActive(u: SuperAdminUser) {
    setBusy(u.id);
    try {
      const updated = await superAdminUsersApi.setActive(u.id, !u.is_active);
      setUsers(prev => prev.map(x => x.id === u.id ? updated : x));
    } catch {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x));
    } finally { setBusy(null); }
  }

  async function changeRole(u: SuperAdminUser, role: string) {
    setBusy(u.id);
    try {
      const updated = await superAdminUsersApi.setRole(u.id, role);
      setUsers(prev => prev.map(x => x.id === u.id ? updated : x));
    } catch {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role } : x));
    } finally { setBusy(null); }
  }

  async function deleteUser(id: string) {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    setBusy(id);
    try { await superAdminUsersApi.delete(id); } catch { /* demo */ }
    setUsers(prev => prev.filter(x => x.id !== id));
    setBusy(null);
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
    </div>
  );

  return (
    <div>
      {isDemo && <DemoBanner />}
      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {["User", "Tenant / Plan", "Role", "Account", "Actions"].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {users.map(u => {
              const sub = subs[u.tenant_id];
              const expiry = sub?.trial_ends_at ? new Date(sub.trial_ends_at) : null;
              const expired = expiry && expiry < new Date();
              return (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  {/* User */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {u.first_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 leading-none">{u.first_name} {u.last_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{u.email}</p>
                      </div>
                    </div>
                  </td>

                  {/* Tenant + subscription info */}
                  <td className="px-5 py-3.5">
                    <div className="flex flex-col gap-1">
                      <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium w-fit">{u.tenant_name}</span>
                      {sub ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${TIER_COLORS[sub.tier] ?? "bg-gray-100 text-gray-600"}`}>
                            {sub.tier}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[sub.status] ?? "bg-gray-100 text-gray-600"}`}>
                            {sub.status.replace("_", " ")}
                          </span>
                          {expiry && (
                            <span className={`text-xs ${expired ? "text-red-500 font-medium" : "text-gray-400"}`}>
                              {expired ? "Expired " : "Expires "}{expiry.toLocaleDateString()}
                            </span>
                          )}
                          {u.role !== "super_admin" && (
                            <button
                              type="button"
                              onClick={() => setEditSub(sub)}
                              className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                            >
                              <Pencil className="w-3 h-3" /> Edit plan
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">No subscription</span>
                      )}
                    </div>
                  </td>

                  {/* Role */}
                  <td className="px-5 py-3.5">
                    {u.role === "super_admin" || u.role === "admin" ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-lg">
                        👑 {u.role === "super_admin" ? "Super Admin" : "Owner"}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        disabled={busy === u.id}
                        onChange={e => changeRole(u, e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      >
                        <option value="user">User (Full Access)</option>
                        <option value="auditor">Auditor (Limited)</option>
                      </select>
                    )}
                  </td>

                  {/* Active toggle */}
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => toggleActive(u)}
                      disabled={busy === u.id}
                      className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                    >
                      {u.is_active
                        ? <><ToggleRight className="w-5 h-5 text-emerald-500" /><span className="text-emerald-600">Active</span></>
                        : <><ToggleLeft className="w-5 h-5 text-gray-400" /><span className="text-gray-500">Disabled</span></>
                      }
                    </button>
                  </td>

                  {/* Delete */}
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => deleteUser(u.id)}
                      disabled={busy === u.id}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Delete user"
                    >
                      {busy === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3">{users.length} user{users.length !== 1 ? "s" : ""} across all tenants</p>

      {editSub && (
        <EditSubscriptionModal
          sub={editSub}
          onClose={() => setEditSub(null)}
          onSaved={handleSubSaved}
        />
      )}
    </div>
  );
}

// ── Tab: Access Control ───────────────────────────────────────────────────────

function AccessControlTab() {
  const [entries, setEntries] = useState<AccessControlEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo]   = useState(false);
  const [saving, setSaving]   = useState<string | null>(null);

  useEffect(() => {
    superAdminAccessApi.listTenantAccess()
      .then(data => { setEntries(data); setLoading(false); })
      .catch(() => { setEntries(MOCK_ACCESS); setIsDemo(true); setLoading(false); });
  }, []);

  async function toggleModule(tenantId: string, module: string) {
    const entry = entries.find(e => e.tenant_id === tenantId);
    if (!entry) return;
    const next = entry.enabled_modules.includes(module)
      ? entry.enabled_modules.filter(m => m !== module)
      : [...entry.enabled_modules, module];
    setSaving(tenantId);
    try { await superAdminAccessApi.updateTenantAccess(tenantId, next); } catch { /* demo */ }
    setEntries(prev => prev.map(e => e.tenant_id === tenantId ? { ...e, enabled_modules: next } : e));
    setSaving(null);
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
    </div>
  );

  return (
    <div className="space-y-4">
      {isDemo && <DemoBanner />}
      {entries.map(entry => (
        <div key={entry.tenant_id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900">{entry.tenant_name}</h3>
              <span className="inline-block mt-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-md capitalize font-medium">{entry.plan.replace("_", " ")}</span>
            </div>
            {saving === entry.tenant_id && <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />}
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_MODULES.map(mod => {
              const enabled = entry.enabled_modules.includes(mod);
              return (
                <button
                  key={mod}
                  type="button"
                  onClick={() => toggleModule(entry.tenant_id, mod)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    enabled
                      ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                      : "bg-white border-gray-200 text-gray-500 hover:border-indigo-400 hover:text-indigo-600"
                  }`}
                >
                  {mod}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Add Framework Modal ───────────────────────────────────────────────────────

function AddFrameworkModal({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (fw: SuperAdminFramework) => void;
}) {
  const [mode, setMode]             = useState<"yaml" | "pdf">("yaml");
  const [name, setName]             = useState("");
  const [shortName, setShortName]   = useState("");
  const [version, setVersion]       = useState("1.0");
  const [yamlContent, setYaml]      = useState("");
  const [file, setFile]             = useState<File | null>(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !shortName.trim()) { setError("Name and Short Name are required."); return; }
    setSaving(true);
    setError("");
    try {
      let fw: SuperAdminFramework;
      if (mode === "pdf" && file) {
        fw = await superAdminFrameworksApi.uploadPdf(file);
      } else {
        fw = await superAdminFrameworksApi.createFromData({
          name: name.trim(),
          short_name: shortName.trim().toUpperCase(),
          version: version.trim() || "1.0",
          yaml_content: yamlContent.trim() || undefined,
        });
      }
      onCreated(fw);
    } catch {
      // Offline / demo: create a local placeholder
      onCreated({
        id: `local-${Date.now()}`,
        name: name.trim(),
        short_name: shortName.trim().toUpperCase(),
        version: version.trim() || "1.0",
        controls_count: undefined,
        created_at: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600" /> Add Framework
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Mode toggle */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden">
            {(["yaml", "pdf"] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === m ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-50"
                }`}
              >
                {m === "yaml" ? "YAML / JSON Entry" : "PDF Upload"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Framework Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="ISO 27001:2022"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Short Name *</label>
              <input
                value={shortName}
                onChange={e => setShortName(e.target.value)}
                required
                placeholder="ISO27001"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Version</label>
            <input
              value={version}
              onChange={e => setVersion(e.target.value)}
              placeholder="2022"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {mode === "yaml" ? (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">YAML / JSON Content <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea
                value={yamlContent}
                onChange={e => setYaml(e.target.value)}
                rows={7}
                placeholder={"name: ISO 27001\nshort_name: ISO27001\ncontrols:\n  - id: A.5.1\n    title: Policies for information security\n    category: ORGANIZATIONAL"}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">PDF File</label>
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-all"
              >
                <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                {file
                  ? <p className="text-sm font-medium text-gray-800">{file.name}</p>
                  : <>
                    <p className="text-sm text-gray-500 font-medium">Click to select a PDF</p>
                    <p className="text-xs text-gray-400 mt-1">The framework controls will be extracted automatically</p>
                  </>
                }
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2.5 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Add Framework"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab: Frameworks ───────────────────────────────────────────────────────────

function FrameworksTab() {
  const [frameworks, setFrameworks] = useState<SuperAdminFramework[]>([]);
  const [loading, setLoading]       = useState(true);
  const [isDemo, setIsDemo]         = useState(false);
  const [showModal, setShowModal]   = useState(false);

  useEffect(() => {
    superAdminFrameworksApi.listAll()
      .then(data => { setFrameworks(data); setLoading(false); })
      .catch(() => { setFrameworks(MOCK_FRAMEWORKS); setIsDemo(true); setLoading(false); });
  }, []);

  async function deleteFramework(id: string) {
    if (!confirm("Delete this framework? This will affect all tenants using it.")) return;
    try { await superAdminFrameworksApi.delete(id); } catch { /* demo */ }
    setFrameworks(prev => prev.filter(f => f.id !== id));
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
    </div>
  );

  return (
    <div>
      {isDemo && <DemoBanner />}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{frameworks.length} framework{frameworks.length !== 1 ? "s" : ""} available on the platform</p>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Framework
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {["Framework", "Short Name", "Version", "Controls", "Added", "Actions"].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {frameworks.map(fw => (
              <tr key={fw.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3.5 font-medium text-gray-900">{fw.name}</td>
                <td className="px-5 py-3.5">
                  <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-md text-xs font-mono font-medium">{fw.short_name}</span>
                </td>
                <td className="px-5 py-3.5 text-gray-600">{fw.version}</td>
                <td className="px-5 py-3.5 text-gray-600">{fw.controls_count ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-5 py-3.5 text-gray-400 text-xs">{new Date(fw.created_at).toLocaleDateString()}</td>
                <td className="px-5 py-3.5">
                  <button
                    type="button"
                    onClick={() => deleteFramework(fw.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete framework"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <AddFrameworkModal
          onClose={() => setShowModal(false)}
          onCreated={fw => { setFrameworks(prev => [fw, ...prev]); setShowModal(false); }}
        />
      )}
    </div>
  );
}

// ── Tab: Settings ────────────────────────────────────────────────────────────

type SettingsSub = "profile" | "security" | "notifications" | "platform";

const SETTINGS_TABS: { id: SettingsSub; label: string }[] = [
  { id: "profile",       label: "Profile"       },
  { id: "security",      label: "Security"      },
  { id: "notifications", label: "Notifications" },
  { id: "platform",      label: "Platform Info" },
];

function SettingsTab() {
  const user = authSession.getUser();
  const [sub, setSub] = useState<SettingsSub>("profile");
  const [firstName, setFirstName] = useState("Super");
  const [lastName, setLastName]   = useState("Admin");
  const [email, setEmail]         = useState(user?.email ?? "superadmin@platform.com");
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd]         = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifNewUser, setNotifNewUser] = useState(true);
  const [notifNewTenant, setNotifNewTenant] = useState(true);
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex gap-8 max-w-4xl">
      {/* Sub-nav */}
      <aside className="w-44 flex-shrink-0">
        <nav className="space-y-0.5">
          {SETTINGS_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSub(t.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                sub === t.id ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1">
        {saved && (
          <div className="flex items-center gap-2 mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
            <CheckCircle className="w-4 h-4 flex-shrink-0" /> Changes saved.
          </div>
        )}

        {sub === "profile" && (
          <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
            <h3 className="font-semibold text-gray-900">Profile</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">First Name</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Last Name</label>
                <input value={lastName} onChange={e => setLastName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
              <div className="px-3 py-2.5 border border-gray-100 rounded-xl bg-gray-50 text-sm text-gray-500">
                <span className="px-2 py-0.5 bg-red-50 text-red-700 text-xs font-semibold rounded-full">Super Admin</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Organization</label>
              <div className="px-3 py-2.5 border border-gray-100 rounded-xl bg-gray-50 text-sm text-gray-500">Platform Owner</div>
            </div>
            <button type="submit" className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
              Save Changes
            </button>
          </form>
        )}

        {sub === "security" && (
          <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
            <h3 className="font-semibold text-gray-900">Change Password</h3>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Current Password</label>
              <input type="password" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} placeholder="••••••••"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">New Password</label>
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Min 8 characters"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} placeholder="Repeat new password"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
              Default credentials: <strong>superadmin@platform.com / super123</strong> — change in production.
            </div>
            <button type="submit" className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
              Update Password
            </button>
          </form>
        )}

        {sub === "notifications" && (
          <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
            <h3 className="font-semibold text-gray-900">Notification Preferences</h3>
            {[
              { label: "Email notifications", sub: "Receive platform alerts by email", value: notifEmail, onChange: setNotifEmail },
              { label: "New user registered",  sub: "Alert when a new user joins any tenant", value: notifNewUser, onChange: setNotifNewUser },
              { label: "New tenant created",   sub: "Alert when a new organization signs up", value: notifNewTenant, onChange: setNotifNewTenant },
            ].map(({ label, sub: desc, value, onChange }) => (
              <div key={label} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(v => !v)}
                  className="flex-shrink-0"
                >
                  {value
                    ? <ToggleRight className="w-7 h-7 text-indigo-600" />
                    : <ToggleLeft  className="w-7 h-7 text-gray-300"   />
                  }
                </button>
              </div>
            ))}
            <button type="submit" className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
              Save Preferences
            </button>
          </form>
        )}

        {sub === "platform" && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Platform Info</h3>
            {[
              { label: "Backend API",  value: <a href="http://localhost:8000/api/v1/docs" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">localhost:8000/api/v1/docs</a> },
              { label: "Frontend",     value: <span className="text-gray-900">localhost:4000</span> },
              { label: "Version",      value: <span className="text-gray-900">0.1.0</span> },
              { label: "Database",     value: <span className="text-gray-900">SQLite (dev) → PostgreSQL (prod)</span> },
              { label: "Auth",         value: <span className="text-gray-900">JWT / bcrypt</span> },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-500">{label}</span>
                <span className="text-sm font-medium">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: AI Access Requests ───────────────────────────────────────────────────

function AiAccessTab() {
  const [requests, setRequests] = useState<AiAccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [responding, setResponding] = useState<string | null>(null);

  useEffect(() => {
    superAdminAiAccessApi.listAiRequests()
      .then(data => { setRequests(data); setLoading(false); })
      .catch(() => {
        setRequests([
          { id: "r1", tenant_id: "t1", user_id: "u1", user_email: "ciso@demo.com", user_name: "Sophie Martin", feature: "document-generation", reason: "Need to generate ISO 27001 policies", status: "pending", requested_at: new Date(Date.now() - 86400000).toISOString(), created_at: "", updated_at: "" },
          { id: "r2", tenant_id: "t2", user_id: "u3", user_email: "audit@demo.com", user_name: "Jean Dupont", feature: "ai-analysis", reason: "Analyze compliance gaps for SOC 2", status: "pending", requested_at: new Date().toISOString(), created_at: "", updated_at: "" },
        ]);
        setIsDemo(true);
        setLoading(false);
      });
  }, []);

  async function approveRequest(id: string) {
    setResponding(id);
    try {
      console.log("Calling approve for request:", id);
      const updated = await superAdminAiAccessApi.approveRequest(id, "Approved - Welcome to AI features");
      console.log("Approve response:", updated);
      setRequests(prev => {
        const updated_list = prev.map(r => r.id === id ? updated : r);
        console.log("Updated requests list:", updated_list);
        return updated_list;
      });
    } catch (err) {
      console.error("Approve failed:", err);
      // Show alert so user knows there was an error
      alert(`Error approving request: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setResponding(null); }
  }

  async function denyRequest(id: string) {
    setResponding(id);
    try {
      const updated = await superAdminAiAccessApi.denyRequest(id, "AI access not available for your current plan");
      setRequests(prev => prev.map(r => r.id === id ? updated : r));
    } catch (err) {
      console.error("Deny failed:", err);
      // Don't update locally on error - keep the original request
    } finally { setResponding(null); }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

  const pending = requests.filter(r => r.status === "pending");
  const approved = requests.filter(r => r.status === "approved");
  const denied = requests.filter(r => r.status === "denied");

  return (
    <div className="space-y-6">
      {isDemo && <DemoBanner />}

      {/* Pending requests */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Pending Requests</h2>
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">{pending.length}</span>
        </div>

        {pending.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No pending requests</p>
        ) : (
          <div className="space-y-3">
            {pending.map(req => (
              <div key={req.id} className="flex items-start justify-between p-4 border border-amber-200 bg-amber-50 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-gray-900">{req.user_name}</p>
                    <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">{req.feature.replace("-", " ")}</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{req.reason}</p>
                  <p className="text-xs text-gray-500">{req.user_email} · {new Date(req.requested_at).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2 ml-4">
                  <button type="button" onClick={() => approveRequest(req.id)} disabled={responding === req.id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-60">
                    {responding === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />} Approve
                  </button>
                  <button type="button" onClick={() => denyRequest(req.id)} disabled={responding === req.id}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-60">
                    {responding === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />} Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Approved & Denied */}
      <div className="grid grid-cols-2 gap-6">
        {/* Approved */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Approved ({approved.length})</h3>
          <div className="space-y-2">
            {approved.map(req => (
              <div key={req.id} className="flex items-center justify-between p-3 border border-green-200 bg-green-50 rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{req.user_name}</p>
                  <p className="text-xs text-gray-500">{req.user_email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <button
                    type="button"
                    onClick={() => denyRequest(req.id)}
                    disabled={responding === req.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 rounded transition-colors disabled:opacity-60"
                  >
                    {responding === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />} Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Denied */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Denied ({denied.length})</h3>
          <div className="space-y-2">
            {denied.map(req => (
              <div key={req.id} className="flex items-center justify-between p-3 border border-red-200 bg-red-50 rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{req.user_name}</p>
                  <p className="text-xs text-gray-500">{req.user_email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <X className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <button
                    type="button"
                    onClick={() => approveRequest(req.id)}
                    disabled={responding === req.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-100 rounded transition-colors disabled:opacity-60"
                  >
                    {responding === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />} Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Subscriptions ────────────────────────────────────────────────────────

function SubscriptionsTab() {
  const [subs, setSubs]       = useState<TenantSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo]   = useState(false);
  const [editing, setEditing] = useState<TenantSubscription | null>(null);

  useEffect(() => {
    superAdminSubscriptionsApi.listAll()
      .then(data => { setSubs(data); setLoading(false); })
      .catch(() => { setIsDemo(true); setLoading(false); });
  }, []);

  function handleSaved(updated: TenantSubscription) {
    setSubs(prev => prev.map(s => s.tenant_id === updated.tenant_id ? updated : s));
    setEditing(null);
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

  return (
    <div>
      {isDemo && <DemoBanner />}
      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {["Organization", "Plan", "Status", "Trial Expires", "Actions"].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {subs.map(s => {
              const expiry = s.trial_ends_at ? new Date(s.trial_ends_at) : null;
              const expired = expiry && expiry < new Date();
              return (
                <tr key={s.tenant_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-gray-900">{s.tenant_name}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${TIER_COLORS[s.tier] ?? "bg-gray-100 text-gray-600"}`}>
                      {s.tier}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {s.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm">
                    {expiry ? (
                      <span className={expired ? "text-red-500 font-medium" : "text-gray-700"}>
                        {expiry.toLocaleDateString()}
                        {expired && <span className="ml-1.5 text-xs text-red-400">(expired)</span>}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3">{subs.length} tenant{subs.length !== 1 ? "s" : ""} total</p>

      {editing && (
        <EditSubscriptionModal
          sub={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ── Support Tickets Tab ───────────────────────────────────────────────────────

const STATUS_STYLES: Record<TicketStatus, string> = {
  open:         "bg-blue-100 text-blue-700",
  in_progress:  "bg-amber-100 text-amber-700",
  waiting_user: "bg-purple-100 text-purple-700",
  resolved:     "bg-emerald-100 text-emerald-700",
  closed:       "bg-gray-100 text-gray-500",
};
const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low:    "bg-gray-100 text-gray-500",
  medium: "bg-blue-100 text-blue-700",
  high:   "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

function AdminChatPanel({
  ticketId,
  onChatUpdate,
}: { ticketId: string; onChatUpdate: (s: ChatSessionData) => void }) {
  const [msgs, setMsgs] = useState<{ id: string; content: string; is_support: boolean; sender_name: string; created_at: string }[]>([]);
  const [input, setInput]   = useState("");
  const [wsReady, setWsReady] = useState(false);
  const wsRef   = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  useEffect(() => {
    const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token") || "";
    const wsBase = (import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1").replace(/^http/, "ws");
    const ws = new WebSocket(`${wsBase}/support/tickets/${ticketId}/chat/ws?token=${token}`);
    wsRef.current = ws;
    ws.onopen  = () => setWsReady(true);
    ws.onclose = () => setWsReady(false);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "message") setMsgs(prev => [...prev, data]);
        if (data.type === "chat_ended") onChatUpdate({ id: "", ticket_id: ticketId, status: "ended", requested_at: null, started_at: null, ended_at: null });
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [ticketId]);

  function send() {
    const c = input.trim();
    if (!c || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ content: c }));
    setInput("");
  }

  async function end() {
    try { const s = await supportApi.updateChat(ticketId, "end"); onChatUpdate(s); wsRef.current?.close(); } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col h-72 border border-blue-200 rounded-xl overflow-hidden mt-4">
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white">
        <Video className="w-4 h-4" />
        <span className="text-sm font-semibold flex-1">Live Chat</span>
        {wsReady ? <span className="flex items-center gap-1 text-xs text-blue-200"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live</span>
          : <span className="text-xs text-blue-300">Connecting…</span>}
        <button onClick={end} className="p-1 rounded-lg hover:bg-blue-700" title="End chat"><PhoneOff className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
        {msgs.length === 0 && <p className="text-center text-xs text-gray-400 mt-6">Chat started — write to the user.</p>}
        {msgs.map(m => (
          <div key={m.id} className={`flex ${m.is_support ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-xs px-3 py-2 rounded-2xl text-sm ${m.is_support ? "bg-blue-600 text-white" : "bg-white border border-gray-200"}`}>
              {!m.is_support && <p className="text-xs font-semibold text-blue-600 mb-0.5">{m.sender_name}</p>}
              <p>{m.content}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100 bg-white">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Reply to user…" disabled={!wsReady}
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={send} disabled={!wsReady || !input.trim()} className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function SupportTicketDetail({ ticket: init, onBack, onUpdated }: {
  ticket: SupportTicketDetail; onBack: () => void; onUpdated: (t: SupportTicketDetail) => void;
}) {
  const [ticket, setTicket]   = useState(init);
  const [newMsg, setNewMsg]   = useState("");
  const [sending, setSending] = useState(false);
  const [chatSession, setChat] = useState<ChatSessionData | null>(ticket.chat_session);
  const [reqChat, setReqChat] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [ticket.messages]);

  async function reload() {
    try { const t = await supportApi.get(ticket.id); setTicket(t); setChat(t.chat_session); onUpdated(t); } catch { /* ignore */ }
  }

  async function sendMsg(e: React.FormEvent) {
    e.preventDefault();
    if (!newMsg.trim()) return;
    setSending(true);
    try {
      const msg = await supportApi.postMessage(ticket.id, newMsg.trim());
      setTicket(prev => ({ ...prev, messages: [...prev.messages, msg] }));
      setNewMsg("");
    } catch { /* ignore */ } finally { setSending(false); }
  }

  async function updateStatus(s: TicketStatus) {
    try { const t = await supportApi.update(ticket.id, { status: s }); setTicket(t); onUpdated(t); } catch { /* ignore */ }
  }

  async function startChat() {
    setReqChat(true);
    try { const s = await supportApi.requestChat(ticket.id); setChat(s); } catch { /* ignore */ } finally { setReqChat(false); }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight className="w-4 h-4 rotate-180 text-gray-500" /></button>
        <div className="flex-1">
          <h3 className="font-bold text-gray-900">{ticket.title}</h3>
          <p className="text-xs text-gray-400">{ticket.user.first_name} {ticket.user.last_name} · {ticket.user.role} · {fmtDate(ticket.created_at)}</p>
        </div>
        <button onClick={reload} className="p-1.5 rounded-lg hover:bg-gray-100" title="Refresh"><RefreshCw className="w-4 h-4 text-gray-400" /></button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[ticket.status]}`}>{ticket.status.replace("_"," ")}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PRIORITY_STYLES[ticket.priority]}`}>{ticket.priority}</span>
        <div className="flex-1" />
        {/* Status controls */}
        {(["open","in_progress","waiting_user","resolved","closed"] as TicketStatus[]).map(s => (
          s !== ticket.status && (
            <button key={s} onClick={() => updateStatus(s)}
              className="px-2 py-1 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-gray-100 capitalize">
              → {s.replace("_"," ")}
            </button>
          )
        ))}
      </div>

      <div className="bg-gray-50 rounded-xl px-4 py-3 mb-4">
        <p className="text-xs font-semibold text-gray-400 mb-1">Description</p>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
      </div>

      {/* Chat controls */}
      {(!chatSession || chatSession.status === "ended") && (
        <button onClick={startChat} disabled={reqChat}
          className="flex items-center gap-2 px-4 py-2 mb-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-sm font-semibold hover:bg-blue-100 disabled:opacity-60">
          {reqChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
          Request Live Chat
        </button>
      )}
      {chatSession && chatSession.status === "pending" && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-3">
          <Video className="w-4 h-4 text-amber-600" />
          <p className="text-sm text-amber-800 font-semibold flex-1">Chat request sent — waiting for user to accept…</p>
        </div>
      )}
      {chatSession && chatSession.status === "active" && <AdminChatPanel ticketId={ticket.id} onChatUpdate={setChat} />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3">
        {ticket.messages.length === 0 && <p className="text-center text-sm text-gray-400 py-6">No messages yet.</p>}
        {ticket.messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.is_support ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.is_support ? "bg-blue-600 text-white" : "bg-white border border-gray-200"}`}>
              <div className={`text-xs font-semibold mb-1 ${msg.is_support ? "text-blue-200" : "text-blue-600"}`}>
                {msg.is_support ? "Support" : `${msg.sender.first_name} ${msg.sender.last_name}`} · {fmtDate(msg.created_at)}
              </div>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={sendMsg} className="flex gap-2">
        <input value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Reply to user…"
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button type="submit" disabled={sending || !newMsg.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 text-sm font-semibold">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Reply
        </button>
      </form>
    </div>
  );
}

function SupportTab() {
  const [tickets, setTickets]   = useState<SupportTicketListItem[]>([]);
  const [selected, setSelected] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatus] = useState("all");

  const load = useCallback(async () => {
    try {
      const data = await supportApi.list(statusFilter !== "all" ? { status: statusFilter } : {});
      setTickets(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function open(id: string) {
    try { setSelected(await supportApi.get(id)); } catch { /* ignore */ }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="grid lg:grid-cols-5 gap-6 h-[calc(100vh-160px)]">
      {/* List */}
      <div className="lg:col-span-2 flex flex-col gap-3">
        <div className="flex gap-1 flex-wrap">
          {["all","open","in_progress","waiting_user","resolved","closed"].map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${statusFilter === s ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              {s.replace("_"," ")}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Headphones className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No tickets</p>
          </div>
        ) : (
          <div className="overflow-y-auto space-y-2">
            {tickets.map(t => (
              <button key={t.id} onClick={() => open(t.id)}
                className={`w-full text-left border rounded-xl px-4 py-3 hover:shadow-sm transition-all ${selected?.id === t.id ? "border-indigo-400 bg-indigo-50" : "border-gray-200 bg-white"}`}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="font-semibold text-gray-900 text-sm leading-snug">{t.title}</p>
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </div>
                <p className="text-xs text-gray-500 mb-1.5">{t.user.first_name} {t.user.last_name}</p>
                <div className="flex gap-1.5 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLES[t.status]}`}>{t.status.replace("_"," ")}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold capitalize ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span>
                  {t.has_chat && <span className="flex items-center gap-0.5 text-xs text-blue-600 font-semibold"><Video className="w-3 h-3" />Chat</span>}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">{fmtDate(t.updated_at)} · {t.message_count} msgs</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail */}
      <div className="lg:col-span-3">
        {selected ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 h-full flex flex-col">
            <SupportTicketDetail ticket={selected} onBack={() => setSelected(null)}
              onUpdated={(t) => { setSelected(t); setTickets(prev => prev.map(x => x.id === t.id ? { ...x, status: t.status, message_count: t.messages.length } : x)); }} />
          </div>
        ) : (
          <div className="flex bg-gray-50 border border-gray-200 rounded-2xl h-full items-center justify-center text-gray-400 flex-col gap-3">
            <MessageSquare className="w-8 h-8 opacity-30" />
            <p className="text-sm font-semibold">Select a ticket</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabId = "users" | "access" | "frameworks" | "subscriptions" | "ai-access" | "support" | "settings";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "users",         label: "Users",           icon: Users      },
  { id: "access",        label: "Access Control",  icon: Shield     },
  { id: "frameworks",    label: "Frameworks",      icon: BookOpen   },
  { id: "subscriptions", label: "Subscriptions",   icon: CreditCard },
  { id: "ai-access",     label: "AI Requests",     icon: Sparkles   },
  { id: "support",       label: "Support Tickets", icon: Headphones },
  { id: "settings",      label: "Settings",        icon: Settings   },
];

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>("users");
  const navigate = useNavigate();
  const user = authSession.getUser();

  if (!user || user.role !== "super_admin") {
    return <Navigate to="/login" replace />;
  }

  function handleLogout() {
    authSession.logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-56 flex flex-col bg-slate-900 shadow-2xl flex-shrink-0 fixed h-full">
        <div className="flex flex-col items-center px-4 py-5 border-b border-slate-700/60">
          <img src="/logo-vertical.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-24 w-auto object-contain bg-white/95 rounded-xl p-2" />
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium transition-all text-left ${
                activeTab === id
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <div className="px-3 pb-5 pt-3 border-t border-slate-700/60">
          <div className="flex items-center gap-2.5 px-3 py-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">S</div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white leading-none truncate">{user.name}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 ml-56 flex flex-col min-h-screen">
        {/* Header */}
        <header className="bg-white border-b border-gray-100 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h1 className="text-lg font-bold text-gray-900 capitalize">
              {TABS.find(t => t.id === activeTab)?.label}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {activeTab === "users"      && "Manage users and roles across all tenants"}
              {activeTab === "access"     && "Control which modules each tenant can access"}
              {activeTab === "frameworks" && "Upload and manage compliance frameworks"}
              {activeTab === "subscriptions" && "Manage tenant plans, statuses, and trial expiry dates"}
              {activeTab === "ai-access"    && "Review and approve AI feature access requests"}
              {activeTab === "support"      && "View and respond to user support tickets"}
              {activeTab === "settings"     && "Platform configuration and credentials"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-red-50 text-red-600 text-xs font-semibold rounded-full border border-red-100">Super Admin</span>
          </div>
        </header>

        {/* Tab content */}
        <main className="flex-1 p-8">
          {activeTab === "users"      && <UsersTab />}
          {activeTab === "access"        && <AccessControlTab />}
          {activeTab === "frameworks"    && <FrameworksTab />}
          {activeTab === "subscriptions" && <SubscriptionsTab />}
          {activeTab === "ai-access"     && <AiAccessTab />}
          {activeTab === "support"       && <SupportTab />}
          {activeTab === "settings"   && <SettingsTab />}
        </main>
      </div>
    </div>
  );
}
