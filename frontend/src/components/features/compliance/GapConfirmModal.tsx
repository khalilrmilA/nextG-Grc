import { useState, useEffect, useRef, useCallback } from "react";
import { X, Sparkles, Loader2, CheckCircle, User, Calendar, MessageSquare } from "lucide-react";
import { aiApi, complianceApi } from "@/api/endpoints";
import type { GapDetail } from "@/types";

interface Props {
  readonly gap: GapDetail;
  readonly assessmentId: string;
  readonly onClose: () => void;
  readonly onAccepted: (gapId: string) => void;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-700 bg-red-100 border-red-200",
  high:     "text-orange-700 bg-orange-100 border-orange-200",
  medium:   "text-yellow-700 bg-yellow-100 border-yellow-200",
  low:      "text-gray-600 bg-gray-100 border-gray-200",
};

export default function GapConfirmModal({ gap, assessmentId, onClose, onAccepted }: Props) {
  const [aiText, setAiText] = useState("");
  const [aiDone, setAiDone] = useState(false);
  const [aiError, setAiError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [ownerId, setOwnerId]   = useState("");
  const [dueDate, setDueDate]   = useState("");
  const [notes, setNotes]       = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const streamAnalysis = useCallback(() => {
    setAiText("");
    setAiDone(false);
    setAiError("");

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    aiApi.streamRiskAnalysis(
      gap.control_title,
      gap.gap_description,
      "compliance",
      (token) => setAiText((prev) => prev + token),
      () => setAiDone(true),
      abortRef.current.signal,
    ).catch((err) => {
      if (err?.name !== "AbortError") {
        setAiError("AI analysis unavailable. You can still accept the gap manually.");
        setAiDone(true);
      }
    });
  }, [gap]);

  useEffect(() => {
    streamAnalysis();
    return () => { abortRef.current?.abort(); };
  }, [streamAnalysis]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [aiText]);

  async function handleAccept() {
    setSubmitting(true);
    setSubmitError("");
    try {
      await complianceApi.actOnRecommendation(assessmentId, gap.id, {
        action: "accept",
        owner_id: ownerId || undefined,
        due_date: dueDate || undefined,
        notes: notes || undefined,
      });
      onAccepted(gap.id);
      onClose();
    } catch {
      setSubmitError("Failed to create action item. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                {gap.control_identifier}
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${SEVERITY_COLOR[gap.severity] ?? SEVERITY_COLOR.low}`}>
                {gap.severity}
              </span>
              {gap.is_certification_blocker && (
                <span className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  🔴 Cert Blocker
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold text-gray-900 truncate">{gap.control_title}</h2>
          </div>
          <button
            onClick={onClose}
            className="ml-3 text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Gap description */}
          <div className="bg-red-50 border border-red-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Gap Identified</p>
            <p className="text-sm text-red-800">{gap.gap_description}</p>
            {gap.remediation_steps && (
              <p className="text-xs text-red-600 mt-2 border-t border-red-100 pt-2">{gap.remediation_steps}</p>
            )}
          </div>

          {/* AI Recommendation */}
          <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">AI Recommendation</p>
              {!aiDone && <Loader2 className="w-3 h-3 animate-spin text-purple-400" />}
              {aiDone && (
                <button
                  onClick={streamAnalysis}
                  className="ml-auto text-xs text-purple-600 hover:underline"
                >
                  Regenerate
                </button>
              )}
            </div>
            {aiError ? (
              <p className="text-xs text-purple-600">{aiError}</p>
            ) : (
              <div
                ref={scrollRef}
                className="text-sm text-purple-900 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed"
              >
                {aiText || <span className="text-purple-300 italic">Generating…</span>}
              </div>
            )}
          </div>

          {/* Action Item Details */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-800">Create Action Item</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <User className="w-3 h-3 inline mr-1" />
                  Owner (optional)
                </label>
                <input
                  type="text"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  placeholder="User ID or email"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <Calendar className="w-3 h-3 inline mr-1" />
                  Due Date (optional)
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                <MessageSquare className="w-3 h-3 inline mr-1" />
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Additional context or instructions for this action item…"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>

          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {submitError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-gray-100">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={submitting}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            {submitting ? "Creating…" : "Accept & Create Action Item"}
          </button>
        </div>
      </div>
    </div>
  );
}
