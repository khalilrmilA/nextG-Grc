import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, Trash2, Save, GitCommitHorizontal, Lock, ChevronRight } from "lucide-react";
import { incidentsApi } from "@/api/endpoints";
import { MultiSelect } from "@/components/common/MultiSelect";
import i18n from "@/i18n";

// Dates follow the UI language (Arabic keeps Latin digits).
const uiLocale = () => { const l = i18n.language || "en"; return l.startsWith("fr") ? "fr-FR" : l.startsWith("ar") ? "ar-u-nu-latn" : "en-US"; };

/**
 * Incident detail / edit modal.
 *
 * Editable fields mirror the backend's IncidentUpdate schema
 * (backend/app/api/v1/endpoints/incidents.py). The PATCH handler skips any
 * field sent as null, so only fields that actually changed are sent — that way
 * saving one field never clobbers another that someone else just edited.
 * Strings can be cleared (sent as ""); numbers cannot be cleared back to null
 * through the API, so an emptied number field is simply not sent.
 *
 * linked_risks / linked_controls / linked_vendors are patchable too, but this
 * page loads no pickers for them, so they are shown read-only (count) and never
 * sent — they are left exactly as they are.
 */

export const INCIDENT_CATEGORIES = [
  "data_breach", "unauthorized_access", "malware", "phishing",
  "dos_attack", "insider_threat", "physical_security", "system_outage",
  "policy_violation", "other",
];
export const INCIDENT_SEVERITIES = ["critical", "high", "medium", "low"];
/** IncidentStatus enum, in lifecycle order. */
export const INCIDENT_STATUSES = ["open", "investigating", "contained", "resolved", "closed", "post_mortem"];

const STATUS_PILL: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  investigating: "bg-yellow-100 text-yellow-700 border-yellow-200",
  contained: "bg-orange-100 text-orange-700 border-orange-200",
  resolved: "bg-green-100 text-green-700 border-green-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  post_mortem: "bg-purple-100 text-purple-700 border-purple-200",
};

function humanise(v: string): string {
  return v ? v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "";
}

/** Backend timestamps are free-form strings, usually naive-UTC ISO
 *  (datetime.utcnow().isoformat()). Treat a zone-less value as UTC. */
function parseTs(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(hasZone || !s.includes("T") ? s : s + "Z");
  return isNaN(d.getTime()) ? null : d;
}

/** Timestamp -> value for <input type="datetime-local"> (local time). */
function toLocalInput(v: string | null | undefined): string {
  const d = parseTs(v);
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTs(v: string | null | undefined): string {
  const d = parseTs(v);
  return d ? d.toLocaleString(uiLocale()) : (v ? String(v) : "-");
}

const listToText = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
const textToList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const TEXT_FIELDS = [
  "title", "description", "business_impact", "root_cause", "containment_actions",
  "remediation_actions", "lessons_learned", "post_mortem_url", "regulatory_reference",
] as const;
const TS_FIELDS = ["detected_at", "contained_at", "resolved_at", "notification_sent_at"] as const;
const LIST_TEXT_FIELDS = ["affected_systems", "data_types_affected", "tags"] as const;

function formFrom(inc: any) {
  const f: Record<string, any> = {
    category: inc.category || "other",
    severity: inc.severity || "medium",
    status: inc.status || "open",
    assigned_to_id: inc.assigned_to_id || "",
    affected_asset_ids: [...(inc.affected_asset_ids || [])],
    linked_vulnerabilities: [...(inc.linked_vulnerabilities || [])],
    affected_users_count: inc.affected_users_count ?? "",
    financial_impact: inc.financial_impact ?? "",
    breach_notification_required: !!inc.breach_notification_required,
  };
  TEXT_FIELDS.forEach((k) => { f[k] = inc[k] ?? ""; });
  TS_FIELDS.forEach((k) => { f[k] = toLocalInput(inc[k]); });
  LIST_TEXT_FIELDS.forEach((k) => { f[k] = listToText(inc[k]); });
  return f;
}

/** Only the fields that differ from what was loaded. */
function diff(orig: Record<string, any>, cur: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [...TEXT_FIELDS, "category", "severity", "status"]) {
    if (cur[k] !== orig[k]) out[k] = cur[k];
  }
  if (cur.assigned_to_id !== orig.assigned_to_id && cur.assigned_to_id) out.assigned_to_id = cur.assigned_to_id;
  for (const k of TS_FIELDS) {
    if (cur[k] !== orig[k]) {
      const d = cur[k] ? new Date(cur[k]) : null;
      out[k] = d && !isNaN(d.getTime()) ? d.toISOString() : "";
    }
  }
  for (const k of LIST_TEXT_FIELDS) {
    const a = textToList(orig[k]), b = textToList(cur[k]);
    if (!sameList(a, b)) out[k] = b;
  }
  for (const k of ["affected_asset_ids", "linked_vulnerabilities"]) {
    if (!sameList(orig[k], cur[k])) out[k] = cur[k];
  }
  if (cur.breach_notification_required !== orig.breach_notification_required) {
    out.breach_notification_required = cur.breach_notification_required;
  }
  if (String(cur.affected_users_count) !== String(orig.affected_users_count) && cur.affected_users_count !== "") {
    out.affected_users_count = Math.max(0, parseInt(String(cur.affected_users_count), 10) || 0);
  }
  if (String(cur.financial_impact) !== String(orig.financial_impact) && cur.financial_impact !== "") {
    out.financial_impact = Math.max(0, Number(cur.financial_impact) || 0);
  }
  return out;
}

