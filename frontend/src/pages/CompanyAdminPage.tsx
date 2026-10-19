import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/auth";
import { usersApi, groupsApi, activityLogApi, subscriptionsApi, type TeamGroupRecord, type PlanUsage } from "../api/endpoints";
import { planDisplayName } from "../lib/plans";
import type { ActivityActionCatalogue } from "../types";
import {
  UserPlus, Trash2, KeyRound, Users, Search, X,
  CheckCircle, Loader2, AlertCircle, Eye, EyeOff,
  Shield, ShieldCheck, ToggleLeft, ToggleRight, Pencil,
  Activity, Clock, Filter, Plus, Download, Upload, LogIn, ScrollText,
  UsersRound, Ban, FolderPlus, Send,
} from "lucide-react";

// ── Role definitions ──────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  ciso:               "bg-purple-100 text-purple-700 border-purple-200",
  risk_manager:       "bg-amber-100 text-amber-700 border-amber-200",
  compliance_manager: "bg-teal-100 text-teal-700 border-teal-200",
  policy_manager:     "bg-orange-100 text-orange-700 border-orange-200",
  vendor_manager:     "bg-cyan-100 text-cyan-700 border-cyan-200",
  control_owner:      "bg-pink-100 text-pink-700 border-pink-200",
  business_owner:     "bg-lime-100 text-lime-700 border-lime-200",
  security_analyst:   "bg-rose-100 text-rose-700 border-rose-200",
  executive:          "bg-slate-100 text-slate-700 border-slate-200",
  auditor:            "bg-indigo-100 text-indigo-700 border-indigo-200",
  viewer:             "bg-gray-100 text-gray-600 border-gray-200",
};

const ROLE_VALUES = ["ciso", "risk_manager", "compliance_manager", "policy_manager", "vendor_manager", "control_owner", "business_owner", "security_analyst", "executive", "auditor", "viewer"];

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
  excluded_roles: string[];
  effective_roles: string[];
  is_active: boolean;
}

type TeamGroup = TeamGroupRecord;

/** Roles a group grants `userId` — used to frame "Custom Rules" as carve-outs
 * against group membership rather than free-form deny rules. */
