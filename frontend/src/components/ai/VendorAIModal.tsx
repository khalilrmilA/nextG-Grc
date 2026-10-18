/**
 * VendorAIModal — AI-powered vendor risk assessment streamed from Ollama.
 * Accepts questionnaire responses (key→value) and streams a scored risk report.
 */
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, RefreshCw, Copy, Download, Sparkles, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { vendorsApi } from "@/api/endpoints";
import type { Vendor } from "@/types";
import { useAiTokenRefresh } from "@/hooks/useAiTokenRefresh";
import AiGate from "@/components/features/ai/AiGate";
import { safeMarkdown } from "@/lib/safeMarkdown";

interface Props {
  vendorId: string;
  vendorName: string;
  vendorIndustry?: string;
  vendorServices?: string;
  onClose: () => void;
  /** The vendor as saved after approval — its new score must show at once (follow-up C-3). */
  onApproved?: (vendor: Vendor) => void;
}

// Default questionnaire for quick AI assessment when no custom Q&A provided.
// The English question text is sent to the AI as-is; the on-screen label is
// looked up by position in QUESTION_KEYS so it follows the interface language.
const QUESTION_KEYS = ["iso27001", "soc2", "encryption", "incident_response", "pentest", "bcp_dr", "background_checks", "mfa", "vuln_mgmt", "subprocessors"];
const DEFAULT_QUESTIONNAIRE: Record<string, string> = {
  "Does the 3rd party hold ISO 27001 certification?": "N/A",
  "Does the 3rd party hold SOC 2 Type II certification?": "N/A",
  "Does the 3rd party encrypt data at rest and in transit?": "N/A",
  "Does the 3rd party have a documented incident response plan?": "N/A",
  "Does the 3rd party conduct annual penetration testing?": "N/A",
  "Does the 3rd party have a business continuity / DR plan?": "N/A",
  "Does the 3rd party perform background checks on employees?": "N/A",
  "Does the 3rd party use multi-factor authentication?": "N/A",
  "Does the 3rd party have a vulnerability management program?": "N/A",
  "Does the 3rd party maintain a list of sub-processors?": "N/A",
};

// Markdown rendering: use the shared XSS-safe helper. AI output may contain
// attacker-influenced strings (e.g. vendor names), so we never insert raw HTML.
const renderMarkdown = safeMarkdown;

