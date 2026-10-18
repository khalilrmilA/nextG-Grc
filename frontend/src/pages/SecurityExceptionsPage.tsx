import { useState, useEffect } from "react";
import { Plus, Search, X, Loader2, ShieldOff, CheckCircle, XCircle, AlertTriangle, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { securityApi, usersApi, risksApi, riskScenariosApi } from "@/api/endpoints";
import { MultiSelect, type MultiSelectOption } from "@/components/common/MultiSelect";
import { useAuthStore, hasAnyRole, currentUserId } from "@/store/auth";
import appI18n from "@/i18n";

/** Intl locale for the current UI language (Arabic keeps Latin digits). */
function uiLocale(): string {
  const l = appI18n.language || "en";
  return l.startsWith("fr") ? "fr-FR" : l.startsWith("ar") ? "ar-u-nu-latn" : "en-US";
}


const EXCEPTION_STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  pending_approval: "bg-yellow-100 text-yellow-700 border-yellow-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  expired: "bg-gray-100 text-gray-500 border-gray-200",
  revoked: "bg-red-100 text-red-700 border-red-200",
};

const ACCEPTANCE_STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  expired: "bg-gray-100 text-gray-500 border-gray-200",
  revoked: "bg-red-100 text-red-700 border-red-200",
};

// Approve / reject / revoke an acceptance: CISO (admins auto-pass server-side).
const ACCEPTANCE_DECISION_ROLES = ["ciso", "tenant_admin", "super_admin"];

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"];
const EXCEPTION_TYPE_OPTIONS = ["risk", "control", "vulnerability", "requirement", "asset"];

/** Raw backend enum -> the SPA's language, falling back to a humanised form of
 *  the value itself so an enum with no key yet still reads as a label. */
function humanise(v: string): string {
  return v ? v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "";
}

