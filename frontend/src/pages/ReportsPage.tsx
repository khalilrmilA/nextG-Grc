/**
 * ReportsPage — Generate and download weekly PDF reports for the GRC platform.
 * Shows available report types with descriptions and download buttons.
 */
import { useState, useEffect } from "react";
import { FileText, Download, LayoutDashboard, AlertTriangle, CheckSquare, Building2, ClipboardList, Loader2, Calendar, RefreshCw, Eye, Plus, Play, Trash2, X, History, ShieldCheck, ShieldAlert, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { reportsApi, reportSchedulesApi, complianceApi } from "@/api/endpoints";
import type { StoredFileVersionItem } from "@/types";
import { useAuthStore } from "@/store/auth";
import FileHistoryModal from "@/components/features/compliance/FileHistoryModal";

interface ReportType {
  id: string;
  name: string;
  description: string;
  icon: string;
}

const ICON_MAP: Record<string, typeof LayoutDashboard> = {
  layout: LayoutDashboard,
  "alert-triangle": AlertTriangle,
  "check-square": CheckSquare,
  building: Building2,
  "clipboard-list": ClipboardList,
};

const COLOR_MAP: Record<string, { bg: string; icon: string; border: string }> = {
  executive: { bg: "bg-blue-50", icon: "text-blue-600", border: "border-blue-100" },
  risk: { bg: "bg-red-50", icon: "text-red-600", border: "border-red-100" },
  compliance: { bg: "bg-green-50", icon: "text-green-600", border: "border-green-100" },
  vendor: { bg: "bg-purple-50", icon: "text-purple-600", border: "border-purple-100" },
  audit: { bg: "bg-amber-50", icon: "text-amber-600", border: "border-amber-100" },
};

const FREQUENCIES = ["daily", "weekly", "monthly"];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]; // Monday=0 .. Sunday=6 (matches datetime.weekday())