// ── Questionnaire Builder ─────────────────────────────────────────────────────
function QuestionnairePanel({
  responses,
  onChange,
}: {
  readonly responses: Record<string, string>;
  readonly onChange: (q: string, a: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Values stay English (they are sent to the AI); only the labels are translated.
  const options = ["Yes", "No", "N/A"];
  const optionLabel = (o: string) => (o === "Yes" ? t("common.yes") : o === "No" ? t("common.no") : t("dashboard.na"));
  const defaultQs = Object.keys(DEFAULT_QUESTIONNAIRE);
  const questionLabel = (q: string) => {
    const i = defaultQs.indexOf(q);
    return i >= 0 ? t(`vendor_ai.questions.${QUESTION_KEYS[i]}`, { defaultValue: q }) : q;
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span>{t("vendor_ai.edit_responses", { count: Object.keys(responses).length })}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
          {Object.entries(responses).map(([q, a]) => (
            <div key={q} className="px-4 py-3 space-y-2">
              <p className="text-xs font-medium text-gray-700">{questionLabel(q)}</p>
              <div className="flex gap-3">
                {options.map(option => (
                  <label key={option} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={q}
                      value={option}
                      checked={a === option}
                      onChange={e => onChange(q, e.target.value)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span className="text-xs text-gray-600">{optionLabel(option)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function VendorAIModal({ vendorId, vendorName, vendorIndustry, vendorServices, onClose, onApproved }: Readonly<Props>) {
  const { t } = useTranslation();
  const { refreshAiTokens } = useAiTokenRefresh();
  const [responses, setResponses] = useState<Record<string, string>>(DEFAULT_QUESTIONNAIRE);
  const [output, setOutput]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);
  const [started, setStarted]     = useState(false);
  const [error, setError]         = useState("");
  const [approving, setApproving] = useState(false);
  const [approved, setApproved]   = useState(false);
  const abortRef  = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Load saved analysis when modal opens
  useEffect(() => {
    async function loadSavedAnalysis() {
      try {
        const vendor = await vendorsApi.get(vendorId);
        if (vendor.description) {
          setOutput(vendor.description);
          setDone(true);
          setStarted(true);
        }
      } catch (err) {
        // Vendor not found or no saved analysis - that's fine
        if (err instanceof Error) {
          console.debug("Could not load saved analysis:", err.message);
        }
      }
    }
    loadSavedAnalysis();
  }, [vendorId]);

  useEffect(() => {
    if (loading || output) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output, loading]);

  function handleResponseChange(q: string, a: string) {
    setResponses(prev => ({ ...prev, [q]: a }));
  }

  function analyze() {
    setOutput("");
    setError("");
    setDone(false);
    setLoading(true);
    setStarted(true);
    abortRef.current = new AbortController();

    vendorsApi.analyzeStream({
      vendorId,
      questionnaireResponses: responses,
      onChunk: (token) => setOutput(prev => prev + token),
      onDone: async () => {
        setLoading(false);
        setDone(true);
        await refreshAiTokens();
      },
      signal: abortRef.current.signal,
    });
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(output);
  }

  function downloadMd() {
    const blob = new Blob([output], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${vendorName.replace(/\s+/g, "_")}_vendor_risk.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function approveAnalysis() {
    // Extract risk score from output (looks for "Score: X/10")
    const scoreMatch = output.match(/Score:\s*(\d+)\/10/);
    const riskScore = scoreMatch ? Number.parseInt(scoreMatch[1], 10) : 5;

    setApproving(true);
    try {
      const result = await vendorsApi.approveAnalysis(vendorId, riskScore, output);
      onApproved?.(result);
      setApproved(true);
      setError("");
      // Close modal after 2 seconds
      setTimeout(() => onClose(), 2000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(t("vendor_ai.approve_failed", { error: errorMsg }));
      console.error("Approval error:", err);
    } finally {
      setApproving(false);
    }
  }

  return (
    <AiGate featureLabel={t("vendor_ai.feature_label")}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 text-sm">{t("vendor_ai.title")}</h2>
                <p className="text-xs text-gray-400">{vendorName}{vendorIndustry ? ` · ${vendorIndustry}` : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {loading && (
                <button type="button" onClick={() => { abortRef.current?.abort(); setLoading(false); }}
                  className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                  {t("policies.ai_stop")}
                </button>
              )}
              {done && !approved && (
                <>
                  <button type="button" onClick={analyze}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                    <RefreshCw className="w-3 h-3" /> {t("ai.regenerate")}
                  </button>
                  <button type="button" onClick={copyToClipboard}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                    <Copy className="w-3 h-3" /> {t("ai.copy")}
                  </button>
                  <button type="button" onClick={downloadMd}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                    <Download className="w-3 h-3" /> {t("vendor_ai.download_md")}
                  </button>
                  <button type="button" onClick={approveAnalysis} disabled={approving}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors">
                    {approving ? t("vendor_ai.approving") : `✓ ${t("vendor_ai.approve_save")}`}
                  </button>
                </>
              )}
              {approved && (
                <div className="flex items-center gap-2 text-xs text-green-600 font-medium">
                  ✓ {t("vendor_ai.approved")}
                </div>
              )}
              <button type="button" onClick={onClose}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Pre-analysis — questionnaire + launch */}
          {!started && (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <p className="text-sm text-gray-600">
                {t("vendor_ai.intro")}
              </p>
              {vendorServices && (
                <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-600">
                  <span className="font-semibold text-gray-700">{t("vendor_ai.services")} </span>{vendorServices}
                </div>
              )}
              <QuestionnairePanel responses={responses} onChange={handleResponseChange} />
              <button
                type="button"
                onClick={analyze}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-medium transition-all shadow-sm"
              >
                <Sparkles className="w-4 h-4" />
                {t("vendor_ai.run")}
              </button>
            </div>
          )}

          {/* Streaming output */}
          {started && (
            <>
              <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
                <span><strong className="text-gray-700">{t("vendor_ai.third_party")}</strong> {vendorName}</span>
                {loading && <span className="ml-auto animate-pulse text-emerald-500">{t("vendor_ai.analyzing")}</span>}
                {done    && <span className="ml-auto text-green-600 font-medium flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> {t("vendor_ai.complete")}</span>}
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
                {!output && loading && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                    <div className="flex gap-1">
                      {[0,1,2].map(i => (
                        <span key={i} className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                    <p className="text-sm">{t("vendor_ai.analyzing_posture")}</p>
                  </div>
                )}
                {output && (
                  <div
                    className="prose-sm max-w-none text-gray-700 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(output) }}
                  />
                )}
                <div ref={bottomRef} />
              </div>
            </>
          )}
        </div>
      </div>
    </AiGate>
  );
}
