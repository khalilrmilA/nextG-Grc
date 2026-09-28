import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft, FileText, RefreshCw, Copy, Download, Loader2, CheckCircle,
  Send, ShieldCheck, XCircle, Share2, Sparkles, X, Table2, History,
} from "lucide-react";
import { auditorPortalApi, auditsApi, dataApi, reportBuilderApi } from "@/api/endpoints";
import { useAuthStore, hasAnyRole } from "@/store/auth";
import FileHistoryModal from "@/components/features/compliance/FileHistoryModal";
import type { Audit, AuditReportDistribution } from "@/types";

/** Display locale for dates: Latin digits in Arabic, French day-month order in French. */
const dateLocale = (lang: string) => (lang?.startsWith("fr") ? "fr-FR" : lang?.startsWith("ar") ? "ar-u-nu-latn" : "en-US");


// Who may do what to the deliverable. Mirrors backend/app/api/v1/endpoints/audits.py:
// AUDIT_WRITE_ROLES produce and submit it, AUDIT_MANAGE_ROLES validate and release
// it — and the backend additionally refuses an approval by the person who produced it.
const MANAGE_ROLES = ["tenant_admin", "super_admin", "ciso", "compliance_manager"];
const WRITE_ROLES  = [...MANAGE_ROLES, "auditor"];

const REPORT_STATUS_CLS: Record<string, string> = {
  draft:       "bg-gray-100 text-gray-600",
  submitted:   "bg-blue-100 text-blue-700",
  approved:    "bg-green-100 text-green-700",
  rejected:    "bg-red-100 text-red-700",
  issued:      "bg-emerald-100 text-emerald-700",
  distributed: "bg-emerald-100 text-emerald-700",
};

/** The HTTP status behind a rejected api call. 403 on an approval is the
 *  separation-of-duties refusal, not a fault — it deserves its own sentence. */
