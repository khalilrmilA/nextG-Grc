import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  X, Sparkles, Copy, RotateCcw, Loader2, CheckCheck,
  Pencil, Save, UserCheck, ChevronDown, ChevronUp, CheckCircle,
} from "lucide-react";
import { aiApi, policiesApi } from "@/api/endpoints";
import { makeThinkFilter } from "@/lib/sse";
import { useAiTokenRefresh } from "@/hooks/useAiTokenRefresh";
import type { GapDetail } from "@/types";
import AiGate from "@/components/features/ai/AiGate";

interface PolicyGeneratorModalProps {
  readonly gap: GapDetail;
  readonly frameworkShortName: string;
  readonly assessmentContext?: string;
  readonly onClose: () => void;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-700 bg-red-100",
  high:     "text-orange-700 bg-orange-100",
  medium:   "text-yellow-700 bg-yellow-100",
  low:      "text-gray-600 bg-gray-100",
};

export default function PolicyGeneratorModal({
  gap,
  frameworkShortName,
  assessmentContext,
  onClose,
}: PolicyGeneratorModalProps) {
  const { refreshAiTokens } = useAiTokenRefresh();
  const { t, i18n } = useTranslation();
  const [output, setOutput]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [copied, setCopied]       = useState(false);
  const [editMode, setEditMode]   = useState(false);
  const [edited, setEdited]       = useState("");
  const [saving, setSaving]           = useState(false);
  const [savedPolicy, setSavedPolicy] = useState(false);
  const [showAssign, setShowAssign]     = useState(false);
  const [assignee, setAssignee]         = useState({ name: "", email: "" });
  const [auditorVisible, setAuditorVisible] = useState(false);
  const [assigning, setAssigning]       = useState(false);
  const [assigned, setAssigned]         = useState(false);
  const abortRef  = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const content = editMode ? edited : output;

  async function generate() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOutput("");
    setEdited("");
    setEditMode(false);
    setSavedPolicy(false);
    setLoading(true);

    const filter = makeThinkFilter();

    try {
      await aiApi.streamPolicyGeneration(
        {
          control_identifier: gap.control_identifier,
          control_title: gap.control_title,
          framework_short_name: frameworkShortName,
          control_description: gap.control_description,
          gap_description: gap.gap_description,
          existing_context: assessmentContext,
        },
        (token) => {
          const filtered = filter(token);
          if (filtered) setOutput((prev) => prev + filtered);
        },
        async () => {
          setLoading(false);
          await refreshAiTokens();
        },
        ctrl.signal,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setOutput((prev) => prev + "\n\n⚠️ " + t("policy_gen.failed"));
      }
      setLoading(false);
    }
  }

  useEffect(() => {
    generate();
    return () => abortRef.current?.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (outputRef.current && !editMode) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, editMode]);

  function enterEdit() {
    setEdited(output);
    setEditMode(true);
  }

  async function copyToClipboard() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function savePolicy() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await policiesApi.create({
        title: `${gap.control_identifier} — ${gap.control_title}`,
        description: t("policy_gen.desc_gap", { framework: frameworkShortName, control: gap.control_identifier, gap: gap.gap_description }),
        category: "Compliance",
        status: "draft",
        content,
      } as never);
      setSavedPolicy(true);
    } catch {/* silent */} finally { setSaving(false); }
  }

  async function assignToControl() {
    if (!assignee.name.trim()) return;
    setAssigning(true);
    try {
      const finalContent = content.trim();
      const dateStr = new Date().toLocaleDateString(i18n.language?.startsWith("fr") ? "fr-FR" : i18n.language?.startsWith("ar") ? "ar-u-nu-latn" : "en-GB", { day: "2-digit", month: "long", year: "numeric" });

      await policiesApi.create({
        title: `${gap.control_identifier} — ${gap.control_title}`,
        description: t("policy_gen.desc_assigned", { framework: frameworkShortName, control: gap.control_identifier, name: `${assignee.name}${assignee.email ? ` (${assignee.email})` : ""}`, date: dateStr }),
        category: "Compliance",
        // Publishing needs the text approved by a second person, so the most a
        // generated policy can start as is "in review" (policies.py refuses more).
        status: auditorVisible ? "in_review" : "draft",
        linked_controls: [gap.control_id],
        content: finalContent,
      } as never);

      setAssigned(true);
      setSavedPolicy(true);
    } catch {/* silent */} finally { setAssigning(false); }
  }

  return (
    <AiGate featureLabel={t("policy_gen.feature")}>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {t("compliance.generate_policy")} — {gap.control_identifier}: {gap.control_title}
                </h2>
                <p className="text-xs text-gray-400">{frameworkShortName} · {t("policy_gen.subtitle")}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0">

            {/* Left: context + actions */}
            <div className="w-64 flex-shrink-0 border-r border-gray-100 flex flex-col overflow-y-auto">
              <div className="p-4 space-y-4 flex-1">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t("compliance.gap_identified_label")}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLOR[gap.severity] ?? "text-gray-600 bg-gray-100"}`}>
                    {t("policy_gen.severity", { severity: t(`compliance.severities.${gap.severity}`, { defaultValue: gap.severity }) })}
                  </span>
                  <p className="text-xs text-gray-700 leading-relaxed mt-2">{gap.gap_description}</p>
                </div>

                {gap.control_description && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policy_gen.control_requirement")}</p>
                    <p className="text-xs text-gray-600 leading-relaxed">{gap.control_description}</p>
                  </div>
                )}

                {gap.remediation_steps && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("policy_gen.suggested_remediation")}</p>
                    <p className="text-xs text-gray-600 leading-relaxed">{gap.remediation_steps}</p>
                  </div>
                )}
              </div>

              {/* Action buttons — only shown when generation is done */}
              {!loading && output && (
                <div className="p-4 border-t border-gray-100 space-y-2">
                  {/* Edit toggle */}
                  <button
                    onClick={() => editMode ? setEditMode(false) : enterEdit()}
                    className={`w-full flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl border transition-colors ${
                      editMode
                        ? "bg-purple-600 text-white border-purple-600"
                        : "text-gray-700 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <Pencil className="w-4 h-4" />
                    {editMode ? t("policy_gen.exit_edit") : t("policy_gen.edit")}
                  </button>

                  {/* Save as policy */}
                  <button
                    onClick={savePolicy}
                    disabled={saving || savedPolicy}
                    className="w-full flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {saving
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : savedPolicy
                        ? <CheckCircle className="w-4 h-4 text-green-500" />
                        : <Save className="w-4 h-4" />
                    }
                    {savedPolicy ? t("policy_gen.saved_to_policies") : t("policy_gen.save_draft")}
                  </button>

                  {/* Assign to controller */}
                  <button
                    onClick={() => setShowAssign(v => !v)}
                    className={`w-full flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl border transition-colors ${
                      showAssign
                        ? "bg-blue-600 text-white border-blue-600"
                        : "text-gray-700 border-gray-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700"
                    }`}
                  >
                    <UserCheck className="w-4 h-4" />
                    {t("policy_gen.assign_controller")}
                    {showAssign ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                  </button>

                  {showAssign && (
                    <div className="space-y-2 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={auditorVisible}
                          onChange={e => setAuditorVisible(e.target.checked)}
                          className="w-3.5 h-3.5 accent-blue-600"
                        />
                        <span className="text-xs text-gray-600">{t("compliance.checklist_visible_auditor")}</span>
                      </label>
                      {auditorVisible && <p className="text-[11px] text-gray-500">{t("r2.policies.auditor_visible_hint")}</p>}
                      <input
                        type="text"
                        placeholder={t("policy_gen.controller_name")}
                        value={assignee.name}
                        onChange={e => { setAssignee(p => ({ ...p, name: e.target.value })); setAssigned(false); }}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <input
                        type="email"
                        placeholder={t("policy_gen.email_optional")}
                        value={assignee.email}
                        onChange={e => setAssignee(p => ({ ...p, email: e.target.value }))}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      {assigned ? (
                        <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-2.5 py-2">
                          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          {t("policy_gen.assigned")}
                        </div>
                      ) : (
                        <button
                          onClick={assignToControl}
                          disabled={!assignee.name.trim() || assigning}
                          className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg disabled:opacity-40 transition-colors"
                        >
                          {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                          {t("policy_gen.save_assign")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: policy content */}
            <div className="flex-1 flex flex-col min-w-0">
              {editMode ? (
                <textarea
                  value={edited}
                  onChange={e => setEdited(e.target.value)}
                  className="flex-1 p-5 font-mono text-sm text-gray-800 leading-relaxed resize-none focus:outline-none border-0"
                  placeholder={t("policy_gen.edit_placeholder")}
                  spellCheck={false}
                />
              ) : (
                <div
                  ref={outputRef}
                  className="flex-1 overflow-y-auto p-5 font-mono text-sm text-gray-800 whitespace-pre-wrap leading-relaxed"
                >
                  {output || (
                    loading ? (
                      <div className="flex items-center gap-2 text-gray-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{t("policy_gen.generating")}</span>
                      </div>
                    ) : (
                      <span className="text-gray-300">{t("policy_gen.will_appear")}</span>
                    )
                  )}
                  {loading && output && (
                    <span className="inline-block w-1.5 h-4 bg-purple-500 animate-pulse ml-0.5 align-text-bottom" />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
            <p className="text-xs text-gray-400">
              {loading
                ? t("policy_gen.writing")
                : editMode
                  ? t("policy_gen.editing_hint")
                  : output
                    ? t("policy_gen.review_hint")
                    : ""}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => generate()}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t("compliance.regenerate")}
              </button>
              <button
                onClick={copyToClipboard}
                disabled={!content}
                className="flex items-center gap-1.5 text-xs text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                {copied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? t("common.copied") : t("policy_gen.copy")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AiGate>
  );
}