const EMPTY_SCHEDULE_FORM = {
  name: "",
  report_type: "executive",
  frequency: "weekly",
  hour: 7,
  day_of_week: 0,
  day_of_month: 1,
  recipients: "",
  enabled: true,
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * « Archivage des rapports dans l\'historique » — every report the platform
 * produces is now written as a StoredFileVersion, keyed on parent_type
 * `report:<type>` and the tenant, with the sha256 of the bytes that were served.
 * That is the same ledger the evidence files use, so the history is read with
 * the same endpoint and shown with the same modal.
 */
const REPORT_PARENT_PREFIX = "report:";

type ArchivedReportRow = StoredFileVersionItem & { reportType: string };


export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const [reportTypes, setReportTypes] = useState<ReportType[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [apiError, setApiError] = useState(false);

  const tenantId = useAuthStore((u) => u?.tenant_id);
  const [history, setHistory] = useState<ArchivedReportRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyDenied, setHistoryDenied] = useState(false);
  const [historyFor, setHistoryFor] = useState<{ parentType: string; title: string } | null>(null);

  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [schedulesLocked, setSchedulesLocked] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(EMPTY_SCHEDULE_FORM);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  function getDefaultReportTypes(): ReportType[] {
    return [
      { id: "executive", name: t("reports.executive_name"), description: t("reports.executive_desc"), icon: "layout" },
      { id: "risk", name: t("reports.risk_name"), description: t("reports.risk_desc"), icon: "alert-triangle" },
      { id: "compliance", name: t("reports.compliance_name"), description: t("reports.compliance_desc"), icon: "check-square" },
      { id: "vendor", name: t("reports.vendor_name"), description: t("reports.vendor_desc"), icon: "building" },
      { id: "audit", name: t("reports.audit_name"), description: t("reports.audit_desc"), icon: "clipboard-list" },
    ];
  }

  async function loadReportTypes() {
    try {
      setLoading(true);
      setApiError(false);
      const data = await reportsApi.listTypes();
      if (data?.types && data.types.length > 0) {
        setReportTypes(data.types);
      } else {
        setReportTypes(getDefaultReportTypes());
        setApiError(true);
      }
    } catch (err) {
      console.error("Failed to load report types:", err);
      setReportTypes(getDefaultReportTypes());
      setApiError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReportTypes();
    loadSchedules();
  }, []);

  // The archive is read per report type, because versions are numbered per
  // (parent_type, tenant) — one series per type rather than one global one.
  useEffect(() => {
    let cancelled = false;
    if (!tenantId || reportTypes.length === 0) {
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    Promise.allSettled(
      reportTypes.map((r) => complianceApi.listFileVersions(`${REPORT_PARENT_PREFIX}${r.id}`, tenantId)),
    ).then((results) => {
      if (cancelled) return;
      const rows: ArchivedReportRow[] = [];
      let denied = 0;
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          for (const version of result.value ?? []) {
            rows.push({ ...version, reportType: reportTypes[index].id });
          }
        } else if ((result.reason as { response?: { status?: number } })?.response?.status === 403) {
          denied += 1;
        }
      });
      rows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      setHistory(rows.slice(0, 25));
      // Only a real rights refusal turns the panel into a "not authorised"
      // state; a single failed type just contributes no rows.
      setHistoryDenied(denied > 0 && denied === results.length);
      setHistoryLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenantId, reportTypes]);

  async function loadSchedules() {
    try {
      setSchedulesLoading(true);
      const data = await reportSchedulesApi.list();
      setSchedules(Array.isArray(data) ? data : []);
      setSchedulesLocked(false);
    } catch (err: any) {
      // 402 = feature not in the tenant's plan (Elite Pack) — show the upsell state, not an error.
      setSchedulesLocked(err?.response?.status === 402);
      setSchedules([]);
    } finally {
      setSchedulesLoading(false);
    }
  }

  async function handleCreateSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduleForm.name.trim()) { setScheduleError(t("reports.error_schedule_name_required")); return; }
    setScheduleSubmitting(true);
    setScheduleError("");
    try {
      const recipients = scheduleForm.recipients
        .split(/[,;\s]+/)
        .map((r) => r.trim())
        .filter(Boolean);
      await reportSchedulesApi.create({
        name: scheduleForm.name,
        report_type: scheduleForm.report_type,
        frequency: scheduleForm.frequency,
        hour: scheduleForm.hour,
        day_of_week: scheduleForm.day_of_week,
        day_of_month: scheduleForm.day_of_month,
        recipients,
        enabled: scheduleForm.enabled,
      });
      setShowScheduleModal(false);
      setScheduleForm(EMPTY_SCHEDULE_FORM);
      loadSchedules();
    } catch (err: any) {
      setScheduleError(err?.response?.data?.detail || t("reports.error_schedule_create_failed"));
    } finally {
      setScheduleSubmitting(false);
    }
  }

  async function handleToggleSchedule(schedule: any) {
    setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? { ...s, enabled: !s.enabled } : s)));
    try {
      await reportSchedulesApi.update(schedule.id, { enabled: !schedule.enabled });
    } catch {
      loadSchedules(); // revert to server truth on failure
    }
  }

  async function handleRunNow(id: string) {
    setRunningId(id);
    try {
      await reportSchedulesApi.runNow(id);
      loadSchedules();
    } catch {
      alert(t("reports.error_run_failed"));
    } finally {
      setRunningId(null);
    }
  }

  async function handleDeleteSchedule(id: string) {
    if (!window.confirm(t("reports.confirm_delete_schedule"))) return;
    try {
      await reportSchedulesApi.delete(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert(t("reports.error_delete_failed"));
    }
  }

  async function handleDownload(reportType: string) {
    try {
      setDownloading(reportType);
      await reportsApi.download(reportType);
    } catch (err) {
      console.error("Download failed:", err);
      alert(t("reports.error_download_failed"));
    } finally {
      setDownloading(null);
    }
  }

  async function handlePreview(reportType: string) {
    try {
      setDownloading(reportType);
      const url = await reportsApi.preview(reportType);
      setPreviewUrl(url);
    } catch (err) {
      console.error("Preview failed:", err);
      alert(t("reports.error_preview_failed"));
    } finally {
      setDownloading(null);
    }
  }

  // Cleanup blob URL when modal closes
  function handleClosePreview() {
    if (previewUrl) {
      globalThis.URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
  }

  // Get current week dates
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 7);
  const weekStartStr = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const weekEndStr = today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("reports.weekly_reports")}</h1>
          <p className="text-gray-500 text-sm mt-1">{t("reports.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Calendar className="w-4 h-4" />
          <span>{weekStartStr} - {weekEndStr}</span>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
        <FileText className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-blue-900">{t("reports.weekly_generation")}</h3>
          <p className="text-xs text-blue-700 mt-0.5">{t("reports.info_banner_text")}</p>
        </div>
      </div>

      {apiError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-amber-900">{t("reports.error_banner_title")}</h3>
            <p className="text-xs text-amber-700 mt-0.5">{t("reports.error_banner_text")}</p>
          </div>
        </div>
      )}

      {/* Report cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportTypes.map((report) => {
          const Icon = ICON_MAP[report.icon] || FileText;
          const colors = COLOR_MAP[report.id] || { bg: "bg-gray-50", icon: "text-gray-600", border: "border-gray-100" };
          const isDownloading = downloading === report.id;

          return (
            <div
              key={report.id}
              className={`bg-white rounded-2xl border ${colors.border} p-5 hover:shadow-md transition-all`}
            >
              <div className={`w-12 h-12 ${colors.bg} rounded-xl flex items-center justify-center mb-4`}>
                <Icon className={`w-6 h-6 ${colors.icon}`} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{String(t(`reports.${report.id}_name` as never, report.name))}</h3>
              <p className="text-sm text-gray-500 mb-4 min-h-[40px]">{String(t(`reports.${report.id}_desc` as never, report.description))}</p>

              <div className="flex gap-2">
                <button
                  onClick={() => handlePreview(report.id)}
                  disabled={isDownloading}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <Eye className="w-4 h-4" />
                  {t("reports.preview")}
                </button>
                <button
                  onClick={() => handleDownload(report.id)}
                  disabled={isDownloading}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("reports.generating")}
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      {t("reports.download")}
                    </>
                  )}
                </button>
              </div>

              {/* « Historique » — the archived versions of THIS report type */}
              <button
                type="button"
                onClick={() =>
                  setHistoryFor({
                    parentType: `${REPORT_PARENT_PREFIX}${report.id}`,
                    title: String(t(`reports.${report.id}_name` as never, report.name)),
                  })
                }
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-blue-600"
              >
                <History className="w-3.5 h-3.5" />
                {t("treatment.history_short")}
                {history.some((h) => h.reportType === report.id) && (
                  <span className="text-gray-400">
                    ({history.filter((h) => h.reportType === report.id).length})
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Report archive — objectif 6, « archivage des rapports dans l'historique » */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <History className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            {t("reports.history_title", { defaultValue: t("treatment.history") })}
          </h3>
        </div>
        {i18n.exists("reports.history_subtitle") && (
          <p className="text-xs text-gray-500 mb-4">{t("reports.history_subtitle")}</p>
        )}

        {historyLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          </div>
        ) : historyDenied ? (
          <div className="flex flex-col items-center py-8 text-sm text-gray-400">
            <Lock className="w-6 h-6 mb-2 text-gray-300" />
            {t("activity_log.forbidden")}
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">
            {t("reports.no_history", { defaultValue: t("treatment.no_history") })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("reports.col_type")}</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("treatment.version_n", { n: "" }).trim()}</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("common.name")}</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("common.created_at")}</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("archiving.evidence_hash")}</th>
                  <th className="text-right py-2 font-medium text-gray-500">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const intact = row.integrity === "ok" || row.integrity === "unrecorded";
                  return (
                    <tr key={row.id} className="border-b border-gray-50">
                      <td className="py-2.5 pr-3 text-gray-700">
                        {String(t(`reports.${row.reportType}_name` as never, row.reportType))}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="text-xs font-mono font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          v{row.version_number}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-gray-900 max-w-xs truncate" title={row.file_name ?? ""}>
                        {row.file_name || "—"}
                        <span className="block text-xs text-gray-400">{fmtSize(row.file_size_bytes)}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-gray-500 whitespace-nowrap">{fmtDateTime(row.created_at)}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                          intact
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        }`}>
                          {intact ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                          {intact
                            ? t("audit_detail.evidence_integrity_ok")
                            : t("audit_detail.evidence_integrity_failed")}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryFor({
                              parentType: `${REPORT_PARENT_PREFIX}${row.reportType}`,
                              title: String(t(`reports.${row.reportType}_name` as never, row.reportType)),
                            })
                          }
                          title={t("treatment.history")}
                          aria-label={t("treatment.history")}
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {historyFor && (
        <FileHistoryModal
          parentType={historyFor.parentType}
          parentId={tenantId ?? ""}
          title={historyFor.title}
          onClose={() => setHistoryFor(null)}
        />
      )}

      {/* Scheduled reports */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">{t("reports.automated_title")}</h3>
          </div>
          {!schedulesLocked && (
            <button
              onClick={() => setShowScheduleModal(true)}
              className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> {t("reports.btn_new_schedule")}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">{t("reports.automated_text")}</p>

        {schedulesLocked ? (
          <div className="text-center py-8 text-sm text-gray-400">{t("reports.schedules_locked")}</div>
        ) : schedulesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          </div>
        ) : schedules.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400">{t("reports.no_schedules")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("reports.col_name")}</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("reports.col_type")}</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("reports.col_frequency")}</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("reports.col_next_run")}</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">{t("reports.col_last_status")}</th>
                  <th className="text-center py-2 pr-3 font-medium text-gray-500">{t("reports.col_enabled")}</th>
                  <th className="text-right py-2 font-medium text-gray-500">{t("reports.col_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50">
                    <td className="py-2.5 pr-3 font-medium text-gray-900">{s.name}</td>
                    <td className="py-2.5 pr-3 text-gray-600">{String(t(`reports.${s.report_type}_name` as never, s.report_type))}</td>
                    <td className="py-2.5 pr-3 text-gray-600">{t(`reports.frequency_${s.frequency}` as never)}</td>
                    <td className="py-2.5 pr-3 text-gray-500">{fmtDateTime(s.next_run_at)}</td>
                    <td className="py-2.5 pr-3">
                      {s.last_status ? (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.last_status === "sent" || s.last_status === "ok" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {s.last_status}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">{t("reports.status_never_run")}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-center">
                      <button
                        role="switch"
                        aria-checked={s.enabled}
                        onClick={() => handleToggleSchedule(s)}
                        className={`w-9 h-5 rounded-full transition-colors relative ${s.enabled ? "bg-blue-600" : "bg-gray-200"}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${s.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                      </button>
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleRunNow(s.id)}
                          disabled={runningId === s.id}
                          title={t("reports.btn_run_now")}
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"
                        >
                          {runningId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDeleteSchedule(s.id)}
                          title={t("common.delete")}
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowScheduleModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("reports.btn_new_schedule")}</h2>
              <button onClick={() => setShowScheduleModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {scheduleError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{scheduleError}</div>}
            <form onSubmit={handleCreateSchedule} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("reports.form_schedule_name")} *</label>
                <input value={scheduleForm.name} onChange={(e) => setScheduleForm({ ...scheduleForm, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("reports.form_report_type")}</label>
                <select value={scheduleForm.report_type} onChange={(e) => setScheduleForm({ ...scheduleForm, report_type: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {reportTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("reports.form_frequency")}</label>
                  <select value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {FREQUENCIES.map((f) => <option key={f} value={f}>{t(`reports.frequency_${f}` as never)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("reports.form_hour")}</label>
                  <select value={scheduleForm.hour} onChange={(e) => setScheduleForm({ ...scheduleForm, hour: parseInt(e.target.value) })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00 UTC</option>)}
                  </select>
                </div>
              </div>
              {scheduleForm.frequency === "weekly" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("reports.form_day_of_week")}</label>
                  <select value={scheduleForm.day_of_week} onChange={(e) => setScheduleForm({ ...scheduleForm, day_of_week: parseInt(e.target.value) })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {WEEKDAYS.map((d) => <option key={d} value={d}>{t(`reports.weekday_${d}` as never)}</option>)}
                  </select>
                </div>
              )}
              {scheduleForm.frequency === "monthly" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("reports.form_day_of_month")}</label>
                  <input type="number" min={1} max={28} value={scheduleForm.day_of_month} onChange={(e) => setScheduleForm({ ...scheduleForm, day_of_month: parseInt(e.target.value) || 1 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("reports.form_recipients")}</label>
                <input value={scheduleForm.recipients} onChange={(e) => setScheduleForm({ ...scheduleForm, recipients: e.target.value })} placeholder={t("reports.form_recipients_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={scheduleForm.enabled} onChange={(e) => setScheduleForm({ ...scheduleForm, enabled: e.target.checked })} className="rounded border-gray-300" />
                {t("reports.form_enabled")}
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowScheduleModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
                <button type="submit" disabled={scheduleSubmitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {scheduleSubmitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PDF Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{t("reports.report_preview")}</h2>
              <button
                onClick={handleClosePreview}
                className="text-gray-400 hover:text-gray-600 px-3 py-1 rounded-lg hover:bg-gray-100"
              >
                {t("reports.btn_close")}
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe
                src={previewUrl}
                className="w-full h-full"
                title={t("reports.report_preview")}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
