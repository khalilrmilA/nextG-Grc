import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { usersApi } from "../api/endpoints";
import {
  UserPlus, Trash2, ToggleLeft, ToggleRight,
  Loader2, AlertCircle, CheckCircle, Eye, EyeOff, X,
  ClipboardList, Layers, KeyRound, Users, ShieldCheck,
  Search, ChevronDown,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  expires_at?: string | null;
}

const ASSIGNABLE_ROLES = [
  { value: "tenant_admin",        label: "Admin" },
  { value: "ciso",                label: "CISO" },
  { value: "risk_manager",        label: "Risk Manager" },
  { value: "compliance_manager",  label: "Compliance Manager" },
  { value: "auditor",             label: "Auditor" },
  { value: "policy_manager",      label: "Policy Manager" },
  { value: "vendor_manager",      label: "Vendor Manager" },
  { value: "control_owner",       label: "Control Owner" },
  { value: "viewer",              label: "Viewer" },
];

function roleLabel(role: string) {
  return ASSIGNABLE_ROLES.find(r => r.value === role.toLowerCase())?.label ?? role;
}

function roleBadgeClass(role: string): string {
  const map: Record<string, string> = {
    tenant_admin:       "bg-blue-100 text-blue-700",
    ciso:               "bg-purple-100 text-purple-700",
    risk_manager:       "bg-amber-100 text-amber-700",
    compliance_manager: "bg-teal-100 text-teal-700",
    auditor:            "bg-indigo-100 text-indigo-700",
    policy_manager:     "bg-orange-100 text-orange-700",
    vendor_manager:     "bg-cyan-100 text-cyan-700",
    control_owner:      "bg-pink-100 text-pink-700",
    viewer:             "bg-gray-100 text-gray-600",
    super_admin:        "bg-red-100 text-red-700",
  };
  return map[role.toLowerCase()] ?? "bg-gray-100 text-gray-600";
}

function avatarColor(role: string): string {
  const map: Record<string, string> = {
    tenant_admin:       "from-blue-400 to-blue-600",
    ciso:               "from-purple-400 to-purple-600",
    risk_manager:       "from-amber-400 to-orange-500",
    compliance_manager: "from-teal-400 to-teal-600",
    auditor:            "from-indigo-400 to-indigo-600",
    policy_manager:     "from-orange-400 to-red-500",
    vendor_manager:     "from-cyan-400 to-cyan-600",
    control_owner:      "from-pink-400 to-pink-600",
    viewer:             "from-gray-400 to-gray-500",
  };
  return map[role.toLowerCase()] ?? "from-gray-400 to-gray-600";
}

// ── Password Display Modal ────────────────────────────────────────────────────

