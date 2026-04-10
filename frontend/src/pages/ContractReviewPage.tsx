/**
 * ContractReviewPage — CISO reviews vendor contracts with AI analysis.
 * Shows a list of pending contracts and lets CISO approve/reject with comments.
 */
import { useState, useEffect } from "react";
import { FileText, CheckCircle2, XCircle, Send, Clock, AlertTriangle, Sparkles, Loader2, ArrowLeft, Building2 } from "lucide-react";
import { vendorsApi } from "@/api/endpoints";

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
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending_ai: { label: "AI Analyzing", color: "bg-blue-100 text-blue-700 border-blue-200", icon: Loader2 },
  ai_reviewed: { label: "Ready for Review", color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: Clock },
  pending_ciso: { label: "Pending CISO", color: "bg-orange-100 text-orange-700 border-orange-200", icon: Clock },
  approved: { label: "Approved", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
  sent_to_vendor: { label: "Sent to Vendor", color: "bg-purple-100 text-purple-700 border-purple-200", icon: Send },
};

export default function ContractReviewPage() {
  const [contracts, setContracts] = useState<VendorContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VendorContract | null>(null);
  const [comments, setComments] = useState("");
  const [processing, setProcessing] = useState(false);

  async function loadContracts() {
    try {
      setLoading(true);
      const data = await vendorsApi.listContractsPendingReview();
      setContracts(data || []);
    } catch (err) {
      console.error("Failed to load contracts:", err);
      setContracts([]);
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
      setProcessing(true);
      await vendorsApi.cisoReviewContract(selected.id, action, comments);
      await loadContracts();
      setSelected(null);
      setComments("");
    } catch (err) {
      console.error("Failed to review contract:", err);
      alert("Failed to process review. Please try again.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleSendToVendor(contract: VendorContract) {
    try {
      setProcessing(true);
      await vendorsApi.sendContractToVendor(contract.id);
      await loadContracts();
    } catch (err) {
      console.error("Failed to send contract:", err);
      alert("Failed to send contract. Please try again.");
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
    const canReview = selected.validation_status === "ai_reviewed" || selected.validation_status === "pending_ciso";
    const canSend = selected.validation_status === "approved";

    return (
      <div className="max-w-5xl mx-auto p-6">
        <button
          onClick={() => { setSelected(null); setComments(""); }}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Contract List
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
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${statusCfg.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {statusCfg.label}
                    </span>
                    <span className="text-xs text-gray-500">Version {selected.version}</span>
                    <span className="text-xs text-gray-500">
                      {selected.file_size ? `${(selected.file_size / 1024).toFixed(1)} KB` : ""}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Review Content */}
          <div className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-800">AI Contract Review</h2>
            </div>
            {selected.ai_review ? (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 max-h-96 overflow-y-auto">
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{selected.ai_review}</div>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">AI review in progress...</p>
              </div>
            )}
          </div>

          {/* Previous CISO Comments */}
          {selected.ciso_comments && (
            <div className="px-6 pb-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Previous CISO Comments</h3>
              <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3">
                <p className="text-sm text-gray-700">{selected.ciso_comments}</p>
                {selected.ciso_reviewed_at && (
                  <p className="text-xs text-gray-400 mt-2">
                    Reviewed on {new Date(selected.ciso_reviewed_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* CISO Action Section */}
          {canReview && (
            <div className="px-6 py-5 border-t border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">CISO Review Decision</h3>
              <textarea
                placeholder="Add your review comments (optional for approval, required for rejection)..."
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
                  Reject Contract
                </button>
                <button
                  onClick={() => handleAction("approve")}
                  disabled={processing}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Approve Contract
                </button>
              </div>
              {!comments.trim() && (
                <p className="text-xs text-gray-500 mt-2">
                  <AlertTriangle className="w-3 h-3 inline mr-1" />
                  Comments are required for rejection
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
                    Contract Approved
                  </h3>
                  <p className="text-xs text-gray-600 mt-1">Ready to send back to vendor</p>
                </div>
                <button
                  onClick={() => handleSendToVendor(selected)}
                  disabled={processing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  Send to Vendor
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
        <h1 className="text-2xl font-bold text-gray-900">Contract Review</h1>
        <p className="text-sm text-gray-500 mt-1">Review and approve vendor contracts analyzed by AI</p>
      </div>

      {contracts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">No Contracts Pending Review</h2>
          <p className="text-sm text-gray-500">All contracts have been reviewed. New uploads will appear here.</p>
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
                className="bg-white rounded-xl border border-gray-100 p-4 hover:border-blue-200 hover:shadow-sm transition-all text-left"
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
                          Vendor ID: {contract.vendor_id.slice(0, 8)}
                        </span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className="text-xs text-gray-500">v{contract.version}</span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className="text-xs text-gray-500">
                          {new Date(contract.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border flex items-center gap-1.5 flex-shrink-0 ${statusCfg.color}`}>
                    <StatusIcon className="w-3 h-3" />
                    {statusCfg.label}
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
