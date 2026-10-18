/**
 * Maintain → retire a third party: edit, offboard, delete, reassess, keep the
 * assessment history and upload a new contract for an existing vendor.
 * Every action here maps to a vendor_manager / CISO route in vendors.py.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, Upload, X, History } from "lucide-react";
import { vendorsApi, type VendorAssessmentRecord } from "@/api/endpoints";
import { TIER_OPTIONS, STATUS_OPTIONS, INDUSTRY_OPTIONS, ENDED_STATUSES, industryKey, type Status } from "./vendorOptions";
import {
  PrescreenQuestions, PrescreenInsights, InsightList, emptyPrescreenResponses,
  prescreenToRegisterScore, prescreenAssessmentPayload, type PrescreenResult,
} from "./Prescreen";

/** Roles allowed by PATCH / DELETE / offboard / assessments / upload-contract. */
export const VENDOR_WRITE_ROLES = ["vendor_manager", "ciso", "tenant_admin", "super_admin"];

export interface LifecycleVendor {
  id: string;
  name: string;
  industry: string | null;
  country: string | null;
  website: string | null;
  risk_tier: string;
  status: string;
  risk_score: number | null;
  has_data_processing_agreement: boolean;
  contract_expiry: string | null;
  services_provided: string | null;
  primary_contact_name?: string | null;
  primary_contact_email?: string | null;
  offboarded_at?: string | null;
  offboarding_reason?: string | null;
}

const INPUT = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white";
const LABEL = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1";

function apiError(err: unknown, fallback: string): string {
  const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === "string" && d ? d : fallback;
}

