import { useState, useEffect, useMemo } from "react";
import { Plus, X, Loader2, Crown, ShieldCheck, AlertTriangle, Clock, ChevronDown, ChevronRight, Users, List, RefreshCw, History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { riskTreatmentApi, riskScenariosApi, risksApi, usersApi } from "@/api/endpoints";
import { MultiSelect } from "@/components/common/MultiSelect";
import appI18n from "@/i18n";

/** Intl locale for the current UI language (Arabic keeps Latin digits). */
function uiLocale(): string {
  const l = appI18n.language || "en";
  return l.startsWith("fr") ? "fr-FR" : l.startsWith("ar") ? "ar-u-nu-latn" : "en-US";
}


const OPTIONS = ["mitigate", "accept", "transfer", "avoid"];

const OPTION_BADGE: Record<string, string> = {
  mitigate: "bg-blue-100 text-blue-700 border-blue-200",
  accept: "bg-gray-100 text-gray-600 border-gray-200",
  transfer: "bg-violet-100 text-violet-700 border-violet-200",
  avoid: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

type RiskLite = { id: string; title: string };
type ScenarioLite = { id: string; name: string; linked_risk_id?: string | null; current_risk_level?: string | null };
type UserLite = { id: string; first_name: string; last_name: string; email: string };
type TrackingRow = {
  id: string; risk_id: string; treatment_option: string; owner_id: string | null;
  progress_percentage: number; due_date: string | null; estimated_cost: number | null;
  actual_cost: number | null; overdue: boolean; at_risk: boolean; over_budget: boolean;
};
type ResponsibleGroup = {
  owner_id: string | null; total: number; overdue: number; at_risk: number; over_budget: number;
  avg_progress: number; treatments: TrackingRow[];
};
type TreatmentVersion = {
  id: string; risk_id: string; treatment_id: string; version_number: number;
  snapshot: Record<string, any>; change_summary: string | null; created_by_id: string | null; created_at: string;
};

export default function RiskTreatmentPage() {
  const { t } = useTranslation();
  const [treatments, setTreatments] = useState<any[]>([]);
  const [tracking, setTracking] = useState<any[]>([]);
  const [byResponsible, setByResponsible] = useState<ResponsibleGroup[]>([]);
  const [risks, setRisks] = useState<RiskLite[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioLite[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "by_responsible">("all");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const emptyForm = {
    risk_id: "",
    treatment_option: "mitigate",
    description: "",
    due_date: "",
    progress_percentage: 0,
    estimated_cost: "",
    transfer_to: "",
    acceptance_justification: "",
    linked_scenario_ids: [] as string[],
  };
  const [form, setForm] = useState({ ...emptyForm });

  // M8.2 gap fix: supersede workflow (a meaningfully new plan, distinct from a
  // plain edit — requires a change_summary) + plan-level version history.
  const emptySupersedeForm = {
    treatment_option: "mitigate",
    description: "",
    due_date: "",
    progress_percentage: 0,
    estimated_cost: "",
    transfer_to: "",
    acceptance_justification: "",
    linked_scenario_ids: [] as string[],
    change_summary: "",
  };
  const [supersedeModal, setSupersedeModal] = useState(false);
  const [supersedeTarget, setSupersedeTarget] = useState<any>(null);
  const [supersedeForm, setSupersedeForm] = useState({ ...emptySupersedeForm });
  const [supersedeError, setSupersedeError] = useState("");
  const [supersedeSubmitting, setSupersedeSubmitting] = useState(false);

  const [historyModal, setHistoryModal] = useState(false);
  const [historyRisk, setHistoryRisk] = useState<{ id: string; title: string } | null>(null);
  const [historyVersions, setHistoryVersions] = useState<TreatmentVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function load() {
    try {
      const [tl, tr, br] = await Promise.all([
        riskTreatmentApi.list(),
        riskTreatmentApi.tracking(),
        riskTreatmentApi.trackingByResponsible(),
      ]);
      setTreatments(Array.isArray(tl) ? tl : []);
      setTracking(Array.isArray(tr) ? tr : []);
      setByResponsible(Array.isArray(br) ? br : []);
    } catch {
      setTreatments([]); setTracking([]); setByResponsible([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // riskTreatmentApi.risks() hard-codes page_size=200. Every treatment row's
    // risk title is resolved from THIS list, so past the 200th risk the register
    // showed an 8-character UUID prefix instead of a title. 500 is the backend's
    // ceiling (PaginationParams le=500); beyond that the truncation is reported
    // rather than hidden — see left_open.
    risksApi.list({ page_size: 500 })
      .then((d: any) => setRisks((d.items || d || []).map((r: any) => ({ id: r.id, title: r.title }))))
      .catch(() => setRisks([]));
    riskScenariosApi.list()
      .then((d: any) => setScenarios(Array.isArray(d) ? d : (d?.items || [])))
      .catch(() => setScenarios([]));
    usersApi.directory()
      .then((d: any) => setUsers(Array.isArray(d) ? d : []))
      .catch(() => setUsers([]));
  }, []);

  const riskTitle = (id: string) => risks.find((r) => r.id === id)?.title || id.slice(0, 8);
  const scenarioLabel = (s: ScenarioLite) => s.current_risk_level ? `${s.name} (${s.current_risk_level})` : s.name;
  const scenarioName = (id: string) => {
    const s = scenarios.find((sc) => sc.id === id);
    return s ? scenarioLabel(s) : id.slice(0, 8);
  };
  const ownerName = (id: string | null) => {
    if (!id) return t("treatment.unassigned", "Unassigned");
    const u = users.find((x) => x.id === id);
    if (!u) return id.slice(0, 8);
    const name = `${u.first_name || ""} ${u.last_name || ""}`.trim();
    return name || u.email;
  };
  const overdueCount = tracking.filter((t) => t.overdue).length;
  const atRiskCount = tracking.filter((t) => t.at_risk).length;

  // Task A: scenario options scoped to the risk currently selected in the form.
  const scenarioOptions = useMemo(() => {
    const pool = form.risk_id
      ? scenarios.filter((s) => s.linked_risk_id === form.risk_id)
      : scenarios;
    return pool.map((s) => ({ id: s.id, label: scenarioLabel(s) }));
  }, [scenarios, form.risk_id]);

  // Same scoping, for the supersede modal's fixed (non-selectable) risk.
  const supersedeScenarioOptions = useMemo(() => {
    const riskId = supersedeTarget?.risk_id;
    const pool = riskId ? scenarios.filter((s) => s.linked_risk_id === riskId) : scenarios;
    return pool.map((s) => ({ id: s.id, label: scenarioLabel(s) }));
  }, [scenarios, supersedeTarget]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.risk_id) { setError(t("treatment.error_risk_required", "Select a risk")); return; }
    if (!form.acceptance_justification.trim()) {
      setError(form.treatment_option === "accept"
        ? t("treatment.error_justification", "Acceptance requires a justification")
        : t("r2.treatment.error_justification", "A justification is required for every treatment decision")); return;
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
        linked_scenario_ids: form.linked_scenario_ids,
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

  function openSupersede(tr: any) {
    setSupersedeTarget(tr);
    setSupersedeForm({
      treatment_option: tr.treatment_option || "mitigate",
      description: tr.description || "",
      due_date: tr.due_date || "",
      progress_percentage: tr.progress_percentage || 0,
      estimated_cost: tr.estimated_cost != null ? String(tr.estimated_cost) : "",
      transfer_to: tr.transfer_to || "",
      acceptance_justification: tr.acceptance_justification || "",
      linked_scenario_ids: tr.linked_scenario_ids || [],
      change_summary: "",
    });
    setSupersedeError("");
    setSupersedeModal(true);
  }

  async function handleSupersedeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supersedeTarget) return;
    if (!supersedeForm.change_summary.trim()) {
      setSupersedeError(t("treatment.error_change_summary", "Describe what changed in this new plan"));
      return;
    }
    if (!supersedeForm.acceptance_justification.trim()) {
      setSupersedeError(supersedeForm.treatment_option === "accept"
        ? t("treatment.error_justification", "Acceptance requires a justification")
        : t("r2.treatment.error_justification", "A justification is required for every treatment decision"));
      return;
    }
    setSupersedeSubmitting(true); setSupersedeError("");
    try {
      await riskTreatmentApi.supersede(supersedeTarget.risk_id, {
        treatment_option: supersedeForm.treatment_option,
        description: supersedeForm.description || null,
        due_date: supersedeForm.due_date || null,
        progress_percentage: Number(supersedeForm.progress_percentage) || 0,
        estimated_cost: supersedeForm.estimated_cost ? Number(supersedeForm.estimated_cost) : null,
        transfer_to: supersedeForm.transfer_to || null,
        acceptance_justification: supersedeForm.acceptance_justification || null,
        linked_scenario_ids: supersedeForm.linked_scenario_ids,
        change_summary: supersedeForm.change_summary,
      });
      setSupersedeModal(false);
      setSupersedeTarget(null);
      setLoading(true);
      load();
    } catch (err: any) {
      setSupersedeError(err?.response?.data?.detail || t("treatment.error_save", "Could not save treatment"));
    } finally {
      setSupersedeSubmitting(false);
    }
  }

  async function openHistory(tr: any) {
    setHistoryRisk({ id: tr.risk_id, title: riskTitle(tr.risk_id) });
    setHistoryModal(true);
    setHistoryLoading(true);
    try {
      const v = await riskTreatmentApi.versions(tr.risk_id);
      setHistoryVersions(Array.isArray(v) ? v : []);
    } catch {
      setHistoryVersions([]);
    } finally {
      setHistoryLoading(false);
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

      {/* View toggle (Task B: All vs By responsible) */}
      <div className="inline-flex items-center gap-1 bg-gray-100 rounded-xl p-1">
        <button
          onClick={() => setViewMode("all")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${viewMode === "all" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          <List className="w-3.5 h-3.5" /> {t("treatment.view_all", "All")}
        </button>
        <button
          onClick={() => setViewMode("by_responsible")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${viewMode === "by_responsible" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          <Users className="w-3.5 h-3.5" /> {t("treatment.view_by_responsible", "By responsible")}
        </button>
      </div>

      {/* Table */}
      {viewMode === "all" ? (
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
                    <th className="text-left px-6 py-3 font-medium text-gray-500">{t("treatment.col_scenarios", "Linked scenarios")}</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">{t("treatment.col_actions", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {treatments.map((tr: any) => (
                    <tr key={tr.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{riskTitle(tr.risk_id)}</td>
                      <td className="px-6 py-4"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${OPTION_BADGE[tr.treatment_option] || "bg-gray-100 text-gray-600"}`}>{tr.treatment_option ? String(t(`vocab.${tr.treatment_option}` as never, String(tr.treatment_option).replace(/_/g, " "))) : "-"}</span></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${tr.progress_percentage || 0}%` }} /></div>
                          <span className="text-xs text-gray-600 tabular-nums">{tr.progress_percentage || 0}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{tr.due_date || "—"}</td>
                      <td className="px-6 py-4 text-gray-600 tabular-nums">{tr.estimated_cost != null ? `$${tr.estimated_cost}` : "—"}</td>
                      <td className="px-6 py-4">
                        {tr.linked_scenario_ids?.length ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {tr.linked_scenario_ids.map((sid: string) => (
                              <span key={sid} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-md font-medium">{scenarioName(sid)}</span>
                            ))}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openSupersede(tr)}
                            title={t("treatment.supersede", "Supersede / Update plan")}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> {t("treatment.supersede_short", "Supersede")}
                          </button>
                          <button
                            type="button"
                            onClick={() => openHistory(tr)}
                            title={t("treatment.history", "Version history")}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <History className="w-3.5 h-3.5" /> {t("treatment.history_short", "History")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {loading ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
          ) : byResponsible.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm text-center py-16 text-gray-400">{t("treatment.empty", "No treatment plans yet. Add one to start tracking mitigation.")}</div>
          ) : (
            byResponsible.map((group) => {
              const key = group.owner_id ?? "unassigned";
              const open = openGroups[key] ?? true;
              return (
                <div key={key} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenGroups((g) => ({ ...g, [key]: !open }))}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      <span className="font-semibold text-gray-900">{ownerName(group.owner_id)}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>{t("treatment.group_total", "Total")}: <b className="text-gray-800">{group.total}</b></span>
                      <span className="text-red-600">{t("treatment.stat_overdue", "Overdue")}: <b>{group.overdue}</b></span>
                      <span className="text-amber-600">{t("treatment.stat_at_risk", "Due today / at risk")}: <b>{group.at_risk}</b></span>
                      <span className="text-orange-600">{t("treatment.group_over_budget", "Over budget")}: <b>{group.over_budget}</b></span>
                      <span>{t("treatment.group_avg_progress", "Avg. progress")}: <b className="text-gray-800">{group.avg_progress}%</b></span>
                    </div>
                  </button>
                  {open && (
                    <div className="overflow-x-auto border-t border-gray-100">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50/50">
                            <th className="text-left px-6 py-2.5 font-medium text-gray-500">{t("treatment.col_risk", "Risk")}</th>
                            <th className="text-left px-6 py-2.5 font-medium text-gray-500">{t("treatment.col_option", "Option")}</th>
                            <th className="text-left px-6 py-2.5 font-medium text-gray-500">{t("treatment.col_progress", "Progress")}</th>
                            <th className="text-left px-6 py-2.5 font-medium text-gray-500">{t("treatment.col_due", "Due")}</th>
                            <th className="text-left px-6 py-2.5 font-medium text-gray-500">{t("treatment.col_cost", "Est. cost")}</th>
                            <th className="text-left px-6 py-2.5 font-medium text-gray-500">{t("treatment.col_flags", "Flags")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.treatments.map((tr) => (
                            <tr key={tr.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                              <td className="px-6 py-3 font-medium text-gray-900">{riskTitle(tr.risk_id)}</td>
                              <td className="px-6 py-3"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${OPTION_BADGE[tr.treatment_option] || "bg-gray-100 text-gray-600"}`}>{tr.treatment_option ? String(t(`vocab.${tr.treatment_option}` as never, String(tr.treatment_option).replace(/_/g, " "))) : "-"}</span></td>
                              <td className="px-6 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${tr.progress_percentage || 0}%` }} /></div>
                                  <span className="text-xs text-gray-600 tabular-nums">{tr.progress_percentage || 0}%</span>
                                </div>
                              </td>
                              <td className="px-6 py-3 text-gray-600">{tr.due_date || "—"}</td>
                              <td className="px-6 py-3 text-gray-600 tabular-nums">{tr.estimated_cost != null ? `$${tr.estimated_cost}` : "—"}</td>
                              <td className="px-6 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {tr.overdue && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium">{t("treatment.stat_overdue", "Overdue")}</span>}
                                  {tr.at_risk && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">{t("treatment.flag_at_risk", "At risk")}</span>}
                                  {tr.over_budget && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full font-medium">{t("treatment.flag_over_budget", "Over budget")}</span>}
                                  {!tr.overdue && !tr.at_risk && !tr.over_budget && <span className="text-gray-300">—</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

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
                <select value={form.risk_id} onChange={(e) => setForm({ ...form, risk_id: e.target.value, linked_scenario_ids: [] })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">{t("treatment.select_risk", "Select a risk…")}</option>
                  {risks.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.linked_scenarios", "Linked risk scenarios")}</label>
                <MultiSelect
                  options={scenarioOptions}
                  selected={form.linked_scenario_ids}
                  onChange={(ids) => setForm({ ...form, linked_scenario_ids: ids })}
                  placeholder={t("treatment.select_scenarios", "Select scenario(s)…")}
                  emptyLabel={t("treatment.no_scenarios", "No scenarios for this risk")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.col_option", "Option")}</label>
                  <select value={form.treatment_option} onChange={(e) => setForm({ ...form, treatment_option: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {OPTIONS.map((o) => <option key={o} value={o}>{String(t(`vocab.${o}` as never, o.charAt(0).toUpperCase() + o.slice(1)))}</option>)}
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
                  <input value={form.transfer_to} onChange={(e) => setForm({ ...form, transfer_to: e.target.value })} placeholder={t("treatment.transfer_to_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {/* The backend requires a justification for every option, not only accept. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {form.treatment_option === "accept" ? t("treatment.justification", "Acceptance justification") : t("r2.treatment.justification", "Justification")} *
                </label>
                <textarea value={form.acceptance_justification} onChange={(e) => setForm({ ...form, acceptance_justification: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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

      {/* Supersede Modal (M8.2 gap fix) — a meaningfully new plan for a risk that
          already has one, distinct from a plain edit: requires change_summary,
          and archives the prior plan into version history before overwriting it. */}
      {supersedeModal && supersedeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSupersedeModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900">{t("treatment.supersede", "Supersede / Update plan")}</h2>
              <button onClick={() => setSupersedeModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-6">{t("treatment.supersede_for", "For risk:")} <span className="font-medium text-gray-800">{riskTitle(supersedeTarget.risk_id)}</span></p>
            {supersedeError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{supersedeError}</div>}
            <form onSubmit={handleSupersedeSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.change_summary", "What changed in this new plan?")} *</label>
                <textarea
                  value={supersedeForm.change_summary}
                  onChange={(e) => setSupersedeForm({ ...supersedeForm, change_summary: e.target.value })}
                  rows={2}
                  placeholder={t("treatment.change_summary_placeholder", "e.g. Revised budget after vendor quote, new completion date…")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.linked_scenarios", "Linked risk scenarios")}</label>
                <MultiSelect
                  options={supersedeScenarioOptions}
                  selected={supersedeForm.linked_scenario_ids}
                  onChange={(ids) => setSupersedeForm({ ...supersedeForm, linked_scenario_ids: ids })}
                  placeholder={t("treatment.select_scenarios", "Select scenario(s)…")}
                  emptyLabel={t("treatment.no_scenarios", "No scenarios for this risk")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.col_option", "Option")}</label>
                  <select value={supersedeForm.treatment_option} onChange={(e) => setSupersedeForm({ ...supersedeForm, treatment_option: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {OPTIONS.map((o) => <option key={o} value={o}>{String(t(`vocab.${o}` as never, o.charAt(0).toUpperCase() + o.slice(1)))}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.col_due", "Due date")}</label>
                  <input type="date" value={supersedeForm.due_date} onChange={(e) => setSupersedeForm({ ...supersedeForm, due_date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description", "Description")}</label>
                <textarea value={supersedeForm.description} onChange={(e) => setSupersedeForm({ ...supersedeForm, description: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.progress", "Progress %")}</label>
                  <input type="number" min={0} max={100} value={supersedeForm.progress_percentage} onChange={(e) => setSupersedeForm({ ...supersedeForm, progress_percentage: parseInt(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.cost", "Est. cost ($)")}</label>
                  <input type="number" min={0} value={supersedeForm.estimated_cost} onChange={(e) => setSupersedeForm({ ...supersedeForm, estimated_cost: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              {supersedeForm.treatment_option === "transfer" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("treatment.transfer_to", "Transfer to")}</label>
                  <input value={supersedeForm.transfer_to} onChange={(e) => setSupersedeForm({ ...supersedeForm, transfer_to: e.target.value })} placeholder={t("treatment.transfer_to_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {/* The backend requires a justification for every option, not only accept. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {supersedeForm.treatment_option === "accept" ? t("treatment.justification", "Acceptance justification") : t("r2.treatment.justification", "Justification")} *
                </label>
                <textarea value={supersedeForm.acceptance_justification} onChange={(e) => setSupersedeForm({ ...supersedeForm, acceptance_justification: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setSupersedeModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                <button type="submit" disabled={supersedeSubmitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {supersedeSubmitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("treatment.supersede_short", "Supersede")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Version History Modal (M8.2 gap fix) */}
      {historyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setHistoryModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900">{t("treatment.history", "Version history")}</h2>
              <button onClick={() => setHistoryModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {historyRisk && <p className="text-sm text-gray-500 mb-6">{t("treatment.supersede_for", "For risk:")} <span className="font-medium text-gray-800">{historyRisk.title}</span></p>}
            {historyLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
            ) : historyVersions.length === 0 ? (
              <div className="text-center py-12 text-gray-400">{t("treatment.no_history", "No superseded versions yet — this plan hasn't been revised.")}</div>
            ) : (
              <ol className="relative border-s border-gray-200 space-y-6 ps-4">
                {historyVersions.map((v) => (
                  <li key={v.id} className="ms-2">
                    <span className="absolute -start-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-900">{t("treatment.version_n", "Version {{n}}", { n: v.version_number })}</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold border ${OPTION_BADGE[v.snapshot?.treatment_option] || "bg-gray-100 text-gray-600"}`}>{v.snapshot?.treatment_option}</span>
                      <span className="text-[11px] text-gray-400">{new Date(v.created_at).toLocaleString(uiLocale())}</span>
                    </div>
                    {v.change_summary && <p className="text-sm text-gray-700 mt-1">{v.change_summary}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                      <span>{t("treatment.col_progress", "Progress")}: {v.snapshot?.progress_percentage ?? 0}%</span>
                      <span>{t("treatment.col_due", "Due")}: {v.snapshot?.due_date || "—"}</span>
                      <span>{t("treatment.col_cost", "Est. cost")}: {v.snapshot?.estimated_cost != null ? `$${v.snapshot.estimated_cost}` : "—"}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