function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | undefined)?.response?.status;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default function AuditReportPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { auditId, assessmentId } = useParams<{ auditId?: string; assessmentId?: string }>();
  const user = useAuthStore((u) => u);

  const canWrite  = hasAnyRole(user, WRITE_ROLES);
  const canManage = hasAnyRole(user, MANAGE_ROLES);

  // ── The engagement deliverable (report workflow) ───────────────────────────
  const [audit, setAudit] = useState<Audit | null>(null);
  const [distributions, setDistributions] = useState<AuditReportDistribution[]>([]);
  const [loading, setLoading] = useState(!!auditId);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showDistribute, setShowDistribute] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [distributeNote, setDistributeNote] = useState("");

  // ── The AI narrative (per assessment) ─────────────────────────────────────
  const [report, setReport] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const narrativeAssessmentId = assessmentId ?? audit?.assessment_id ?? null;

  const loadAudit = useCallback(async () => {
    if (!auditId) return;
    setLoading(true);
    setActionError("");
    const [a, d] = await Promise.allSettled([
      auditsApi.get(auditId),
      auditsApi.listReportDistributions(auditId),
    ]);
    if (a.status === "fulfilled") setAudit(a.value);
    else setActionError(t("audit_detail.error_load_failed"));
    if (d.status === "fulfilled") setDistributions(Array.isArray(d.value) ? d.value : []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  useEffect(() => { loadAudit(); }, [loadAudit]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const reportStatus = (audit?.report_status ?? "draft") as string;

  function fmt(value?: string | null) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString(dateLocale(i18n.language));
  }

  // `separationOfDuties` marks the one action whose 403 means "you produced this
  // document, so you may not validate it". On every other action a 403 is a plain
  // permission refusal and must not be reported as a self-approval block.
  async function run(
    key: string,
    fn: () => Promise<unknown>,
    options?: { separationOfDuties?: boolean },
  ) {
    setBusy(key);
    setActionError("");
    setNotice("");
    try {
      await fn();
      setNotice(t("common.success"));
      window.setTimeout(() => setNotice(""), 4000);
      await loadAudit();
    } catch (e) {
      const status = httpStatus(e);
      if (status === 403) {
        setActionError(options?.separationOfDuties
          ? t("audit_report.blocked_self_approval")
          : t("errors.unauthorized"));
      } else {
        setActionError(t("audit_report.error_action_failed"));
      }
    } finally {
      setBusy("");
    }
  }

  async function downloadPdf() {
    if (!auditId || !audit) return;
    setBusy("download");
    setActionError("");
    try {
      const blob = await auditsApi.downloadReport(auditId);
      saveBlob(blob, `${audit.title.replace(/[^\w\s-]/g, "_")}_report.pdf`);
    } catch (e) {
      // 403 is the diffusion gate ("not approved yet"); anything else is a
      // genuine failure and must not be dressed up as a policy refusal.
      setActionError(httpStatus(e) === 403
        ? t("audit_report.blocked_not_approved")
        : t("audit_report.error_action_failed"));
    } finally {
      setBusy("");
    }
  }

  async function downloadFindings() {
    if (!auditId) return;
    setBusy("findings");
    setActionError("");
    try {
      if (canManage) {
        const blob = await reportBuilderApi.exportFile("audit_findings", "xlsx", {
          filters: { audit_id: auditId },
        });
        saveBlob(blob, `audit-findings-${auditId}.xlsx`);
      } else {
        await dataApi.exportAuditFindings("csv", auditId);
      }
    } catch {
      setActionError(t("audit_report.error_action_failed"));
    } finally {
      setBusy("");
    }
  }

  async function submitDistribution() {
    if (!auditId) return;
    const list = recipients.split(/[,;\n]/).map((r) => r.trim()).filter(Boolean);
    if (list.length === 0) { setActionError(t("audit_report.recipients_required")); return; }
    setBusy("distribute");
    setActionError("");
    try {
      await auditsApi.distributeReport(auditId, { recipients: list, channel: "email", note: distributeNote.trim() || null });
      setShowDistribute(false);
      setRecipients("");
      setDistributeNote("");
      await loadAudit();
      const d = await auditsApi.listReportDistributions(auditId);
      setDistributions(Array.isArray(d) ? d : []);
    } catch {
      setActionError(t("audit_report.error_action_failed"));
    } finally {
      setBusy("");
    }
  }

  async function submitRejection() {
    if (!auditId) return;
    const reason = rejectReason.trim();
    if (!reason) { setActionError(t("audit_report.reject_reason_required")); return; }
    setBusy("reject");
    setActionError("");
    try {
      await auditsApi.rejectReport(auditId, reason);
      setShowReject(false);
      setRejectReason("");
      await loadAudit();
    } catch {
      setActionError(t("audit_report.error_action_failed"));
    } finally {
      setBusy("");
    }
  }

  const generateNarrative = useCallback(() => {
    if (!narrativeAssessmentId) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setReport("");
    setError("");
    setStreaming(true);
    auditorPortalApi
      .generateReport(
        narrativeAssessmentId,
        (token) => setReport((prev) => prev + token),
        () => setStreaming(false),
        abortRef.current.signal,
      )
      .catch((err: unknown) => {
        if ((err as Error).name !== "AbortError") setError(t("audit_report.error_generate_failed"));
        setStreaming(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrativeAssessmentId]);

  function handleCopy() {
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => setError(t("audit_report.error_action_failed")));
  }

  function handleDownloadMarkdown() {
    saveBlob(new Blob([report], { type: "text/markdown" }), `audit-report-${narrativeAssessmentId ?? auditId}.md`);
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const backTo = auditId ? `/auditor/portal/audits/${auditId}` : `/auditor/portal/${assessmentId ?? ""}`;

  return (
    <>
      {showHistory && auditId && (
        <FileHistoryModal
          parentType="audit"
          parentId={auditId}
          title={audit?.title ?? t("audit_report.title")}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Reject modal */}
      {showReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowReject(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("audit_report.reject")}</h2>
              <button type="button" onClick={() => setShowReject(false)} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_report.reject_reason")}</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder={t("audit_report.reject_reason_placeholder")}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setShowReject(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-xl">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={submitRejection}
                disabled={busy === "reject"}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-xl"
              >
                {busy === "reject" && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("audit_report.reject")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Distribute modal */}
      {showDistribute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDistribute(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("audit_report.distribute")}</h2>
              <button type="button" onClick={() => setShowDistribute(false)} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_report.recipients")}</label>
            <textarea
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              rows={3}
              placeholder={t("audit_report.recipients_placeholder")}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label className="block text-sm font-medium text-gray-700 mb-1 mt-4">{t("common.notes")}</label>
            <textarea
              value={distributeNote}
              onChange={(e) => setDistributeNote(e.target.value)}
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setShowDistribute(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-xl">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={submitDistribution}
                disabled={busy === "distribute"}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl"
              >
                {busy === "distribute" && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("audit_report.distribute")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-8 max-w-7xl space-y-6">
        {/* Header */}
        <div>
          <button
            type="button"
            onClick={() => navigate(backTo)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            {t("audits.checklist")}
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{audit?.title ?? t("audit_report.title")}</h1>
                <p className="text-sm text-gray-500 mt-0.5">{t("audit_report.subtitle")}</p>
              </div>
            </div>
            {auditId && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REPORT_STATUS_CLS[reportStatus] ?? REPORT_STATUS_CLS.draft}`}>
                {t("audit_report.status")}: {t(`audit_report.statuses.${reportStatus}`, reportStatus)}
              </span>
            )}
          </div>
        </div>

        {actionError && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{actionError}</div>}
        {notice && <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">{notice}</div>}

        {/* ── The deliverable: generate → submit → approve/reject → distribute ── */}
        {auditId && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-gray-700">{t("audit_report.title")}</h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canWrite && (
                <button
                  type="button"
                  onClick={() => run("generate", () => auditsApi.generateReport(auditId))}
                  disabled={busy === "generate"}
                  className="inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-3.5 py-1.5 rounded-lg transition-colors"
                >
                  {busy === "generate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {audit?.report_url ? t("audit_report.regenerate") : t("audit_report.generate")}
                </button>
              )}

              <button
                type="button"
                onClick={downloadPdf}
                disabled={!audit?.report_url || busy === "download"}
                className="inline-flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-600 px-3.5 py-1.5 rounded-lg transition-colors"
              >
                {busy === "download" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {t("audit_report.download_pdf")}
              </button>

              <button
                type="button"
                onClick={downloadFindings}
                disabled={busy === "findings"}
                className="inline-flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-600 px-3.5 py-1.5 rounded-lg transition-colors"
              >
                {busy === "findings" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Table2 className="w-4 h-4" />}
                {canManage ? t("audit_report.download_excel") : t("common.export")}
              </button>

              <button
                type="button"
                onClick={() => setShowHistory(true)}
                className="inline-flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3.5 py-1.5 rounded-lg transition-colors"
              >
                <History className="w-4 h-4" />
                {t("policies.tab_history")}
              </button>

              {canWrite && (
                <button
                  type="button"
                  onClick={() => run("submit", () => auditsApi.submitReport(auditId))}
                  disabled={!audit?.report_url || busy === "submit" || !["draft", "rejected"].includes(reportStatus)}
                  className="inline-flex items-center gap-1.5 text-sm border border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 px-3.5 py-1.5 rounded-lg transition-colors"
                >
                  {busy === "submit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {t("audit_report.submit")}
                </button>
              )}

              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => run("approve", () => auditsApi.approveReport(auditId), { separationOfDuties: true })}
                    disabled={busy === "approve" || reportStatus !== "submitted"}
                    className="inline-flex items-center gap-1.5 text-sm border border-green-200 bg-green-50 hover:bg-green-100 disabled:opacity-50 text-green-700 px-3.5 py-1.5 rounded-lg transition-colors"
                  >
                    {busy === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    {t("audit_report.approve")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowReject(true)}
                    disabled={reportStatus !== "submitted"}
                    className="inline-flex items-center gap-1.5 text-sm border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-700 px-3.5 py-1.5 rounded-lg transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    {t("audit_report.reject")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDistribute(true)}
                    disabled={!["approved", "issued"].includes(reportStatus)}
                    className="inline-flex items-center gap-1.5 text-sm border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-700 px-3.5 py-1.5 rounded-lg transition-colors"
                  >
                    <Share2 className="w-4 h-4" />
                    {t("audit_report.distribute")}
                  </button>
                </>
              )}
            </div>

            {!canManage && (
              <p className="text-xs text-gray-400">{t("audit_report.blocked_not_approved")}</p>
            )}

            {/* Lifecycle facts */}
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <dt className="text-gray-400">{t("audit_report.statuses.submitted")}</dt>
                <dd className="text-gray-700 font-medium mt-0.5">{fmt(audit?.report_submitted_at)}</dd>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <dt className="text-gray-400">{t("audit_report.statuses.approved")}</dt>
                <dd className="text-gray-700 font-medium mt-0.5">{fmt(audit?.report_approved_at)}</dd>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <dt className="text-gray-400">{t("audit_report.statuses.issued")}</dt>
                <dd className="text-gray-700 font-medium mt-0.5">{fmt(audit?.report_issued_at)}</dd>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <dt className="text-gray-400">{t("audits.findings")}</dt>
                <dd className="text-gray-700 font-medium mt-0.5">{audit?.finding_count ?? 0}</dd>
              </div>
            </dl>

            {reportStatus === "rejected" && audit?.report_rejected_reason && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                <span className="font-semibold">{t("audit_report.rejected_reason_label")}: </span>
                {audit.report_rejected_reason}
              </div>
            )}
          </div>
        )}

        {/* ── Release history ── */}
        {auditId && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-500" />
              <h2 className="text-sm font-semibold text-gray-700">{t("audit_report.distributions_title")}</h2>
              <span className="text-xs text-gray-400">{distributions.length}</span>
            </div>
            {distributions.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">{t("audit_report.no_distributions")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400">
                      <th className="text-start font-medium px-5 py-2">{t("audit_report.distribution_recipient")}</th>
                      <th className="text-start font-medium px-5 py-2">{t("audit_report.distribution_channel")}</th>
                      <th className="text-start font-medium px-5 py-2">{t("frameworks.version")}</th>
                      <th className="text-start font-medium px-5 py-2">{t("audit_report.distribution_sent_at")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {distributions.map((d) => (
                      <tr key={d.id}>
                        <td className="px-5 py-2.5 text-gray-800">{d.recipients}</td>
                        <td className="px-5 py-2.5 text-gray-500">{d.channel}</td>
                        <td className="px-5 py-2.5 text-gray-500">{d.report_version}</td>
                        <td className="px-5 py-2.5 text-gray-500">{fmt(d.distributed_at ?? d.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── AI narrative ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <h2 className="text-sm font-semibold text-gray-700">{t("audit_report.section_summary")}</h2>
            </div>
            <div className="flex items-center gap-2">
              {report && (
                <>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {copied
                      ? <><CheckCircle className="w-4 h-4 text-green-500" /> {t("common.success")}</>
                      : <><Copy className="w-4 h-4" /> {t("audits.copy_report")}</>}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadMarkdown}
                    className="flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    {t("audits.download_report")}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={generateNarrative}
                disabled={streaming || !narrativeAssessmentId}
                className="flex items-center gap-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                {streaming
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("audits.generating_report")}</>
                  : report
                    ? <><RefreshCw className="w-4 h-4" /> {t("audits.regenerate_report")}</>
                    : <><Sparkles className="w-4 h-4" /> {t("audits.generate_report")}</>}
              </button>
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

          {!narrativeAssessmentId && (
            <p className="text-xs text-gray-400">{t("audit_detail.plan_needs_framework")}</p>
          )}

          {!report && !streaming && !error && (
            <div className="border border-dashed border-gray-200 rounded-2xl p-12 text-center">
              <FileText className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              <p className="text-sm font-medium text-gray-500">{t("audit_report.empty_title")}</p>
              <p className="text-xs text-gray-400 mt-1">{t("audit_report.empty_hint")}</p>
            </div>
          )}

          {(report || streaming) && (
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
              {streaming && (
                <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-100 bg-blue-50/50 text-xs text-blue-600">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t("audits.generating_report")}
                </div>
              )}
              <div className="px-8 py-6 prose prose-sm max-w-none text-gray-800">
                <ReportMarkdown content={report} />
                {streaming && <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ms-0.5 align-text-bottom" />}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** Minimal markdown renderer for the report (headings, bold, lists, rules). */
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
        <li key={i} className="text-sm text-gray-700 ms-4 list-disc">
          <InlineMarkdown text={line.replace(/^[-*] /, "")} />
        </li>,
      );
    } else if (/^\d+\. /.test(line)) {
      elements.push(
        <li key={i} className="text-sm text-gray-700 ms-4 list-decimal">
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
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
        }
        return part;
      })}
    </>
  );
}