function Shell({ title, onClose, children, wide }: {
  readonly title: string; readonly onClose: () => void; readonly children: React.ReactNode; readonly wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { readonly msg: string }) {
  return msg ? <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{msg}</p> : null;
}

// ── Edit ──────────────────────────────────────────────────────────────────────
export function EditVendorModal({ vendor, onClose, onSaved }: {
  readonly vendor: LifecycleVendor; readonly onClose: () => void; readonly onSaved: (v: LifecycleVendor) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: vendor.name,
    industry: vendor.industry ?? "",
    country: vendor.country ?? "",
    website: vendor.website ?? "",
    risk_tier: vendor.risk_tier,
    status: vendor.status,
    services_provided: vendor.services_provided ?? "",
    has_data_processing_agreement: vendor.has_data_processing_agreement,
    contract_expiry: (vendor.contract_expiry ?? "").slice(0, 10),
    primary_contact_name: vendor.primary_contact_name ?? "",
    primary_contact_email: vendor.primary_contact_email ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ended = ENDED_STATUSES.includes(vendor.status as Status);
  // An ended status is set by Offboard; from one, the edit can only reactivate.
  const statuses = STATUS_OPTIONS.filter(s => !ENDED_STATUSES.includes(s) || s === vendor.status);
  const industries = INDUSTRY_OPTIONS.includes(form.industry) || !form.industry ? INDUSTRY_OPTIONS : [form.industry, ...INDUSTRY_OPTIONS];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t("vendors.name_required")); return; }
    setSaving(true); setError("");
    try {
      const updated = await vendorsApi.update(vendor.id, {
        ...form,
        name: form.name.trim(),
        country: form.country.trim().toUpperCase().slice(0, 2) || null,
        website: form.website.trim() || null,
        industry: form.industry || null,
        services_provided: form.services_provided.trim() || null,
        contract_expiry: form.contract_expiry || null,
        primary_contact_name: form.primary_contact_name.trim() || null,
        primary_contact_email: form.primary_contact_email.trim() || null,
        // Unchanged status is not sent, so an ended vendor can be edited without reactivating it.
        status: form.status === vendor.status ? undefined : form.status,
      });
      onSaved(updated as unknown as LifecycleVendor);
      onClose();
    } catch (err) {
      setError(apiError(err, t("r2.vendors.error_save_failed")));
      setSaving(false);
    }
  }

  return (
    <Shell title={t("r2.vendors.edit_title")} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <ErrorBox msg={error} />
        <div>
          <label htmlFor="ve-name" className={LABEL}>{t("vendors.vendor_name_label")} *</label>
          <input id="ve-name" className={INPUT} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="ve-industry" className={LABEL}>{t("vendors.industry_label")}</label>
            <select id="ve-industry" className={INPUT} value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
              <option value="">{t("r2.common.none")}</option>
              {industries.map(o => <option key={o} value={o}>{t(`vendors_page.industry.${industryKey(o)}`, { defaultValue: o })}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ve-country" className={LABEL}>{t("vendors.country_code")}</label>
            <input id="ve-country" maxLength={2} className={`${INPUT} uppercase`} value={form.country}
              onChange={e => setForm(f => ({ ...f, country: e.target.value.toUpperCase() }))} />
          </div>
          <div>
            <label htmlFor="ve-tier" className={LABEL}>{t("vendors.risk_tier_label")}</label>
            <select id="ve-tier" className={INPUT} value={form.risk_tier} onChange={e => setForm(f => ({ ...f, risk_tier: e.target.value }))}>
              {TIER_OPTIONS.map(o => <option key={o} value={o}>{t(`vendors.tiers.${o}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ve-status" className={LABEL}>{t("vendors.status_label")}</label>
            <select id="ve-status" className={INPUT} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {statuses.map(o => <option key={o} value={o}>{t(`vocab.${o}`, { defaultValue: o.replaceAll("_", " ") })}</option>)}
            </select>
            {ended && <p className="text-xs text-gray-500 mt-1">{t("r2.vendors.reactivate_hint")}</p>}
          </div>
          <div>
            <label htmlFor="ve-expiry" className={LABEL}>{t("vendors.contract_expiry_label")}</label>
            <input id="ve-expiry" type="date" className={INPUT} value={form.contract_expiry}
              onChange={e => setForm(f => ({ ...f, contract_expiry: e.target.value }))} />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.has_data_processing_agreement} className="w-4 h-4 accent-blue-600"
                onChange={e => setForm(f => ({ ...f, has_data_processing_agreement: e.target.checked }))} />
              <span className="text-sm text-gray-700">{t("vendors.dpa_signed")}</span>
            </label>
          </div>
        </div>
        <div>
          <label htmlFor="ve-services" className={LABEL}>{t("vendors.services_label")}</label>
          <input id="ve-services" className={INPUT} value={form.services_provided}
            onChange={e => setForm(f => ({ ...f, services_provided: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="ve-website" className={LABEL}>{t("vendors.website_label")}</label>
          <input id="ve-website" type="url" className={INPUT} value={form.website}
            onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="ve-cname" className={LABEL}>{t("r2.vendors.contact_name")}</label>
            <input id="ve-cname" className={INPUT} value={form.primary_contact_name}
              onChange={e => setForm(f => ({ ...f, primary_contact_name: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="ve-cemail" className={LABEL}>{t("r2.vendors.contact_email")}</label>
            <input id="ve-cemail" type="email" className={INPUT} value={form.primary_contact_email}
              onChange={e => setForm(f => ({ ...f, primary_contact_email: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">{t("common.cancel")}</button>
          <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("r2.common.save_changes")}
          </button>
        </div>
      </form>
    </Shell>
  );
}

// ── Offboard ──────────────────────────────────────────────────────────────────
export function OffboardVendorModal({ vendor, onClose, onSaved }: {
  readonly vendor: LifecycleVendor; readonly onClose: () => void; readonly onSaved: (v: LifecycleVendor) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<"offboarding" | "inactive">("inactive");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!reason.trim()) { setError(t("r2.vendors.error_reason_required")); return; }
    if (!date) { setError(t("r2.vendors.error_date_required")); return; }
    setSaving(true); setError("");
    try {
      const updated = await vendorsApi.offboard(vendor.id, { status: target, effective_date: date, reason: reason.trim() });
      onSaved(updated as unknown as LifecycleVendor);
      onClose();
    } catch (err) {
      setError(apiError(err, t("r2.vendors.error_save_failed")));
      setSaving(false);
    }
  }

  return (
    <Shell title={t("r2.vendors.offboard_title", { name: vendor.name })} onClose={onClose}>
      <p className="text-sm text-gray-600">{t("r2.vendors.offboard_body")}</p>
      <ErrorBox msg={error} />
      <fieldset className="space-y-2">
        <legend className={LABEL}>{t("vendors.status_label")}</legend>
        {(["offboarding", "inactive"] as const).map(s => (
          <label key={s} className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="radio" name="vo-target" checked={target === s} onChange={() => setTarget(s)} className="mt-1 accent-blue-600" />
            <span><b>{t(`vocab.${s}`, { defaultValue: s })}</b> — {t(`r2.vendors.offboard_${s}_hint`)}</span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="vo-date" className={LABEL}>{t("r2.vendors.effective_date")} *</label>
        <input id="vo-date" type="date" className={INPUT} value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div>
        <label htmlFor="vo-reason" className={LABEL}>{t("r2.common.reason")} *</label>
        <textarea id="vo-reason" rows={3} className={`${INPUT} resize-none`} value={reason} onChange={e => setReason(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
        <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t("r2.vendors.offboard")}
        </button>
      </div>
    </Shell>
  );
}

// ── Delete ────────────────────────────────────────────────────────────────────
export function DeleteVendorDialog({ vendor, onClose, onDeleted }: {
  readonly vendor: LifecycleVendor; readonly onClose: () => void; readonly onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function doDelete() {
    setBusy(true); setError("");
    try {
      await vendorsApi.delete(vendor.id);
      onDeleted();
    } catch (err) {
      // 409 = contracts of record: the server's message says to offboard instead.
      setError(apiError(err, t("r2.vendors.error_delete_failed")));
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" role="alertdialog" aria-modal="true">
        <h3 className="font-semibold text-gray-900">{t("r2.vendors.delete_confirm_title")}</h3>
        <p className="text-sm text-gray-600">{t("r2.vendors.delete_confirm_body", { name: vendor.name })}</p>
        <ErrorBox msg={error} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
          <button onClick={doDelete} disabled={busy} className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("r2.common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reassess (prescreen on an existing vendor) ────────────────────────────────
export function ReassessVendorModal({ vendor, onClose, onSaved }: {
  readonly vendor: LifecycleVendor; readonly onClose: () => void; readonly onSaved: (newScore: number | null) => void;
}) {
  const { t } = useTranslation();
  const [responses, setResponses] = useState<Record<string, string>>(emptyPrescreenResponses);
  const [result, setResult] = useState<PrescreenResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setBusy(true); setError("");
    try {
      const r = await vendorsApi.prescreenQuestionnaire({
        vendor_name: vendor.name,
        vendor_industry: vendor.industry ?? undefined,
        vendor_country: vendor.country ?? undefined,
        responses,
      }) as PrescreenResult;
      setResult(r);
    } catch (err) {
      setError(apiError(err, t("vendors_page.ai_analysis_failed", { error: "" })));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result) return;
    setBusy(true); setError("");
    try {
      const score = prescreenToRegisterScore(result.initial_risk_score);
      await vendorsApi.createAssessment(vendor.id, prescreenAssessmentPayload(result, responses, score));
      onSaved(score);
      onClose();
    } catch (err) {
      setError(apiError(err, t("r2.vendors.error_save_failed")));
      setBusy(false);
    }
  }

  return (
    <Shell title={t("r2.vendors.reassess_title", { name: vendor.name })} onClose={onClose} wide>
      <ErrorBox msg={error} />
      {result
        ? <PrescreenInsights result={result} suggestedScore={prescreenToRegisterScore(result.initial_risk_score)} />
        : <PrescreenQuestions responses={responses} onChange={setResponses} />}
      <div className="flex gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={result ? () => setResult(null) : onClose} disabled={busy}
          className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {result ? `← ${t("common.back")}` : t("common.cancel")}
        </button>
        {result ? (
          <button type="button" onClick={save} disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} ✓ {t("r2.vendors.save_assessment")}
          </button>
        ) : (
          <button type="button" onClick={analyze} disabled={busy}
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {t("vendors.analyze_with_ai", "Analyze with AI")}
          </button>
        )}
      </div>
    </Shell>
  );
}

// ── Assessment history ────────────────────────────────────────────────────────
export function VendorAssessmentsTab({ vendor, canWrite, onReassess, refreshKey, locale }: {
  readonly vendor: LifecycleVendor; readonly canWrite: boolean; readonly onReassess: () => void;
  readonly refreshKey: number; readonly locale: string;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<VendorAssessmentRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null); setFailed(false);
    vendorsApi.listAssessments(vendor.id)
      .then(r => { if (alive) setRows(r); })
      .catch(() => { if (alive) { setFailed(true); setRows([]); } });
    return () => { alive = false; };
  }, [vendor.id, refreshKey]);

  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1"><History className="w-3.5 h-3.5" />{t("r2.vendors.assessments_title")}</p>
        {canWrite && (
          <button onClick={onReassess} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg">
            <Sparkles className="w-3.5 h-3.5" /> {t("r2.vendors.reassess")}
          </button>
        )}
      </div>
      {rows === null && <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>}
      {failed && <p className="text-sm text-red-600">{t("r2.vendors.assessments_failed")}</p>}
      {rows && !failed && rows.length === 0 && <p className="text-sm text-gray-400">{t("r2.vendors.assessments_empty")}</p>}
      {rows?.map((a, i) => (
        <div key={a.id} className="border border-gray-100 rounded-xl p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {a.kind === "ai_analysis" ? t("r2.vendors.kind_ai_analysis") : t("r2.vendors.kind_prescreen")}
                {i === 0 && a.status === "approved" && (
                  <span className="ms-2 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-700">{t("r2.vendors.current")}</span>
                )}
              </p>
              <p className="text-xs text-gray-500 mt-0.5"><bdi>{new Date(a.created_at).toLocaleString(locale)}</bdi></p>
            </div>
            <div className="text-right shrink-0">
              {a.assessment_score != null && <p className="text-sm font-bold text-gray-800">{a.assessment_score}/10</p>}
              {a.applied_risk_score != null && <p className="text-xs text-gray-500">{t("vendors.risk_score_label")}: {a.applied_risk_score}</p>}
            </div>
          </div>
          {a.narrative && (
            <button onClick={() => setOpen(open === a.id ? null : a.id)} className="text-xs font-medium text-blue-600 hover:text-blue-800 mt-2">
              {open === a.id ? t("r2.risks.hide_changes") : t("r2.vendors.show_details")}
            </button>
          )}
          {open === a.id && (
            <div className="mt-2 space-y-3">
              <div className="text-xs text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto bg-gray-50 rounded-lg p-2">{a.narrative}</div>
              <InsightList items={a.result?.strengths} title={`✓ ${t("vendors_page.strengths")}`} titleCls="text-green-700" itemCls="bg-green-50" />
              <InsightList items={a.result?.concerns} title={`⚠ ${t("vendors_page.concerns")}`} titleCls="text-yellow-700" itemCls="bg-yellow-50" />
              <InsightList items={a.result?.red_flags} title={`🚩 ${t("vendors_page.red_flags")}`} titleCls="text-red-700" itemCls="bg-red-50" />
              {a.answers && Object.keys(a.answers).length > 0 && (
                <p className="text-xs text-gray-500">
                  {t("r2.vendors.answers_summary", {
                    yes: Object.values(a.answers).filter(v => v === "yes").length,
                    no: Object.values(a.answers).filter(v => v === "no").length,
                    na: Object.values(a.answers).filter(v => v === "na").length,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── New contract for an existing vendor ───────────────────────────────────────
export function UploadContractPanel({ vendor, onUploaded }: {
  readonly vendor: LifecycleVendor; readonly onUploaded: (newExpiry: string | null) => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState((vendor.contract_expiry ?? "").slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uploaded = useRef<File | null>(null);

  async function upload() {
    if (!file) { setError(t("r2.vendors.error_file_required")); return; }
    setBusy(true); setError("");
    try {
      // Same entry point as the wizard: AI review → CISO review → send to vendor.
      // A retry after the expiry step failed does not upload the file again
      // (the server also answers a same-bytes re-upload with the contract on file).
      if (uploaded.current !== file) {
        await vendorsApi.uploadContract(vendor.id, file);
        uploaded.current = file;
      }
      // A renewal moves the expiry that drives the 90/60/30/7/0-day alerts.
      const newExpiry = expiry || null;
      if (newExpiry !== (vendor.contract_expiry ?? "").slice(0, 10) && newExpiry) {
        await vendorsApi.update(vendor.id, { contract_expiry: newExpiry });
      }
      setOpen(false); setFile(null); uploaded.current = null;
      onUploaded(newExpiry);
    } catch (err) {
      setError(uploaded.current === file
        ? t("r2b.vendors.contract_saved_expiry_failed", { error: apiError(err, "") })
        : apiError(err, t("r2.vendors.error_upload_failed")));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900">
        <Upload className="w-3.5 h-3.5" /> {t("r2.vendors.upload_contract")}
      </button>
    );
  }
  return (
    <div className="w-full border border-blue-100 bg-blue-50/50 rounded-xl p-3 space-y-3 mt-2">
      <ErrorBox msg={error} />
      <div>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.txt" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-300 rounded-lg p-3 text-sm text-gray-600 hover:border-blue-400 bg-white">
          {file ? <>✓ <strong>{file.name}</strong></> : t("vendors.upload_contract_hint", "Click to upload contract (PDF, DOCX, XLSX, XLS, TXT)")}
        </button>
        <p className="text-xs text-gray-500 mt-1">{t("r2.vendors.upload_contract_flow")}</p>
      </div>
      <div>
        <label htmlFor="vu-expiry" className={LABEL}>{t("r2.vendors.new_contract_expiry")}</label>
        <input id="vu-expiry" type="date" className={INPUT} value={expiry} onChange={e => setExpiry(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={() => { setOpen(false); setFile(null); setError(""); }} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">{t("common.cancel")}</button>
        <button onClick={upload} disabled={busy} className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("r2.vendors.upload")}
        </button>
      </div>
    </div>
  );
}
