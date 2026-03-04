import { useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, RefreshCw, Copy, Download, Loader2, CheckCircle } from "lucide-react";
import { auditorPortalApi } from "@/api/endpoints";

export default function AuditReportPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(() => {
    if (!assessmentId) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setReport("");
    setError("");
    setStreaming(true);

    auditorPortalApi
      .generateReport(
        assessmentId,
        (token) => setReport((prev) => prev + token),
        () => setStreaming(false),
        abortRef.current.signal,
      )
      .catch((err: unknown) => {
        if ((err as Error).name !== "AbortError") {
          setError("Failed to generate report. Please try again.");
        }
        setStreaming(false);
      });
  }, [assessmentId]);

  function handleCopy() {
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-report-${assessmentId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8 max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate(`/auditor-portal/${assessmentId}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to checklist
        </button>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Audit Report</h1>
              <p className="text-sm text-gray-500 mt-0.5">AI-generated formal audit report</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {report && (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {copied ? (
                    <><CheckCircle className="w-4 h-4 text-green-500" /> Copied</>
                  ) : (
                    <><Copy className="w-4 h-4" /> Copy</>
                  )}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download .md
                </button>
              </>
            )}
            <button
              onClick={generate}
              disabled={streaming}
              className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              {streaming ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
              ) : report ? (
                <><RefreshCw className="w-4 h-4" /> Regenerate</>
              ) : (
                <>✨ Generate Report</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!report && !streaming && !error && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <FileText className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Click <strong>Generate Report</strong> to create an AI-written formal audit report based on your recorded verdicts.</p>
        </div>
      )}

      {/* Report output */}
      {(report || streaming) && (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          {streaming && (
            <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-100 bg-blue-50/50 text-xs text-blue-600">
              <Loader2 className="w-3 h-3 animate-spin" />
              Generating report…
            </div>
          )}
          <div className="px-8 py-6 prose prose-sm max-w-none text-gray-800">
            <ReportMarkdown content={report} />
            {streaming && <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />}
          </div>
        </div>
      )}
    </div>
  );
}

/** Minimal markdown renderer for the report (headings, bold, lists, horizontal rules). */
function ReportMarkdown({ content }: { readonly content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="text-lg font-bold text-gray-900 mt-6 mb-2 border-b border-gray-100 pb-1">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="text-base font-semibold text-gray-800 mt-4 mb-1">{line.slice(4)}</h3>);
    } else if (line.startsWith("#### ")) {
      elements.push(<h4 key={i} className="text-sm font-semibold text-gray-700 mt-3 mb-1">{line.slice(5)}</h4>);
    } else if (line.startsWith("---")) {
      elements.push(<hr key={i} className="my-4 border-gray-200" />);
    } else if (/^[-*] /.test(line)) {
      elements.push(
        <li key={i} className="text-sm text-gray-700 ml-4 list-disc">
          <InlineMarkdown text={line.replace(/^[-*] /, "")} />
        </li>,
      );
    } else if (/^\d+\. /.test(line)) {
      elements.push(
        <li key={i} className="text-sm text-gray-700 ml-4 list-decimal">
          <InlineMarkdown text={line.replace(/^\d+\. /, "")} />
        </li>,
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(
        <p key={i} className="text-sm text-gray-700 leading-relaxed">
          <InlineMarkdown text={line} />
        </p>,
      );
    }
  });

  return <>{elements}</>;
}

function InlineMarkdown({ text }: { readonly text: string }) {
  // Handle **bold** and `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
        }
        return part;
      })}
    </>
  );
}
