import { useState, useEffect } from "react";
import { Plus, X, Loader2, Crown, Gauge, AlertTriangle, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { controlEvalApi } from "@/api/endpoints";

// The sources the requirement names: internal audits, technical tests,
// performance indicators. Recorded so a score from a documented test is
// distinguishable from one given from memory.
const EVAL_METHODS = ["internal_audit", "technical_test", "performance_indicator", "document_review", "interview"];

const PERF_BADGE: Record<string, string> = {
  performant: "bg-green-100 text-green-700 border-green-200",
  moyennement_performant: "bg-yellow-100 text-yellow-700 border-yellow-200",
  non_performant: "bg-red-100 text-red-700 border-red-200",
};

// The second element is the t() FALLBACK, not the rendered label — the five
// criteria headers, the three score choices and the performance badge were the
// last raw English left on this page. Keys go under ctrleval.* like the rest.
const CRITERIA: [string, string][] = [
  ["formalisme", "Formalism"],
  ["type_controle", "Control type"],
  ["timing", "Timing"],
  ["tracabilite", "Traceability"],
  ["quatre_yeux", "Four-eyes principle"],
];

const SCORE_LABELS = ["absent", "partial", "full"];

type ControlLite = { id: string; name: string; ref_id?: string };

export default function ControlEffectivenessPage() {
  const { t } = useTranslation();
  const [evals, setEvals] = useState<any[]>([]);
  const [due, setDue] = useState<any[]>([]);
  const [actionRequired, setActionRequired] = useState<any[]>([]);
  const [controls, setControls] = useState<ControlLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const emptyForm = {
    applied_control_id: "",
    formalisme: 1, type_controle: 1, timing: 1, tracabilite: 1, quatre_yeux: 1,
    next_evaluation_at: "",
    method: "",
    evidence_ref: "",
    notes: "",
  };
  const [form, setForm] = useState({ ...emptyForm });

  async function load() {
    try {
      const [list, dueList, todoList] = await Promise.all([
        controlEvalApi.list(), controlEvalApi.due(), controlEvalApi.actionRequired(),
      ]);
      setActionRequired(Array.isArray(todoList) ? todoList : []);
      setEvals(Array.isArray(list) ? list : []);
      setDue(Array.isArray(dueList) ? dueList : []);
    } catch {
      setEvals([]); setDue([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    controlEvalApi.controls()
      .then((d: any) => setControls((d.items || d || []).map((c: any) => ({ id: c.id, name: c.name, ref_id: c.ref_id }))))
      .catch(() => setControls([]));
  }, []);

  const controlName = (id: string) => {
    const c = controls.find((x) => x.id === id);
    return c ? (c.ref_id ? `${c.ref_id} · ${c.name}` : c.name) : id.slice(0, 8);
  };
  const total = CRITERIA.reduce((sum, [k]) => sum + (Number((form as any)[k]) || 0), 0);
  const previewLevel = total >= 8 ? "performant" : total >= 5 ? "moyennement_performant" : "non_performant";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.applied_control_id) { setError(t("ctrleval.error_control", "Select a control to evaluate")); return; }
    setSubmitting(true); setError("");
    try {
      await controlEvalApi.create({
        applied_control_id: form.applied_control_id,
        formalisme: form.formalisme, type_controle: form.type_controle,
        timing: form.timing, tracabilite: form.tracabilite, quatre_yeux: form.quatre_yeux,
        next_evaluation_at: form.next_evaluation_at || null,
        notes: form.notes || null,
        method: form.method || null,
        evidence_ref: form.evidence_ref || null,
      });
      setShowModal(false); setForm({ ...emptyForm }); setLoading(true); load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("ctrleval.error_save", "Could not save evaluation"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("ctrleval.title", "Control Effectiveness")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
              <Crown className="w-3 h-3" /> {t("ctrleval.elite", "Elite Pack")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("ctrleval.subtitle", "Evaluate controls on the 5 effectiveness criteria → performance level, with a re-assessment due list")}</p>
        </div>
        <button onClick={() => { setError(""); setForm({ ...emptyForm }); setShowModal(true); }} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> {t("ctrleval.new", "New evaluation")}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t("ctrleval.stat_total", "Evaluations"), value: evals.length, icon: Gauge, color: "text-blue-600 bg-blue-50" },
          { label: t("ctrleval.stat_due", "Due for re-assessment"), value: due.length, icon: AlertTriangle, color: "text-amber-600 bg-amber-50" },
          { label: t("ctrleval.stat_action", "Follow-up open"), value: actionRequired.length, icon: Wrench, color: "text-red-600 bg-red-50" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{s.value}</p><p className="text-xs text-gray-500">{s.label}</p></div>
            </div>
          </div>
        ))}
      </div>

      {actionRequired.length > 0 && (
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-red-100 bg-red-50/60">
            <Wrench className="w-4 h-4 text-red-600" />
            <span className="text-sm font-semibold text-gray-800">
              {t("ctrleval.action_title", "Controls declared ineffective — follow-up open")}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {actionRequired.map((ev: any) => (
              <div key={ev.id} className="px-6 py-3 flex items-start gap-3">
                <span className="mt-0.5 shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold border bg-red-100 text-red-700 border-red-200">
                  {String(t(`ctrleval.remediation_${ev.remediation_status}` as never, ev.remediation_status))}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">
                    {controlName(ev.applied_control_id)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {ev.remediation_plan || t("ctrleval.action_no_plan", "No action plan recorded yet")}
                    {ev.remediation_due_date ? ` · ${t("ctrleval.action_due", "due")} ${ev.remediation_due_date}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : evals.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            {controls.length === 0
              ? t("ctrleval.no_controls", "No applied controls to evaluate yet — add controls first, then score their effectiveness here.")
              : t("ctrleval.empty", "No evaluations yet. Score a control on the 5 criteria to derive its performance level.")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("ctrleval.col_control", "Control")}</th>
                  {CRITERIA.map(([k, label]) => <th key={k} className="text-center px-3 py-3 font-medium text-gray-500">{String(t(`ctrleval.crit_${k}` as never, label))}</th>)}
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("ctrleval.col_perf", "Performance")}</th>
                </tr>
              </thead>
              <tbody>
                {evals.map((ev: any) => (
                  <tr key={ev.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">{controlName(ev.applied_control_id)}</td>
                    {CRITERIA.map(([k]) => <td key={k} className="text-center px-3 py-4 tabular-nums text-gray-700">{ev[k]}</td>)}
                    <td className="px-6 py-4"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${PERF_BADGE[ev.performance_level] || "bg-gray-100 text-gray-600"}`}>{ev.performance_level ? String(t(`ctrleval.level_${ev.performance_level}` as never, String(ev.performance_level).replace(/_/g, " "))) : "-"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("ctrleval.new", "New evaluation")}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("ctrleval.col_control", "Control")} *</label>
                <select value={form.applied_control_id} onChange={(e) => setForm({ ...form, applied_control_id: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">{t("ctrleval.select_control", "Select a control…")}</option>
                  {controls.map((c) => <option key={c.id} value={c.id}>{c.ref_id ? `${c.ref_id} · ${c.name}` : c.name}</option>)}
                </select>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">{t("ctrleval.criteria", "5 criteria (0–2)")}</p>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${PERF_BADGE[previewLevel]}`}>{String(t(`ctrleval.level_${previewLevel}` as never, previewLevel.replace(/_/g, " ")))} · {total}/10</span>
                </div>
                {CRITERIA.map(([key, label]) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 text-sm text-gray-600">{String(t(`ctrleval.crit_${key}` as never, label))}</span>
                    <select value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: parseInt(e.target.value) })} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {SCORE_LABELS.map((l, i) => <option key={i} value={i}>{i} — {String(t(`ctrleval.score_${l}` as never, l))}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("ctrleval.next", "Next evaluation")}</label>
                  <input type="date" value={form.next_evaluation_at} onChange={(e) => setForm({ ...form, next_evaluation_at: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("ctrleval.method_label", "What this evaluation is based on")}
                  </label>
                  <select
                    value={form.method}
                    onChange={(e) => setForm({ ...form, method: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t("ctrleval.method_none", "Not stated")}</option>
                    {EVAL_METHODS.map((mth) => (
                      <option key={mth} value={mth}>{String(t(`ctrleval.method_${mth}` as never, mth.replace(/_/g, " ")))}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("ctrleval.evidence_label", "Evidence reference")}
                  </label>
                  <input
                    value={form.evidence_ref}
                    onChange={(e) => setForm({ ...form, evidence_ref: e.target.value })}
                    placeholder={t("ctrleval.evidence_ph", "Audit report, test ticket or indicator")}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.notes", "Notes")}</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
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
