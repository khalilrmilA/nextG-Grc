/**
 * ContractReviewPage — CISO reviews vendor contracts with AI analysis.
 * Shows a list of pending contracts and lets CISO approve/reject with comments.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FileText, CheckCircle2, XCircle, Send, Clock, AlertTriangle, Sparkles, Loader2, ArrowLeft, Building2 } from "lucide-react";
import { vendorsApi } from "@/api/endpoints";
import { useAuthStore, hasAnyRole } from "@/store/auth";

// vendors.py: ciso-review is CISO-only (maker-checker); send-to-vendor is vendor_manager + CISO.
const DECIDE_ROLES = ["ciso", "tenant_admin", "super_admin"];
const SEND_ROLES = ["vendor_manager", "ciso", "tenant_admin", "super_admin"];

function apiError(err: unknown, fallback: string): string {
  const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === "string" ? d : fallback;
}

interface VendorContract {
  id: string;
  vendor_id: string;
  file_name: string;
  file_size: number | null;
  ai_review: string | null;
  review_status: string;
  validation_status: string;
  ciso_reviewer_id: string | null;
  ciso_comments: string | null;
  ciso_reviewed_at: string | null;
  sent_to_vendor_at: string | null;
  version: number;
  created_at: string;
  vendor_name?: string | null;
}

/** Display locale for dates, following the interface language. */
const dateLocale = (lang: string) => (lang.startsWith("fr") ? "fr-FR" : lang.startsWith("ar") ? "ar-u-nu-latn" : "en-US");

