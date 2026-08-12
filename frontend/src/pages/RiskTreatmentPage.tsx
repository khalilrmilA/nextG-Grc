import { useState, useEffect } from "react";
import { Plus, X, Loader2, Crown, ShieldCheck, AlertTriangle, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { riskTreatmentApi } from "@/api/endpoints";

const OPTIONS = ["mitigate", "accept", "transfer", "avoid"];

const OPTION_BADGE: Record<string, string> = {
  mitigate: "bg-blue-100 text-blue-700 border-blue-200",
  accept: "bg-gray-100 text-gray-600 border-gray-200",
  transfer: "bg-violet-100 text-violet-700 border-violet-200",
  avoid: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

type RiskLite = { id: string; title: string };

export default function RiskTreatmentPage() {
  const { t } = useTranslation();
  const [treatments, setTreatments] = useState<any[]>([]);
  const [tracking, setTracking] = useState<any[]>([]);
  const [risks, setRisks] = useState<RiskLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const emptyForm = {
    risk_id: "",
    treatment_option: "mitigate",
    description: "",
    due_date: "",
    progress_percentage: 0,
    estimated_cost: "",
    transfer_to: "",
    acceptance_justification: "",
  };
  const [form, setForm] = useState({ ...emptyForm });

  async function load() {
    try {
      const [tl, tr] = await Promise.all([riskTreatmentApi.list(), riskTreatmentApi.tracking()]);
      setTreatments(Array.isArray(tl) ? tl : []);
      setTracking(Array.isArray(tr) ? tr : []);
    } catch {
      setTreatments([]); setTracking([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    riskTreatmentApi.risks()
      .then((d: any) => setRisks((d.items || d || []).map((r: any) => ({ id: r.id, title: r.title }))))
      .catch(() => setRisks([]));
  }, []);

  const riskTitle = (id: string) => risks.find((r) => r.id === id)?.title || id.slice(0, 8);
  const overdueCount = tracking.filter((t) => t.overdue).length;
  const atRiskCount = tracking.filter((t) => t.at_risk).length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.risk_id) { setError(t("treatment.error_risk_required", "Select a risk")); return; }
    if (form.treatment_option === "accept" && !form.acceptance_justification.trim()) {
      setError(t("treatment.error_justification", "Acceptance requires a justification")); return;
    }
    setSubmitting(true); setError("");
    try {
      await riskTreatmentApi.upsert({
        risk_id: form.risk_id,
        treatment_option: form.treatment_option,
        description: form.description || null,
        due_date: form.due_date || null,
        progress_percentage: Number(form.progress_percentage) || 0,
        estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : null,
        transfer_to: form.transfer_to || null,
        acceptance_justification: form.acceptance_justification || null,
      });
      setShowModal(false);
      setForm({ ...emptyForm });
      setLoading(true);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("treatment.error_save", "Could not save treatment"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("treatment.title", "Risk Treatment")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
              <Crown className="w-3 h-3" /> {t("treatment.elite", "Elite Pack")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("treatment.subtitle", "Treatment decisions per risk — mitigate / accept / transfer / avoid — with schedule, cost and tracking")}</p>
        </div>
        <button onClick={() => { setError(""); setForm({ ...emptyForm }); setShowModal(true); }} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> {t("treatment.new", "New treatment")}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t("treatment.stat_total", "Treatment plans"), value: treatments.length, icon: ShieldCheck, color: "text-blue-600 bg-blue-50" },
          { label: t("treatment.stat_overdue", "Overdue"), value: overdueCount, icon: AlertTriangle, color: "text-red-600 bg-red-50" },
          { label: t("treatment.stat_at_risk", "Due today / at risk"), value: atRiskCount, icon: Clock, color: "text-amber-600 bg-amber-50" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{s.value}</p><p className="text-xs text-gray-500">{s.label}</p></div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : treatments.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t("treatment.empty", "No treatment plans yet. Add one to start tracking mitigation.")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("treatment.col_risk", "Risk")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("treatment.col_option", "Option")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("treatment.col_progress", "Progress")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("treatment.col_due", "Due")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("treatment.col_cost", "Est. cost")}</th>
                </tr>
              </thead>
              <tbody>
                {treatments.map((tr: any) => (
                  <tr key={tr.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">{riskTitle(tr.risk_id)}</td>
                    <td className="px-6 py-4"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${OPTION_BADGE[tr.treatment_option] || "bg-gray-100 text-gray-600"}`}>{tr.treatment_option}</span></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${tr.progress_percentage || 0}%` }} /></div>
                        <span className="text-xs text-gray-600 tabular-nums">{tr.progress_percentage || 0}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{tr.due_date || "—"}</td>
                    <td className="px-6 py-4 text-gray-600 tabular-nums">{tr.estimated_cost != null ? `$${tr.estimated_cost}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("treatment.new", "New treatment")}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.col_risk", "Risk")} *</label>
                <select value={form.risk_id} onChange={(e) => setForm({ ...form, risk_id: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">{t("treatment.select_risk", "Select a risk…")}</option>
                  {risks.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.col_option", "Option")}</label>
                  <select value={form.treatment_option} onChange={(e) => setForm({ ...form, treatment_option: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.col_due", "Due date")}</label>
                  <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description", "Description")}</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.progress", "Progress %")}</label>
                  <input type="number" min={0} max={100} value={form.progress_percentage} onChange={(e) => setForm({ ...form, progress_percentage: parseInt(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.cost", "Est. cost ($)")}</label>
                  <input type="number" min={0} value={form.estimated_cost} onChange={(e) => setForm({ ...form, estimated_cost: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              {form.treatment_option === "transfer" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.transfer_to", "Transfer to")}</label>
                  <input value={form.transfer_to} onChange={(e) => setForm({ ...form, transfer_to: e.target.value })} placeholder="e.g. Cyber insurance policy #…" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {form.treatment_option === "accept" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.justification", "Acceptance justification")} *</label>
                  <textarea value={form.acceptance_justification} onChange={(e) => setForm({ ...form, acceptance_justification: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save", "Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
