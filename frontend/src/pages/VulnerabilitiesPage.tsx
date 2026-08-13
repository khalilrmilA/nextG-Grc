import { useState, useEffect } from "react";
import { Plus, Search, X, Loader2, Filter, Bug, ShieldCheck, Wrench, BarChart3, Upload, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { vulnerabilitiesApi, vulnImportApi } from "@/api/endpoints";

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  in_remediation: "bg-yellow-100 text-yellow-700 border-yellow-200",
  mitigated: "bg-green-100 text-green-700 border-green-200",
  accepted: "bg-gray-100 text-gray-600 border-gray-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  false_positive: "bg-purple-100 text-purple-700 border-purple-200",
};

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS = ["open", "in_remediation", "mitigated", "accepted", "closed", "false_positive"];
const SOURCE_OPTIONS = ["pen_test", "scan", "manual", "bug_bounty"];

export default function VulnerabilitiesPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ total: 0, open: 0, in_remediation: 0, avg_cvss: 0 });
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Scanner import
  const [showImport, setShowImport] = useState(false);
  const [importTool, setImportTool] = useState("csv");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const SAMPLE_CSV = `Name,Severity,CVSS,CVE,Host,Solution
Apache Struts 2 Remote Code Execution,Critical,9.8,CVE-2017-5638,Internet Banking Portal,Upgrade to Struts 2.5.13 or later
OpenSSL Heartbleed,High,7.5,CVE-2014-0160,SWIFT Gateway,Patch OpenSSL to 1.0.1g+
Outdated jQuery (Cross-Site Scripting),Medium,6.1,CVE-2020-11022,Internet Banking Portal,Upgrade jQuery to 3.5+
SMBv1 protocol enabled,High,8.1,CVE-2017-0144,Domain Controller AD,Disable SMBv1
Weak SSH ciphers,Low,3.7,,Backup Storage Array,Restrict to strong ciphers`;

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "sample-openvas-scan.csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importFile) return;
    setImporting(true); setImportResult(null);
    try {
      const journal = await vulnImportApi.upload(importFile, importTool);
      setImportResult(journal);
      setLoading(true);
      load(); loadStats();
    } catch (err: any) {
      setImportResult({ status: "failed", error: err?.response?.data?.detail || "Import failed" });
    } finally {
      setImporting(false);
    }
  }

  const [form, setForm] = useState({
    ref_id: "",
    title: "",
    description: "",
    severity: "medium",
    cvss_score: 5.0,
    source: "scan",
    affected_systems: "",
  });

  async function load() {
    try {
      const params: any = {};
      if (sevFilter) params.severity = sevFilter;
      if (statusFilter) params.status_filter = statusFilter;
      const data = await vulnerabilitiesApi.list(params);
      setItems(Array.isArray(data) ? data : data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const s = await vulnerabilitiesApi.stats();
      setStats(s);
    } catch {}
  }

  useEffect(() => {
    load();
    loadStats();
  }, [sevFilter, statusFilter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("vulnerabilities.error_title_required")); return; }
    if (!form.ref_id.trim()) { setError(t("vulnerabilities.error_ref_required")); return; }
    setSubmitting(true);
    setError("");
    try {
      await vulnerabilitiesApi.create(form);
      setShowModal(false);
      setForm({ ref_id: "", title: "", description: "", severity: "medium", cvss_score: 5.0, source: "scan", affected_systems: "" });
      setLoading(true);
      load();
      loadStats();
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("vulnerabilities.error_create_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = items.filter((i) =>
    (i.title?.toLowerCase().includes(search.toLowerCase()) || i.ref_id?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("vulnerabilities.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("vulnerabilities.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setImportResult(null); setImportFile(null); setShowImport(true); }}
            className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Upload className="w-4 h-4" /> {t("vulnerabilities.import_scan", "Import scan")}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> {t("vulnerabilities.new_vulnerability")}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: t("vulnerabilities.stat_total"), value: stats.total, icon: Bug, color: "text-blue-600 bg-blue-50" },
          { label: t("vulnerabilities.stat_open"), value: stats.open, icon: ShieldCheck, color: "text-red-600 bg-red-50" },
          { label: t("vulnerabilities.stat_in_remediation"), value: stats.in_remediation, icon: Wrench, color: "text-yellow-600 bg-yellow-50" },
          { label: t("vulnerabilities.stat_avg_cvss"), value: typeof stats.avg_cvss === "number" ? stats.avg_cvss.toFixed(1) : "0.0", icon: BarChart3, color: "text-purple-600 bg-purple-50" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("vulnerabilities.search_placeholder")}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("vulnerabilities.all_severities")}</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{t(`compliance.severities.${s}` as never)}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t("vulnerabilities.all_statuses")}</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t("vulnerabilities.no_vulnerabilities")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_ref")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_title")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_severity")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_cvss")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_status")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("vulnerabilities.col_remediation_due")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 font-mono text-xs text-gray-700">{item.ref_id}</td>
                  <td className="px-6 py-4 font-medium text-gray-900">{item.title}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${SEV_BADGE[item.severity] || "bg-gray-100 text-gray-600"}`}>
                      {item.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-700 font-medium">{item.cvss_score ?? "-"}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${STATUS_BADGE[item.status] || "bg-gray-100 text-gray-600"}`}>
                      {item.status?.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500">{item.remediation_due_date ? new Date(item.remediation_due_date).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("vulnerabilities.new_vulnerability")}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.ref_id_label")} *</label>
                  <input value={form.ref_id} onChange={(e) => setForm({ ...form, ref_id: e.target.value })} placeholder={t("vulnerabilities.ref_id_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.name")} *</label>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description")}</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.severity")}</label>
                  <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{t(`compliance.severities.${s}` as never)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.cvss_score")}</label>
                  <input type="number" min={0} max={10} step={0.1} value={form.cvss_score} onChange={(e) => setForm({ ...form, cvss_score: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.col_source")}</label>
                  <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.affected_systems")}</label>
                <input value={form.affected_systems} onChange={(e) => setForm({ ...form, affected_systems: e.target.value })} placeholder={t("vulnerabilities.affected_systems_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("vulnerabilities.new_vulnerability")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Scanner import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowImport(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" /> {t("vulnerabilities.import_title", "Import scanner results")}
              </h2>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-5">{t("vulnerabilities.import_help", "Upload a Nessus (.nessus) file or a Qualys / OpenVAS CSV export. Findings are parsed, deduplicated and auto-matched to your assets.")}</p>
            <form onSubmit={handleImport} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.scanner", "Scanner")}</label>
                  <select value={importTool} onChange={(e) => setImportTool(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="csv">Generic CSV</option>
                    <option value="openvas">OpenVAS</option>
                    <option value="qualys">Qualys</option>
                    <option value="nessus">Nessus / Tenable</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("vulnerabilities.file", "Scan file")}</label>
                  <input type="file" accept=".csv,.nessus,.xml" onChange={(e) => setImportFile(e.target.files?.[0] || null)} className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm hover:file:bg-blue-100" />
                </div>
              </div>
              <button type="button" onClick={downloadSample} className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Download className="w-3.5 h-3.5" /> {t("vulnerabilities.sample", "Download a sample OpenVAS CSV to try it")}
              </button>
              {importResult && (
                <div className={`p-3 rounded-xl text-sm ${importResult.status === "completed" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                  {importResult.status === "completed"
                    ? `Imported ${importResult.imported_count} findings (${importResult.matched_count} matched to assets, ${importResult.skipped_count} duplicates skipped) from ${importResult.parsed_count} parsed.`
                    : `Import failed: ${importResult.error || "unknown error"}`}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.close", "Close")}</button>
                <button type="submit" disabled={importing || !importFile} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {importing && <Loader2 className="w-4 h-4 animate-spin" />} {t("vulnerabilities.import_run", "Import")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