export default function SecurityExceptionsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"exceptions" | "acceptances">("exceptions");

  // Exceptions state
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [excLoading, setExcLoading] = useState(true);
  const [showExcModal, setShowExcModal] = useState(false);
  const [excSearch, setExcSearch] = useState("");
  const [excError, setExcError] = useState("");
  const [excSubmitting, setExcSubmitting] = useState(false);
  const [excForm, setExcForm] = useState({
    title: "",
    justification: "",
    description: "",
    severity: "medium",
    exception_type: "risk",
    expiration_date: "",
    compensating_controls: "",
  });

  // Acceptances state
  const [acceptances, setAcceptances] = useState<any[]>([]);
  const [accLoading, setAccLoading] = useState(true);
  const [showAccModal, setShowAccModal] = useState(false);
  const [accError, setAccError] = useState("");
  const [accSubmitting, setAccSubmitting] = useState(false);
  // Approve/reject are gated server-side (CISO role, four-eyes: a requester may
  // not approve their own waiver) and 409 on a lapsed or already-decided one.
  // All three handlers used to `catch {}`, so every one of those refusals was a
  // button click that did nothing at all, with no explanation anywhere.
  const [actionError, setActionError] = useState("");
  // "Requested By" printed the raw requester UUID. GET /users is
  // tenant_admin-only, so for other roles the map stays empty and the cell keeps
  // its previous value rather than losing the information entirely.
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [accForm, setAccForm] = useState({
    name: "",
    justification: "",
    expiration_date: "",
    risk_ids: [] as string[],
    risk_scenario_ids: [] as string[],
  });
  // What an acceptance covers: picked from the register, shown by name in the list.
  const [riskOptions, setRiskOptions] = useState<MultiSelectOption[]>([]);
  const [scenarioOptions, setScenarioOptions] = useState<MultiSelectOption[]>([]);
  // Reject / revoke both ask for a reason in a dialog (the backend refuses an empty one).
  const [decision, setDecision] = useState<{ kind: "reject" | "revoke"; item: any } | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);
  const authUser = useAuthStore((u) => u);
  const canDecide = hasAnyRole(authUser, ACCEPTANCE_DECISION_ROLES);
  const myId = currentUserId(authUser);

  async function loadExceptions() {
    try {
      const data = await securityApi.listExceptions();
      setExceptions(Array.isArray(data) ? data : data.items || []);
    } catch {
      setExceptions([]);
    } finally {
      setExcLoading(false);
    }
  }

  async function loadAcceptances() {
    try {
      const data = await securityApi.listAcceptances();
      setAcceptances(Array.isArray(data) ? data : data.items || []);
    } catch {
      setAcceptances([]);
    } finally {
      setAccLoading(false);
    }
  }

  useEffect(() => {
    loadExceptions();
    loadAcceptances();
    usersApi.list()
      .then((us: any) => setUserNames(Object.fromEntries(
        (Array.isArray(us) ? us : []).map((u: any) => [
          u.id, `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email,
        ]),
      )))
      .catch(() => setUserNames({}));
    risksApi.list({ page: 1, page_size: 500 })
      .then((d) => setRiskOptions((d.items ?? []).map((r) => ({ id: r.id, label: r.title }))))
      .catch(() => setRiskOptions([]));
    riskScenariosApi.list()
      .then((d: any) => setScenarioOptions((Array.isArray(d) ? d : d.items || []).map((s: any) => ({
        id: s.id, label: s.ref_id ? `${s.ref_id} — ${s.name}` : s.name,
      }))))
      .catch(() => setScenarioOptions([]));
  }, []);

  async function handleExcSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!excForm.title.trim()) { setExcError(t("security_exceptions.error_title_required")); return; }
    if (!excForm.justification.trim()) { setExcError(t("security_exceptions.error_justification_required")); return; }
    if (!excForm.expiration_date) { setExcError(t("security_exceptions.error_expiration_required")); return; }
    setExcSubmitting(true);
    setExcError("");
    try {
      await securityApi.createException(excForm);
      setShowExcModal(false);
      setExcForm({ title: "", justification: "", description: "", severity: "medium", exception_type: "risk", expiration_date: "", compensating_controls: "" });
      setExcLoading(true);
      loadExceptions();
    } catch (err: any) {
      setExcError(err?.response?.data?.detail || t("security_exceptions.error_create_exception"));
    } finally {
      setExcSubmitting(false);
    }
  }

  async function handleAccSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accForm.name.trim()) { setAccError(t("security_exceptions.error_name_required")); return; }
    if (!accForm.justification.trim()) { setAccError(t("security_exceptions.error_justification_required")); return; }
    if (!accForm.expiration_date) { setAccError(t("security_exceptions.error_expiration_required")); return; }
    setAccSubmitting(true);
    setAccError("");
    try {
      await securityApi.createAcceptance(accForm);
      setShowAccModal(false);
      setAccForm({ name: "", justification: "", expiration_date: "", risk_ids: [], risk_scenario_ids: [] });
      setAccLoading(true);
      loadAcceptances();
    } catch (err: any) {
      setAccError(err?.response?.data?.detail || t("security_exceptions.error_create_acceptance"));
    } finally {
      setAccSubmitting(false);
    }
  }

  /** Whatever the server actually said, in the user's language when it is a
   *  status we can name ourselves. */
  function describeError(err: unknown): string {
    const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    if (typeof detail === "string" && detail) return detail;
    const status = (err as { response?: { status?: number } })?.response?.status ?? 0;
    if (status === 403) return t("common.access_restricted_hint");
    return t("errors.save_failed");
  }

  async function handleApproveException(id: string) {
    setActionError("");
    try {
      await securityApi.approveException(id);
      loadExceptions();
    } catch (err) {
      setActionError(describeError(err));
    }
  }

  async function handleRejectException(id: string) {
    setActionError("");
    const reason = window.prompt(t("moduledash.reject_reason"));
    // null = the user cancelled the prompt; an empty string is a deliberate
    // "no reason given" and still rejects.
    if (reason === null) return;
    try {
      await securityApi.rejectException(id, reason || undefined);
      loadExceptions();
    } catch (err) {
      setActionError(describeError(err));
    }
  }

  async function handleApproveAcceptance(id: string) {
    setActionError("");
    try {
      await securityApi.approveAcceptance(id);
      loadAcceptances();
    } catch (err) {
      setActionError(describeError(err));
    }
  }

  async function submitDecision() {
    if (!decision) return;
    if (!decisionReason.trim()) { setDecisionError(t("r2.acceptances.error_reason_required")); return; }
    setDecisionBusy(true); setDecisionError("");
    try {
      if (decision.kind === "reject") await securityApi.rejectAcceptance(decision.item.id, decisionReason.trim());
      else await securityApi.revokeAcceptance(decision.item.id, decisionReason.trim());
      setDecision(null); setDecisionReason("");
      loadAcceptances();
    } catch (err) {
      setDecisionError(describeError(err));
    } finally {
      setDecisionBusy(false);
    }
  }

  const riskLabel = (id: string) => riskOptions.find((o) => o.id === id)?.label ?? id;
  const scenarioLabel = (id: string) => scenarioOptions.find((o) => o.id === id)?.label ?? id;

  const filteredExceptions = exceptions.filter((i) =>
    i.title?.toLowerCase().includes(excSearch.toLowerCase())
  );

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("security_exceptions.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("security_exceptions.subtitle")}</p>
        </div>
        <button
          onClick={() => activeTab === "exceptions" ? setShowExcModal(true) : setShowAccModal(true)}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> {activeTab === "exceptions" ? t("security_exceptions.new_exception_btn") : t("security_exceptions.new_risk_acceptance")}
        </button>
      </div>

      {actionError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab("exceptions")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "exceptions" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          <ShieldOff className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
          {t("security_exceptions.exceptions_tab")}
        </button>
        <button
          onClick={() => setActiveTab("acceptances")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === "acceptances" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
        >
          <AlertTriangle className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
          {t("security_exceptions.risk_acceptances_tab")}
        </button>
      </div>

      {/* Exceptions Tab */}
      {activeTab === "exceptions" && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={excSearch}
                onChange={(e) => setExcSearch(e.target.value)}
                placeholder={t("security_exceptions.search_placeholder")}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {excLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : filteredExceptions.length === 0 ? (
              <div className="text-center py-16 text-gray-400">{t("security_exceptions.no_exceptions")}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_title")}</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_severity")}</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_status")}</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_type")}</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_expiration")}</th>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_requested_by")}</th>
                    <th className="text-right px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExceptions.map((item: any) => (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{item.title}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${SEV_BADGE[item.severity] || "bg-gray-100 text-gray-600"}`}>
                          {String(t(`vocab.${item.severity}` as never, humanise(item.severity)))}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${EXCEPTION_STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"}`}>
                          {String(t(`vocab.${item.status}` as never, humanise(item.status)))}
                        </span>
                        {/* SEOut.is_expired is derived on read, so a waiver
                            whose window closed is flagged even on the worker
                            that has not yet written the status transition. */}
                        {item.is_expired && item.status !== "expired" && (
                          <span className="ml-1.5 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-gray-100 text-gray-500 border-gray-200">
                            {t("vocab.expired")}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-600">{item.exception_type ? String(t(`vocab.${item.exception_type}` as never, humanise(item.exception_type))) : "-"}</td>
                      <td className="px-6 py-4 text-gray-500">{item.expiration_date ? new Date(item.expiration_date).toLocaleDateString(uiLocale()) : "-"}</td>
                      <td className="px-6 py-4 text-gray-500">{item.requested_by_id ? (userNames[item.requested_by_id] || item.requested_by_id) : "-"}</td>
                      <td className="px-6 py-4 text-right">
                        {/* The backend accepts a decision only on
                            pending_approval, and refuses one on a waiver whose
                            expiry has already passed — offering the button in
                            those states produced a 409 the user never saw. */}
                        {item.status === "pending_approval" && !item.is_expired && (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => handleApproveException(item.id)} className="inline-flex items-center gap-1 text-green-600 hover:text-green-700 text-xs font-medium">
                              <CheckCircle className="w-4 h-4" /> {t("security_exceptions.approve")}
                            </button>
                            <button onClick={() => handleRejectException(item.id)} className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-xs font-medium">
                              <XCircle className="w-4 h-4" /> {t("security_exceptions.reject")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Acceptances Tab */}
      {activeTab === "acceptances" && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {accLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : acceptances.length === 0 ? (
            <div className="text-center py-16 text-gray-400">{t("security_exceptions.no_risk_acceptances")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_name")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_status")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("r2.acceptances.covers")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_justification")}</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_expiration")}</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">{t("security_exceptions.table_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {acceptances.map((item: any) => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${ACCEPTANCE_STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"}`}>
                        {String(t(`vocab.${item.status}` as never, humanise(item.status)))}
                      </span>
                      {item.is_expired && item.status !== "expired" && (
                        <span className="ml-1.5 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-gray-100 text-gray-500 border-gray-200">
                          {t("vocab.expired")}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-600 max-w-xs">
                      {[...(item.risk_ids ?? []).map((id: string) => riskLabel(id)), ...(item.risk_scenario_ids ?? []).map((id: string) => scenarioLabel(id))]
                        .map((lbl: string, i: number) => <div key={i} className="truncate">{lbl}</div>)}
                      {!(item.risk_ids?.length || item.risk_scenario_ids?.length) && "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600 max-w-xs">
                      <div className="truncate">{item.justification || "-"}</div>
                      {(item.rejection_reason || item.revocation_reason) && (
                        <div className="text-xs text-red-600 mt-1 truncate">
                          {t("r2.common.reason")}: {item.revocation_reason || item.rejection_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500">{item.expiration_date ? new Date(item.expiration_date).toLocaleDateString(uiLocale()) : "-"}</td>
                    <td className="px-6 py-4 text-right">
                      {/* Four-eyes: the requester cannot decide on their own request. */}
                      {canDecide && item.status === "pending" && !item.is_expired && item.requested_by_id !== myId && (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleApproveAcceptance(item.id)} className="inline-flex items-center gap-1 text-green-600 hover:text-green-700 text-xs font-medium">
                            <CheckCircle className="w-4 h-4" /> {t("security_exceptions.approve")}
                          </button>
                          <button onClick={() => { setDecision({ kind: "reject", item }); setDecisionReason(""); setDecisionError(""); }}
                            className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-xs font-medium">
                            <XCircle className="w-4 h-4" /> {t("security_exceptions.reject")}
                          </button>
                        </div>
                      )}
                      {canDecide && item.status === "pending" && item.requested_by_id === myId && (
                        <span className="text-xs text-gray-400">{t("r2.acceptances.awaiting_other_approver")}</span>
                      )}
                      {canDecide && item.status === "approved" && !item.is_expired && (
                        <button onClick={() => { setDecision({ kind: "revoke", item }); setDecisionReason(""); setDecisionError(""); }}
                          className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-xs font-medium">
                          <Undo2 className="w-4 h-4" /> {t("r2.acceptances.revoke")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Exception Create Modal */}
      {showExcModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowExcModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("security_exceptions.new_exception")}</h2>
              <button onClick={() => setShowExcModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {excError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{excError}</div>}
            <form onSubmit={handleExcSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("security_exceptions.table_title")} *</label>
                <input value={excForm.title} onChange={(e) => setExcForm({ ...excForm, title: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("security_exceptions.justification")} *</label>
                <textarea value={excForm.justification} onChange={(e) => setExcForm({ ...excForm, justification: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description")}</label>
                <textarea value={excForm.description} onChange={(e) => setExcForm({ ...excForm, description: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.severity")}</label>
                  <select value={excForm.severity} onChange={(e) => setExcForm({ ...excForm, severity: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{String(t(`vocab.${s}` as never, humanise(s)))}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("security_exceptions.exception_type")}</label>
                  <select value={excForm.exception_type} onChange={(e) => setExcForm({ ...excForm, exception_type: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {EXCEPTION_TYPE_OPTIONS.map((tp) => <option key={tp} value={tp}>{String(t(`vocab.${tp}` as never, humanise(tp)))}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("security_exceptions.expiration_date")} *</label>
                <input type="date" value={excForm.expiration_date} onChange={(e) => setExcForm({ ...excForm, expiration_date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("security_exceptions.compensating_controls")}</label>
                <textarea value={excForm.compensating_controls} onChange={(e) => setExcForm({ ...excForm, compensating_controls: e.target.value })} rows={2} placeholder={t("security_exceptions.compensating_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowExcModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("security_exceptions.btn_cancel")}</button>
                <button type="submit" disabled={excSubmitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {excSubmitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("security_exceptions.btn_create_exception")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Acceptance Create Modal */}
      {showAccModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAccModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("security_exceptions.new_risk_acceptance")}</h2>
              <button onClick={() => setShowAccModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {accError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{accError}</div>}
            <form onSubmit={handleAccSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.name")} *</label>
                <input value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("security_exceptions.justification")} *</label>
                <textarea value={accForm.justification} onChange={(e) => setAccForm({ ...accForm, justification: e.target.value })} rows={4} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("security_exceptions.expiration_date")} *</label>
                <input type="date" value={accForm.expiration_date} onChange={(e) => setAccForm({ ...accForm, expiration_date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("r2.acceptances.risks_label")}</label>
                <MultiSelect options={riskOptions} selected={accForm.risk_ids}
                  onChange={(ids) => setAccForm({ ...accForm, risk_ids: ids })}
                  placeholder={t("risk_scenarios.select_placeholder")} emptyLabel={t("risk_scenarios.no_options")} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("r2.acceptances.scenarios_label")}</label>
                <MultiSelect options={scenarioOptions} selected={accForm.risk_scenario_ids}
                  onChange={(ids) => setAccForm({ ...accForm, risk_scenario_ids: ids })}
                  placeholder={t("risk_scenarios.select_placeholder")} emptyLabel={t("risk_scenarios.no_options")} />
                <p className="text-xs text-gray-400 mt-1">{t("r2.acceptances.picker_hint")}</p>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAccModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("security_exceptions.btn_cancel")}</button>
                <button type="submit" disabled={accSubmitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {accSubmitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("security_exceptions.btn_create_acceptance")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject / revoke an acceptance — both need a written reason. */}
      {decision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" role="alertdialog" aria-modal="true">
            <h3 className="font-semibold text-gray-900">
              {decision.kind === "reject" ? t("r2.acceptances.reject_title") : t("r2.acceptances.revoke_title")}
            </h3>
            <p className="text-sm text-gray-600">
              {decision.kind === "reject"
                ? t("r2.acceptances.reject_body", { name: decision.item.name })
                : t("r2.acceptances.revoke_body", { name: decision.item.name })}
            </p>
            <div>
              <label htmlFor="acc-decision-reason" className="block text-sm font-medium text-gray-700 mb-1">{t("r2.common.reason")} *</label>
              <textarea id="acc-decision-reason" rows={3} value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {decisionError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{decisionError}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDecision(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
              <button onClick={submitDecision} disabled={decisionBusy}
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium">
                {decisionBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                {decision.kind === "reject" ? t("security_exceptions.reject") : t("r2.acceptances.revoke")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
