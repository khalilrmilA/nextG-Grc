/**
 * ReportsPage — Generate and download weekly PDF reports for the GRC platform.
 * Shows available report types with descriptions and download buttons.
 */
import { useState, useEffect } from "react";
import { FileText, Download, LayoutDashboard, AlertTriangle, CheckSquare, Building2, ClipboardList, Loader2, Calendar, RefreshCw, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { reportsApi } from "@/api/endpoints";

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


export default function ReportsPage() {
  const { t } = useTranslation();
  const [reportTypes, setReportTypes] = useState<ReportType[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [apiError, setApiError] = useState(false);

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
  }, []);

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
            </div>
          );
        })}
      </div>

      {/* Schedule info */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">{t("reports.automated_title")}</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">{t("reports.automated_text")}</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-900">5</p>
            <p className="text-xs text-gray-500">{t("reports.report_types")}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-900">7</p>
            <p className="text-xs text-gray-500">{t("reports.days_coverage")}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-900">PDF</p>
            <p className="text-xs text-gray-500">{t("reports.format")}</p>
          </div>
        </div>
      </div>

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
                title="PDF Preview"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
