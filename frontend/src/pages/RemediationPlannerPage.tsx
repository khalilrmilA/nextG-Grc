import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Loader2, RotateCcw, Copy, CheckCheck } from "lucide-react";
import { aiApi, complianceApi } from "@/api/endpoints";
import { useAiTokenRefresh } from "@/hooks/useAiTokenRefresh";
import AiGate from "@/components/features/ai/AiGate";

export default function RemediationPlannerPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const { refreshAiTokens } = useAiTokenRefresh();

  const [planText, setPlanText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [assessmentName, setAssessmentName] = useState("");
  const [frameworkName, setFrameworkName] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!assessmentId) return;
    complianceApi.getAssessment(assessmentId).then((a) => {
      setAssessmentName(a.name);
      setFrameworkName(a.framework_short_name);
    }).catch(() => {});
  }, [assessmentId]);

  const startStream = useCallback(() => {
    if (!assessmentId) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setPlanText("");
    setDone(false);
    setError("");
    setStreaming(true);

    aiApi.streamRemediationPlan(
      assessmentId,
      (token) => {
        setPlanText((prev) => prev + token);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      },
      async () => {
        setStreaming(false);
        setDone(true);
        await refreshAiTokens();
      },
      abortRef.current.signal,
    ).catch((err) => {
      if (err?.name !== "AbortError") {
        setError("Failed to generate remediation plan. Make sure Ollama is running.");
        setStreaming(false);
      }
    });
  }, [assessmentId]);

  useEffect(() => {
    startStream();
    return () => { abortRef.current?.abort(); };
  }, [startStream]);

  async function handleCopy() {
    await navigator.clipboard.writeText(planText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Render markdown-like sections — split on "##" headings for visual structure
  function renderPlan(text: string) {
    const lines = text.split("\n");
    return lines.map((line, i) => {
      if (line.startsWith("### ")) {
        return (
          <h3 key={i} className="text-base font-bold text-gray-800 mt-5 mb-2 border-b border-gray-100 pb-1">
            {line.slice(4)}
          </h3>
        );
      }
      if (line.startsWith("## ")) {
        return (
          <h2 key={i} className="text-lg font-bold text-blue-700 mt-7 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-5 bg-blue-600 rounded-full inline-block" />
            {line.slice(3)}
          </h2>
        );
      }
      if (line.startsWith("# ")) {
        return (
          <h1 key={i} className="text-xl font-bold text-gray-900 mb-4">
            {line.slice(2)}
          </h1>
        );
      }
      if (line.startsWith("- ") || line.startsWith("* ")) {
        return (
          <li key={i} className="text-sm text-gray-700 ml-4 mb-1 list-disc">
            {line.slice(2)}
          </li>
        );
      }
      if (line.match(/^\d+\. /)) {
        return (
          <li key={i} className="text-sm text-gray-700 ml-4 mb-1 list-decimal">
            {line.replace(/^\d+\. /, "")}
          </li>
        );
      }
      if (line.startsWith("**") && line.endsWith("**")) {
        return (
          <p key={i} className="text-sm font-semibold text-gray-800 mt-3 mb-1">
            {line.slice(2, -2)}
          </p>
        );
      }
      if (line.trim() === "") {
        return <div key={i} className="h-1" />;
      }
      return (
        <p key={i} className="text-sm text-gray-700 leading-relaxed mb-1">
          {line}
        </p>
      );
    });
  }

  return (
    <AiGate featureLabel="Remediation Planner">
      <div className="p-8 max-w-4xl space-y-6">
        {/* Header */}
        <div>
          <button
            onClick={() => navigate(`/compliance/assessments/${assessmentId}`)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to assessment
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-purple-500" />
                90-Day Remediation Plan
              </h1>
              {assessmentName && (
                <p className="text-sm text-gray-500 mt-1">
                  {assessmentName}
                  {frameworkName && (
                    <span className="ml-2 font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs">
                      {frameworkName}
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {done && (
                <>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {copied ? <CheckCheck className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={startStream}
                    className="flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Regenerate
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Status bar */}
        {streaming && (
          <div className="flex items-center gap-2 text-sm text-purple-700 bg-purple-50 border border-purple-100 rounded-xl px-4 py-3">
            <Loader2 className="w-4 h-4 animate-spin" />
            AI is generating your personalized 90-day remediation plan…
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
            <button onClick={startStream} className="ml-3 text-red-600 underline">Retry</button>
          </div>
        )}

        {/* Plan content */}
        {(planText || streaming) && (
          <div
            ref={scrollRef}
            className="bg-white rounded-2xl border border-gray-100 p-6 min-h-64 max-h-[calc(100vh-300px)] overflow-y-auto"
          >
            {renderPlan(planText)}
            {streaming && (
              <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5 rounded-sm" />
            )}
          </div>
        )}

        {!planText && !streaming && !error && (
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
            <Sparkles className="w-10 h-10 text-purple-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">Starting generation…</p>
          </div>
        )}
      </div>
    </AiGate>
  );
}
