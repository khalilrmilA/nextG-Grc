import { useState, useEffect } from "react";
import { Plus, X, Loader2, Crown, Trash2, Users, FileText, Eye, UserPlus, Shield, Calendar, Pencil, Landmark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { governanceApi, usersApi, policiesApi } from "@/api/endpoints";
import { MultiSelect } from "@/components/common/MultiSelect";

const RACI_BADGE: Record<string, string> = {
  R: "bg-blue-100 text-blue-700 border-blue-200",
  A: "bg-red-100 text-red-700 border-red-200",
  C: "bg-amber-100 text-amber-700 border-amber-200",
  I: "bg-gray-100 text-gray-600 border-gray-200",
};
const RACI_LABEL: Record<string, string> = { R: "Responsible", A: "Accountable", C: "Consulted", I: "Informed" };
const BUILTIN_ROLES = ["tenant_admin", "ciso", "risk_manager", "compliance_manager", "control_owner", "auditor", "policy_manager"];
const TYPOLOGIES = ["policy", "charter", "regulation", "minutes", "procedure", "plan"];
const ACCESS = ["read", "edit", "validate"];
const DOC_PERMISSIONS = ["view", "edit", "validate"];
const CADENCES = ["monthly", "quarterly", "annual", "ad_hoc"];

export default function GovernancePage() {
  const { t } = useTranslation();
  const [raci, setRaci] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [committees, setCommittees] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [raciForm, setRaciForm] = useState({ activity: "", raci: "R", responsible_type: "role", role: "ciso", customRole: "", group_id: "", module: "" });
  const [useCustomRole, setUseCustomRole] = useState(false);
  const [addingRaci, setAddingRaci] = useState(false);
  const [showDoc, setShowDoc] = useState(false);
  const [docForm, setDocForm] = useState({ title: "", typology: "policy", module: "", access_level: "read", content: "" });
  const [savingDoc, setSavingDoc] = useState(false);
  const [busy, setBusy] = useState("");

  // Custom-role preview: what a role (built-in or custom) is currently responsible for
  const [previewRole, setPreviewRole] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Add-group modal
  const [showGroup, setShowGroup] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", description: "", member_ids: [] as string[] });
  const [savingGroup, setSavingGroup] = useState(false);

  // Manage-access modal (M11.3 — per-document ACL)
  const [accessDoc, setAccessDoc] = useState<any | null>(null);
  const [accessGrants, setAccessGrants] = useState<any[]>([]);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accessTarget, setAccessTarget] = useState<"user" | "role">("user");
  const [accessForm, setAccessForm] = useState({ user_id: "", role: "ciso", permission: "view" });
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessBusy, setAccessBusy] = useState("");

  // Steering committees (M14.6)
  const [showCommittee, setShowCommittee] = useState(false);
  const emptyCommittee = { id: "", name: "", description: "", cadence: "quarterly", member_ids: [] as string[], linked_policy_ids: [] as string[], linked_document_ids: [] as string[], next_meeting_date: "" };
  const [committeeForm, setCommitteeForm] = useState(emptyCommittee);
  const [savingCommittee, setSavingCommittee] = useState(false);

  const knownRoles = Array.from(new Set([...BUILTIN_ROLES, ...raci.filter((r) => r.responsible_type === "role" && r.role).map((r) => r.role)]));

  async function load() {
    try {
      const [r, d, g, u, c, p] = await Promise.all([
        governanceApi.raciList(), governanceApi.docsList(), governanceApi.groupsList(), usersApi.list(),
        governanceApi.committeesList(), policiesApi.list().catch(() => []),
      ]);
      setRaci(Array.isArray(r) ? r : []);
      setDocs(Array.isArray(d) ? d : []);
      setGroups(Array.isArray(g) ? g : []);
      setUsers(Array.isArray(u) ? u : []);
      setCommittees(Array.isArray(c) ? c : []);
      setPolicies(Array.isArray(p) ? p : []);
    } catch { setRaci([]); setDocs([]); setGroups([]); setUsers([]); setCommittees([]); setPolicies([]); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function addRaci(e: React.FormEvent) {
    e.preventDefault();
    if (!raciForm.activity.trim()) return;
    const responsible_type = raciForm.responsible_type;
    const role = responsible_type === "role" ? (useCustomRole ? raciForm.customRole.trim() : raciForm.role) : null;
    if (responsible_type === "role" && !role) return;
    if (responsible_type === "group" && !raciForm.group_id) return;
    setAddingRaci(true);
    try {
      await governanceApi.raciCreate({
        activity: raciForm.activity, raci: raciForm.raci, responsible_type,
        role, group_id: responsible_type === "group" ? raciForm.group_id : null,
        module: raciForm.module || null,
      });
      setRaciForm({ activity: "", raci: "R", responsible_type: "role", role: "ciso", customRole: "", group_id: "", module: "" });
      setUseCustomRole(false);
      load();
    } catch {} finally { setAddingRaci(false); }
  }
  async function delRaci(id: string) { setBusy(id); try { await governanceApi.raciDelete(id); load(); } catch {} finally { setBusy(""); } }

  async function openPreview(role: string) {
    setPreviewRole(role);
    setPreviewLoading(true);
    try { setPreviewRows(await governanceApi.raciPreviewRole(role)); } catch { setPreviewRows([]); } finally { setPreviewLoading(false); }
  }

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupForm.name.trim()) return;
    setSavingGroup(true);
    try {
      await governanceApi.groupCreate({ name: groupForm.name, description: groupForm.description || null, member_ids: groupForm.member_ids });
      setShowGroup(false);
      setGroupForm({ name: "", description: "", member_ids: [] });
      load();
    } catch {} finally { setSavingGroup(false); }
  }
  async function delGroup(id: string) { setBusy(id); try { await governanceApi.groupDelete(id); load(); } catch {} finally { setBusy(""); } }

  function responsibleLabel(r: any): string {
    if (r.responsible_type === "group") return groups.find((g) => g.id === r.group_id)?.name || t("governance.unknown_group", "Unknown group");
    if (r.user_id) return users.find((u) => u.id === r.user_id)?.email || r.user_id;
    return (r.role || "—").replace(/_/g, " ");
  }

  async function addDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!docForm.title.trim()) return;
    setSavingDoc(true);
    try {
      await governanceApi.docsCreate({ title: docForm.title, typology: docForm.typology, module: docForm.module || null, access_level: docForm.access_level, content: docForm.content || null });
      setShowDoc(false);
      setDocForm({ title: "", typology: "policy", module: "", access_level: "read", content: "" });
      load();
    } catch {} finally { setSavingDoc(false); }
  }
  async function delDoc(id: string) { setBusy(id); try { await governanceApi.docsDelete(id); load(); } catch {} finally { setBusy(""); } }

  async function openAccess(doc: any) {
    setAccessDoc(doc);
    setAccessError("");
    setAccessForm({ user_id: "", role: "ciso", permission: "view" });
    setLoadingAccess(true);
    try {
      setAccessGrants(await governanceApi.accessList(doc.id));
    } catch {
      setAccessGrants([]);
      setAccessError(t("governance.access_denied", "You don't have permission to manage access on this document."));
    } finally {
      setLoadingAccess(false);
    }
  }
  function closeAccess() { setAccessDoc(null); setAccessGrants([]); setAccessError(""); }

  async function addAccess(e: React.FormEvent) {
    e.preventDefault();
    if (!accessDoc) return;
    if (accessTarget === "user" && !accessForm.user_id) return;
    setSavingAccess(true);
    setAccessError("");
    try {
      await governanceApi.accessGrant(accessDoc.id, {
        user_id: accessTarget === "user" ? accessForm.user_id : null,
        role: accessTarget === "role" ? accessForm.role : null,
        permission: accessForm.permission,
      });
      setAccessGrants(await governanceApi.accessList(accessDoc.id));
      setAccessForm({ user_id: "", role: "ciso", permission: "view" });
    } catch {
      setAccessError(t("governance.access_save_error", "Could not grant access."));
    } finally {
      setSavingAccess(false);
    }
  }
  async function revokeAccess(id: string) {
    if (!accessDoc) return;
    setAccessBusy(id);
    try {
      await governanceApi.accessRevoke(accessDoc.id, id);
      setAccessGrants(await governanceApi.accessList(accessDoc.id));
    } catch {} finally { setAccessBusy(""); }
  }
  function accessSubjectLabel(g: any): string {
    if (g.user_id) return users.find((u) => u.id === g.user_id)?.email || g.user_id;
    return (g.role || "—").replace(/_/g, " ");
  }

  function openNewCommittee() { setCommitteeForm(emptyCommittee); setShowCommittee(true); }
  function openEditCommittee(c: any) {
    setCommitteeForm({
      id: c.id, name: c.name, description: c.description || "", cadence: c.cadence,
      member_ids: c.member_ids || [], linked_policy_ids: c.linked_policy_ids || [],
      linked_document_ids: c.linked_document_ids || [], next_meeting_date: c.next_meeting_date || "",
    });
    setShowCommittee(true);
  }
  async function saveCommittee(e: React.FormEvent) {
    e.preventDefault();
    if (!committeeForm.name.trim()) return;
    setSavingCommittee(true);
    const payload = {
      name: committeeForm.name, description: committeeForm.description || null, cadence: committeeForm.cadence,
      member_ids: committeeForm.member_ids, linked_policy_ids: committeeForm.linked_policy_ids,
      linked_document_ids: committeeForm.linked_document_ids, next_meeting_date: committeeForm.next_meeting_date || null,
    };
    try {
      if (committeeForm.id) await governanceApi.committeeUpdate(committeeForm.id, payload);
      else await governanceApi.committeeCreate(payload);
      setShowCommittee(false);
      setCommitteeForm(emptyCommittee);
      load();
    } catch {} finally { setSavingCommittee(false); }
  }
  async function delCommittee(id: string) { setBusy(id); try { await governanceApi.committeeDelete(id); load(); } catch {} finally { setBusy(""); } }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("governance.title", "Governance")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
              <Crown className="w-3 h-3" /> {t("governance.elite", "Elite Pack")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("governance.subtitle", "RACI responsibility matrix and the governance document repository")}</p>
        </div>
      </div>

      {/* RACI matrix */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">{t("governance.raci", "RACI matrix")}</h2>
          </div>
          <button type="button" onClick={() => setShowGroup(true)} className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <UserPlus className="w-4 h-4" /> {t("governance.add_group", "Add group")}
          </button>
        </div>
        <form onSubmit={addRaci} className="flex flex-wrap items-end gap-2">
          <input value={raciForm.activity} onChange={(e) => setRaciForm({ ...raciForm, activity: e.target.value })} placeholder={t("governance.activity", "Activity / decision")} className="flex-1 min-w-[200px] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={raciForm.raci} onChange={(e) => setRaciForm({ ...raciForm, raci: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {["R", "A", "C", "I"].map((x) => <option key={x} value={x}>{x} — {RACI_LABEL[x]}</option>)}
          </select>
          <select value={raciForm.responsible_type} onChange={(e) => setRaciForm({ ...raciForm, responsible_type: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="role">{t("governance.by_role", "By role")}</option>
            <option value="group">{t("governance.by_group", "By group")}</option>
          </select>
          {raciForm.responsible_type === "role" ? (
            useCustomRole ? (
              <div className="flex items-center gap-1">
                <input value={raciForm.customRole} onChange={(e) => setRaciForm({ ...raciForm, customRole: e.target.value })} placeholder={t("governance.custom_role", "Custom role name")} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button type="button" onClick={() => setUseCustomRole(false)} className="text-xs text-gray-400 hover:text-gray-600 px-1">{t("common.cancel", "Cancel")}</button>
              </div>
            ) : (
              <select
                value={raciForm.role}
                onChange={(e) => { if (e.target.value === "__custom__") setUseCustomRole(true); else setRaciForm({ ...raciForm, role: e.target.value }); }}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {knownRoles.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                <option value="__custom__">+ {t("governance.custom_role", "Custom role")}…</option>
              </select>
            )
          ) : (
            <select value={raciForm.group_id} onChange={(e) => setRaciForm({ ...raciForm, group_id: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t("governance.select_group", "Select group…")}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          <input value={raciForm.module} onChange={(e) => setRaciForm({ ...raciForm, module: e.target.value })} placeholder={t("governance.module", "Module")} className="w-32 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="submit" disabled={addingRaci} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {addingRaci ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t("governance.add", "Add")}
          </button>
        </form>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
          ) : raci.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">{t("governance.no_raci", "No RACI assignments yet.")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-2 font-medium text-gray-500">{t("governance.activity", "Activity")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">RACI</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">{t("governance.responsible", "Responsible")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">{t("governance.module", "Module")}</th>
                <th className="px-4 py-2"></th>
              </tr></thead>
              <tbody>
                {raci.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-900">{r.activity}</td>
                    <td className="px-4 py-2.5"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${RACI_BADGE[r.raci] || "bg-gray-100"}`}>{r.raci}</span></td>
                    <td className="px-4 py-2.5 text-gray-600 capitalize">
                      <span className="inline-flex items-center gap-1.5">
                        {responsibleLabel(r)}
                        {r.responsible_type === "role" && r.role && (
                          <button type="button" onClick={() => openPreview(r.role)} title={t("governance.preview_role", "Preview role")} className="text-gray-300 hover:text-blue-600">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{r.module || "—"}</td>
                    <td className="px-4 py-2.5 text-right"><button onClick={() => delRaci(r.id)} disabled={busy === r.id} className="text-gray-400 hover:text-red-500 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Document repository */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-violet-600" />
            <h2 className="text-base font-semibold text-gray-900">{t("governance.documents", "Document repository")}</h2>
          </div>
          <button onClick={() => setShowDoc(true)} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> {t("governance.new_doc", "New document")}
          </button>
        </div>
        <div className="overflow-x-auto">
          {loading ? null : docs.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">{t("governance.no_docs", "No documents yet.")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-2 font-medium text-gray-500">{t("governance.doc_title", "Title")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">{t("governance.typology", "Typology")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">{t("governance.access", "Access")}</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">{t("governance.version", "Version")}</th>
                <th className="px-4 py-2"></th>
              </tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{d.title}</td>
                    <td className="px-4 py-2.5 text-gray-600 capitalize">{d.typology}</td>
                    <td className="px-4 py-2.5"><span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-gray-100 text-gray-600 capitalize">{d.access_level}</span></td>
                    <td className="px-4 py-2.5 text-gray-500 tabular-nums">v{d.current_version}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-2">
                        <button onClick={() => openAccess(d)} title={t("governance.manage_access", "Manage access")} className="text-gray-400 hover:text-blue-600"><Shield className="w-4 h-4" /></button>
                        <button onClick={() => delDoc(d.id)} disabled={busy === d.id} className="text-gray-400 hover:text-red-500 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Steering committees (M14.6 — distinct from RACI) */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-gray-900">{t("governance.committees", "Steering committees")}</h2>
          </div>
          <button onClick={openNewCommittee} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> {t("governance.new_committee", "New committee")}
          </button>
        </div>
        {loading ? null : committees.length === 0 ? (
          <p className="text-sm text-gray-400 py-3">{t("governance.no_committees", "No steering committees yet.")}</p>
        ) : (
          <div className="space-y-3">
            {committees.map((c) => {
              const linkedPolicies = (c.linked_policy_ids || []).map((id: string) => policies.find((p) => p.id === id)?.title).filter(Boolean);
              const linkedDocs = (c.linked_document_ids || []).map((id: string) => docs.find((d) => d.id === id)?.title).filter(Boolean);
              return (
                <div key={c.id} className="border border-gray-100 rounded-xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{c.name}</span>
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200 capitalize">{(c.cadence || "").replace(/_/g, " ")}</span>
                      </div>
                      {c.description && <p className="text-sm text-gray-500 mt-0.5">{c.description}</p>}
                    </div>
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                      <button onClick={() => openEditCommittee(c)} title={t("common.edit", "Edit")} className="text-gray-400 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => delCommittee(c.id)} disabled={busy === c.id} className="text-gray-400 hover:text-red-500 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {(c.member_ids || []).length} {t("governance.members", "members")}</span>
                    {c.next_meeting_date && (
                      <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {t("governance.next_meeting", "Next meeting")}: {c.next_meeting_date}</span>
                    )}
                  </div>
                  {(linkedPolicies.length > 0 || linkedDocs.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {linkedPolicies.map((title: string, i: number) => (
                        <span key={`p-${i}`} className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">{title}</span>
                      ))}
                      {linkedDocs.map((title: string, i: number) => (
                        <span key={`d-${i}`} className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs text-violet-700">{title}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Groups list (shown once at least one group exists, for management) */}
      {groups.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-semibold text-gray-900">{t("governance.groups", "Groups")}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700">
                {g.name} <span className="text-gray-400 text-xs">({(g.member_ids || []).length})</span>
                <button onClick={() => delGroup(g.id)} disabled={busy === g.id} className="text-gray-400 hover:text-red-500 disabled:opacity-50"><X className="w-3.5 h-3.5" /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Role preview modal */}
      {previewRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPreviewRole(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 capitalize">{t("governance.preview_of", "Responsibilities of")} {previewRole.replace(/_/g, " ")}</h2>
              <button onClick={() => setPreviewRole(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {previewLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
            ) : previewRows.length === 0 ? (
              <p className="text-sm text-gray-400 py-3">{t("governance.no_assignments", "No assignments for this role yet.")}</p>
            ) : (
              <ul className="space-y-2 max-h-80 overflow-y-auto">
                {previewRows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between border border-gray-100 rounded-xl px-3 py-2 text-sm">
                    <span className="text-gray-800">{r.activity}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${RACI_BADGE[r.raci] || "bg-gray-100"}`}>{r.raci}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Add group modal */}
      {showGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowGroup(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("governance.add_group", "Add group")}</h2>
              <button onClick={() => setShowGroup(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={addGroup} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.group_name", "Group name")} *</label>
                <input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description", "Description")}</label>
                <input value={groupForm.description} onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.members", "Members")}</label>
                <MultiSelect
                  options={users.map((u) => ({ id: u.id, label: `${u.first_name} ${u.last_name} (${u.email})` }))}
                  selected={groupForm.member_ids}
                  onChange={(ids) => setGroupForm({ ...groupForm, member_ids: ids })}
                  placeholder={t("governance.select_members", "Select members…")}
                  emptyLabel={t("governance.no_users", "No users found")}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowGroup(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                <button type="submit" disabled={savingGroup} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {savingGroup && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save", "Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDoc(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("governance.new_doc", "New document")}</h2>
              <button onClick={() => setShowDoc(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={addDoc} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.doc_title", "Title")} *</label>
                <input value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.typology", "Typology")}</label>
                  <select value={docForm.typology} onChange={(e) => setDocForm({ ...docForm, typology: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {TYPOLOGIES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.module", "Module")}</label>
                  <input value={docForm.module} onChange={(e) => setDocForm({ ...docForm, module: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.access", "Access")}</label>
                  <select value={docForm.access_level} onChange={(e) => setDocForm({ ...docForm, access_level: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {ACCESS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.content", "Content")}</label>
                <textarea value={docForm.content} onChange={(e) => setDocForm({ ...docForm, content: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowDoc(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                <button type="submit" disabled={savingDoc} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {savingDoc && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save", "Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage access modal (M11.3 — per-document ACL) */}
      {accessDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeAccess} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Shield className="w-5 h-5 text-blue-600" /> {t("governance.manage_access", "Manage access")}</h2>
              <button onClick={closeAccess} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{accessDoc.title}</p>

            {loadingAccess ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
            ) : accessError && accessGrants.length === 0 ? (
              <p className="text-sm text-red-500 py-3">{accessError}</p>
            ) : (
              <>
                <ul className="space-y-2 max-h-48 overflow-y-auto mb-4">
                  {accessGrants.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2">{t("governance.no_grants", "No explicit grants yet — falls back to the document's default access level.")}</p>
                  ) : accessGrants.map((g) => (
                    <li key={g.id} className="flex items-center justify-between border border-gray-100 rounded-xl px-3 py-2 text-sm">
                      <span className="flex items-center gap-2 text-gray-800 capitalize">
                        {g.user_id ? <Users className="w-3.5 h-3.5 text-gray-400" /> : <UserPlus className="w-3.5 h-3.5 text-gray-400" />}
                        {accessSubjectLabel(g)}
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border bg-gray-100 text-gray-600">{g.permission}</span>
                      </span>
                      <button onClick={() => revokeAccess(g.id)} disabled={accessBusy === g.id} className="text-gray-400 hover:text-red-500 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button>
                    </li>
                  ))}
                </ul>

                <form onSubmit={addAccess} className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4">
                  <select value={accessTarget} onChange={(e) => setAccessTarget(e.target.value as "user" | "role")} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="user">{t("governance.by_user", "User")}</option>
                    <option value="role">{t("governance.by_role", "By role")}</option>
                  </select>
                  {accessTarget === "user" ? (
                    <select value={accessForm.user_id} onChange={(e) => setAccessForm({ ...accessForm, user_id: e.target.value })} className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">{t("governance.select_user", "Select a user…")}</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.email})</option>)}
                    </select>
                  ) : (
                    <select value={accessForm.role} onChange={(e) => setAccessForm({ ...accessForm, role: e.target.value })} className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {knownRoles.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                    </select>
                  )}
                  <select value={accessForm.permission} onChange={(e) => setAccessForm({ ...accessForm, permission: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {DOC_PERMISSIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <button type="submit" disabled={savingAccess} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {savingAccess ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t("governance.grant", "Grant")}
                  </button>
                </form>
                {accessError && accessGrants.length > 0 && <p className="text-xs text-red-500 mt-2">{accessError}</p>}
              </>
            )}
          </div>
        </div>
      )}

      {/* Steering committee modal (M14.6) */}
      {showCommittee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCommittee(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{committeeForm.id ? t("governance.edit_committee", "Edit committee") : t("governance.new_committee", "New committee")}</h2>
              <button onClick={() => setShowCommittee(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={saveCommittee} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.committee_name", "Committee name")} *</label>
                <input value={committeeForm.name} onChange={(e) => setCommitteeForm({ ...committeeForm, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description", "Description")}</label>
                <input value={committeeForm.description} onChange={(e) => setCommitteeForm({ ...committeeForm, description: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.cadence", "Cadence")}</label>
                  <select value={committeeForm.cadence} onChange={(e) => setCommitteeForm({ ...committeeForm, cadence: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {CADENCES.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.next_meeting", "Next meeting")}</label>
                  <input type="date" value={committeeForm.next_meeting_date} onChange={(e) => setCommitteeForm({ ...committeeForm, next_meeting_date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.members", "Members")}</label>
                <MultiSelect
                  options={users.map((u) => ({ id: u.id, label: `${u.first_name} ${u.last_name} (${u.email})` }))}
                  selected={committeeForm.member_ids}
                  onChange={(ids) => setCommitteeForm({ ...committeeForm, member_ids: ids })}
                  placeholder={t("governance.select_members", "Select members…")}
                  emptyLabel={t("governance.no_users", "No users found")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.linked_policies", "Linked policies")}</label>
                <MultiSelect
                  options={policies.map((p) => ({ id: p.id, label: p.title }))}
                  selected={committeeForm.linked_policy_ids}
                  onChange={(ids) => setCommitteeForm({ ...committeeForm, linked_policy_ids: ids })}
                  placeholder={t("governance.select_policies", "Select policies…")}
                  emptyLabel={t("governance.no_policies", "No policies found")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("governance.linked_documents", "Linked documents")}</label>
                <MultiSelect
                  options={docs.map((d) => ({ id: d.id, label: d.title }))}
                  selected={committeeForm.linked_document_ids}
                  onChange={(ids) => setCommitteeForm({ ...committeeForm, linked_document_ids: ids })}
                  placeholder={t("governance.select_documents", "Select documents…")}
                  emptyLabel={t("governance.no_docs", "No documents yet.")}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCommittee(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                <button type="submit" disabled={savingCommittee} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {savingCommittee && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save", "Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
