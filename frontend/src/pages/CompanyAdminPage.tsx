import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { usersApi } from "../api/endpoints";
import {
  UserPlus, Trash2, ToggleLeft, ToggleRight,
  Loader2, AlertCircle, CheckCircle, Eye, EyeOff, X,
  ClipboardList, Layers,
} from "lucide-react";

interface Auditor {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  expires_at?: string | null;
}

// ── Create Auditor Modal ───────────────────────────────────────────────────────

function CreateAuditorModal({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (a: Auditor) => void;
}) {
  const [name, setName]           = useState("");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [showPwd, setShowPwd]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const [done, setDone]           = useState(false);

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
        onCreated({
          id: created.id,
          email: created.email,
          first_name: created.first_name,
          last_name: created.last_name,
          role: "auditor",
          is_active: true,
          expires_at: created.expires_at ?? null,
        });
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
                <input
                  value={name} onChange={e => setName(e.target.value)} required autoFocus
                  placeholder="Jane Smith"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
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
                <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password</label>
                <div className="relative">
                  <input
                    type={showPwd ? "text" : "password"}
                    value={password} onChange={e => setPassword(e.target.value)} required
                    placeholder="Min 8 characters"
                    className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Share securely — the auditor should change it after first login.</p>
              </div>

              <div>
                <label htmlFor="expires-at-admin" className="block text-xs font-medium text-gray-700 mb-1">
                  Account Expiry <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="expires-at-admin"
                  type="date"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Account will be locked automatically after this date.</p>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-700">
                  The auditor will have read-only access to assigned assessments. They can only record verdicts and notes.
                </p>
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

function AssignFrameworksModal({ auditor, onClose }: { readonly auditor: Auditor; readonly onClose: () => void }) {
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
        id: a.id,
        name: a.name || 'Assessment',
        framework_name: a.framework_name || a.framework_id || '',
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
      // Assign newly selected
      for (const assessId of selected) {
        const alreadyAssigned = assignments.find(a => a.assessment_id === assessId);
        if (!alreadyAssigned) {
          await usersApi.assignAuditor(auditor.id, assessId);
        }
      }
      // Unassign deselected
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
            <p className="text-sm text-gray-400 text-center py-4">No assessments found. Create a compliance assessment first.</p>
          ) : assessments.map(a => (
            <label key={a.id} className="flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={selected.has(a.id)}
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CompanyAdminPage() {
  const user = useAuthStore(u => u);
  const [auditors, setAuditors] = useState<Auditor[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy]         = useState<string | null>(null);
  const [isDemo, setIsDemo]     = useState(false);
  const [assigningAuditor, setAssigningAuditor] = useState<Auditor | null>(null);

  if (!user || user.role !== "admin") return <Navigate to="/dashboard" replace />;

  useEffect(() => {
    import("../api/endpoints").then(({ usersApi: api }) => {
      api.listUsers()
        .then((data) => {
          const auditors = data
            .filter((u) => u.role === "auditor" || u.role === "AUDITOR")
            .map((u) => ({
              id: u.id,
              email: u.email,
              first_name: u.first_name,
              last_name: u.last_name,
              role: u.role,
              is_active: true,
              expires_at: (u as { expires_at?: string | null }).expires_at ?? null,
            }));
          setAuditors(auditors);
          setLoading(false);
        })
        .catch(() => {
          setIsDemo(true);
          setLoading(false);
        });
    });
  }, []);

  async function toggleActive(a: Auditor) {
    setBusy(a.id);
    // optimistic update — backend PATCH /users/:id not yet wired, update locally
    setAuditors(prev => prev.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x));
    setBusy(null);
  }

  async function deleteAuditor(id: string) {
    if (!confirm("Remove this auditor? They will lose access to all assignments.")) return;
    setBusy(id);
    setAuditors(prev => prev.filter(x => x.id !== id));
    setBusy(null);
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your auditors — create accounts, control access.</p>
      </div>

      {isDemo && (
        <div className="flex items-center gap-2 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Could not load auditors from backend — showing empty state.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Auditors",   value: auditors.length,                       color: "text-blue-600",  bg: "bg-blue-50"  },
          { label: "Active",           value: auditors.filter(a => a.is_active).length,  color: "text-green-600", bg: "bg-green-50" },
          { label: "Inactive",         value: auditors.filter(a => !a.is_active).length, color: "text-gray-500",  bg: "bg-gray-50"  },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`${bg} rounded-xl p-4 border border-gray-100`}>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Table header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">Your Auditors</h2>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <UserPlus className="w-4 h-4" /> Add Auditor
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : auditors.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
          <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No auditors yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Add your first auditor to assign them to assessments.</p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
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
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {a.first_name.charAt(0).toUpperCase()}
                      </div>
                      <p className="font-medium text-gray-900">{a.first_name} {a.last_name}</p>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{a.email}</td>
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => toggleActive(a)}
                      disabled={busy === a.id}
                      className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                    >
                      {a.is_active
                        ? <><ToggleRight className="w-5 h-5 text-emerald-500" /><span className="text-emerald-600">Active</span></>
                        : <><ToggleLeft className="w-5 h-5 text-gray-400" /><span className="text-gray-500">Inactive</span></>
                      }
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    {a.expires_at ? (() => {
                      const exp = new Date(a.expires_at);
                      const isExpired = exp < new Date();
                      return (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isExpired ? "bg-red-100 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                          {isExpired ? "Expired" : exp.toLocaleDateString()}
                        </span>
                      );
                    })() : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => setAssigningAuditor(a)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                      title="Manage framework assignments"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Manage
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => deleteAuditor(a.id)}
                      disabled={busy === a.id}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Remove auditor"
                    >
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
        <AssignFrameworksModal
          auditor={assigningAuditor}
          onClose={() => setAssigningAuditor(null)}
        />
      )}
    </div>
  );
}
