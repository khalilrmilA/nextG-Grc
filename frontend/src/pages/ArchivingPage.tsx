import { useState, useEffect } from "react";
import {
  Plus, X, Loader2, Crown, Archive, Download, Trash2, Repeat, CheckCircle2, XCircle,
  Eye, Search, ShieldCheck, ShieldAlert, FileText, Paperclip, RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { archivingApi } from "@/api/endpoints";
// POST /archiving/purge-expired now REQUIRES ?reason= (min 5 chars) and accepts
// ?dry_run=. archivingApi.purgeExpired() is still a zero-argument call that
// sends neither, so going through it can only ever 422. Until that signature is
// widened (api lane), the call is made on the same authenticated client the api
// objects wrap — never a bare fetch/axios.
import { apiClient } from "@/api/client";
import type { ArchiveRecord, ArchiveContent, ArchivedEvidence } from "@/types";
import appI18n from "@/i18n";

/** Intl locale for the current UI language (Arabic keeps Latin digits). */
function uiLocale(): string {
  const l = appI18n.language || "en";
  return l.startsWith("fr") ? "fr-FR" : l.startsWith("ar") ? "ar-u-nu-latn" : "en-US";
}


const ENTITY_TYPES = ["risk", "policy", "audit", "control", "assessment", "document", "vulnerability"];

// The 8 entity types the auto-archiving rules engine actually supports
// (backend/app/services/archiving_engine.py::ARCHIVABLE_ENTITIES) — distinct
// from ENTITY_TYPES above, which is only for the manual one-off archive form.
const RULE_ENTITY_TYPES = ["risk", "incident", "audit", "vulnerability", "security_exception", "applied_control", "policy", "vendor"];
const RULE_OPERATORS = ["=", "!=", ">", "<", ">=", "<="];

type RuleClause = { field: string; op: string; value: string };

function formatEntityType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The snapshot's own name for the record, whatever shape it was archived in. */
function archivedName(record: { payload?: Record<string, unknown> | null; entity_id?: string | null }): string {
  const payload = record.payload ?? {};
  for (const key of ["title", "name", "reference", "ref_id", "label"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return record.entity_id ?? "—";
}

function fmtBytes(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/** Scalar payload fields, in a stable order — the archived record as a person
 *  reads it, with the raw JSON kept underneath for anything not scalar. */
function scalarFields(payload: Record<string, unknown> | null | undefined): [string, string][] {
  if (!payload) return [];
  return Object.entries(payload)
    .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 24)
    .map(([k, v]) => [k, v === null || v === "" ? "—" : String(v)]);
}

function buildCriteriaFromClauses(clauses: RuleClause[]): string {
  return clauses
    .filter((c) => c.field.trim() && c.value.trim())
    .map((c) => `${c.field.trim()} ${c.op} ${c.value.trim()}`)
    .join(" AND ");
}

function emptyClause(): RuleClause {
  return { field: "", op: "=", value: "" };
}

/**
 * « Consultation sans restauration » — the archived record read back whole:
 * the snapshot itself, the children captured with it (constats, recommandations)
 * and the evidence manifest, each file downloadable and checkable against the
 * fingerprint taken when it was stored.
 */
function ArchiveDetailDrawer({ archiveId, onClose }: { archiveId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [content, setContent] = useState<ArchiveContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [verify, setVerify] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    archivingApi
      .content(archiveId, verify)
      .then((data) => { if (!cancelled) setContent(data); })
      .catch(() => { if (!cancelled) setError(t("archiving.detail_load_error")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [archiveId, verify, t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function downloadEvidence(item: ArchivedEvidence) {
    if (!item.id) return;
    setDownloading(item.id);
    try {
      // The bytes need the Authorization header, so this comes back as a blob
      // rather than as a link the browser would fetch unauthenticated.
      const blob = await archivingApi.downloadEvidence(archiveId, item.id);
      saveBlob(blob, item.file_name || item.name || "evidence");
    } catch {
      setError(t("archiving.detail_load_error"));
    } finally {
      setDownloading("");
    }
  }

  const record = content?.record;
  const children = content?.children ?? {};
  const childKeys = Object.keys(children).filter((k) => k !== "evidence" && (children[k] ?? []).length > 0);
  const evidence = content?.evidence ?? [];

  const childLabels: Record<string, string> = {
    findings: t("archiving.children_findings"),
    evidence: t("archiving.children_evidence"),
    recommendations: t("archiving.children_recommendations"),
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 rtl:right-auto rtl:left-0 w-full max-w-2xl bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{t("archiving.archive_detail")}</h2>
            {record && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{archivedName(record)}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setVerify((v) => !v)}
              title={t("archiving.evidence_hash")}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                verify ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" /> {t("archiving.evidence_hash")}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
          ) : !record ? (
            <p className="text-sm text-gray-400 text-center py-16">{t("archiving.detail_load_error")}</p>
          ) : (
            <>
              {/* Header facts */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-400">{t("archiving.entity_type")}</p>
                  <p className="text-sm text-gray-900">{formatEntityType(record.entity_type)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">{t("archiving.archived_on")}</p>
                  <p className="text-sm text-gray-900">{record.archived_at ? new Date(record.archived_at).toLocaleString(uiLocale()) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">{t("archiving.archived_by")}</p>
                  <p className="text-sm text-gray-900">{content?.archived_by_email || t("activity_log.actor_system")}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">{t("archiving.retention_until")}</p>
                  <p className="text-sm text-gray-900">
                    {record.retention_until ? new Date(record.retention_until).toLocaleDateString(uiLocale()) : t("archiving.indefinite")}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-gray-400">{t("archiving.reason")}</p>
                  <p className="text-sm text-gray-900">{record.reason || "—"}</p>
                </div>
              </div>

              {/* Snapshot */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-400" /> {t("archiving.content_title")}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">{t("archiving.content_hint")}</p>
                <div className="mt-3 rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {scalarFields(record.payload).map(([key, value]) => (
                        <tr key={key} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-2 text-xs font-mono text-gray-500 w-1/3 align-top">{key}</td>
                          <td className="px-4 py-2 text-gray-800 break-words">{value}</td>
                        </tr>
                      ))}
                      {scalarFields(record.payload).length === 0 && (
                        <tr><td className="px-4 py-3 text-sm text-gray-400">{t("common.no_data")}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  {showRaw ? t("common.close") : t("common.view")}
                </button>
                {showRaw && (
                  <pre className="mt-2 p-3 bg-gray-50 border border-gray-100 rounded-xl text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(record.payload ?? {}, null, 2)}
                  </pre>
                )}
              </div>

              {/* Children captured with the record */}
              {childKeys.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{t("archiving.children_title")}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{t("archiving.source")}: {content?.children_source}</p>
                  <div className="mt-3 space-y-4">
                    {childKeys.map((key) => (
                      <div key={key} className="rounded-xl border border-gray-100 overflow-hidden">
                        <div className="px-4 py-2 bg-gray-50/70 flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-600">{childLabels[key] ?? formatEntityType(key)}</span>
                          <span className="text-xs text-gray-400">{(children[key] ?? []).length}</span>
                        </div>
                        <ul className="divide-y divide-gray-50">
                          {(children[key] ?? []).slice(0, 25).map((child, idx) => (
                            <li key={String(child.id ?? idx)} className="px-4 py-2.5 text-sm text-gray-800 flex items-center justify-between gap-3">
                              <span className="truncate">{archivedName({ payload: child, entity_id: String(child.id ?? "") })}</span>
                              {typeof child.status === "string" && (
                                <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600 flex-shrink-0">
                                  {child.status}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence manifest */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-gray-400" /> {t("archiving.evidence_title")}
                </h3>
                {evidence.length === 0 ? (
                  <p className="text-sm text-gray-400 mt-2">{t("archiving.evidence_none")}</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {evidence.map((item, idx) => {
                      const failed = item.integrity === "modified" || item.integrity === "missing" || item.integrity === "unreadable";
                      return (
                        <div key={item.id ?? idx} className="border border-gray-100 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {item.file_name || item.name || "—"}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">{fmtBytes(item.file_size_bytes)}</p>
                            {item.file_sha256 && (
                              <p className="text-xs font-mono text-gray-400 mt-0.5 truncate" title={item.file_sha256}>
                                {t("archiving.evidence_hash")}: {item.file_sha256.slice(0, 16)}…
                              </p>
                            )}
                            <span className={`inline-flex items-center gap-1 mt-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                              failed
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-green-50 text-green-700 border-green-200"
                            }`}>
                              {failed ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                              {failed
                                ? t("audit_detail.evidence_integrity_failed")
                                : t("audit_detail.evidence_integrity_ok")}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={!item.downloadable || downloading === item.id}
                            onClick={() => downloadEvidence(item)}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
                          >
                            {downloading === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                            {t("archiving.evidence_download")}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ArchivingPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ArchiveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeReason, setPurgeReason] = useState("");
  const [purgeWord, setPurgeWord] = useState("");
  const [purgeError, setPurgeError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ entity_type: "risk", reason: "", retention_days: 365 });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  // ── Archiving rules (scheduled auto-archiving) ─────────────────────────
  const [rules, setRules] = useState<any[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState("");
  const [ruleDeleteBusy, setRuleDeleteBusy] = useState("");
  const [ruleForm, setRuleForm] = useState<{
    entity_type: string;
    retention_days: string;
    enabled: boolean;
    mode: "builder" | "advanced";
    clauses: RuleClause[];
    advancedText: string;
  }>({
    entity_type: RULE_ENTITY_TYPES[0],
    retention_days: "365",
    enabled: true,
    mode: "builder",
    clauses: [emptyClause()],
    advancedText: "",
  });

  async function load() {
    setLoadError("");
    try {
      const d = await archivingApi.listFiltered(typeFilter ? { entity_type: typeFilter, limit: 200 } : { limit: 200 });
      setItems(Array.isArray(d) ? d : []);
    } catch {
      setItems([]);
      setLoadError(t("archiving.load_error"));
    } finally { setLoading(false); }
  }
  async function loadRules() {
    try { const d = await archivingApi.listRules(); setRules(Array.isArray(d) ? d : []); }
    catch { setRules([]); } finally { setRulesLoading(false); }
  }
  useEffect(() => { loadRules(); }, []);
  // Re-queried server-side rather than filtered in the browser: the list is
  // capped, so a client-side filter would only ever search the first page.
  useEffect(() => { setLoading(true); load(); }, [typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addArchive(e: React.FormEvent) {
    e.preventDefault();
    if (!form.reason.trim()) return;
    setSaving(true);
    try {
      await archivingApi.create({ entity_type: form.entity_type, reason: form.reason, retention_days: Number(form.retention_days) || null, payload: { note: form.reason } });
      setShowAdd(false); setForm({ entity_type: "risk", reason: "", retention_days: 365 }); setLoading(true); load();
    } catch {} finally { setSaving(false); }
  }
  const purgeWordExpected = t("archiving.purge_confirm_word");
  const purgeReady = purgeReason.trim().length >= 5 && purgeWord.trim().toUpperCase() === purgeWordExpected.toUpperCase();

  async function purge() {
    if (!purgeReady) return;
    setBusy("purge"); setMsg(""); setPurgeError("");
    try {
      const r = await apiClient
        .post<{ purged?: number }>("/archiving/purge-expired", null, { params: { reason: purgeReason.trim() } })
        .then((res) => res.data);
      setMsg(t("archiving.purge_done", { count: r?.purged ?? 0 }));
      setPurgeOpen(false); setPurgeReason(""); setPurgeWord("");
      setLoading(true); load();
    } catch (err: any) {
      // 403 is the tenant_admin gate, not a failure of the operation — say which.
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      setPurgeError(
        status === 403
          ? t("archiving.purge_forbidden")
          : (typeof detail === "string" ? detail : t("archiving.load_error")),
      );
    } finally { setBusy(""); }
  }
  async function exportArchives(format: "xlsx" | "csv" | "pdf") {
    setBusy(`export-${format}`);
    try {
      const blob = await archivingApi.exportFile(format);
      const url = window.URL.createObjectURL(blob as Blob);
      const a = document.createElement("a"); a.href = url; a.download = `archives.${format}`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch {} finally { setBusy(""); }
  }

  // ── Rule form helpers ────────────────────────────────────────────────
  function resetRuleForm() {
    setRuleForm({
      entity_type: RULE_ENTITY_TYPES[0],
      retention_days: "365",
      enabled: true,
      mode: "builder",
      clauses: [emptyClause()],
      advancedText: "",
    });
    setRuleError("");
  }
  function addClause() {
    setRuleForm((prev) => ({ ...prev, clauses: [...prev.clauses, emptyClause()] }));
  }
  function removeClause(idx: number) {
    setRuleForm((prev) => ({ ...prev, clauses: prev.clauses.filter((_, i) => i !== idx) }));
  }
  function updateClause(idx: number, patch: Partial<RuleClause>) {
    setRuleForm((prev) => ({ ...prev, clauses: prev.clauses.map((c, i) => (i === idx ? { ...c, ...patch } : c)) }));
  }
  function toggleRuleMode() {
    setRuleForm((prev) =>
      prev.mode === "builder"
        ? { ...prev, mode: "advanced", advancedText: buildCriteriaFromClauses(prev.clauses) }
        : { ...prev, mode: "builder" }
    );
  }
  const criteriaPreview = ruleForm.mode === "builder" ? buildCriteriaFromClauses(ruleForm.clauses) : ruleForm.advancedText;

  async function submitRule(e: React.FormEvent) {
    e.preventDefault();
    const criteria = criteriaPreview.trim();
    if (!criteria) {
      setRuleError(t("archiving.rules.error_criteria_required", "Add at least one condition"));
      return;
    }
    setRuleSaving(true);
    setRuleError("");
    try {
      await archivingApi.createRule({
        entity_type: ruleForm.entity_type,
        criteria,
        enabled: ruleForm.enabled,
        retention_days: ruleForm.retention_days.trim() === "" ? null : Number(ruleForm.retention_days),
      });
      setShowRuleModal(false);
      setRulesLoading(true);
      loadRules();
    } catch (err: any) {
      setRuleError(err?.response?.data?.detail || t("archiving.rules.error_create_failed", "Could not create rule"));
    } finally {
      setRuleSaving(false);
    }
  }

  async function deleteRule(id: string) {
    if (!confirm(t("archiving.rules.confirm_delete", "Delete this archiving rule? This cannot be undone."))) return;
    setRuleDeleteBusy(id);
    try {
      await archivingApi.deleteRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {} finally { setRuleDeleteBusy(""); }
  }

  const expired = items.filter((i) => i.retention_until && i.retention_until < new Date().toISOString()).length;

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? items.filter((i) =>
        `${archivedName(i)} ${i.reason ?? ""} ${i.entity_type}`.toLowerCase().includes(needle),
      )
    : items;
  const entityTypeOptions = Array.from(new Set([...ENTITY_TYPES, ...items.map((i) => i.entity_type)]));

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("archiving.title", "Archiving & Retention")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
              <Crown className="w-3 h-3" /> {t("archiving.elite", "Elite Pack")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("archiving.subtitle", "Snapshot records with a retention window, consult without restoring, and export the archive")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => exportArchives("xlsx")} disabled={!!busy} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
            {busy === "export-xlsx" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {t("archiving.export", "Export")}
          </button>
          <button onClick={() => exportArchives("csv")} disabled={!!busy} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
            {busy === "export-csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {t("archiving.export_csv", "CSV")}
          </button>
          <button onClick={() => exportArchives("pdf")} disabled={!!busy} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
            {busy === "export-pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {t("archiving.export_pdf", "PDF")}
          </button>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> {t("archiving.new", "Archive record")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t("archiving.stat_total", "Archived records"), value: items.length, color: "text-blue-600 bg-blue-50" },
          { label: t("archiving.stat_expired", "Past retention"), value: expired, color: "text-red-600 bg-red-50" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}><Archive className="w-5 h-5" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{s.value}</p><p className="text-xs text-gray-500">{s.label}</p></div>
            </div>
          </div>
        ))}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center justify-between">
          <div><p className="text-sm font-semibold text-gray-900">{t("archiving.enforce", "Retention")}</p><p className="text-xs text-gray-500 mt-0.5">{msg || t("archiving.enforce_sub", "Delete records past their retention")}</p></div>
          <button onClick={() => { setPurgeError(""); setPurgeOpen(true); }} disabled={!!busy} className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
            {busy === "purge" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t("archiving.purge", "Purge expired")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="sr-only" htmlFor="archive-type-filter">{t("archiving.filter_entity_type")}</label>
          <select
            id="archive-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("archiving.filter_all_types")}</option>
            {entityTypeOptions.map((x) => <option key={x} value={x}>{formatEntityType(x)}</option>)}
          </select>
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("archiving.search_placeholder")}
              aria-label={t("archiving.search_placeholder")}
              className="w-full border border-gray-200 rounded-xl text-sm pl-9 rtl:pl-3 rtl:pr-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => { setLoading(true); load(); }}
            disabled={loading}
            className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" /> {t("common.refresh")}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loadError && <div className="m-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{loadError}</div>}
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : visible.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t("archiving.empty", "No archived records yet.")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.entity", "Entity")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.entity_name")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.reason", "Reason")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.archived", "Archived")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.retention_until", "Retention until")}</th>
                <th className="px-6 py-3" />
              </tr></thead>
              <tbody>
                {visible.map((it) => (
                  <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-4"><span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-gray-100 text-gray-600 capitalize">{it.entity_type}</span></td>
                    <td className="px-6 py-4 text-gray-900 font-medium max-w-xs truncate" title={archivedName(it)}>{archivedName(it)}</td>
                    <td className="px-6 py-4 text-gray-600 max-w-xs truncate" title={it.reason ?? ""}>{it.reason || "—"}</td>
                    <td className="px-6 py-4 text-gray-500">{it.archived_at ? new Date(it.archived_at).toLocaleDateString(uiLocale()) : "—"}</td>
                    <td className="px-6 py-4 text-gray-500">{it.retention_until ? new Date(it.retention_until).toLocaleDateString(uiLocale()) : t("archiving.indefinite", "indefinite")}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setDetailId(it.id)}
                        title={t("archiving.view_archive")}
                        aria-label={t("archiving.view_archive")}
                        className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg px-3 py-1.5 hover:bg-gray-50"
                      >
                        <Eye className="w-3.5 h-3.5" /> {t("archiving.view")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailId && <ArchiveDetailDrawer archiveId={detailId} onClose={() => setDetailId(null)} />}

      {/* « Assure la conservation… » — purging destroys evidence permanently, so
          the route demands a written reason and this asks for it, plus the
          typed confirmation word, before anything is sent. */}
      {purgeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPurgeOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold text-gray-900">{t("archiving.purge_confirm_title")}</h3>
              <button onClick={() => setPurgeOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600">{t("archiving.purge_confirm_body")}</p>

            {purgeError && <div className="mt-3 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{purgeError}</div>}

            <label className="block text-xs font-medium text-gray-600 mt-4 mb-1" htmlFor="purge-reason">
              {t("archiving.reason")}
            </label>
            <textarea
              id="purge-reason"
              rows={3}
              value={purgeReason}
              onChange={(e) => setPurgeReason(e.target.value)}
              placeholder={t("archiving.reason")}
              className="w-full border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
            />

            <label className="block text-xs font-medium text-gray-600 mt-3 mb-1" htmlFor="purge-word">
              {t("archiving.purge_confirm_input")}
            </label>
            <input
              id="purge-word"
              value={purgeWord}
              onChange={(e) => setPurgeWord(e.target.value)}
              placeholder={purgeWordExpected}
              className="w-full border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
            />

            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setPurgeOpen(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={purge}
                disabled={!purgeReady || busy === "purge"}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy === "purge" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {t("archiving.purge")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Archiving Rules (scheduled auto-archiving) ──────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Repeat className="w-4 h-4 text-gray-400" /> {t("archiving.rules.title", "Archiving rules")}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{t("archiving.rules.subtitle", "Automatically archive matching records on a recurring schedule")}</p>
          </div>
          <button onClick={() => { resetRuleForm(); setShowRuleModal(true); }} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> {t("archiving.rules.new", "New rule")}
          </button>
        </div>
        {rulesLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : rules.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t("archiving.rules.empty", "No archiving rules yet.")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.entity", "Entity")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.rules.criteria", "Criteria")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.rules.status", "Status")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.retention_days", "Retention (days)")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.rules.next_run", "Next run")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.rules.last_run", "Last run")}</th>
                <th className="text-left px-6 py-3 font-medium text-gray-500">{t("archiving.rules.last_result", "Last result")}</th>
                <th className="px-6 py-3"></th>
              </tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-4"><span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-gray-100 text-gray-600">{formatEntityType(r.entity_type)}</span></td>
                    <td className="px-6 py-4 text-gray-700 font-mono text-xs max-w-xs truncate" title={r.criteria}>{r.criteria}</td>
                    <td className="px-6 py-4">
                      {r.enabled ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-green-50 text-green-700 border-green-100">
                          <CheckCircle2 className="w-3 h-3" /> {t("archiving.rules.enabled", "Enabled")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-gray-100 text-gray-500 border-gray-200">
                          <XCircle className="w-3 h-3" /> {t("archiving.rules.disabled", "Disabled")}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500">{r.retention_days ?? "—"}</td>
                    <td className="px-6 py-4 text-gray-500">{r.next_run_at ? new Date(r.next_run_at).toLocaleString(uiLocale()) : "—"}</td>
                    <td className="px-6 py-4 text-gray-500">{r.last_run_at ? new Date(r.last_run_at).toLocaleString(uiLocale()) : t("archiving.rules.never", "Never")}</td>
                    <td className="px-6 py-4 text-gray-500 max-w-xs truncate" title={r.last_result || ""}>{r.last_result || "—"}</td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => deleteRule(r.id)} disabled={ruleDeleteBusy === r.id} className="text-gray-400 hover:text-red-600 disabled:opacity-50" aria-label={t("archiving.rules.delete", "Delete rule")} title={t("archiving.rules.delete", "Delete rule")}>
                        {ruleDeleteBusy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("archiving.new", "Archive record")}</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={addArchive} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("archiving.entity", "Entity type")}</label>
                  <select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {ENTITY_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("archiving.retention_days", "Retention (days)")}</label>
                  <input type="number" min={0} value={form.retention_days} onChange={(e) => setForm({ ...form, retention_days: parseInt(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("archiving.reason", "Reason")} *</label>
                <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save", "Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowRuleModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("archiving.rules.new", "New rule")}</h2>
              <button onClick={() => setShowRuleModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {ruleError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{ruleError}</div>}
            <form onSubmit={submitRule} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("archiving.entity", "Entity type")}</label>
                  <select value={ruleForm.entity_type} onChange={(e) => setRuleForm({ ...ruleForm, entity_type: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {RULE_ENTITY_TYPES.map((x) => <option key={x} value={x}>{formatEntityType(x)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("archiving.retention_days", "Retention (days)")}</label>
                  <input type="number" min={0} value={ruleForm.retention_days} onChange={(e) => setRuleForm({ ...ruleForm, retention_days: e.target.value })} placeholder={t("archiving.rules.retention_hint", "Leave blank for default")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">{t("archiving.rules.criteria", "Criteria")}</label>
                  <button type="button" onClick={toggleRuleMode} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                    {ruleForm.mode === "builder" ? t("archiving.rules.advanced_mode", "Edit as raw text") : t("archiving.rules.builder_mode", "Use condition builder")}
                  </button>
                </div>

                {ruleForm.mode === "builder" ? (
                  <div className="space-y-2">
                    {ruleForm.clauses.map((c, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          list="archiving-rule-fields"
                          value={c.field}
                          onChange={(e) => updateClause(idx, { field: e.target.value })}
                          placeholder={t("archiving.rules.field_placeholder", "field, e.g. status")}
                          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <select value={c.op} onChange={(e) => updateClause(idx, { op: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                          {RULE_OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                        </select>
                        <input
                          value={c.value}
                          onChange={(e) => updateClause(idx, { value: e.target.value })}
                          placeholder={t("archiving.rules.value_placeholder", "value, e.g. closed")}
                          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button type="button" onClick={() => removeClause(idx)} disabled={ruleForm.clauses.length <= 1} className="shrink-0 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed" aria-label={t("archiving.rules.remove_condition", "Remove condition")}>
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <datalist id="archiving-rule-fields">
                      <option value="status" />
                      <option value="age_days" />
                      <option value="severity" />
                      <option value="category" />
                      <option value="criticality" />
                      <option value="risk_tier" />
                    </datalist>
                    <button type="button" onClick={addClause} className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
                      <Plus className="w-3.5 h-3.5" /> {t("archiving.rules.add_condition", "Add condition")}
                    </button>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg text-xs font-mono text-gray-600 break-all">
                      {criteriaPreview || t("archiving.rules.criteria_preview_empty", "Add a condition to see the generated criteria")}
                    </div>
                  </div>
                ) : (
                  <textarea
                    value={ruleForm.advancedText}
                    onChange={(e) => setRuleForm({ ...ruleForm, advancedText: e.target.value })}
                    placeholder={t("archiving.rules.advanced_placeholder", "e.g. status=closed AND age_days>365")}
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
                <p className="text-xs text-gray-400 mt-1.5">{t("archiving.rules.hint", "Combine conditions with AND. Operators: = != > < >= <=. Numeric fields (e.g. age_days) compare as numbers; other fields compare as case-insensitive text.")}</p>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={ruleForm.enabled} onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                {t("archiving.rules.enabled_label", "Start enabled")}
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowRuleModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
                <button type="submit" disabled={ruleSaving} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {ruleSaving && <Loader2 className="w-4 h-4 animate-spin" />} {t("common.save", "Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
