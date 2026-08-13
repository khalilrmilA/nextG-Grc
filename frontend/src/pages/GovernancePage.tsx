import { useState, useEffect } from "react";
import { Plus, X, Loader2, Crown, Trash2, Users, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { governanceApi } from "@/api/endpoints";

const RACI_BADGE: Record<string, string> = {
  R: "bg-blue-100 text-blue-700 border-blue-200",
  A: "bg-red-100 text-red-700 border-red-200",
  C: "bg-amber-100 text-amber-700 border-amber-200",
  I: "bg-gray-100 text-gray-600 border-gray-200",
};
const RACI_LABEL: Record<string, string> = { R: "Responsible", A: "Accountable", C: "Consulted", I: "Informed" };
const ROLES = ["tenant_admin", "ciso", "risk_manager", "compliance_manager", "control_owner", "auditor", "policy_manager"];
const TYPOLOGIES = ["policy", "charter", "regulation", "minutes", "procedure", "plan"];
const ACCESS = ["read", "edit", "validate"];

export default function GovernancePage() {
  const { t } = useTranslation();
  const [raci, setRaci] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [raciForm, setRaciForm] = useState({ activity: "", raci: "R", role: "ciso", module: "" });
  const [addingRaci, setAddingRaci] = useState(false);
  const [showDoc, setShowDoc] = useState(false);
  const [docForm, setDocForm] = useState({ title: "", typology: "policy", module: "", access_level: "read", content: "" });
  const [savingDoc, setSavingDoc] = useState(false);
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const [r, d] = await Promise.all([governanceApi.raciList(), governanceApi.docsList()]);
      setRaci(Array.isArray(r) ? r : []);
      setDocs(Array.isArray(d) ? d : []);
    } catch { setRaci([]); setDocs([]); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function addRaci(e: React.FormEvent) {
    e.preventDefault();
    if (!raciForm.activity.trim()) return;
    setAddingRaci(true);
    try {
      await governanceApi.raciCreate({ activity: raciForm.activity, responsible_type: "role", role: raciForm.role, raci: raciForm.raci, module: raciForm.module || null });
      setRaciForm({ activity: "", raci: "R", role: "ciso", module: "" });
      load();
    } catch {} finally { setAddingRaci(false); }
  }
  async function delRaci(id: string) { setBusy(id); try { await governanceApi.raciDelete(id); load(); } catch {} finally { setBusy(""); } }

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
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          <h2 className="text-base font-semibold text-gray-900">{t("governance.raci", "RACI matrix")}</h2>
        </div>
        <form onSubmit={addRaci} className="flex flex-wrap items-end gap-2">
          <input value={raciForm.activity} onChange={(e) => setRaciForm({ ...raciForm, activity: e.target.value })} placeholder={t("governance.activity", "Activity / decision")} className="flex-1 min-w-[200px] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={raciForm.raci} onChange={(e) => setRaciForm({ ...raciForm, raci: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {["R", "A", "C", "I"].map((x) => <option key={x} value={x}>{x} — {RACI_LABEL[x]}</option>)}
          </select>
          <select value={raciForm.role} onChange={(e) => setRaciForm({ ...raciForm, role: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
          </select>
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
                    <td className="px-4 py-2.5 text-gray-600 capitalize">{(r.role || r.user_id || "—").replace(/_/g, " ")}</td>
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
                    <td className="px-4 py-2.5 text-right"><button onClick={() => delDoc(d.id)} disabled={busy === d.id} className="text-gray-400 hover:text-red-500 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

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
    </div>
  );
}