function PasswordModal({
  title,
  name,
  email,
  password,
  onClose,
}: {
  readonly title: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyPassword() {
    navigator.clipboard.writeText(password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-green-600" /> {title}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-100 rounded-xl">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">{name}</p>
              <p className="text-xs text-green-600">{email}</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Temporary Password</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono text-gray-800 select-all">
                {password}
              </code>
              <button
                type="button"
                onClick={copyPassword}
                className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${copied ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
            Share this password securely — it will not be shown again. The user should change it after first login.
          </p>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create User Modal ─────────────────────────────────────────────────────────

function CreateUserModal({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (u: TenantUser, password: string) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [role,      setRole]      = useState("viewer");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !email.trim()) { setError("First name and email are required."); return; }
    setSaving(true);
    setError("");
    try {
      const created = await usersApi.createUser({
        email: email.trim().toLowerCase(),
        first_name: firstName.trim(),
        last_name: lastName.trim() || "-",
        role,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      onCreated(
        { id: created.id, email: created.email, first_name: created.first_name, last_name: created.last_name, role: created.role, is_active: created.is_active, expires_at: created.expires_at },
        (created as { temporary_password?: string }).temporary_password ?? "",
      );
      onClose();
    } catch {
      setError("Failed to create user. The email may already be in use.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-600" /> Add User
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First Name</label>
              <input
                value={firstName} onChange={e => setFirstName(e.target.value)} required autoFocus
                placeholder="Jane"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last Name</label>
              <input
                value={lastName} onChange={e => setLastName(e.target.value)}
                placeholder="Smith"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              placeholder="jane@company.com"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <div className="relative">
              <select
                value={role} onChange={e => setRole(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white pr-8"
              >
                {ASSIGNABLE_ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Account Expiry <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
            <p className="text-xs text-blue-700">A temporary password will be generated and shown once after creation.</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Create Auditor Modal (unchanged) ─────────────────────────────────────────

function CreateAuditorModal({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (a: TenantUser) => void;
}) {
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [done,     setDone]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) { setError("All fields are required."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setSaving(true);
    setError("");
    try {
      const created = await usersApi.createAuditor({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setDone(true);
      setTimeout(() => {
        onCreated({ id: created.id, email: created.email, first_name: created.first_name, last_name: created.last_name, role: "auditor", is_active: true, expires_at: created.expires_at ?? null });
        onClose();
      }, 1200);
    } catch {
      setError("Failed to create auditor. The email may already be in use.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-600" /> Add Auditor
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {done ? (
            <div className="py-6 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <p className="font-semibold text-gray-800">Auditor created!</p>
              <p className="text-sm text-gray-400 mt-1">{name} can now log in.</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
                <input value={name} onChange={e => setName(e.target.value)} required autoFocus placeholder="Jane Smith"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="jane@company.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password</label>
                <div className="relative">
                  <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required placeholder="Min 8 characters"
                    className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="aud-expires" className="block text-xs font-medium text-gray-700 mb-1">
                  Account Expiry <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input id="aud-expires" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-700">The auditor will have read-only access to assigned assessments.</p>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2.5 rounded-xl">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : "Create Auditor"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

// ── Assign Frameworks Modal ───────────────────────────────────────────────────

function AssignFrameworksModal({ auditor, onClose }: { readonly auditor: TenantUser; readonly onClose: () => void }) {
  const [assessments, setAssessments] = useState<{id: string; name: string; framework_name: string}[]>([]);
  const [assignments, setAssignments] = useState<{assignment_id: string; assessment_id: string}[]>([]);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      import('../api/endpoints').then(m => m.complianceApi.listAssessments()),
      import('../api/endpoints').then(m => m.usersApi.listAssignments()),
    ]).then(([assesssResp, assigns]) => {
      const assesssList = (assesssResp as { items?: unknown[] }).items ?? (Array.isArray(assesssResp) ? assesssResp : []);
      setAssessments((assesssList as Array<{id: string; name?: string; framework_name?: string; framework_id?: string}>).map(a => ({
        id: a.id, name: a.name || 'Assessment', framework_name: a.framework_name || a.framework_id || '',
      })));
      const auditorAssigns = (assigns as Array<{id: string; auditor_id: string; assessment_id: string}>).filter(a => a.auditor_id === auditor.id);
      setAssignments(auditorAssigns.map(a => ({ assignment_id: a.id, assessment_id: a.assessment_id || '' })));
      setSelected(new Set(auditorAssigns.map(a => a.assessment_id || '')));
    }).catch(() => {});
  }, [auditor.id]);

  async function handleSave() {
    setSaving(true);
    const { usersApi } = await import('../api/endpoints');
    try {
      for (const assessId of selected) {
        if (!assignments.find(a => a.assessment_id === assessId)) {
          await usersApi.assignAuditor(auditor.id, assessId);
        }
      }
      for (const a of assignments) {
        if (!selected.has(a.assessment_id)) {
          await usersApi.unassignAuditor(a.assignment_id);
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Assign Frameworks — {auditor.first_name} {auditor.last_name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <p className="px-5 py-2 text-xs text-gray-500 border-b bg-gray-50">Select the compliance assessments this auditor can access.</p>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {assessments.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No assessments found.</p>
          ) : assessments.map(a => (
            <label key={a.id} className="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={selected.has(a.id)}
                onChange={e => {
                  setSelected(prev => {
                    const next = new Set(prev);
                    e.target.checked ? next.add(a.id) : next.delete(a.id);
                    return next;
                  });
                }}
                className="w-4 h-4 accent-blue-600"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{a.framework_name}</p>
                <p className="text-xs text-gray-400 truncate">{a.name}</p>
              </div>
            </label>
          ))}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Save Assignments"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── All Users Tab ─────────────────────────────────────────────────────────────

function AllUsersTab({ currentUserEmail }: { readonly currentUserEmail: string }) {
  const [users,       setUsers]       = useState<TenantUser[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [search,      setSearch]      = useState("");
  const [busy,        setBusy]        = useState<string | null>(null);
  const [showCreate,  setShowCreate]  = useState(false);
  const [pwdModal,    setPwdModal]    = useState<{ name: string; email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await usersApi.listUsers();
      setUsers(data.map(u => ({
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        role: u.role,
        is_active: (u as { is_active?: boolean }).is_active ?? true,
        expires_at: (u as { expires_at?: string | null }).expires_at ?? null,
      })));
    } catch {
      setError("Could not load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(u: TenantUser) {
    setBusy(u.id);
    try {
      const updated = await usersApi.updateUser(u.id, { is_active: !u.is_active });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: updated.is_active } : x));
    } catch {
      // revert optimistic update silently
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(u: TenantUser, newRole: string) {
    setBusy(u.id + "_role");
    try {
      const updated = await usersApi.updateUser(u.id, { role: newRole });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: updated.role } : x));
    } catch {
      // silently ignore
    } finally {
      setBusy(null);
    }
  }

  async function handleResetPassword(u: TenantUser) {
    setBusy(u.id + "_pwd");
    try {
      const result = await usersApi.resetPassword(u.id);
      setPwdModal({ name: `${u.first_name} ${u.last_name}`, email: u.email, password: result.temporary_password });
    } catch {
      // silently ignore
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(u: TenantUser) {
    if (!confirm(`Remove ${u.first_name} ${u.last_name}? This cannot be undone.`)) return;
    setBusy(u.id + "_del");
    try {
      await usersApi.deleteUser(u.id);
      setUsers(prev => prev.filter(x => x.id !== u.id));
    } catch {
      // silently ignore
    } finally {
      setBusy(null);
    }
  }

  const filtered = users.filter(u =>
    `${u.first_name} ${u.last_name} ${u.email} ${u.role}`.toLowerCase().includes(search.toLowerCase())
  );

  const active   = users.filter(u => u.is_active).length;
  const inactive = users.filter(u => !u.is_active).length;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Users",  value: users.length,  color: "text-blue-600",   bg: "bg-blue-50"  },
          { label: "Active",       value: active,        color: "text-green-600",  bg: "bg-green-50" },
          { label: "Inactive",     value: inactive,      color: "text-gray-500",   bg: "bg-gray-50"  },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4 border border-gray-100`}>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email or role…"
            className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm flex-shrink-0"
        >
          <UserPlus className="w-4 h-4" /> Add User
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          <button onClick={load} className="ml-auto text-xs underline">Retry</button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">{search ? "No users match your search" : "No users yet"}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["User", "Email", "Role", "Status", "Actions"].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map(u => {
                const isSelf = u.email === currentUserEmail;
                const isSuperAdmin = u.role === "super_admin";
                const canEdit = !isSelf && !isSuperAdmin;
                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    {/* Name */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarColor(u.role)} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                          {u.first_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{u.first_name} {u.last_name}</p>
                          {isSelf && <p className="text-xs text-blue-500">You</p>}
                        </div>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="px-5 py-3.5 text-gray-500">{u.email}</td>

                    {/* Role */}
                    <td className="px-5 py-3.5">
                      {canEdit ? (
                        <div className="relative">
                          <select
                            value={u.role.toLowerCase()}
                            onChange={e => changeRole(u, e.target.value)}
                            disabled={busy === u.id + "_role"}
                            className={`pl-2 pr-6 py-1 rounded-full text-xs font-semibold border-0 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${roleBadgeClass(u.role)}`}
                          >
                            {ASSIGNABLE_ROLES.map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                          {busy === u.id + "_role"
                            ? <Loader2 className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin" />
                            : <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-60" />
                          }
                        </div>
                      ) : (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleBadgeClass(u.role)}`}>
                          {roleLabel(u.role)}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3.5">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => toggleActive(u)}
                          disabled={busy === u.id}
                          className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                          title={u.is_active ? "Disable account" : "Enable account"}
                        >
                          {busy === u.id ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" /> :
                            u.is_active
                              ? <><ToggleRight className="w-5 h-5 text-emerald-500" /><span className="text-emerald-600">Active</span></>
                              : <><ToggleLeft className="w-5 h-5 text-gray-400" /><span className="text-gray-500">Inactive</span></>
                          }
                        </button>
                      ) : (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                          {u.is_active ? "Active" : "Inactive"}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3.5">
                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleResetPassword(u)}
                            disabled={!!busy}
                            title="Reset password"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                          >
                            {busy === u.id + "_pwd" ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(u)}
                            disabled={!!busy}
                            title="Delete user"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            {busy === u.id + "_del" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(u, password) => {
            setUsers(prev => [u, ...prev]);
            if (password) setPwdModal({ name: `${u.first_name} ${u.last_name}`, email: u.email, password });
          }}
        />
      )}

      {pwdModal && (
        <PasswordModal
          title="User Created"
          name={pwdModal.name}
          email={pwdModal.email}
          password={pwdModal.password}
          onClose={() => setPwdModal(null)}
        />
      )}
    </div>
  );
}

// ── Auditors Tab ──────────────────────────────────────────────────────────────

function AuditorsTab() {
  const [auditors, setAuditors]             = useState<TenantUser[]>([]);
  const [loading,  setLoading]              = useState(true);
  const [isDemo,   setIsDemo]               = useState(false);
  const [busy,     setBusy]                 = useState<string | null>(null);
  const [showModal, setShowModal]           = useState(false);
  const [assigningAuditor, setAssigningAuditor] = useState<TenantUser | null>(null);

  useEffect(() => {
    usersApi.listUsers()
      .then(data => {
        setAuditors(data
          .filter(u => u.role === "auditor" || u.role === "AUDITOR")
          .map(u => ({ id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, role: u.role, is_active: (u as { is_active?: boolean }).is_active ?? true, expires_at: (u as { expires_at?: string | null }).expires_at ?? null }))
        );
        setLoading(false);
      })
      .catch(() => { setIsDemo(true); setLoading(false); });
  }, []);

  async function toggleActive(a: TenantUser) {
    setBusy(a.id);
    try {
      const updated = await usersApi.updateUser(a.id, { is_active: !a.is_active });
      setAuditors(prev => prev.map(x => x.id === a.id ? { ...x, is_active: updated.is_active } : x));
    } catch {
      setAuditors(prev => prev.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAuditor(id: string) {
    if (!confirm("Remove this auditor? They will lose access to all assignments.")) return;
    setBusy(id);
    try {
      await usersApi.deleteAuditor(id);
    } catch { /* fallthrough */ }
    setAuditors(prev => prev.filter(x => x.id !== id));
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      {isDemo && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Could not load auditors from backend — showing empty state.
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Auditors", value: auditors.length,                       color: "text-blue-600",  bg: "bg-blue-50"  },
          { label: "Active",         value: auditors.filter(a => a.is_active).length,  color: "text-green-600", bg: "bg-green-50" },
          { label: "Inactive",       value: auditors.filter(a => !a.is_active).length, color: "text-gray-500",  bg: "bg-gray-50"  },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4 border border-gray-100`}>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Your Auditors</h2>
        <button type="button" onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm">
          <UserPlus className="w-4 h-4" /> Add Auditor
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
      ) : auditors.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
          <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No auditors yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Add your first auditor to assign them to assessments.</p>
          <button type="button" onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
            Add Auditor
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Auditor", "Email", "Status", "Expiry", "Frameworks", "Actions"].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {auditors.map(a => (
                <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {a.first_name.charAt(0).toUpperCase()}
                      </div>
                      <p className="font-medium text-gray-900">{a.first_name} {a.last_name}</p>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{a.email}</td>
                  <td className="px-5 py-3.5">
                    <button type="button" onClick={() => toggleActive(a)} disabled={busy === a.id}
                      className="flex items-center gap-1.5 text-xs font-medium transition-colors">
                      {a.is_active
                        ? <><ToggleRight className="w-5 h-5 text-emerald-500" /><span className="text-emerald-600">Active</span></>
                        : <><ToggleLeft className="w-5 h-5 text-gray-400" /><span className="text-gray-500">Inactive</span></>
                      }
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    {a.expires_at ? (() => {
                      const exp = new Date(a.expires_at!);
                      const isExpired = exp < new Date();
                      return (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isExpired ? "bg-red-100 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                          {isExpired ? "Expired" : exp.toLocaleDateString()}
                        </span>
                      );
                    })() : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <button type="button" onClick={() => setAssigningAuditor(a)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                      <Layers className="w-3.5 h-3.5" /> Manage
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <button type="button" onClick={() => deleteAuditor(a.id)} disabled={busy === a.id}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      {busy === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CreateAuditorModal
          onClose={() => setShowModal(false)}
          onCreated={a => setAuditors(prev => [a, ...prev])}
        />
      )}
      {assigningAuditor && (
        <AssignFrameworksModal auditor={assigningAuditor} onClose={() => setAssigningAuditor(null)} />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CompanyAdminPage() {
  const user = useAuthStore(u => u);
  const [tab, setTab] = useState<"users" | "auditors">("users");

  if (!user || user.role !== "admin") return <Navigate to="/dashboard" replace />;

  const tabs = [
    { id: "users"    as const, label: "All Users",  icon: <Users className="w-4 h-4" /> },
    { id: "auditors" as const, label: "Auditors",   icon: <ShieldCheck className="w-4 h-4" /> },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
        <p className="text-sm text-gray-500 mt-1">Manage users, roles, and access control for your organization.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit mb-6">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.id
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "users"    && <AllUsersTab currentUserEmail={user.email ?? ""} />}
      {tab === "auditors" && <AuditorsTab />}
    </div>
  );
}
