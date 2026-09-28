import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Sparkles, Loader2, CheckCircle, User, Calendar, MessageSquare, Repeat } from "lucide-react";
import { aiApi, complianceApi, usersApi, type TenantUserRecord } from "@/api/endpoints";
import AiGate from "@/components/features/ai/AiGate";
import { useAiTokenRefresh } from "@/hooks/useAiTokenRefresh";
import type { GapDetail } from "@/types";

interface Props {
  readonly gap: GapDetail;
  readonly assessmentId: string;
  readonly onClose: () => void;
  readonly onAccepted: (gapId: string) => void;
}

/** The backend accepts exactly these four (ACTION_RECURRENCES in compliance.py);
 *  anything else is a 422, so this is a picker and never a free-text field. */
const ACTION_RECURRENCES = ["monthly", "quarterly", "semiannual", "annual"] as const;

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-700 bg-red-100 border-red-200",
  high:     "text-orange-700 bg-orange-100 border-orange-200",
  medium:   "text-yellow-700 bg-yellow-100 border-yellow-200",
  low:      "text-gray-600 bg-gray-100 border-gray-200",
};

/** The accept body the endpoint really takes. The api lane's
 *  actOnRecommendation() signature has not caught up with start_date /
 *  action_type / recurrence yet (reported under needs_integration), so the
 *  payload is built here and handed over as a value rather than as an inline
 *  literal — every field below is read by POST /gaps/{id}/recommendation. */
interface AcceptPayload {
  action: "accept" | "reject";
  owner_id?: string;
  start_date?: string;
  due_date?: string;
  notes?: string;
  action_type?: string;
  recurrence?: string;
}