function groupGrantedRoles(userId: string, groups: TeamGroup[]): { role: string; via: string[] }[] {
  const byRole = new Map<string, string[]>();
  for (const g of groups) {
    if (!g.member_ids.includes(userId)) continue;
    for (const r of g.roles) {
      byRole.set(r, [...(byRole.get(r) ?? []), g.name]);
    }
  }
  return Array.from(byRole.entries()).map(([role, via]) => ({ role, via }));
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
  groups,
  onSave,
  onClose,
}: {
  mode: "create" | "edit";
  user?: TenantUser;
  groups: TeamGroup[];
  onSave: (data: { firstName: string; lastName: string; email: string; roles: string[]; excludedRoles: string[] }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName,  setLastName]  = useState(user?.last_name  ?? "");
  const [email,     setEmail]     = useState(user?.email      ?? "");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    user?.roles?.length ? user.roles : (user?.role ? [user.role] : [])
  );
  const [excludedRoles, setExcludedRoles] = useState<string[]>(user?.excluded_roles ?? []);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const grantedViaGroups = user ? groupGrantedRoles(user.id, groups) : [];

  function toggleExclusion(role: string) {
    setExcludedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  }

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
      await onSave({ firstName, lastName, email, roles: selectedRoles, excludedRoles });
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

          {mode === "edit" && grantedViaGroups.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">
                {t("company_admin.custom_rules_title")}
                <span className="ml-1 text-gray-400 font-normal">{t("company_admin.custom_rules_hint")}</span>
              </label>
              <div className="space-y-2">
                {grantedViaGroups.map(({ role, via }) => {
                  const excluded = excludedRoles.includes(role);
                  const label = String(t(`company_admin.roles.${role}_label` as never, role));
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => toggleExclusion(role)}
                      className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                        excluded ? "border-red-300 bg-red-50" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <div className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2 transition-all ${
                        excluded ? "bg-red-600 border-red-600" : "border-gray-300"
                      }`}>
                        {excluded && <Ban className="w-3 h-3 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${ROLE_COLORS[role] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                          {label}
                        </span>
                        <p className="text-xs text-gray-500 mt-1">
                          {t("company_admin.custom_rules_via", { groups: via.join(", ") })}
                        </p>
                        {excluded && (
                          <p className="text-xs text-red-600 mt-0.5 font-medium">{t("company_admin.custom_rules_excluded")}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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

// ── Create / Edit Group modal ─────────────────────────────────────────────────

function GroupFormModal({
  group,
  users,
  onSave,
  onClose,
}: {
  group?: TeamGroup;
  users: TenantUser[];
  onSave: (data: { name: string; description: string; memberIds: string[]; roles: string[] }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(group?.roles ?? []);
  const [selectedMembers, setSelectedMembers] = useState<string[]>(group?.member_ids ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const roleOptions = ROLE_VALUES.map(value => ({
    value,
    label: String(t(`company_admin.roles.${value}_label` as never, value)),
    color: ROLE_COLORS[value] ?? "bg-gray-100 text-gray-600 border-gray-200",
  }));

  function toggleRole(value: string) {
    setSelectedRoles(prev => prev.includes(value) ? prev.filter(r => r !== value) : [...prev, value]);
  }
  function toggleMember(id: string) {
    setSelectedMembers(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t("company_admin.group_err_name")); return; }
    setSaving(true);
    setError("");
    try {
      await onSave({ name: name.trim(), description: description.trim(), memberIds: selectedMembers, roles: selectedRoles });
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
            <UsersRound className="w-4 h-4 text-blue-600" />
            {group ? t("company_admin.group_form_edit_title") : t("company_admin.group_form_create_title")}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">{t("company_admin.group_name")}</label>
            <input
              required value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("company_admin.group_name_placeholder")}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">{t("company_admin.group_description")}</label>
            <input
              value={description} onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("company_admin.group_description_placeholder")}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">
              {t("company_admin.group_grants_roles")}
              <span className="ml-1 text-gray-400 font-normal">{t("company_admin.assign_roles_hint")}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {roleOptions.map(opt => {
                const active = selectedRoles.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleRole(opt.value)}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-all ${
                      active ? opt.color : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">
              {t("company_admin.group_members")}
              <span className="ml-1 text-gray-400 font-normal">({selectedMembers.length})</span>
            </label>
            <div className="max-h-52 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
              {users.length === 0 ? (
                <p className="text-xs text-gray-400 px-2 py-3 text-center">{t("company_admin.no_members")}</p>
              ) : users.map(u => {
                const active = selectedMembers.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleMember(u.id)}
                    className={`w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-all ${
                      active ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border-2 ${
                      active ? "bg-blue-600 border-blue-600" : "border-gray-300"
                    }`}>
                      {active && <CheckCircle className="w-3 h-3 text-white" />}
                    </div>
                    <span className="text-sm text-gray-700 truncate">{u.first_name} {u.last_name}</span>
                    <span className="text-xs text-gray-400 truncate ml-auto">{u.email}</span>
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
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {group ? t("company_admin.save_changes") : t("company_admin.group_create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Groups panel ──────────────────────────────────────────────────────────────

function GroupsPanel({
  groups,
  users,
  loading,
  onCreate,
  onEdit,
  onDelete,
}: {
  groups: TeamGroup[];
  users: TenantUser[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (g: TeamGroup) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const usersById = new Map(users.map(u => [u.id, u]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{t("company_admin.groups_subtitle")}</p>
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
        >
          <FolderPlus className="w-4 h-4" /> {t("company_admin.group_create")}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> {t("company_admin.loading")}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-gray-100">
          <UsersRound className="w-10 h-10 text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-500">{t("company_admin.no_groups")}</p>
          <button type="button" onClick={onCreate} className="mt-3 text-sm text-blue-600 hover:underline font-medium">
            {t("company_admin.group_create_first")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map(g => (
            <div key={g.id} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{g.name}</p>
                  {g.description && <p className="text-xs text-gray-400 mt-0.5">{g.description}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button type="button" onClick={() => onEdit(g)} title={t("company_admin.edit_roles_title")}
                    className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => onDelete(g.id)} title={t("company_admin.delete_confirm")}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {g.roles.length === 0 ? (
                  <span className="text-xs text-gray-400">{t("company_admin.group_no_roles")}</span>
                ) : g.roles.map(r => <RoleBadge key={r} role={r} />)}
              </div>

              <div className="flex items-center gap-1.5 pt-2 border-t border-gray-50">
                <Users className="w-3.5 h-3.5 text-gray-300" />
                <span className="text-xs text-gray-500">
                  {g.member_ids.length} {g.member_ids.length !== 1 ? t("company_admin.member_count_other") : t("company_admin.member_count_one")}
                </span>
                {g.member_ids.length > 0 && (
                  <span className="text-xs text-gray-400 truncate ml-1">
                    — {g.member_ids.slice(0, 3).map(id => usersById.get(id)?.first_name ?? "?").join(", ")}
                    {g.member_ids.length > 3 ? "…" : ""}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Activity Log helpers ───────────────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { bg: string; text: string; dot: string; icon: React.ComponentType<{ className?: string }> }> = {
  create: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", icon: Plus    },
  update: { bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-500",    icon: Pencil  },
  delete: { bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500",     icon: Trash2  },
  login:  { bg: "bg-purple-50",  text: "text-purple-700",  dot: "bg-purple-500",  icon: LogIn   },
  export: { bg: "bg-gray-50",    text: "text-gray-600",    dot: "bg-gray-400",    icon: Download },
  import: { bg: "bg-teal-50",    text: "text-teal-700",    dot: "bg-teal-500",    icon: Upload  },
  // Access + validation verbs, recorded since the trail started logging reads
  // and normalising approvals (objectif 8).
  view:       { bg: "bg-sky-50",     text: "text-sky-700",     dot: "bg-sky-500",     icon: Eye         },
  download:   { bg: "bg-cyan-50",    text: "text-cyan-700",    dot: "bg-cyan-500",    icon: Download    },
  approve:    { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", icon: ShieldCheck },
  validate:   { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", icon: ShieldCheck },
  close:      { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", icon: CheckCircle },
  distribute: { bg: "bg-indigo-50",  text: "text-indigo-700",  dot: "bg-indigo-500",  icon: Send        },
  reject:     { bg: "bg-rose-50",    text: "text-rose-700",    dot: "bg-rose-500",    icon: Ban         },
};

const MODULE_CONFIG: Record<string, { label_key: string; icon: string }> = {
  risk:          { label_key: "risks.title",            icon: "⚠️" },
  vendor:        { label_key: "vendors.title",          icon: "🏢" },
  audit:         { label_key: "audits.title",           icon: "📋" },
  policy:        { label_key: "policies.title",         icon: "📄" },
  compliance:    { label_key: "compliance.title",       icon: "✅" },
  asset:         { label_key: "assets.title",           icon: "💻" },
  incident:      { label_key: "incidents.title",        icon: "🚨" },
  auth:          { label_key: "settings.title",         icon: "🔐" },
  framework:     { label_key: "frameworks.title",       icon: "📚" },
  vulnerability: { label_key: "vulnerabilities.title",  icon: "🔓" },
  threat:        { label_key: "threats.title",          icon: "🛡️" },
  user:          { label_key: "company_admin.title",    icon: "👤" },
  security:      { label_key: "security_exceptions.title", icon: "🔒" },
  regulatory:    { label_key: "regulatory.title",       icon: "📰" },
  webhook:       { label_key: "webhooks.title",         icon: "🔗" },
};

// Fallbacks only: the real lists come from GET /activity-log/actions, which
// reports the verbs and entity types this tenant's trail actually holds.
const ENTITY_FILTER_LIST = ["risk","vendor","audit","policy","compliance","asset","incident","vulnerability","threat","report"];
const ACTION_FILTER_LIST  = ["create","update","delete","login","export","import","view","download","approve","close","distribute"];
const CATEGORY_FILTER_LIST = ["access","validation","change","other"];

function fmtTimeAgo(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string, lang: string): string {
  const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60)   return t("activity_log.time_just_now");
  const m = Math.floor(s / 60);
  if (m < 60)   return t("company_admin.ago_minutes_short", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24)   return t("company_admin.ago_hours_short", { count: h });
  const d = Math.floor(h / 24);
  if (d < 30)   return t("company_admin.ago_days_short", { count: d });
  return new Date(dateStr).toLocaleDateString(lang === "ar" ? "ar-u-nu-latn" : lang === "fr" ? "fr-FR" : "en-US");
}

function avatarColor(email: string): string {
  const colors = [
    "bg-blue-500","bg-indigo-500","bg-purple-500","bg-pink-500",
    "bg-teal-500","bg-emerald-500","bg-amber-500","bg-orange-500",
  ];
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % colors.length;
  return colors[h];
}

function ActivityLogPanel({ users, initialUserId }: { users: TenantUser[]; initialUserId?: string }) {
  const { t, i18n } = useTranslation();
  const tStr = (key: string, opts?: Record<string, unknown>): string => { return String(t(key, opts as never)); };
  const [items, setItems]             = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]         = useState(true);
  const [offset, setOffset]           = useState(0);
  const [userFilter, setUserFilter]   = useState(initialUserId ?? "");
  const [entityFilter, setEntityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [catalogue, setCatalogue] = useState<ActivityActionCatalogue | null>(null);
  const LIMIT = 25;

  // The verb vocabulary is published by the backend, so a verb it starts
  // recording (view, download, approve, close, distribute…) is filterable here
  // without a frontend change.
  useEffect(() => {
    let cancelled = false;
    activityLogApi.actions()
      .then(data => { if (!cancelled) setCatalogue(data); })
      .catch(() => { if (!cancelled) setCatalogue(null); });
    return () => { cancelled = true; };
  }, []);

  const actionOptions = catalogue?.actions_present?.length ? catalogue.actions_present : ACTION_FILTER_LIST;
  const entityOptions = catalogue?.entity_types_present?.length ? catalogue.entity_types_present : ENTITY_FILTER_LIST;
  const categoryOptions = catalogue?.category_choices?.length ? catalogue.category_choices : CATEGORY_FILTER_LIST;

  async function load(reset = true) {
    const newOffset = reset ? 0 : offset;
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const params: {
        user_id?: string; entity_type?: string; action?: string; category?: string;
        date_from?: string; date_to?: string; limit: number; offset: number;
      } = { limit: LIMIT, offset: newOffset };
      if (userFilter)   params.user_id     = userFilter;
      if (entityFilter) params.entity_type = entityFilter;
      if (actionFilter) params.action      = actionFilter;
      if (categoryFilter) params.category  = categoryFilter;
      // A date picker yields a day; the range is widened so "to" includes it.
      if (dateFrom) params.date_from = `${dateFrom}T00:00:00`;
      if (dateTo)   params.date_to   = `${dateTo}T23:59:59`;
      const data = await activityLogApi.list(params);
      const entries = data?.items ?? [];
      setItems(prev => reset ? entries : [...prev, ...entries]);
      setHasMore(entries.length === LIMIT);
      setOffset(newOffset + entries.length);
    } catch {
      if (reset) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => { load(true); }, [userFilter, entityFilter, actionFilter, categoryFilter, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = userFilter || entityFilter || actionFilter || categoryFilter || dateFrom || dateTo;

  return (
    <div className="space-y-4">

      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />

          {/* Member filter */}
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[200px]"
          >
            <option value="">{t("activity_log.all_members")}</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
            ))}
          </select>

          {/* Module filter */}
          <select
            value={entityFilter}
            onChange={e => setEntityFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("activity_log.all_modules")}</option>
            {entityOptions.map(et => (
              <option key={et} value={et}>
                {MODULE_CONFIG[et]?.icon} {t(`activity_log.entities.${et}`, { defaultValue: et })}
              </option>
            ))}
          </select>

          {/* Action filter */}
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("activity_log.all_actions")}</option>
            {actionOptions.map(a => (
              <option key={a} value={a}>
                {t(`activity_log.actions.${a}`, { defaultValue: a })}
              </option>
            ))}
          </select>

          {/* Verb family — access / validation / change, the three questions
              objectif 8 asks the trail to answer. */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label={t("activity_log.category")}
          >
            <option value="">{t("activity_log.all_categories")}</option>
            {categoryOptions.map(c => (
              <option key={c} value={c}>
                {t(`activity_log.categories.${c}`, { defaultValue: c })}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500" htmlFor="company-log-from">
              {t("company_admin.log_date_from")}
            </label>
            <input
              id="company-log-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-xl text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500" htmlFor="company-log-to">
              {t("company_admin.log_date_to")}
            </label>
            <input
              id="company-log-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="border border-gray-200 rounded-xl text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {hasFilters && (
            <button
              onClick={() => {
                setUserFilter(""); setEntityFilter(""); setActionFilter("");
                setCategoryFilter(""); setDateFrom(""); setDateTo("");
              }}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors border border-gray-200 hover:border-red-200 rounded-lg px-3 py-2"
            >
              <X className="w-3 h-3" /> {t("activity_log.clear_filters")}
            </button>
          )}
        </div>
      </div>

      {/* Log cards */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            <p className="text-sm text-gray-400">{t("company_admin.loading_activity")}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
              <Activity className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500">{t("activity_log.no_activity")}</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-50">
              {items.map((entry: any, idx: number) => {
                const cfg   = ACTION_CONFIG[entry.action] ?? ACTION_CONFIG.update;
                const Icon  = cfg.icon;
                const email = entry.actor_email || entry.user_email || "";
                // The trail resolves the actor for display; a blank one is the
                // scheduler, not an anonymous user.
                const actor = entry.is_system
                  ? t("activity_log.actor_system")
                  : (entry.actor_name || email || t("activity_log.actor_unknown"));
                const initials = (email || actor).slice(0, 2).toUpperCase();
                const mod   = MODULE_CONFIG[entry.entity_type];

                const actionLabel  = t(`activity_log.actions.${entry.action}`,  { defaultValue: entry.action });
                const entityLabel  = t(`activity_log.entities.${entry.entity_type}`, { defaultValue: entry.entity_type });
                const timeLabel    = entry.created_at ? fmtTimeAgo(entry.created_at, tStr, i18n.language) : "–";

                return (
                  <div key={entry.id || idx} className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50/60 transition-colors">

                    {/* Avatar */}
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full ${avatarColor(email)} flex items-center justify-center`}>
                      <span className="text-white text-xs font-bold">{initials}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Top row: email + time */}
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-gray-800 truncate" title={email}>{actor}</p>
                        <span className="flex-shrink-0 flex items-center gap-1 text-xs text-gray-400">
                          <Clock className="w-3 h-3" />{timeLabel}
                        </span>
                      </div>

                      {/* Description row */}
                      <p className="text-sm text-gray-600">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold mr-1.5 ${cfg.bg} ${cfg.text}`}>
                          <Icon className="w-3 h-3" />
                          {actionLabel}
                        </span>
                        {entityLabel}
                        {entry.entity_name && (
                          <span className="font-semibold text-gray-800"> — {entry.entity_name}</span>
                        )}
                      </p>

                      {/* Module tag */}
                      {mod && (
                        <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                          <span>{mod.icon}</span>
                          <span>{t(mod.label_key as never, { defaultValue: entry.entity_type })}</span>
                        </p>
                      )}
                    </div>

                    {/* Action dot indicator */}
                    <div className={`flex-shrink-0 w-2 h-2 rounded-full mt-2 ${cfg.dot}`} />
                  </div>
                );
              })}
            </div>

            {hasMore && (
              <div className="px-5 py-4 border-t border-gray-50 text-center">
                <button
                  onClick={() => load(false)}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                  {t("activity_log.load_more")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CompanyAdminPage() {
  const user = useAuthStore(u => u);
  // Only tenant_admin can access this page. The guard lives in this wrapper so
  // the page's own hooks always run in the same order (they used to sit after
  // this early return — a rules-of-hooks violation).
  if (!user || user.role !== "tenant_admin") return <Navigate to="/dashboard" replace />;
  return <CompanyAdminPageContent />;
}

function CompanyAdminPageContent() {
  const { t } = useTranslation();
  // Non-null: the wrapper only renders this for a signed-in tenant_admin.
  const user = useAuthStore(u => u)!;

  const [activeTab, setActiveTab] = useState<"team" | "groups" | "logs">("team");
  const [logUserId, setLogUserId] = useState<string | undefined>(undefined);

  const [users,   setUsers]   = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [error,   setError]   = useState("");

  const [createModal, setCreateModal] = useState(false);
  const [editTarget,  setEditTarget]  = useState<TenantUser | null>(null);
  const [pwdModal,    setPwdModal]    = useState<{ name: string; email: string; password: string } | null>(null);
  const [deleteId,    setDeleteId]    = useState<string | null>(null);

  const [groups,        setGroups]        = useState<TeamGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupCreateModal, setGroupCreateModal] = useState(false);
  const [groupEditTarget,  setGroupEditTarget]  = useState<TeamGroup | null>(null);
  const [deleteGroupId,    setDeleteGroupId]    = useState<string | null>(null);

  // Package + contributor seats (silent on error; never blocks the page).
  const [planUsage, setPlanUsage] = useState<PlanUsage | null>(null);
  const loadUsers = useCallback(async () => {
    setLoading(true);
    subscriptionsApi.getUsage().then(setPlanUsage).catch(() => {});
    try {
      const data = await usersApi.list();
      // exclude self and super_admin from the list
      setUsers(data.filter((u: TenantUser) => u.id !== user.tenant_id && u.role !== "super_admin"));
    } catch {
      setError(t("company_admin.err_load"));
    } finally {
      setLoading(false);
    }
  }, [user.tenant_id, t]);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      setGroups(await groupsApi.list());
    } catch {
      setError(t("company_admin.group_err_load"));
    } finally {
      setGroupsLoading(false);
    }
  }, [t]);

  useEffect(() => { loadUsers(); loadGroups(); }, [loadUsers, loadGroups]);

  const filtered = users.filter(u =>
    `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total:    users.length,
    active:   users.filter(u => u.is_active).length,
    inactive: users.filter(u => !u.is_active).length,
  };

  async function handleCreate(data: { firstName: string; lastName: string; email: string; roles: string[]; excludedRoles: string[] }) {
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

  async function handleEditRoles(data: { firstName: string; lastName: string; email: string; roles: string[]; excludedRoles: string[] }) {
    if (!editTarget) return;
    await usersApi.update(editTarget.id, { roles: data.roles, excluded_roles: data.excludedRoles });
    setEditTarget(null);
    await loadUsers();
  }

  async function handleCreateGroup(data: { name: string; description: string; memberIds: string[]; roles: string[] }) {
    await groupsApi.create({ name: data.name, description: data.description || null, member_ids: data.memberIds, roles: data.roles });
    setGroupCreateModal(false);
    await loadGroups();
  }

  async function handleEditGroup(data: { name: string; description: string; memberIds: string[]; roles: string[] }) {
    if (!groupEditTarget) return;
    await groupsApi.update(groupEditTarget.id, { name: data.name, description: data.description || null, member_ids: data.memberIds, roles: data.roles });
    setGroupEditTarget(null);
    await loadGroups();
  }

  async function handleDeleteGroup() {
    if (!deleteGroupId) return;
    await groupsApi.delete(deleteGroupId);
    setDeleteGroupId(null);
    await loadGroups();
    await loadUsers(); // effective_roles may have changed for former members
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

  function viewUserLogs(userId: string) {
    setLogUserId(userId);
    setActiveTab("logs");
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
        {activeTab === "team" && (
          <button
            type="button"
            onClick={() => setCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
          >
            <UserPlus className="w-4 h-4" /> {t("company_admin.invite_member")}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab("team")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "team" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Users className="w-4 h-4" /> {t("company_admin.tab_team")}
        </button>
        <button
          onClick={() => setActiveTab("groups")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "groups" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <UsersRound className="w-4 h-4" /> {t("company_admin.tab_groups")}
        </button>
        <button
          onClick={() => { setLogUserId(undefined); setActiveTab("logs"); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "logs" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <ScrollText className="w-4 h-4" /> {t("company_admin.tab_logs")}
        </button>
      </div>

      {activeTab === "logs" && <ActivityLogPanel users={users} initialUserId={logUserId} />}

      {activeTab === "groups" && (
        <GroupsPanel
          groups={groups}
          users={users}
          loading={groupsLoading}
          onCreate={() => setGroupCreateModal(true)}
          onEdit={g => setGroupEditTarget(g)}
          onDelete={id => setDeleteGroupId(id)}
        />
      )}

      {activeTab === "team" && <>

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

      {planUsage && (
        <p className={`text-xs ${planUsage.over_limit.includes("contributors") ? "text-red-600 font-semibold"
          : planUsage.near_limit.includes("contributors") ? "text-amber-600 font-semibold" : "text-gray-500"}`}>
          {planDisplayName(planUsage.plan_tier || planUsage.tier, t)} · {String(t("plan_limits.item_contributors", {
            used: planUsage.usage.contributors,
            max: planUsage.limits.max_contributors < 0 ? "∞" : planUsage.limits.max_contributors,
          }))}
        </p>
      )}

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
              const personalRoles = u.roles?.length ? u.roles : [u.role];
              const displayRoles = u.effective_roles?.length ? u.effective_roles : personalRoles;
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

                  {/* Role badges — a small dot flags a role granted via group membership */}
                  <div className="flex flex-wrap gap-1.5 max-w-xs">
                    {displayRoles.map(r => (
                      <span key={r} className="relative inline-flex">
                        <RoleBadge role={r} />
                        {!personalRoles.includes(r) && (
                          <span
                            title={t("company_admin.role_via_group")}
                            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-indigo-400 border border-white"
                          />
                        )}
                      </span>
                    ))}
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
                      onClick={() => viewUserLogs(u.id)}
                      title={t("company_admin.view_logs_title")}
                      className="p-2 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                    >
                      <ScrollText className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditTarget(u)}
                      title={t("company_admin.edit_roles_title")}
                      className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResetPassword(u)}
                      title={t("company_admin.reset_password_title")}
                      className="p-2 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(u)}
                      title={u.is_active ? t("company_admin.deactivate") : t("company_admin.activate")}
                      className="p-2 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                    >
                      {u.is_active
                        ? <ToggleRight className="w-4 h-4 text-green-500" />
                        : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(u.id)}
                      title={t("company_admin.delete_confirm")}
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

      </>}

      {/* Modals */}
      {createModal && (
        <UserFormModal mode="create" groups={groups} onSave={handleCreate} onClose={() => setCreateModal(false)} />
      )}
      {editTarget && (
        <UserFormModal mode="edit" user={editTarget} groups={groups} onSave={handleEditRoles} onClose={() => setEditTarget(null)} />
      )}
      {pwdModal && (
        <PasswordModal
          name={pwdModal.name} email={pwdModal.email} password={pwdModal.password}
          onClose={() => setPwdModal(null)}
        />
      )}
      {groupCreateModal && (
        <GroupFormModal users={users} onSave={handleCreateGroup} onClose={() => setGroupCreateModal(false)} />
      )}
      {groupEditTarget && (
        <GroupFormModal group={groupEditTarget} users={users} onSave={handleEditGroup} onClose={() => setGroupEditTarget(null)} />
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

      {/* Delete group confirm */}
      {deleteGroupId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t("company_admin.group_delete_title")}</h3>
            <p className="text-sm text-gray-500 mb-6">{t("company_admin.group_delete_desc")}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteGroupId(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50">
                {t("company_admin.cancel")}
              </button>
              <button type="button" onClick={handleDeleteGroup}
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
