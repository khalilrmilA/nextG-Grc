import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth";
import { usersApi } from "../api/endpoints";
import {
  UserPlus, Trash2, KeyRound, Users, Search, X,
  CheckCircle, Loader2, AlertCircle, Eye, EyeOff,
  Shield, ShieldCheck, ToggleLeft, ToggleRight, Pencil,
} from "lucide-react";

// ── Role definitions ──────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  ciso:               "bg-purple-100 text-purple-700 border-purple-200",
  risk_manager:       "bg-amber-100 text-amber-700 border-amber-200",
  compliance_manager: "bg-teal-100 text-teal-700 border-teal-200",
  policy_manager:     "bg-orange-100 text-orange-700 border-orange-200",
  vendor_manager:     "bg-cyan-100 text-cyan-700 border-cyan-200",
  control_owner:      "bg-pink-100 text-pink-700 border-pink-200",
  auditor:            "bg-indigo-100 text-indigo-700 border-indigo-200",
  viewer:             "bg-gray-100 text-gray-600 border-gray-200",
};

const ROLE_VALUES = ["ciso", "risk_manager", "compliance_manager", "policy_manager", "vendor_manager", "control_owner", "auditor", "viewer"];

function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation();
  const color = ROLE_COLORS[role] ?? "bg-gray-100 text-gray-600 border-gray-200";
  const label = String(t(`company_admin.roles.${role}_label` as never, role));
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      {label}
    </span>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  roles: string[];
  is_active: boolean;
}

// ── Password reveal modal ─────────────────────────────────────────────────────