export default function GapConfirmModal({ gap, assessmentId, onClose, onAccepted }: Props) {
  const { t } = useTranslation();
  const { refreshAiTokens } = useAiTokenRefresh();
  const [aiText, setAiText] = useState("");
  const [aiDone, setAiDone] = useState(false);
  const [aiError, setAiError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [users, setUsers] = useState<TenantUserRecord[]>([]);
  const [ownerId, setOwnerId]     = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate]     = useState("");
  const [actionType, setActionType] = useState<"corrective" | "preventive">("corrective");
  const [recurrence, setRecurrence] = useState("");
  const [notes, setNotes]         = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    usersApi.list()
      .then((list) => { if (alive) setUsers(list.filter((u) => u.is_active)); })
      .catch(() => { /* the picker degrades to "unassigned"; never blocks the modal */ });
    return () => { alive = false; };
  }, []);

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
      async () => {
        setAiDone(true);
        await refreshAiTokens();
      },
      abortRef.current.signal,
    ).catch((err) => {
      if (err?.name !== "AbortError") {
        setAiError(t("compliance.ai_unavailable", "AI analysis is unavailable. You can still accept this gap manually."));
        setAiDone(true);
      }
    });
  }, [gap, refreshAiTokens, t]);

  useEffect(() => {
    streamAnalysis();
    return () => { abortRef.current?.abort(); };
  }, [streamAnalysis]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [aiText]);

  const datesInvalid = !!startDate && !!dueDate && new Date(dueDate) < new Date(startDate);

  async function handleAccept() {
    if (datesInvalid) {
      setSubmitError(t("action_plan.dates_invalid"));
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    const payload: AcceptPayload = {
      action: "accept",
      owner_id: ownerId || undefined,
      start_date: startDate || undefined,
      due_date: dueDate || undefined,
      notes: notes || undefined,
      action_type: actionType,
      recurrence: actionType === "preventive" && recurrence ? recurrence : undefined,
    };
    try {
      await complianceApi.actOnRecommendation(assessmentId, gap.id, payload);
      onAccepted(gap.id);
      onClose();
    } catch {
      setSubmitError(t("compliance.action_item_create_failed", "The action item could not be created. Nothing was changed."));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldCls =
    "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white";

  return (
    <AiGate featureLabel={t("compliance.journey_gap_analysis")}>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                {gap.control_identifier}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${SEVERITY_COLOR[gap.severity] ?? SEVERITY_COLOR.low}`}>
                {t(`compliance.severities.${gap.severity}`, { defaultValue: gap.severity })}
              </span>
              {gap.is_certification_blocker && (
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200">
                  🔴 {t("compliance.blocker")}
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold text-gray-900 truncate">{gap.control_title}</h2>
          </div>
          <button
            onClick={onClose}
            className="ms-3 text-gray-400 hover:text-gray-600 flex-shrink-0"
            title={t("common.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Gap description */}
          <div className="bg-red-50 border border-red-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">{t("compliance.gap_identified_label")}</p>
            <p className="text-sm text-red-800">{gap.gap_description}</p>
            {gap.remediation_steps && (
              <p className="text-xs text-red-600 mt-2 border-t border-red-100 pt-2">{gap.remediation_steps}</p>
            )}
          </div>

          {/* AI Recommendation */}
          <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">{t("compliance.ai_assessment_label")}</p>
              {!aiDone && <Loader2 className="w-3 h-3 animate-spin text-purple-400" />}
              {aiDone && (
                <button
                  onClick={streamAnalysis}
                  className="ms-auto text-xs text-purple-600 hover:underline"
                >
                  {t("compliance.regenerate", "Regenerate")}
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
                {aiText || <span className="text-purple-300 italic">{t("common.loading")}</span>}
              </div>
            )}
          </div>

          {/* Action Item Details */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-800">{t("compliance.create_action_item")}</p>

            {/* Corrective vs preventive */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t("action_plan.action_type")}</label>
              <div className="flex gap-2">
                {(["corrective", "preventive"] as const).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setActionType(tp)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      actionType === tp
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {t(`action_plan.action_types.${tp}`)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">{t("action_plan.action_type_hint")}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="gap-owner">
                  <User className="w-3 h-3 inline me-1" />
                  {t("action_plan.owner")}
                </label>
                <select
                  id="gap-owner"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className={fieldCls}
                >
                  <option value="">{t("action_plan.select_owner")}</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {`${u.first_name} ${u.last_name}`.trim() || u.email}
                    </option>
                  ))}
                </select>
              </div>
              {actionType === "preventive" && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="gap-recurrence">
                    <Repeat className="w-3 h-3 inline me-1" />
                    {t("action_plan.recurrence")}
                  </label>
                  <select
                    id="gap-recurrence"
                    value={recurrence}
                    onChange={(e) => setRecurrence(e.target.value)}
                    className={fieldCls}
                  >
                    <option value="">{t("common.none")}</option>
                    {ACTION_RECURRENCES.map((r) => (
                      <option key={r} value={r}>
                        {t(`action_plan.recurrences.${r}`, {
                          defaultValue: r.charAt(0).toUpperCase() + r.slice(1),
                        })}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="gap-start">
                  <Calendar className="w-3 h-3 inline me-1" />
                  {t("action_plan.start_date")}
                </label>
                <input
                  id="gap-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={fieldCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="gap-due">
                  <Calendar className="w-3 h-3 inline me-1" />
                  {t("action_plan.end_date")}
                </label>
                <input
                  id="gap-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={fieldCls}
                />
              </div>
            </div>
            {datesInvalid && <p className="text-xs text-red-600">{t("action_plan.dates_invalid")}</p>}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="gap-notes">
                <MessageSquare className="w-3 h-3 inline me-1" />
                {t("common.notes")} ({t("common.optional")})
              </label>
              <textarea
                id="gap-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder={t("action_plan.action_description_placeholder")}
                className={`${fieldCls} resize-none`}
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
            {t("common.cancel")}
          </button>
          <button
            onClick={handleAccept}
            disabled={submitting || datesInvalid}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            {t("compliance.create_action_item")}
          </button>
        </div>
      </div>
    </div>
    </AiGate>
  );
}
