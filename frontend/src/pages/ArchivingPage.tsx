import { useState, useEffect } from "react";
import { Plus, X, Loader2, Crown, Archive, Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { archivingApi } from "@/api/endpoints";

const ENTITY_TYPES = ["risk", "policy", "audit", "control", "assessment", "document", "vulnerability"];

export default function ArchivingPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ entity_type: "risk", reason: "", retention_days: 365 });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    try { const d = await archivingApi.list(); setItems(Array.isArray(d) ? d : []); }
    catch { setItems([]); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function addArchive(e: React.FormEvent) {
    e.preventDefault();
    if (!form.reason.trim()) return;
    setSaving(true);
    try {
      await archivingApi.create({ entity_type: form.entity_type, reason: form.reason, retention_days: Number(form.retention_days) || null, payload: { note: form.reason } });
      setShowAdd(false); setForm({ entity_type: "risk", reason: "", retention_days: 365 }); setLoading(true); load();
    } catch {} finally { setSaving(false); }
  }
  async function purge() {
    setBusy("purge"); setMsg("");
    try { const r = await archivingApi.purgeExpired(); setMsg(`Purged ${r.purged} expired record(s).`); setLoading(true); load(); }
    catch { setMsg("Purge failed"); } finally { setBusy(""); }
  }
  async function exportArchives(format: "xlsx" | "csv") {
    setBusy("export");
    try {
      const blob = await archivingApi.exportFile(format);
      const url = window.URL.createObjectURL(blob as Blob);
      const a = document.createElement("a"); a.href = url; a.download = `archives.${format}`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch {} finally { setBusy(""); }
  }

  const expired = items.filter((i) => i.retention_until && i.retention_until < new Date().toISOString()).length;

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("archiving.title", "Archiving & Retention")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
              <Crown className="w-3 h-3" /> {t("archiving.elite", "Elite Pack")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("archiving.subtitle", "Snapshot records with a retention window, consult without restoring, and export the archive")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => exportArchives("xlsx")} disabled={!!busy} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
            <Download className="w-4 h-4" /> {t("archiving.export", "Export")}
          </button>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> {t("archiving.new", "Archive record")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t("archiving.stat_total", "Archived records"), value: items.length, color: "text-blue-600 bg-blue-50" },
          { label: t("archiving.stat_expired", "Past retention"), value: expired, color: "text-red-600 bg-red-50" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}><Archive className="w-5 h-5" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{s.value}</p><p className="text-xs text-gray-500">{s.label}</p></div>
            </div>
          </div>
        ))}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center justify-between">
          <div><p className="text-sm font-semibold text-gray-900">{t("archiving.enforce", "Retention")}</p><p className="text-xs text-gray-500 mt-0.5">{msg || t("archiving.enforce_sub", "Delete records past their retention")}</p></div>
          <button onClick={purge} disabled={!!busy} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
            {busy === "purge" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t("archiving.purge", "Purge expired")}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t("archiving.empty", "No archived records yet.")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.entity", "Entity")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.reason", "Reason")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.archived", "Archived")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.retention_until", "Retention until")}</th>
              </tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-4"><span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-gray-100 text-gray-600 capitalize">{it.entity_type}</span></td>
                    <td className="px-6 py-4 text-gray-900">{it.reason || "—"}</td>
                    <td className="px-6 py-4 text-gray-500">{it.archived_at ? new Date(it.archived_at).toLocaleDateString() : "—"}</td>
                    <td className="px-6 py-4 text-gray-500">{it.retention_until ? new Date(it.retention_until).toLocaleDateString() : t("archiving.indefinite", "indefinite")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("archiving.new", "Archive record")}</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={addArchive} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("archiving.entity", "Entity type")}</label>
                  <select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {ENTITY_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("archiving.retention_days", "Retention (days)")}</label>
                  <input type="number" min={0} value={form.retention_days} onChange={(e) => setForm({ ...form, retention_days: parseInt(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("archiving.reason", "Reason")} *</label>
                <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save", "Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