// `label` is an i18n key, resolved with t() at render time.
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending_ai: { label: "vendors.contract_status.pending_ai", color: "bg-blue-100 text-blue-700 border-blue-200", icon: Loader2 },
  ai_reviewed: { label: "contract_review.status_ready", color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: Clock },
  pending_ciso: { label: "vendors.contract_status.pending_ciso", color: "bg-orange-100 text-orange-700 border-orange-200", icon: Clock },
  approved: { label: "vendors.contract_status.approved", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  rejected: { label: "vendors.contract_status.rejected", color: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
  sent_to_vendor: { label: "vendors.contract_status.sent_to_vendor", color: "bg-purple-100 text-purple-700 border-purple-200", icon: Send },
};

export default function ContractReviewPage() {
  const { t, i18n } = useTranslation();
  const [contracts, setContracts] = useState<VendorContract[]>([]);
  // Approved, not yet sent (follow-up C-3): approval used to drop a contract out of
  // the only list that led to "Send to vendor".
  const [readyToSend, setReadyToSend] = useState<VendorContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VendorContract | null>(null);
  const [comments, setComments] = useState("");
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");
  const authUser = useAuthStore((u) => u);
  const canDecide = hasAnyRole(authUser, DECIDE_ROLES);
  const canSendRole = hasAnyRole(authUser, SEND_ROLES);

  async function loadContracts() {
    try {
      setLoading(true);
      const [pending, ready] = await Promise.allSettled([
        vendorsApi.listContractsPendingReview(), vendorsApi.listContractsReadyToSend()]);
      setContracts(pending.status === "fulfilled" ? pending.value || [] : []);
      setReadyToSend(ready.status === "fulfilled" ? ready.value || [] : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContracts();
  }, []);

  async function handleAction(action: "approve" | "reject") {
    if (!selected) return;
    try {
      setProcessing(true); setActionError("");
      const decided = await vendorsApi.cisoReviewContract(selected.id, action, comments);
      await loadContracts();
      setComments("");
      // Stay on an approved contract: "Send to vendor" is the next step.
      if (action === "approve" && decided) setSelected({ ...selected, ...decided });
      else setSelected(null);
    } catch (err) {
      setActionError(apiError(err, t("contract_review.review_failed")));
    } finally {
      setProcessing(false);
    }
  }

  async function handleSendToVendor(contract: VendorContract) {
    try {
      setProcessing(true); setActionError("");
      const sent = await vendorsApi.sendContractToVendor(contract.id);
      await loadContracts();
      if (selected?.id === contract.id) setSelected({ ...contract, ...sent });
    } catch (err) {
      setActionError(apiError(err, t("contract_review.send_failed")));
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Detail view
  if (selected) {
    const statusCfg = STATUS_CONFIG[selected.validation_status] || STATUS_CONFIG.pending_ai;
    const StatusIcon = statusCfg.icon;
    const canReview = canDecide && ["ai_reviewed", "pending_ciso", "pending_ai"].includes(selected.validation_status);
    const canSend = canSendRole && selected.validation_status === "approved";

    return (
      <div className="max-w-5xl mx-auto p-6">
        <button
          onClick={() => { setSelected(null); setComments(""); setActionError(""); }}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {t("contract_review.back_to_list")}
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-100 bg-slate-50">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{selected.file_name}</h1>
                  {selected.vendor_name && <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{selected.vendor_name}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${statusCfg.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {t(statusCfg.label)}
                    </span>
                    <span className="text-xs text-gray-500">{t("contract_review.version", { version: selected.version })}</span>
                    <span className="text-xs text-gray-500">
                      {selected.file_size ? `${(selected.file_size / 1024).toFixed(1)} KB` : ""}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {actionError && (
            <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
          )}
          {selected.validation_status === "sent_to_vendor" && selected.sent_to_vendor_at && (
            <div className="mx-6 mt-4 text-sm text-purple-700 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2 flex items-center gap-2">
              <Send className="w-4 h-4" />
              {t("r2b.contracts.sent_on", { date: new Date(selected.sent_to_vendor_at).toLocaleString(dateLocale(i18n.language)) })}
            </div>
          )}

          {/* AI Review Content */}
          <div className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-800">{t("contract_review.ai_review")}</h2>
            </div>
            {selected.ai_review ? (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 max-h-96 overflow-y-auto">
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{selected.ai_review}</div>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">{t("contract_review.ai_in_progress")}</p>
              </div>
            )}
          </div>

          {/* Previous CISO Comments */}
          {selected.ciso_comments && (
            <div className="px-6 pb-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t("contract_review.previous_comments")}</h3>
              <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3">
                <p className="text-sm text-gray-700">{selected.ciso_comments}</p>
                {selected.ciso_reviewed_at && (
                  <p className="text-xs text-gray-400 mt-2">
                    {t("contract_review.reviewed_on", { date: new Date(selected.ciso_reviewed_at).toLocaleString(dateLocale(i18n.language)) })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* CISO Action Section */}
          {canReview && (
            <div className="px-6 py-5 border-t border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">{t("contract_review.decision")}</h3>
              <textarea
                placeholder={t("contract_review.comments_placeholder")}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-3"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => handleAction("reject")}
                  disabled={processing || !comments.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <XCircle className="w-4 h-4" />
                  {t("contract_review.reject")}
                </button>
                <button
                  onClick={() => handleAction("approve")}
                  disabled={processing}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {t("contract_review.approve")}
                </button>
              </div>
              {!comments.trim() && (
                <p className="text-xs text-gray-500 mt-2">
                  <AlertTriangle className="w-3 h-3 inline me-1" />
                  {t("contract_review.comments_required")}
                </p>
              )}
            </div>
          )}

          {/* Send to Vendor Section */}
          {canSend && (
            <div className="px-6 py-5 border-t border-gray-100 bg-green-50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    {t("contract_review.approved_title")}
                  </h3>
                  <p className="text-xs text-gray-600 mt-1">{t("contract_review.ready_to_send")}</p>
                </div>
                <button
                  onClick={() => handleSendToVendor(selected)}
                  disabled={processing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {t("contract_review.send_to_vendor")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t("vendors.contract_review")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("contract_review.subtitle")}</p>
      </div>

      {readyToSend.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Send className="w-4 h-4 text-purple-600" />{t("r2b.contracts.ready_to_send")} ({readyToSend.length})
          </h2>
          {actionError && <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</p>}
          <div className="grid gap-3">
            {readyToSend.map((c) => (
              <div key={c.id} className="bg-white rounded-xl border border-green-100 p-4 flex items-center justify-between gap-4">
                <button onClick={() => setSelected(c)} className="flex items-start gap-3 min-w-0 flex-1 text-start">
                  <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 truncate">{c.file_name}</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {c.vendor_name ?? c.vendor_id.slice(0, 8)} · v{c.version}
                      {c.ciso_reviewed_at && <> · {t("contract_review.reviewed_on", { date: new Date(c.ciso_reviewed_at).toLocaleDateString(dateLocale(i18n.language)) })}</>}
                    </p>
                  </div>
                </button>
                {canSendRole && (
                  <button onClick={() => handleSendToVendor(c)} disabled={processing}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50 flex-shrink-0">
                    <Send className="w-4 h-4" />{t("contract_review.send_to_vendor")}
                  </button>
                )}
              </div>
            ))}
          </div>
          <h2 className="text-sm font-semibold text-gray-700 mt-8 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-500" />{t("r2b.contracts.awaiting_review")} ({contracts.length})
          </h2>
        </div>
      )}

      {contracts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">{t("contract_review.empty_title")}</h2>
          <p className="text-sm text-gray-500">{t("contract_review.empty_desc")}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {contracts.map((contract) => {
            const statusCfg = STATUS_CONFIG[contract.validation_status] || STATUS_CONFIG.pending_ai;
            const StatusIcon = statusCfg.icon;
            return (
              <button
                key={contract.id}
                onClick={() => setSelected(contract)}
                className="bg-white rounded-xl border border-gray-100 p-4 hover:border-blue-200 hover:shadow-sm transition-all text-start"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">{contract.file_name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {contract.vendor_name ?? t("contract_review.vendor_id", { id: contract.vendor_id.slice(0, 8) })}
                        </span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className="text-xs text-gray-500">v{contract.version}</span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className="text-xs text-gray-500">
                          {new Date(contract.created_at).toLocaleDateString(dateLocale(i18n.language))}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border flex items-center gap-1.5 flex-shrink-0 ${statusCfg.color}`}>
                    <StatusIcon className="w-3 h-3" />
                    {t(statusCfg.label)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