function PasswordModal({ name, email, password, onClose }: {
  name: string; email: string; password: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
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
            <KeyRound className="w-4 h-4 text-green-600" /> {t("company_admin.pwd_modal_title")}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="p-4 bg-green-50 border border-green-100 rounded-xl">
            <p className="text-sm font-medium text-green-800">{t("company_admin.pwd_modal_created")} <span className="font-bold">{name}</span></p>
            <p className="text-xs text-green-600 mt-1">{email}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              {t("company_admin.pwd_label")}
            </label>
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200 font-mono text-sm">
              <span className="flex-1 select-all">{show ? password : "•".repeat(password.length)}</span>
              <button type="button" onClick={() => setShow(v => !v)} className="text-gray-400 hover:text-gray-600 p-1">
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={copy}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${copied ? "bg-green-600 text-white" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                {copied ? t("company_admin.copied") : t("company_admin.copy")}
              </button>
            </div>
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {t("company_admin.pwd_warning")}
            </p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            {t("company_admin.done")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create / Edit Roles modal ─────────────────────────────────────────────────

function UserFormModal({
  mode,
  user,
  onSave,
  onClose,
}: {
  mode: "create" | "edit";
  user?: TenantUser;
  onSave: (data: { firstName: string; lastName: string; email: string; roles: string[] }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName,  setLastName]  = useState(user?.last_name  ?? "");
  const [email,     setEmail]     = useState(user?.email      ?? "");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    user?.roles?.length ? user.roles : (user?.role ? [user.role] : [])
  );
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const roleOptions = ROLE_VALUES.map(value => ({
    value,
    label: String(t(`company_admin.roles.${value}_label` as never, value)),
    desc:  String(t(`company_admin.roles.${value}_desc`  as never, "")),
    color: ROLE_COLORS[value] ?? "bg-gray-100 text-gray-600 border-gray-200",
  }));

  function toggleRole(value: string) {
    setSelectedRoles(prev =>
      prev.includes(value) ? prev.filter(r => r !== value) : [...prev, value]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRoles.length) { setError(t("company_admin.err_select_role")); return; }
    setSaving(true);
    setError("");
    try {
      await onSave({ firstName, lastName, email, roles: selectedRoles });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? t("company_admin.err_save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-600" />
            {mode === "create" ? t("company_admin.form_invite_title") : `${t("company_admin.form_edit_title")} — ${user?.first_name} ${user?.last_name}`}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {mode === "create" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{t("company_admin.first_name")}</label>
                  <input
                    required value={firstName} onChange={e => setFirstName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Sarah"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{t("company_admin.last_name")}</label>
                  <input
                    required value={lastName} onChange={e => setLastName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Johnson"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t("company_admin.email_address")}</label>
                <input
                  required type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="sarah@company.com"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">
              {t("company_admin.assign_roles")}
              <span className="ml-1 text-gray-400 font-normal">{t("company_admin.assign_roles_hint")}</span>
            </label>
            <div className="space-y-2">
              {roleOptions.map(opt => {
                const active = selectedRoles.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleRole(opt.value)}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                      active
                        ? "border-blue-400 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2 transition-all ${
                      active ? "bg-blue-600 border-blue-600" : "border-gray-300"
                    }`}>
                      {active && <CheckCircle className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${opt.color}`}>
                          {opt.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              {t("company_admin.cancel")}
            </button>
            <button type="submit" disabled={saving || !selectedRoles.length}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "create" ? t("company_admin.create_account") : t("company_admin.save_roles")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CompanyAdminPage() {
  const { t } = useTranslation();
  const user = useAuthStore(u => u);

  // Only tenant_admin can access this page
  if (!user || user.role !== "tenant_admin") return <Navigate to="/dashboard" replace />;

  const [users,   setUsers]   = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [error,   setError]   = useState("");

  const [createModal, setCreateModal] = useState(false);
  const [editTarget,  setEditTarget]  = useState<TenantUser | null>(null);
  const [pwdModal,    setPwdModal]    = useState<{ name: string; email: string; password: string } | null>(null);
  const [deleteId,    setDeleteId]    = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await usersApi.list();
      // exclude self and super_admin from the list
      setUsers(data.filter((u: TenantUser) => u.id !== user.tenant_id && u.role !== "super_admin"));
    } catch {
      setError(t("company_admin.err_load"));
    } finally {
      setLoading(false);
    }
  }, [user.tenant_id]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filtered = users.filter(u =>
    `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total:    users.length,
    active:   users.filter(u => u.is_active).length,
    inactive: users.filter(u => !u.is_active).length,
  };

  async function handleCreate(data: { firstName: string; lastName: string; email: string; roles: string[] }) {
    const result = await usersApi.createUser({
      email: data.email,
      first_name: data.firstName,
      last_name: data.lastName,
      roles: data.roles,
    });
    setCreateModal(false);
    setPwdModal({ name: `${data.firstName} ${data.lastName}`, email: data.email, password: result.temporary_password });
    await loadUsers();
  }

  async function handleEditRoles(data: { firstName: string; lastName: string; email: string; roles: string[] }) {
    if (!editTarget) return;
    await usersApi.update(editTarget.id, { roles: data.roles });
    setEditTarget(null);
    await loadUsers();
  }

  async function handleToggleActive(u: TenantUser) {
    await usersApi.update(u.id, { is_active: !u.is_active });
    await loadUsers();
  }

  async function handleResetPassword(u: TenantUser) {
    const result = await usersApi.resetPassword(u.id);
    setPwdModal({ name: `${u.first_name} ${u.last_name}`, email: u.email, password: result.temporary_password });
  }

  async function handleDelete() {
    if (!deleteId) return;
    await usersApi.delete(deleteId);
    setDeleteId(null);
    await loadUsers();
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            {t("company_admin.title")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t("company_admin.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
        >
          <UserPlus className="w-4 h-4" /> {t("company_admin.invite_member")}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t("company_admin.total_members"), value: stats.total,    icon: Users,       color: "bg-blue-50 text-blue-600" },
          { label: t("company_admin.active"),        value: stats.active,   icon: ShieldCheck, color: "bg-green-50 text-green-600" },
          { label: t("company_admin.inactive"),      value: stats.inactive, icon: Shield,      color: "bg-gray-50 text-gray-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Search + Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("company_admin.search_placeholder")}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <span className="text-xs text-gray-400">{filtered.length} {filtered.length !== 1 ? t("company_admin.member_count_other") : t("company_admin.member_count_one")}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> {t("company_admin.loading")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500">
              {search ? t("company_admin.no_match") : t("company_admin.no_members")}
            </p>
            {!search && (
              <button type="button" onClick={() => setCreateModal(true)}
                className="mt-3 text-sm text-blue-600 hover:underline font-medium">
                {t("company_admin.invite_first")}
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(u => {
              const initials = `${u.first_name.charAt(0)}${u.last_name.charAt(0)}`.toUpperCase();
              const displayRoles = u.roles?.length ? u.roles : [u.role];
              return (
                <div key={u.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-sm font-bold">{initials}</span>
                  </div>

                  {/* Name + Email */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {u.first_name} {u.last_name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{u.email}</p>
                  </div>

                  {/* Role badges */}
                  <div className="flex flex-wrap gap-1.5 max-w-xs">
                    {displayRoles.map(r => <RoleBadge key={r} role={r} />)}
                  </div>

                  {/* Status */}
                  <div className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    u.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    {u.is_active ? t("company_admin.active") : t("company_admin.inactive")}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditTarget(u)}
                      title="Edit roles"
                      className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResetPassword(u)}
                      title="Reset password"
                      className="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(u)}
                      title={u.is_active ? "Deactivate" : "Activate"}
                      className="p-2 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                    >
                      {u.is_active
                        ? <ToggleRight className="w-4 h-4 text-green-500" />
                        : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(u.id)}
                      title="Delete"
                      className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Role legend */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-600" /> {t("company_admin.role_legend_title")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {ROLE_VALUES.map(value => {
            const label = String(t(`company_admin.roles.${value}_label` as never, value));
            const desc  = String(t(`company_admin.roles.${value}_desc`  as never, ""));
            const color = ROLE_COLORS[value] ?? "bg-gray-100 text-gray-600 border-gray-200";
            return (
            <div key={value} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/60">
              <span className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border mt-0.5 ${color}`}>
                {label}
              </span>
              <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
            </div>
            );
          })}
        </div>
      </div>

      {/* Modals */}
      {createModal && (
        <UserFormModal mode="create" onSave={handleCreate} onClose={() => setCreateModal(false)} />
      )}
      {editTarget && (
        <UserFormModal mode="edit" user={editTarget} onSave={handleEditRoles} onClose={() => setEditTarget(null)} />
      )}
      {pwdModal && (
        <PasswordModal
          name={pwdModal.name} email={pwdModal.email} password={pwdModal.password}
          onClose={() => setPwdModal(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t("company_admin.delete_title")}</h3>
            <p className="text-sm text-gray-500 mb-6">{t("company_admin.delete_desc")}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteId(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">
                {t("company_admin.cancel")}
              </button>
              <button type="button" onClick={handleDelete}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700">
                {t("company_admin.delete_confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
