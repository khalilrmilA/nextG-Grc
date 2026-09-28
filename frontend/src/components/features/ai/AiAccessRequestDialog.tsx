import { useState } from "react";
import { AlertCircle, Loader2, X, CheckCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { authApi } from "@/api/endpoints";

export default function AiAccessRequestDialog({
  isOpen,
  onClose,
  feature = "all",
}: {
  isOpen: boolean;
  onClose: () => void;
  feature?: "document-generation" | "ai-analysis" | "all";
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError(t("ai_access.err_reason_required"));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await authApi.requestAiAccess(feature, reason);
      setSubmitted(true);
      setTimeout(() => {
        onClose();
        setSubmitted(false);
        setReason("");
      }, 2000);
    } catch (err) {
      setError(t("ai_access.err_submit"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{t("ai_access.request_cta")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {submitted ? (
            <div className="py-8 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="font-semibold text-gray-900 mb-1">{t("ai_access.submitted_title")}</p>
              <p className="text-sm text-gray-600">
                {t("ai_access.submitted_desc")}
              </p>
            </div>
          ) : (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-700">
                  <strong>{t("ai_access.why_title")}</strong> {t("ai_access.why_desc")}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("ai_access.feature_type")}
                </label>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700">
                  {feature === "all" && t("ai_access.feature_all")}
                  {feature === "document-generation" && t("ai_access.feature_docgen")}
                  {feature === "ai-analysis" && t("ai_access.feature_analysis")}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("ai_access.reason_label")} *
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("ai_access.reason_placeholder")}
                  rows={4}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 px-3 py-2.5 rounded-lg">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> {t("ai_access.submitting")}
                    </>
                  ) : (
                    t("ai_access.submit")
                  )}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
