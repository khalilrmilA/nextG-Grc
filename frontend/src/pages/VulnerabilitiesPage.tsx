import { useState, useEffect } from "react";
import { Plus, Search, X, Loader2, Filter, Bug, ShieldCheck, Wrench, BarChart3, Upload, Download, Plug, RefreshCw, Trash2, ChevronRight, ChevronDown, Check, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { vulnerabilitiesApi, vulnImportApi, scannerConnectorsApi } from "@/api/endpoints";

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const STATUS_BADGE: Record<string, string> = {
  pending_validation: "bg-amber-100 text-amber-700 border-amber-200",
  validated: "bg-indigo-100 text-indigo-700 border-indigo-200",
  open: "bg-blue-100 text-blue-700 border-blue-200",
  in_remediation: "bg-yellow-100 text-yellow-700 border-yellow-200",
  mitigated: "bg-green-100 text-green-700 border-green-200",
  accepted: "bg-gray-100 text-gray-600 border-gray-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  false_positive: "bg-purple-100 text-purple-700 border-purple-200",
};

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS = ["pending_validation", "validated", "open", "in_remediation", "mitigated", "accepted", "closed", "false_positive"];
const SOURCE_OPTIONS = ["pen_test", "scan", "manual", "bug_bounty"];
const OPERATIONAL_CONTEXTS = ["internet_facing", "dmz", "production", "internal", "isolated", "test", "development"];

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

  // Detail / actions modal
  const [detail, setDetail] = useState<any>(null);
  const [detailForm, setDetailForm] = useState<any>({});
  const [detailBusy, setDetailBusy] = useState("");
  const [detailErr, setDetailErr] = useState("");

  // Impact scoring (RFP mod 3.4)
  const [impactContext, setImpactContext] = useState("");
  const [impactOverrideMode, setImpactOverrideMode] = useState(false);
  const [impactOverrideValue, setImpactOverrideValue] = useState("");
  const [impactJustification, setImpactJustification] = useState("");
  const [impactBusy, setImpactBusy] = useState(false);
  const [impactErr, setImpactErr] = useState("");
  const [showImpactHistory, setShowImpactHistory] = useState(false);
  const [impactHistory, setImpactHistory] = useState<any[] | null>(null);
  const [impactHistoryLoading, setImpactHistoryLoading] = useState(false);

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

  // Scanner connectors (live API sync)
  const [showConn, setShowConn] = useState(false);
  const [connectors, setConnectors] = useState<any[]>([]);
  const [connLoading, setConnLoading] = useState(false);
  const [connMsg, setConnMsg] = useState("");
  const [connBusy, setConnBusy] = useState("");
  const [addingConn, setAddingConn] = useState(false);
  const emptyConn = { name: "", tool: "demo", base_url: "", api_key: "", api_secret: "" };
  const [connForm, setConnForm] = useState({ ...emptyConn });
  const connNeedsUrl = connForm.tool !== "demo";
  const connNeedsKeys = connForm.tool === "tenable";

  async function loadConnectors() {
    setConnLoading(true);
    try { setConnectors(await scannerConnectorsApi.list()); } catch { setConnectors([]); } finally { setConnLoading(false); }
  }
  async function addConnector(e: React.FormEvent) {
    e.preventDefault();
    if (!connForm.name.trim()) return;
    setAddingConn(true); setConnMsg("");
    try {
      await scannerConnectorsApi.create({
        name: connForm.name, tool: connForm.tool,
        base_url: connForm.base_url || null, api_key: connForm.api_key || null, api_secret: connForm.api_secret || null,
      });
      setConnForm({ ...emptyConn });
      loadConnectors();
    } catch (err: any) {
      setConnMsg(err?.response?.data?.detail || "Could not add connector");
    } finally { setAddingConn(false); }
  }
  async function testConn(id: string) {
    setConnBusy(id + ":test"); setConnMsg("");
    try { const r = await scannerConnectorsApi.test(id); setConnMsg((r.ok ? "✓ " : "✗ ") + r.message); }
    catch { setConnMsg("Test failed"); } finally { setConnBusy(""); }
  }
  async function syncConn(id: string) {
    setConnBusy(id + ":sync"); setConnMsg("");
    try {
      const j = await scannerConnectorsApi.sync(id);
      setConnMsg(j.status === "completed"
        ? `✓ Synced: ${j.imported_count} imported, ${j.matched_count} matched, ${j.skipped_count} skipped`
        : `✗ ${j.error || "sync failed"}`);
      loadConnectors(); setLoading(true); load(); loadStats();
    } catch { setConnMsg("Sync failed"); } finally { setConnBusy(""); }
  }
  async function deleteConn(id: string) {
    setConnBusy(id + ":del");
    try { await scannerConnectorsApi.remove(id); loadConnectors(); } catch {} finally { setConnBusy(""); }
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

  function openDetail(item: any) {
    setDetail(item);
    setDetailErr("");
    setImpactContext(""); setImpactOverrideMode(false); setImpactOverrideValue(""); setImpactJustification(""); setImpactErr("");
    setShowImpactHistory(false); setImpactHistory(null); setImpactHistoryLoading(false);
    setDetailForm({
      title: item.title ?? "",
      severity: item.severity ?? "medium",
      cvss_score: item.cvss_score ?? "",
      status: item.status ?? "open",
      remediation_due_date: item.remediation_due_date ? String(item.remediation_due_date).slice(0, 10) : "",
      description: item.description ?? "",
    });
  }
  function refreshAll() { setLoading(true); load(); loadStats(); }

  async function saveDetail() {
    if (!detail) return;
    setDetailBusy("save"); setDetailErr("");
    try {
      const payload: any = { ...detailForm };
      payload.cvss_score = payload.cvss_score === "" ? null : parseFloat(payload.cvss_score);
      if (!payload.remediation_due_date) delete payload.remediation_due_date;
      await vulnerabilitiesApi.update(detail.id, payload);
      setDetail(null); refreshAll();
    } catch (e: any) { setDetailErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setDetailBusy(""); }
  }
  async function validateDetail() {
    if (!detail) return;
    setDetailBusy("validate"); setDetailErr("");
    try {
      await vulnerabilitiesApi.validate(detail.id);
      setDetail(null); refreshAll();
    } catch (e: any) { setDetailErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setDetailBusy(""); }
  }
  async function loadImpactHistory() {
    if (!detail) return;
    setImpactHistoryLoading(true);
    try {
      const h = await vulnerabilitiesApi.impactHistory(detail.id);
      setImpactHistory(Array.isArray(h) ? h : []);
    } catch { setImpactHistory([]); }
    finally { setImpactHistoryLoading(false); }
  }
  function toggleImpactHistory() {
    const next = !showImpactHistory;
    setShowImpactHistory(next);
    if (next && impactHistory === null) loadImpactHistory();
  }
  async function recalcImpact() {
    if (!detail) return;
    setImpactBusy(true); setImpactErr("");
    try {
      const updated = await vulnerabilitiesApi.scoreImpact(detail.id, { operational_context: impactContext || null });
      setDetail(updated);
      setImpactHistory(null);
      if (showImpactHistory) loadImpactHistory();
    } catch (e: any) { setImpactErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setImpactBusy(false); }
  }
  async function overrideImpact() {
    if (!detail) return;
    if (!impactJustification.trim()) { setImpactErr(t("vulnerabilities.impact_justification_required", "A justification is required to override the score")); return; }
    setImpactBusy(true); setImpactErr("");
    try {
      const updated = await vulnerabilitiesApi.scoreImpact(detail.id, { override: parseFloat(impactOverrideValue), justification: impactJustification });
      setDetail(updated);
      setImpactOverrideMode(false);
      setImpactHistory(null);
      if (showImpactHistory) loadImpactHistory();
    } catch (e: any) { setImpactErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setImpactBusy(false); }
  }
  async function deleteDetail() {
    if (!detail) return;
    if (!confirm(t("vulnerabilities.confirm_delete", "Delete this vulnerability?"))) return;
    setDetailBusy("delete"); setDetailErr("");
    try {
      await vulnerabilitiesApi.delete(detail.id);
      setDetail(null); refreshAll();
    } catch (e: any) { setDetailErr(e?.response?.data?.detail || t("common.error", "Something went wrong.")); }
    finally { setDetailBusy(""); }
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
            onClick={() => { setConnMsg(""); loadConnectors(); setShowConn(true); }}
            className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Plug className="w-4 h-4" /> {t("vulnerabilities.connectors", "Connectors")}
          </button>
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
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => (
                <tr
                  key={item.id}
                  onClick={() => openDetail(item)}
                  className="group border-b border-gray-50 hover:bg-blue-50/40 transition-colors cursor-pointer"
                >
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
                  <td className="px-6 py-4 text-right"><ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 inline" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail / actions modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[88vh] overflow-auto">
            <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-100">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-gray-400">{detail.ref_id}</span>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${STATUS_BADGE[detailForm.status] || "bg-gray-100 text-gray-600"}`}>{detailForm.status?.replace(/_/g, " ")}</span>
                </div>
                <h3 className="font-semibold text-gray-900 mt-1">{detail.title}</h3>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {detailErr && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{detailErr}</div>}
              <div>
                <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_title", "Title")}</label>
                <input value={detailForm.title} onChange={(e) => setDetailForm({ ...detailForm, title: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_status", "Status")}</label>
                  <select value={detailForm.status} onChange={(e) => setDetailForm({ ...detailForm, status: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_severity", "Severity")}</label>
                  <select value={detailForm.severity} onChange={(e) => setDetailForm({ ...detailForm, severity: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_cvss", "CVSS")}</label>
                  <input type="number" step="0.1" min="0" max="10" value={detailForm.cvss_score} onChange={(e) => setDetailForm({ ...detailForm, cvss_score: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">{t("vulnerabilities.col_remediation_due", "Remediation due")}</label>
                  <input type="date" value={detailForm.remediation_due_date} onChange={(e) => setDetailForm({ ...detailForm, remediation_due_date: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">{t("common.description", "Description")}</label>
                <textarea rows={3} value={detailForm.description} onChange={(e) => setDetailForm({ ...detailForm, description: e.target.value })} className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* Impact scoring (RFP mod 3.4) */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5" /> {t("vulnerabilities.impact_title", "Impact Score")}
                </p>
                {impactErr && <div className="mb-2 p-2 bg-red-50 text-red-700 rounded-lg text-xs">{impactErr}</div>}
                <div className="flex items-center gap-3 mb-3">
                  <span className={`text-2xl font-bold ${detail.impact_score == null ? "text-gray-300" : detail.impact_score >= 70 ? "text-red-600" : detail.impact_score >= 40 ? "text-orange-600" : "text-green-600"}`}>
                    {detail.impact_score != null ? Math.round(detail.impact_score) : "—"}
                  </span>
                  <span className="text-xs text-gray-400">/ 100</span>
                  {detail.impact_override != null && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">{t("vulnerabilities.impact_manual", "Manual override")}</span>
                  )}
                </div>
                {detail.impact_justification && (
                  <p className="text-xs text-gray-500 mb-3 italic">"{detail.impact_justification}"</p>
                )}

                {impactOverrideMode ? (
                  <div className="space-y-2 bg-gray-50 rounded-xl p-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600">{t("vulnerabilities.impact_override_value", "Override value (0-100)")}</label>
                      <input type="number" min={0} max={100} step={0.1} value={impactOverrideValue} onChange={(e) => setImpactOverrideValue(e.target.value)} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">{t("vulnerabilities.impact_justification", "Justification")} *</label>
                      <textarea rows={2} value={impactJustification} onChange={(e) => setImpactJustification(e.target.value)} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setImpactOverrideMode(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                      <button onClick={overrideImpact} disabled={impactBusy} className="inline-flex items-center gap-1.5 bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-50">
                        {impactBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.save", "Save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={impactContext} onChange={(e) => setImpactContext(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">{t("vulnerabilities.impact_context_default", "Default context")}</option>
                      {OPERATIONAL_CONTEXTS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                    </select>
                    <button onClick={recalcImpact} disabled={impactBusy} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
                      {impactBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {t("vulnerabilities.impact_recalculate", "Recalculate")}
                    </button>
                    <button onClick={() => { setImpactOverrideMode(true); setImpactOverrideValue(detail.impact_score != null ? String(detail.impact_score) : ""); }} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                      {t("vulnerabilities.impact_override_btn", "Override manually")}
                    </button>
                  </div>
                )}

                {/* Impact score history */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={toggleImpactHistory}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
                  >
                    {showImpactHistory ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {t("vulnerabilities.impact_history_title", "History")}
                  </button>
                  {showImpactHistory && (
                    <div className="mt-2 space-y-1.5">
                      {impactHistoryLoading ? (
                        <div className="flex items-center justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-blue-400" /></div>
                      ) : !impactHistory || impactHistory.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">{t("vulnerabilities.impact_history_empty", "No history yet")}</p>
                      ) : (
                        impactHistory.map((h: any) => (
                          <div key={h.id} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                            <span className="text-sm font-semibold text-gray-800">{h.score != null ? Math.round(h.score) : "—"}</span>
                            {h.override && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200 whitespace-nowrap">
                                {t("vulnerabilities.impact_manual", "Manual override")}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              {h.justification && <p className="text-xs text-gray-500 italic truncate" title={h.justification}>"{h.justification}"</p>}
                            </div>
                            <span className="text-[11px] text-gray-400 whitespace-nowrap">{h.created_at ? new Date(h.created_at).toLocaleString() : ""}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={deleteDetail} disabled={!!detailBusy} className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 disabled:opacity-50">
                {detailBusy === "delete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t("common.delete", "Delete")}
              </button>
              <div className="flex items-center gap-2">
                {detailForm.status === "pending_validation" && (
                  <button onClick={validateDetail} disabled={!!detailBusy} className="inline-flex items-center gap-1.5 bg-white border border-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-50 disabled:opacity-50">
                    {detailBusy === "validate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} {t("vulnerabilities.validate", "Validate")}
                  </button>
                )}
                <button onClick={saveDetail} disabled={!!detailBusy} className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {detailBusy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t("common.save", "Save changes")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Scanner connectors modal */}
      {showConn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowConn(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Plug className="w-5 h-5 text-blue-600" /> {t("vulnerabilities.connectors_title", "Scanner connectors")}
              </h2>
              <button onClick={() => setShowConn(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{t("vulnerabilities.connectors_help", "Connect to Nessus/Tenable, Qualys or OpenVAS to pull findings automatically. Sync on demand or on a schedule; every run is journaled.")}</p>

            {connMsg && <div className="mb-4 p-3 rounded-xl text-sm bg-blue-50 text-blue-700">{connMsg}</div>}

            <div className="space-y-2 mb-6">
              {connLoading ? (
                <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
              ) : connectors.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">{t("vulnerabilities.no_connectors", "No connectors yet. Add one below.")}</p>
              ) : connectors.map((cn) => (
                <div key={cn.id} className="flex items-center gap-3 border border-gray-100 rounded-xl px-4 py-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center"><Plug className="w-4 h-4 text-blue-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{cn.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{cn.tool}{cn.schedule_enabled ? ` · every ${cn.interval_hours}h` : ""}{cn.last_status ? ` · last: ${cn.last_status}` : ""}</p>
                  </div>
                  <button onClick={() => testConn(cn.id)} disabled={!!connBusy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
                    {connBusy === cn.id + ":test" ? "…" : t("vulnerabilities.test", "Test")}
                  </button>
                  <button onClick={() => syncConn(cn.id)} disabled={!!connBusy} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                    {connBusy === cn.id + ":sync" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {t("vulnerabilities.sync_now", "Sync now")}
                  </button>
                  <button onClick={() => deleteConn(cn.id)} disabled={!!connBusy} className="text-gray-400 hover:text-red-500 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>

            <form onSubmit={addConnector} className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700">{t("vulnerabilities.add_connector", "Add connector")}</p>
              <div className="grid grid-cols-2 gap-3">
                <input value={connForm.name} onChange={(e) => setConnForm({ ...connForm, name: e.target.value })} placeholder={t("vulnerabilities.conn_name", "Name")} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={connForm.tool} onChange={(e) => setConnForm({ ...connForm, tool: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="demo">Demo (simulated)</option>
                  <option value="tenable">Tenable.io</option>
                  <option value="nessus">Nessus</option>
                  <option value="qualys">Qualys</option>
                  <option value="openvas">OpenVAS</option>
                </select>
              </div>
              {connNeedsUrl && (
                <input value={connForm.base_url} onChange={(e) => setConnForm({ ...connForm, base_url: e.target.value })} placeholder={connForm.tool === "tenable" ? "https://cloud.tenable.com" : "https://scanner.host:port"} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              )}
              {connNeedsKeys && (
                <div className="grid grid-cols-2 gap-3">
                  <input value={connForm.api_key} onChange={(e) => setConnForm({ ...connForm, api_key: e.target.value })} placeholder={t("vulnerabilities.access_key", "Access key")} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={connForm.api_secret} onChange={(e) => setConnForm({ ...connForm, api_secret: e.target.value })} placeholder={t("vulnerabilities.secret_key", "Secret key")} type="password" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">{connForm.tool === "demo" ? t("vulnerabilities.demo_note", "Demo connector simulates a pull that matches your assets.") : t("vulnerabilities.live_note", "Live pull needs a reachable scanner + valid credentials.")}</p>
                <button type="submit" disabled={addingConn} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {addingConn && <Loader2 className="w-4 h-4 animate-spin" />} {t("vulnerabilities.add", "Add")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