const inputCls = "w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1";

interface Props {
  incident: any;
  canEdit: boolean;
  canDelete: boolean;
  vulnOptions: any[];
  assetOptions: any[];
  userNames: Record<string, string>;
  drafting: boolean;
  onCreateScenario: (id: string) => void;
  onClose: () => void;
  /** Called after a successful save or delete so the page reloads list + stats. */
  onChanged: () => void;
}

export default function IncidentDetailModal({
  incident, canEdit, canDelete, vulnOptions, assetOptions, userNames,
  drafting, onCreateScenario, onClose, onChanged,
}: Props) {
  const { t } = useTranslation();
  const [inc, setInc] = useState<any>(incident);
  const [orig, setOrig] = useState<Record<string, any>>(() => formFrom(incident));
  const [form, setForm] = useState<Record<string, any>>(() => formFrom(incident));
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function apply(fresh: any) {
    setInc(fresh);
    const f = formFrom(fresh);
    setOrig(f);
    setForm(f);
  }

  // The list row may be stale; fetch the authoritative record on open.
  useEffect(() => {
    let alive = true;
    incidentsApi.get(incident.id).then((fresh: any) => { if (alive) apply(fresh); }).catch(() => {});
    return () => { alive = false; };
  }, [incident.id]);

  const patch = useMemo(() => diff(orig, form), [orig, form]);
  const dirty = Object.keys(patch).length > 0;

  const set = (k: string, v: any) => { setForm((f) => ({ ...f, [k]: v })); setNotice(""); };
  const errDetail = (err: any, fallback: string) => {
    const d = err?.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x: any) => x?.msg || JSON.stringify(x)).join("; ");
    return fallback;
  };

  async function save() {
    if (!dirty) return;
    if ("title" in patch && !String(patch.title).trim()) {
      setError(t("incidents.error_title_required", "Title is required"));
      return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const fresh = await incidentsApi.update(inc.id, patch);
      apply(fresh);
      setNotice(t("incidents.saved", "Incident saved"));
      onChanged();
    } catch (err: any) {
      setError(errDetail(err, t("incidents.error_update_failed", "Failed to update incident")));
    } finally {
      setSaving(false);
    }
  }

  /** Quick status change: saved immediately. Stamps contained_at / resolved_at
   *  with "now" when moving to that stage and the timestamp is still empty
   *  (resolved_at feeds the average-resolution-time stat). */
  async function changeStatus(s: string) {
    if (s === inc.status || statusSaving) return;
    setStatusSaving(s); setError(""); setNotice("");
    const body: Record<string, unknown> = { status: s };
    const now = new Date().toISOString();
    if (s === "contained" && !inc.contained_at) body.contained_at = now;
    if (s === "resolved" && !inc.resolved_at) body.resolved_at = now;
    try {
      const fresh = await incidentsApi.update(inc.id, body);
      // Keep any unsaved edits the user has in other fields.
      const freshForm = formFrom(fresh);
      setInc(fresh);
      setOrig(freshForm);
      setForm((cur) => {
        const merged: Record<string, any> = { ...cur, status: freshForm.status };
        if (body.contained_at) merged.contained_at = freshForm.contained_at;
        if (body.resolved_at) merged.resolved_at = freshForm.resolved_at;
        // Fields the user had not touched follow the fresh record.
        for (const k of Object.keys(freshForm)) {
          if (!(k in patch)) merged[k] = freshForm[k];
        }
        return merged;
      });
      setNotice(t("incidents.status_updated", "Status updated"));
      onChanged();
    } catch (err: any) {
      setError(errDetail(err, t("incidents.error_update_failed", "Failed to update incident")));
    } finally {
      setStatusSaving(null);
    }
  }

  async function doDelete() {
    setDeleting(true); setError("");
    try {
      await incidentsApi.delete(inc.id);
      onChanged();
      onClose();
    } catch (err: any) {
      setError(errDetail(err, t("incidents.error_delete_failed", "Failed to delete incident")));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const statusIdx = INCIDENT_STATUSES.indexOf(inc.status);
  const nextStatus = statusIdx >= 0 && statusIdx < INCIDENT_STATUSES.length - 1 ? INCIDENT_STATUSES[statusIdx + 1] : null;
  const vocab = (v: string) => String(t(`vocab.${v}` as never, humanise(v)));
  const userName = (id: string | null | undefined) => (id ? userNames[id] || id : "-");
  const hasUserList = Object.keys(userNames).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && !deleting && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{inc.title}</h2>
            <p className="text-xs text-gray-500 mt-1">
              {t("incidents.reported_by", "Reported by")} {userName(inc.reporter_id)}
              {" · "}{t("incidents.created_on", "Created")} {fmtTs(inc.created_at)}
              {" · "}{t("incidents.updated_on", "Updated")} {fmtTs(inc.updated_at)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!canEdit && (
            <div className="flex items-center gap-2 p-3 bg-gray-50 text-gray-600 rounded-xl text-sm">
              <Lock className="w-4 h-4" /> {t("incidents.read_only_notice", "Read-only: only security analysts, CISOs and administrators can edit incidents.")}
            </div>
          )}
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
          {notice && <div className="p-3 bg-green-50 text-green-700 rounded-xl text-sm">{notice}</div>}

          {/* Status lifecycle */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">{t("incidents.col_status", "Status")}</span>
              {canEdit && nextStatus && (
                <button
                  type="button"
                  onClick={() => changeStatus(nextStatus)}
                  disabled={!!statusSaving}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  {t("incidents.advance_to", "Move to")} {vocab(nextStatus)} <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {INCIDENT_STATUSES.map((s, i) => {
                const active = s === inc.status;
                const passed = statusIdx >= 0 && i < statusIdx;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!canEdit || !!statusSaving || active}
                    onClick={() => changeStatus(s)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                      active ? STATUS_PILL[s] + " ring-2 ring-offset-1 ring-blue-400"
                        : passed ? "bg-gray-50 text-gray-500 border-gray-200"
                        : "bg-white text-gray-600 border-gray-200"
                    } ${canEdit && !active ? "hover:bg-gray-100 cursor-pointer" : "cursor-default"} disabled:opacity-100`}
                  >
                    {statusSaving === s && <Loader2 className="w-3 h-3 animate-spin" />}
                    {vocab(s)}
                  </button>
                );
              })}
            </div>
          </div>

          <fieldset disabled={!canEdit || saving} className="space-y-6">
            {/* Overview */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("incidents.section_overview", "Overview")}</h3>
              <div>
                <label className={labelCls}>{t("incidents.form_title", "Title")} *</label>
                <input value={form.title} onChange={(e) => set("title", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("incidents.form_description", "Description")}</label>
                <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} className={inputCls} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>{t("incidents.form_category", "Category")}</label>
                  <select value={form.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
                    {INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{vocab(c)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("incidents.form_severity", "Severity")}</label>
                  <select value={form.severity} onChange={(e) => set("severity", e.target.value)} className={inputCls}>
                    {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{vocab(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("incidents.col_assigned", "Assigned To")}</label>
                  {hasUserList ? (
                    <select value={form.assigned_to_id} onChange={(e) => set("assigned_to_id", e.target.value)} className={inputCls}>
                      <option value="" disabled>{t("incidents.unassigned", "Unassigned")}</option>
                      {Object.entries(userNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  ) : (
                    <input value={userName(inc.assigned_to_id)} disabled className={inputCls} />
                  )}
                </div>
              </div>
              <div>
                <label className={labelCls}>{t("incidents.form_tags", "Tags")}</label>
                <input value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder={t("incidents.comma_separated", "Comma-separated")} className={inputCls} />
              </div>
            </section>

            {/* Timeline */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("incidents.section_timeline", "Timeline")}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {([
                  ["detected_at", t("incidents.col_detected", "Detected")],
                  ["contained_at", t("incidents.form_contained_at", "Contained")],
                  ["resolved_at", t("incidents.form_resolved_at", "Resolved")],
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <label className={labelCls}>{label}</label>
                    <input type="datetime-local" value={form[k]} onChange={(e) => set(k, e.target.value)} className={inputCls} />
                  </div>
                ))}
              </div>
            </section>

            {/* Scope & impact */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("incidents.section_impact", "Scope & impact")}</h3>
              <div>
                <label className={labelCls}>{t("incidents.form_linked_assets", "Linked assets")}</label>
                <MultiSelect
                  options={assetOptions.map((a) => ({ id: a.id, label: a.name || a.id }))}
                  selected={form.affected_asset_ids}
                  onChange={(ids) => set("affected_asset_ids", ids)}
                  placeholder={t("incidents.select_assets", "Select affected asset(s)…")}
                  emptyLabel={t("incidents.no_assets_found", "No assets found")}
                />
              </div>
              <div>
                <label className={labelCls}>{t("incidents.form_linked_vulnerabilities", "Linked vulnerabilities")}</label>
                <MultiSelect
                  options={vulnOptions.map((v) => ({ id: v.id, label: `${v.ref_id || v.id}${v.title ? " — " + v.title : ""}` }))}
                  selected={form.linked_vulnerabilities}
                  onChange={(ids) => set("linked_vulnerabilities", ids)}
                  placeholder={t("incidents.select_vulnerabilities", "Select vulnerabilities…")}
                  emptyLabel={t("incidents.no_vulnerabilities", "No vulnerabilities found")}
                />
              </div>
              <div>
                <label className={labelCls}>{t("incidents.form_affected_systems", "Affected systems (free text)")}</label>
                <input value={form.affected_systems} onChange={(e) => set("affected_systems", e.target.value)} placeholder={t("incidents.affected_systems_placeholder", "e.g. web-server-01, payment-gateway")} className={inputCls} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>{t("incidents.form_affected_users", "Affected users (count)")}</label>
                  <input type="number" min={0} value={form.affected_users_count} onChange={(e) => set("affected_users_count", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("incidents.form_financial_impact", "Financial impact")}</label>
                  <input type="number" min={0} step="0.01" value={form.financial_impact} onChange={(e) => set("financial_impact", e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>{t("incidents.form_data_types", "Data types affected")}</label>
                <input value={form.data_types_affected} onChange={(e) => set("data_types_affected", e.target.value)} placeholder={t("incidents.data_types_placeholder", "e.g. PII, payment card data")} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t("incidents.form_business_impact", "Business impact")}</label>
                <textarea value={form.business_impact} onChange={(e) => set("business_impact", e.target.value)} rows={2} className={inputCls} />
              </div>
              {(inc.linked_risks?.length || inc.linked_controls?.length || inc.linked_vendors?.length) ? (
                <p className="text-xs text-gray-500">
                  {t("incidents.linked_counts", "Also linked: {{risks}} risk(s), {{controls}} control(s), {{vendors}} vendor(s)", {
                    risks: inc.linked_risks?.length || 0, controls: inc.linked_controls?.length || 0, vendors: inc.linked_vendors?.length || 0,
                  })}
                </p>
              ) : null}
            </section>

            {/* Response */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("incidents.section_response", "Response & resolution")}</h3>
              {([
                ["containment_actions", t("incidents.form_containment_actions", "Containment actions")],
                ["root_cause", t("incidents.form_root_cause", "Root cause")],
                ["remediation_actions", t("incidents.form_remediation_actions", "Remediation actions")],
                ["lessons_learned", t("incidents.form_lessons_learned", "Lessons learned")],
              ] as const).map(([k, label]) => (
                <div key={k}>
                  <label className={labelCls}>{label}</label>
                  <textarea value={form[k]} onChange={(e) => set(k, e.target.value)} rows={2} className={inputCls} />
                </div>
              ))}
              <div>
                <label className={labelCls}>{t("incidents.form_post_mortem_url", "Post-mortem URL")}</label>
                <input type="url" value={form.post_mortem_url} onChange={(e) => set("post_mortem_url", e.target.value)} placeholder="https://" className={inputCls} />
              </div>
            </section>

            {/* Breach notification */}
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("incidents.section_breach", "Breach notification")}</h3>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="edit-breach" checked={form.breach_notification_required} onChange={(e) => set("breach_notification_required", e.target.checked)} className="rounded border-gray-300" />
                <label htmlFor="edit-breach" className="text-sm text-gray-700">{t("incidents.breach_notification", "Breach notification required")}</label>
              </div>
              {(form.breach_notification_required || form.notification_sent_at || form.regulatory_reference) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>{t("incidents.form_notification_sent_at", "Notification sent")}</label>
                    <input type="datetime-local" value={form.notification_sent_at} onChange={(e) => set("notification_sent_at", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("incidents.form_regulatory_reference", "Regulatory reference")}</label>
                    <input value={form.regulatory_reference} onChange={(e) => set("regulatory_reference", e.target.value)} placeholder={t("incidents.regulatory_reference_placeholder", "e.g. regulator case number")} className={inputCls} />
                  </div>
                </div>
              )}
            </section>
          </fieldset>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            {canDelete && !confirmDelete && (
              <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-xl">
                <Trash2 className="w-4 h-4" /> {t("common.delete", "Delete")}
              </button>
            )}
            {confirmDelete && (
              <div className="flex items-center gap-2 bg-red-50 rounded-xl px-3 py-1.5">
                <span className="text-sm text-red-700">{t("incidents.confirm_delete", "Delete this incident permanently?")}</span>
                <button type="button" onClick={doDelete} disabled={deleting} className="inline-flex items-center gap-1 bg-red-600 text-white px-3 py-1 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.delete", "Delete")}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="px-2 py-1 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel", "Cancel")}</button>
              </div>
            )}
            <button
              type="button"
              onClick={() => onCreateScenario(inc.id)}
              disabled={drafting}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-xl disabled:opacity-50"
            >
              {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCommitHorizontal className="w-4 h-4" />}
              {t("incidents.create_scenario", "Create risk scenario from this incident")}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              {canEdit ? t("common.cancel", "Cancel") : t("common.close", "Close")}
            </button>
            {canEdit && (
              <button type="button" onClick={save} disabled={!dirty || saving} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t("common.save", "Save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
