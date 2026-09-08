/**
 * AuditPlanModal — the audit programme for ONE engagement.
 *
 * What changed for objectif 4 (« planifier selon le périmètre défini ») :
 *   * the programme is built against the engagement's REAL framework and its
 *     real controls (fetched from /frameworks/{id}/controls) instead of a canned
 *     ISO 27001 list — and when no framework is set the modal says so rather
 *     than silently substituting one;
 *   * the perimeter (processes, entities, systems) is passed into the request,
 *     folded into audit_scope, which is the field the prompt actually reads;
 *   * the result is PERSISTED — POST /audits/{id}/plan — instead of being
 *     thrown away when the modal closes.
 */
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, RefreshCw, Copy, Download, Sparkles, FileText, Save, Loader2, AlertTriangle } from "lucide-react";
import { aiApi, auditsApi, frameworksApi } from "@/api/endpoints";
import { useAiTokenRefresh } from "@/hooks/useAiTokenRefresh";
import AiGate from "@/components/features/ai/AiGate";
import { safeMarkdown } from "@/lib/safeMarkdown";

export interface AuditPlanPerimeter {
  readonly processes?: string[];
  readonly entities?: string[];
  readonly systems?: string[];
}

interface Props {
  readonly auditTitle: string;
  readonly frameworkName: string;
  readonly frameworkShortName: string;
  readonly auditScope?: string;
  readonly auditObjective?: string;
  readonly auditType?: string;
  /** Resolved framework id — the modal loads its controls from it. */
  readonly frameworkId?: string | null;
  /** Named perimeter members, already resolved to labels by the caller. */
  readonly perimeter?: AuditPlanPerimeter;
  readonly controls?: Array<{ control_id: string; title: string; category: string }>;
  /** When given, the generated programme can be saved onto the engagement. */
  readonly auditId?: string;
  readonly onSaved?: (plan: string) => void;
  readonly onClose: () => void;
}

/** aiApi.streamAuditPlan is typed to the original fields; the endpoint also
 *  accepts audit_type. Declared as an intersection so nothing is dropped. */
type AuditPlanRequest = Parameters<typeof aiApi.streamAuditPlan>[0] & {
  audit_type?: string;
};

const renderMarkdown = safeMarkdown;

export default function AuditPlanModal({
  auditTitle, frameworkName, frameworkShortName,
  auditScope, auditObjective, auditType, frameworkId, perimeter,
  controls, auditId, onSaved, onClose,
}: Props) {
  const { t } = useTranslation();
  const { refreshAiTokens } = useAiTokenRefresh();
  const [output, setOutput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState("");
  const [resolved, setResolved] = useState<Array<{ control_id: string; title: string; category: string }>>(controls ?? []);
  const [preparing, setPreparing] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Perimeter, spelled out for the prompt ────────────────────────────────
  const perimeterLines: string[] = [];
  if (perimeter?.processes?.length) {
    perimeterLines.push(`${t("audit_detail.perimeter_processes")}: ${perimeter.processes.join(", ")}`);
  }
  if (perimeter?.entities?.length) {
    perimeterLines.push(`${t("audit_detail.perimeter_entities")}: ${perimeter.entities.join(", ")}`);
  }
  if (perimeter?.systems?.length) {
    perimeterLines.push(`${t("audit_detail.perimeter_systems")}: ${perimeter.systems.join(", ")}`);
  }
  const scopeForPrompt = [auditScope?.trim(), ...perimeterLines].filter(Boolean).join(" — ");

  // ── Resolve the engagement's own controls ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      if (controls?.length) {
        setResolved(controls);
        setPreparing(false);
        return;
      }
      if (!frameworkId) {
        setResolved([]);
        setPreparing(false);
        return;
      }
      try {
        const list = await frameworksApi.getControls(frameworkId);
        if (cancelled) return;
        setResolved(
          list.slice(0, 60).map((c) => ({
            control_id: c.control_id,
            title: c.title,
            category: c.category ?? "",
          })),
        );
      } catch {
        if (!cancelled) setResolved([]);
      } finally {
        if (!cancelled) setPreparing(false);
      }
    }
    prepare();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameworkId]);

  // Generate as soon as we have something real to generate against. No silent
  // fallback framework: an empty control set is reported, not papered over.
  useEffect(() => {
    if (preparing) return;
    if (resolved.length > 0 && !output && !loading && !done) generate();
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparing, resolved.length]);

  useEffect(() => {
    if (loading) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output, loading]);

  function generate() {
    if (resolved.length === 0) return;
    setOutput("");
    setDone(false);
    setSaved(false);
    setError("");
    setLoading(true);
    abortRef.current = new AbortController();
    const request: AuditPlanRequest = {
      framework_name: frameworkName,
      framework_short_name: frameworkShortName,
      audit_title: auditTitle,
      audit_scope: scopeForPrompt || undefined,
      audit_objective: auditObjective,
      audit_type: auditType,
      controls: resolved,
    };
    aiApi.streamAuditPlan(
      request,
      (token) => setOutput((prev) => prev + token),
      async () => {
        setLoading(false);
        setDone(true);
        await refreshAiTokens();
      },
      abortRef.current.signal,
    ).catch(() => {
      setLoading(false);
      // A deliberate Stop aborts the stream; that is not a failure to report.
      if (abortRef.current?.signal.aborted) return;
      setError(t("audit_report.error_generate_failed"));
    });
  }

  async function savePlan() {
    if (!auditId || !output.trim()) return;
    setSaving(true);
    setError("");
    try {
      await auditsApi.savePlan(auditId, output);
      setSaved(true);
      onSaved?.(output);
    } catch {
      setError(t("audit_detail.error_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(output);
  }

  function downloadMd() {
    const blob = new Blob([output], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${auditTitle.replace(/\s+/g, "_")}_audit_plan.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const noFramework = !preparing && resolved.length === 0;

  return (
    <AiGate featureLabel={t("audit_detail.plan_title")}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 text-sm">{t("audit_detail.plan_title")}</h2>
                <p className="text-xs text-gray-400">
                  {frameworkName || t("audit_detail.select_framework")}
                  {resolved.length > 0 && ` · ${t("framework_editor.controls_count", { count: resolved.length })}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {loading && (
                <button type="button" onClick={() => { abortRef.current?.abort(); setLoading(false); }}
                  className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                  {t("policies.ai_stop")}
                </button>
              )}
              {done && (
                <>
                  <button type="button" onClick={generate}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                    <RefreshCw className="w-3 h-3" /> {t("audit_detail.plan_regenerate")}
                  </button>
                  <button type="button" onClick={copyToClipboard}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                    <Copy className="w-3 h-3" /> {t("audits.copy_report")}
                  </button>
                  <button type="button" onClick={downloadMd}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                    <Download className="w-3 h-3" /> {t("audits.download_report")}
                  </button>
                  {auditId && (
                    <button type="button" onClick={savePlan} disabled={saving || saved}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      {saved ? t("audit_detail.plan_saved") : t("audit_detail.plan_save")}
                    </button>
                  )}
                </>
              )}
              <button type="button" onClick={onClose} title={t("common.close")}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Context bar */}
          <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-500 flex-shrink-0 flex-wrap">
            <span><strong className="text-gray-700">{t("audits.title_label")}:</strong> {auditTitle}</span>
            {scopeForPrompt && <span><strong className="text-gray-700">{t("audits.scope")}:</strong> {scopeForPrompt}</span>}
            {loading && <span className="ms-auto animate-pulse text-indigo-500">{t("audit_detail.plan_generating")}</span>}
            {done && (
              <span className="ms-auto text-green-600 font-medium flex items-center gap-1">
                <FileText className="w-3 h-3" /> {t("common.success")}
              </span>
            )}
          </div>

          {/* Output */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {error && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            {noFramework && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <AlertTriangle className="w-8 h-8 text-amber-400" />
                <p className="text-sm font-semibold text-gray-600">{t("audit_detail.plan_needs_framework")}</p>
                <p className="text-xs text-gray-400 max-w-sm">{t("audit_detail.plan_hint")}</p>
              </div>
            )}
            {!output && (loading || preparing) && !noFramework && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <p className="text-sm">{t("audit_detail.plan_generating")}</p>
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
        </div>
      </div>
    </AiGate>
  );
}
