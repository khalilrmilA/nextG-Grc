/**
 * AuditsPage — « Registre de tous les audits réalisés » (objectifs 4 & 8).
 *
 * The register is now the filterable table GET /audits/register answers with:
 * one row per engagement, its campaign, its perimeter, its cadence, its lead
 * auditor (interne or externe), its report state and its findings roll-up —
 * and every row opens the engagement's own dossier.
 *
 * Soft-deleted engagements are excluded by default; an administrator can show
 * the withdrawn ones and put one back.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, Plus, AlertTriangle, Calendar, Tag, X,
  ChevronRight, Sparkles, UserPlus, Users, Loader2,
  Trash2, Shield, RefreshCw, CheckCircle, Search, Filter,
  Building2, Layers, Undo2, FileText, Network, Pencil,
  BarChart3, ChevronDown,
} from "lucide-react";
import AuditPlanModal from "../components/ai/AuditPlanModal";
import CreateAuditorModal from "../components/features/compliance/CreateAuditorModal";
import ModuleDashboard from "@/components/dashboards/ModuleDashboard";
import i18n from "@/i18n";

/* ── The register strings with no locale entry ───────────────────────────────
 * `audits.register_truncated` only had an English defaultValue, and
 * `audit_report.nonconformities_count` had NO key and NO default at all, so the
 * non-conformity badge on every row printed the raw key
 * "audit_report.nonconformities_count" — in all three languages.
 *
 * Five more keys were printing raw on this screen, verified against
 * locales/{en,fr,ar}.ts, which define none of them and no call site supplies a
 * defaultValue: `audits.form_recurrence` (the cadence column header, the
 * cadence filter's title and its first option, and the form label),
 * `audits.form_recurrence_hint`, `audits.recurrence_{none,annual,semi_annual}`
 * (every option of both cadence selects), `dashboard.show_widget` (the admin
 * « show withdrawn engagements » checkbox — which was also the WRONG key: it
 * names a dashboard widget, not a soft-delete filter, so it is replaced by
 * `audits.show_withdrawn`) and `common.error_generic`. A raw i18n key on a
 * table header of the audit register is not a rough edge on a tender screen.
 *
 * It is called with `count`, which puts i18next into plural resolution: the
 * bare key is never consulted, only the _one/_other suffixes (and, for Arabic,
 * the full six-category set that Intl.PluralRules defines). All of them are
 * supplied below. Registered the way i18n/index.ts registers eliteLocales and
 * gapfills, NON-DESTRUCTIVELY — locales/*.ts belong to another lane in this
 * wave and a real key there wins. See needs_integration. */
const AUDITS_I18N: Record<string, Record<string, Record<string, string>>> = {
  en: {
    common: {
      error_generic: "Something went wrong. Nothing was changed.",
    },
    audits: {
      register_truncated: "Only the {{n}} most recent engagements are shown; the figures above cover those alone. Narrow the filters to see the rest.",
      form_recurrence: "Cadence",
      form_recurrence_hint: "A recurring engagement is re-planned automatically once it is closed.",
      recurrence_none: "One-off",
      recurrence_annual: "Annual",
      recurrence_semi_annual: "Every six months",
      show_withdrawn: "Also show withdrawn engagements",
    },
    audit_report: {
      nonconformities_count_one: "{{count}} nonconformity",
      nonconformities_count_other: "{{count}} nonconformities",
    },
  },
  fr: {
    common: {
      error_generic: "Une erreur est survenue. Rien n'a été modifié.",
    },
    audits: {
      register_truncated: "Seules les {{n}} missions les plus récentes sont affichées ; les chiffres ci-dessus ne portent que sur celles-ci. Affinez les filtres pour voir les autres.",
      form_recurrence: "Périodicité",
      form_recurrence_hint: "Une mission récurrente est replanifiée automatiquement dès sa clôture.",
      recurrence_none: "Ponctuelle",
      recurrence_annual: "Annuelle",
      recurrence_semi_annual: "Semestrielle",
      show_withdrawn: "Afficher aussi les missions retirées",
    },
    audit_report: {
      nonconformities_count_one: "{{count}} non-conformité",
      nonconformities_count_many: "{{count}} non-conformités",
      nonconformities_count_other: "{{count}} non-conformités",
    },
  },
  ar: {
    common: {
      error_generic: "حدث خطأ. لم يتغيّر شيء.",
    },
    audits: {
      register_truncated: "تُعرض فقط أحدث {{n}} مهمة؛ الأرقام أعلاه تخصها وحدها. ضيّق عوامل التصفية لعرض البقية.",
      form_recurrence: "الدورية",
      form_recurrence_hint: "تُعاد جدولة المهمة الدورية تلقائياً بمجرد إغلاقها.",
      recurrence_none: "مهمة لمرة واحدة",
      recurrence_annual: "سنوية",
      recurrence_semi_annual: "نصف سنوية",
      show_withdrawn: "إظهار المهام المسحوبة أيضاً",
    },
    audit_report: {
      nonconformities_count_zero: "لا حالات عدم مطابقة",
      nonconformities_count_one: "حالة عدم مطابقة واحدة",
      nonconformities_count_two: "حالتا عدم مطابقة",
      nonconformities_count_few: "{{count}} حالات عدم مطابقة",
      nonconformities_count_many: "{{count}} حالة عدم مطابقة",
      nonconformities_count_other: "{{count}} حالة عدم مطابقة",
    },
  },
};
for (const lng of ["en", "fr", "ar"]) {
  i18n.addResourceBundle(lng, "translation", AUDITS_I18N[lng], true, false);
}
import {
  auditsApi, usersApi, complianceApi, auditCampaignsApi, auditGridsApi,
  frameworksApi, assetGraphApi, assetsApi,
} from "@/api/endpoints";
import type { AuditorUser, AuditorAssignmentRecord } from "@/api/endpoints";
import type { Audit, AuditRegisterRow, AuditCampaign, AuditGrid, Framework } from "@/types";
import { useAuthStore } from "@/store/auth";
import { useEntitlements } from "@/context/EntitlementsContext";

const TYPE_COLORS: Record<string, string> = {
  internal:      "bg-slate-100 text-slate-600",
  external:      "bg-violet-100 text-violet-700",
  certification: "bg-amber-100 text-amber-700",
  regulatory:    "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, { color: string; dot: string }> = {
  planning:  { color: "bg-gray-100 text-gray-600",     dot: "bg-gray-400"   },
  fieldwork: { color: "bg-blue-100 text-blue-700",     dot: "bg-blue-500"   },
  review:    { color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  reporting: { color: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  closed:    { color: "bg-green-100 text-green-700",   dot: "bg-green-500"  },
};

const REPORT_COLORS: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-600",
  submitted: "bg-amber-100 text-amber-700",
  approved:  "bg-blue-100 text-blue-700",
  rejected:  "bg-red-100 text-red-700",
  issued:    "bg-green-100 text-green-700",
};

/** Objectif 8 — « Accessible depuis la section audit ».
 *  Whether the dashboard panel is open, remembered per browser. localStorage
 *  THROWS outright in some privacy modes, so a remembered preference must never
 *  be able to take the audit register down with it. */
const DASH_LS_KEY = "grceye.moduledash.audit.open";

function readDashOpen(): boolean {
  try {
    return window.localStorage.getItem(DASH_LS_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The page of the register the KPI tiles are computed from.
 *
 *  GET /audits/register caps at 500 (``limit: int = Query(default=100, ge=1, le=500)``)
 *  and returns NO total, so a tenant with more engagements than this silently
 *  gets KPI tiles — « audits en cours », « constats ouverts » — that describe
 *  the first page instead of the register. The page used to ask for 200 and say
 *  nothing about it. It now asks for the server maximum AND declares the cut
 *  when it hits it: an under-count nobody is told about is the same class of
 *  defect as an invented figure. */
const REGISTER_LIMIT = 500;

const STATUS_KEYS = ["planning", "fieldwork", "review", "reporting", "closed"] as const;
const TYPE_KEYS   = ["internal", "external", "certification", "regulatory"] as const;
const RECURRENCE_KEYS = ["none", "annual", "semi_annual"] as const;

interface PickerOption { readonly id: string; readonly name: string }

interface DirectoryEntry {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly is_external?: boolean;
  readonly external_org?: string | null;
}

/** GET /users and GET /users/auditors both answer with the qualification the
 *  AuditorUser type does not yet declare — see needs_integration. */
type MaybeExternal = { is_external?: boolean; external_org?: string | null };

// ── Perimeter multi-select ────────────────────────────────────────────────────

function PerimeterPicker({
  label, hint, options, selected, onChange, emptyLabel,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly options: PickerOption[];
  readonly selected: string[];
  readonly onChange: (ids: string[]) => void;
  readonly emptyLabel: string;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
        {selected.length > 0 && (
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700">
            {selected.length}
          </span>
        )}
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-gray-400 italic">{emptyLabel}</p>
      ) : (
        <div className="border border-gray-200 rounded-lg max-h-32 overflow-y-auto divide-y divide-gray-50">
          {options.map((o) => (
            <label
              key={o.id}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm ${
                selected.includes(o.id) ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={() => toggle(o.id)}
                className="w-3.5 h-3.5 accent-blue-600 shrink-0"
              />
              <span className="truncate text-gray-700">{o.name}</span>
            </label>
          ))}
        </div>
      )}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

// ── Create / edit an engagement ───────────────────────────────────────────────

function AuditFormModal({
  audit, campaigns, frameworks, grids, auditors, onClose, onSaved,
}: {
  readonly audit: Audit | null;
  readonly campaigns: AuditCampaign[];
  readonly frameworks: Framework[];
  readonly grids: AuditGrid[];
  readonly auditors: DirectoryEntry[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { hasFeature } = useEntitlements();
  // The org-graph routes are gated behind "asset_cartography". Calling them on a
  // tenant without it answers 402 and the global interceptor throws an upsell
  // dialog over this form — so the entitlement is read first and the two
  // pickers simply stay empty instead.
  const canReadOrgGraph = hasFeature("asset_cartography");
  const isEdit = !!audit;
  const [form, setForm] = useState({
    title: audit?.title ?? "",
    audit_type: audit?.audit_type ?? "internal",
    status: audit?.status ?? "planning",
    framework_id: audit?.framework_id ?? "",
    campaign_id: audit?.campaign_id ?? "",
    grid_id: audit?.grid_id ?? "",
    lead_auditor_id: audit?.lead_auditor_id ?? "",
    planned_start: audit?.planned_start ?? "",
    planned_end: audit?.planned_end ?? "",
    scope: audit?.scope ?? "",
    recurrence: audit?.recurrence ?? "none",
  });
  const [processIds, setProcessIds] = useState<string[]>(audit?.process_ids ?? []);
  const [entityIds, setEntityIds]   = useState<string[]>(audit?.org_entity_ids ?? []);
  const [assetIds, setAssetIds]     = useState<string[]>(audit?.asset_ids ?? []);

  const [processes, setProcesses] = useState<PickerOption[]>([]);
  const [entities, setEntities]   = useState<PickerOption[]>([]);
  const [assets, setAssets]       = useState<PickerOption[]>([]);
  const [loadingPerimeter, setLoadingPerimeter] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Loaded only when the modal opens: the org-graph routes sit behind a plan
  // gate, so a tenant without it simply gets empty pickers, never a broken form.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [ent, proc, ast] = await Promise.allSettled([
        canReadOrgGraph ? assetGraphApi.listEntities() : Promise.resolve([]),
        canReadOrgGraph ? assetGraphApi.listProcesses() : Promise.resolve([]),
        assetsApi.options(),
      ]);
      if (cancelled) return;
      const asOptions = (value: unknown): PickerOption[] =>
        Array.isArray(value)
          ? value
              .map((r) => r as { id?: string; name?: string })
              .filter((r): r is { id: string; name: string } => !!r.id)
              .map((r) => ({ id: r.id, name: r.name || r.id }))
          : [];
      if (ent.status === "fulfilled")  setEntities(asOptions(ent.value));
      if (proc.status === "fulfilled") setProcesses(asOptions(proc.value));
      if (ast.status === "fulfilled")  setAssets(asOptions(ast.value));
      setLoadingPerimeter(false);
    }
    load();
    return () => { cancelled = true; };
  }, [canReadOrgGraph]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError(t("audits.title_required")); return; }
    if (!isEdit && (!form.planned_start || !form.planned_end)) {
      setError(t("audits.dates_required"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      // Everything PATCH /audits/{id} actually applies. The backend's
      // AuditUpdate carries neither framework_id nor audit_type, so sending
      // them on an edit would be silently dropped and the form would report a
      // save that never happened — they are create-only, and the two selects
      // are locked in edit mode for the same reason.
      const common = {
        title: form.title.trim(),
        campaign_id: form.campaign_id || null,
        grid_id: form.grid_id || null,
        lead_auditor_id: form.lead_auditor_id || undefined,
        planned_start: form.planned_start || undefined,
        planned_end: form.planned_end || undefined,
        scope: form.scope.trim() || undefined,
        recurrence: form.recurrence as Audit["recurrence"],
        process_ids: processIds,
        org_entity_ids: entityIds,
        asset_ids: assetIds,
      };
      if (isEdit && audit) {
        await auditsApi.update(audit.id, { ...common, status: form.status as Audit["status"] });
      } else {
        await auditsApi.create({
          ...common,
          audit_type: form.audit_type as Audit["audit_type"],
          framework_id: form.framework_id || undefined,
        });
      }
      onSaved();
      onClose();
    } catch {
      setError(isEdit ? t("audit_detail.error_save_failed") : t("audits.error_create_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">
            {isEdit ? `${t("common.edit")} · ${t("audit_detail.title")}` : t("audits.new_audit")}
          </h2>
          <button type="button" onClick={onClose} title={t("common.close")} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label htmlFor="audit-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              {t("audits.form_title")} *
            </label>
            <input
              id="audit-title"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("audits.form_title_placeholder")}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="audit-type" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_type")}</label>
              <select id="audit-type" disabled={isEdit}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                value={form.audit_type} onChange={(e) => setForm((f) => ({ ...f, audit_type: e.target.value as Audit["audit_type"] }))}>
                {TYPE_KEYS.map((k) => <option key={k} value={k}>{t(`audits.type_${k}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="audit-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_status")}</label>
              <select id="audit-status" disabled={!isEdit}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Audit["status"] }))}>
                {STATUS_KEYS.map((k) => <option key={k} value={k}>{t(`audit_detail.statuses.${k}`)}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="audit-framework" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.select_framework")}</label>
              <select id="audit-framework" disabled={isEdit}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                value={form.framework_id} onChange={(e) => setForm((f) => ({ ...f, framework_id: e.target.value }))}>
                <option value="">{t("common.none")}</option>
                {frameworks.map((fw) => (
                  <option key={fw.id} value={fw.id}>{fw.short_name || fw.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="audit-campaign" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_campaign.select_campaign")}</label>
              <select id="audit-campaign"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.campaign_id} onChange={(e) => setForm((f) => ({ ...f, campaign_id: e.target.value }))}>
                <option value="" disabled={isEdit && !!audit?.campaign_id}>{t("audit_campaign.no_campaign")}</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="audit-lead" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.lead_auditor")}</label>
              <select id="audit-lead"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.lead_auditor_id} onChange={(e) => setForm((f) => ({ ...f, lead_auditor_id: e.target.value }))}>
                <option value="" disabled={isEdit && !!audit?.lead_auditor_id}>{t("common.none")}</option>
                {auditors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.is_external ? `${t("audits.type_external")}${a.external_org ? ` · ${a.external_org}` : ""}` : t("audits.type_internal")}
                  </option>
                ))}
              </select>
              {auditors.length === 0 && (
                <p className="text-xs text-gray-400 mt-1">{t("audits.no_auditor_create_first")}</p>
              )}
            </div>
            <div>
              <label htmlFor="audit-grid" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_grid.select_grid")}</label>
              <select id="audit-grid"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.grid_id} onChange={(e) => setForm((f) => ({ ...f, grid_id: e.target.value }))}>
                <option value="" disabled={isEdit && !!audit?.grid_id}>{t("audit_grid.no_grid")}</option>
                {grids.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="audit-start" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_start_date")}{!isEdit && " *"}</label>
              <input id="audit-start" type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.planned_start} onChange={(e) => setForm((f) => ({ ...f, planned_start: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="audit-end" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_end_date")}{!isEdit && " *"}</label>
              <input id="audit-end" type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.planned_end} onChange={(e) => setForm((f) => ({ ...f, planned_end: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="audit-recurrence" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_recurrence")}</label>
              <select id="audit-recurrence"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.recurrence ?? "none"} onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value as "none" | "annual" | "semi_annual" }))}>
                {RECURRENCE_KEYS.map((k) => <option key={k} value={k}>{t(`audits.recurrence_${k}`)}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400 -mt-2">{t("audits.form_recurrence_hint")}</p>

          {/* Périmètre — objectif 4 */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Network className="w-4 h-4 text-blue-500" />
              <h3 className="text-sm font-semibold text-gray-800">{t("audit_detail.perimeter")}</h3>
            </div>
            <p className="text-xs text-gray-400 mb-3">{t("audit_detail.perimeter_hint")}</p>
            {loadingPerimeter ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <PerimeterPicker
                  label={t("audit_detail.perimeter_processes")}
                  options={processes} selected={processIds} onChange={setProcessIds}
                  emptyLabel={t("audit_detail.perimeter_none")}
                />
                <PerimeterPicker
                  label={t("audit_detail.perimeter_entities")}
                  options={entities} selected={entityIds} onChange={setEntityIds}
                  emptyLabel={t("audit_detail.perimeter_none")}
                />
                <PerimeterPicker
                  label={t("audit_detail.perimeter_systems")}
                  options={assets} selected={assetIds} onChange={setAssetIds}
                  emptyLabel={t("audit_detail.perimeter_none")}
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="audit-scope" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.form_scope")}</label>
            <textarea id="audit-scope" rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t("audits.form_scope_placeholder")}
              value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? t("common.save") : t("audits.create_audit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Assign Auditor Modal ──────────────────────────────────────────────────────

function AssignAuditorModal({
  auditors, assessments, onClose, onSaved,
}: {
  readonly auditors: AuditorUser[];
  readonly assessments: Array<{ id: string; name: string; framework_name?: string }>;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [auditorId, setAuditorId] = useState(auditors[0]?.id ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggleAssessment(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!auditorId) { setError(t("audits.error_select_auditor")); return; }
    if (selectedIds.size === 0) { setError(t("audits.error_select_assessment")); return; }
    setSubmitting(true);
    setError("");
    let anyFailed = false;
    try {
      for (const assessmentId of selectedIds) {
        try {
          await usersApi.assignAuditor(auditorId, assessmentId);
        } catch (err: unknown) {
          const msg = String((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "");
          if (!msg.toLowerCase().includes("already")) anyFailed = true;
        }
      }
      onSaved();
      onClose();
    } catch {
      anyFailed = true;
    } finally {
      setSubmitting(false);
      if (anyFailed) setError(t("audits.error_assignments_failed"));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="w-4 h-4 text-purple-600" /> {t("audits.assign_auditor_to_assessments")}
          </h2>
          <button type="button" onClick={onClose} title={t("common.close")} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div>
              <label htmlFor="assign-auditor" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audits.auditor")}</label>
              {auditors.length === 0 ? (
                <p className="text-sm text-gray-400 italic">{t("audits.no_auditor_create_first")}</p>
              ) : (
                <select
                  id="assign-auditor"
                  value={auditorId}
                  onChange={(e) => setAuditorId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                >
                  {auditors.map((a) => (
                    <option key={a.id} value={a.id}>{a.first_name} {a.last_name} — {a.email}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {t("audits.compliance_assessments")}
                </span>
                {selectedIds.size > 0 && (
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-purple-700 bg-purple-100">
                    {t("audits.selected_count", { count: selectedIds.size })}
                  </span>
                )}
              </div>
              {assessments.length === 0 ? (
                <p className="text-sm text-gray-400 italic">{t("audits.no_assessments")}</p>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                  {assessments.map((a) => (
                    <label
                      key={a.id}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                        selectedIds.has(a.id) ? "bg-purple-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(a.id)}
                        onChange={() => toggleAssessment(a.id)}
                        className="w-4 h-4 accent-purple-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                        {a.framework_name && <p className="text-xs text-gray-400 truncate">{a.framework_name}</p>}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-xs text-purple-700">
              {t("audits.auditor_access_info")}
            </div>
          </div>

          <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={submitting || !auditorId || selectedIds.size === 0}
              className="flex-1 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? t("audits.assigning") : t("audits.assign")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AuditsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useAuthStore((u) => u?.role ?? "");
  const isAdmin = role === "tenant_admin" || role === "super_admin";
  const { hasFeature } = useEntitlements();
  const canReadOrgGraph = hasFeature("asset_cartography");

  const [tab, setTab] = useState<"audits" | "auditors">("audits");

  // Register
  const [rows, setRows] = useState<AuditRegisterRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  // True when the server returned a full page: there are more engagements than
  // the tiles below counted, and the user has to be told rather than shown a
  // total that quietly stops at REGISTER_LIMIT.
  const [registerTruncated, setRegisterTruncated] = useState(false);
  const [dashOpen, setDashOpen] = useState<boolean>(readDashOpen);
  const [recurrenceById, setRecurrenceById] = useState<Record<string, string>>({});
  const [campaigns, setCampaigns] = useState<AuditCampaign[]>([]);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [grids, setGrids] = useState<AuditGrid[]>([]);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);

  // Filters
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [cadenceFilter, setCadenceFilter] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);

  // Auditors tab
  const [auditors, setAuditors] = useState<AuditorUser[]>([]);
  const [assignments, setAssignments] = useState<AuditorAssignmentRecord[]>([]);
  const [assessments, setAssessments] = useState<Array<{ id: string; name: string; framework_name?: string }>>([]);
  const [loadingAuditors, setLoadingAuditors] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Audit | null>(null);
  const [showCreateAuditor, setShowCreateAuditor] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [planFor, setPlanFor] = useState<Audit | null>(null);
  const [planPerimeter, setPlanPerimeter] = useState<{ processes: string[]; entities: string[]; systems: string[] }>({
    processes: [], entities: [], systems: [],
  });

  const [notice, setNotice] = useState("");
  const [confirmDeleteAuditorId, setConfirmDeleteAuditorId] = useState<string | null>(null);
  const [deletingAuditorId, setDeletingAuditorId] = useState<string | null>(null);

  const loadRegister = useCallback(async () => {
    setLoadingRows(true);
    try {
      const data = await auditsApi.register({
        q: q.trim() || undefined,
        status_filter: statusFilter || undefined,
        audit_type: typeFilter || undefined,
        campaign_id: campaignFilter || undefined,
        include_deleted: includeDeleted || undefined,
        limit: REGISTER_LIMIT,
      });
      const page = Array.isArray(data) ? data : [];
      setRows(page);
      setRegisterTruncated(page.length >= REGISTER_LIMIT);
    } catch {
      setRows([]);
      setRegisterTruncated(false);
      setNotice(t("audit_detail.error_load_failed"));
    } finally {
      setLoadingRows(false);
    }
  }, [q, statusFilter, typeFilter, campaignFilter, includeDeleted, t]);

  const loadReference = useCallback(async () => {
    const [full, camp, fw, gr, auditorList, userList] = await Promise.allSettled([
      auditsApi.listAll(),
      auditCampaignsApi.list({ limit: 200 }),
      frameworksApi.list(),
      auditGridsApi.list({ is_active: true }),
      usersApi.listAuditors(),
      usersApi.list(),
    ]);
    if (full.status === "fulfilled") {
      const map: Record<string, string> = {};
      for (const a of full.value) map[a.id] = a.recurrence ?? "none";
      setRecurrenceById(map);
    }
    if (camp.status === "fulfilled") setCampaigns(camp.value.items ?? []);
    if (fw.status === "fulfilled") setFrameworks(fw.value);
    if (gr.status === "fulfilled") setGrids(gr.value);

    const dir = new Map<string, DirectoryEntry>();
    if (auditorList.status === "fulfilled") {
      for (const a of auditorList.value) {
        const ext = a as AuditorUser & MaybeExternal;
        dir.set(a.id, {
          id: a.id,
          name: `${a.first_name} ${a.last_name}`.trim(),
          email: a.email,
          is_external: ext.is_external,
          external_org: ext.external_org,
        });
      }
    }
    if (userList.status === "fulfilled") {
      for (const u of userList.value) {
        const ext = u as typeof u & MaybeExternal;
        if (!dir.has(u.id)) {
          dir.set(u.id, {
            id: u.id,
            name: `${u.first_name} ${u.last_name}`.trim(),
            email: u.email,
            is_external: ext.is_external,
            external_org: ext.external_org,
          });
        }
      }
    }
    setDirectory(Array.from(dir.values()));
  }, []);

  const loadAuditors = useCallback(async () => {
    setLoadingAuditors(true);
    try {
      const [auditorData, assignmentData, assessmentData] = await Promise.allSettled([
        usersApi.listAuditors(),
        usersApi.listAssignments(),
        complianceApi.listAssessments(),
      ]);
      if (auditorData.status === "fulfilled") setAuditors(auditorData.value);
      if (assignmentData.status === "fulfilled") setAssignments(assignmentData.value);
      if (assessmentData.status === "fulfilled") {
        const d = assessmentData.value as unknown;
        const items = Array.isArray(d) ? d : ((d as { items?: unknown[] })?.items ?? []);
        setAssessments(items as Array<{ id: string; name: string; framework_name?: string }>);
      }
    } finally {
      setLoadingAuditors(false);
    }
  }, []);

  useEffect(() => { loadReference(); loadAuditors(); }, [loadReference, loadAuditors]);

  // Debounced so typing in the search box does not fire a call per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => { loadRegister(); }, 250);
    return () => clearTimeout(handle);
  }, [loadRegister]);

  const campaignName = useCallback(
    (id: string | null) => (id ? campaigns.find((c) => c.id === id)?.name ?? id : null),
    [campaigns],
  );

  const visibleRows = useMemo(
    () => (cadenceFilter ? rows.filter((r) => (recurrenceById[r.id] ?? "none") === cadenceFilter) : rows),
    [rows, cadenceFilter, recurrenceById],
  );

  const stats = useMemo(() => {
    const live = visibleRows.filter((r) => !r.deleted_at);
    return {
      active: live.filter((r) => r.status !== "closed").length,
      closed: live.filter((r) => r.status === "closed").length,
      openFindings: live.reduce((s, r) => s + (r.findings_open || 0), 0),
      nonconformities: live.reduce((s, r) => s + (r.nonconformities || 0), 0),
    };
  }, [visibleRows]);

  async function openEdit(id: string) {
    try {
      const full = await auditsApi.get(id);
      setEditing(full);
      setShowForm(true);
    } catch {
      setNotice(t("audit_detail.error_load_failed"));
    }
  }

  async function openPlan(id: string) {
    try {
      const full = await auditsApi.get(id);
      // Perimeter ids mean nothing to a language model — resolve them to names
      // before the programme is generated. Loaded here (a deliberate click)
      // rather than on page load, since the org-graph routes are plan-gated.
      const [proc, ent, ast] = await Promise.allSettled([
        canReadOrgGraph ? assetGraphApi.listProcesses() : Promise.resolve([]),
        canReadOrgGraph ? assetGraphApi.listEntities() : Promise.resolve([]),
        assetsApi.options(),
      ]);
      const nameOf = (settled: PromiseSettledResult<unknown>, ids: string[]): string[] => {
        if (settled.status !== "fulfilled" || !Array.isArray(settled.value)) return ids;
        const byId = new Map<string, string>();
        for (const raw of settled.value) {
          const r = raw as { id?: string; name?: string };
          if (r.id) byId.set(r.id, r.name || r.id);
        }
        return ids.map((i) => byId.get(i) ?? i);
      };
      setPlanPerimeter({
        processes: nameOf(proc, full.process_ids ?? []),
        entities: nameOf(ent, full.org_entity_ids ?? []),
        systems: nameOf(ast, full.asset_ids ?? []),
      });
      setPlanFor(full);
    } catch {
      setNotice(t("audit_detail.error_load_failed"));
    }
  }

  async function handleRestore(id: string) {
    try {
      await auditsApi.restore(id);
      loadRegister();
    } catch {
      setNotice(t("audit_detail.error_save_failed"));
    }
  }

  async function handleUnassign(assignmentId: string) {
    try {
      await usersApi.unassignAuditor(assignmentId);
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    } catch {
      setNotice(t("audits.error_assignments_failed"));
    }
  }

  async function handleDeleteAuditor(auditorId: string) {
    setDeletingAuditorId(auditorId);
    try {
      await usersApi.deleteAuditor(auditorId);
      setAuditors((prev) => prev.filter((a) => a.id !== auditorId));
      setAssignments((prev) => prev.filter((a) => a.auditor_id !== auditorId));
    } catch {
      setNotice(t("common.error_generic"));
    } finally {
      setDeletingAuditorId(null);
      setConfirmDeleteAuditorId(null);
    }
  }

  const filtersActive = !!(q || statusFilter || typeFilter || campaignFilter || cadenceFilter);

  function toggleDash() {
    setDashOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(DASH_LS_KEY, next ? "1" : "0");
      } catch {
        // Private browsing — the panel simply reopens on the next visit.
      }
      return next;
    });
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("audits.management_title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {t("audits.subtitle", { count: visibleRows.length, active: stats.active })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowCreateAuditor(true)}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <UserPlus className="w-4 h-4" /> {t("audits.add_auditor")}
          </button>
          <button type="button" onClick={() => { setEditing(null); setShowForm(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> {t("audits.new_audit")}
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} title={t("common.close")}>
            <X className="w-4 h-4 opacity-50 hover:opacity-100" />
          </button>
        </div>
      )}

      {/*
        Objectif 8 — « Accessible depuis la section audit ».
        GET /dashboards/audit (audits par statut, constats par gravité et par
        état) already existed, but the only screen that ever called it was
        AnalyticsPage, i.e. a card in another navigation group. A dashboard
        reachable only from somewhere else is not "accessible from the audit
        section": the LOCATION is the requirement, so it is mounted here.

        Left ABOVE the tabs on purpose — the register and the auditor directory
        are two views of the same engagement portfolio, and the dashboard
        describes both. ModuleDashboard owns every answer the call can end in:
        the Elite plan gate as a translated upsell panel instead of a blank
        card, the role gate (_AUDIT_GATE = ciso / compliance_manager / auditor,
        admins auto-pass) as an explicit « vue restreinte », a 424 as the
        operator's own message, and an empty portfolio as "nothing recorded
        yet" — never sample rows.
      */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={toggleDash}
          aria-expanded={dashOpen}
          aria-controls="module-dashboard-audit"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {dashOpen
            ? <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
            : <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />}
          <BarChart3 className="w-4 h-4 text-blue-600" aria-hidden="true" />
          {t("moduledash.dashboard")}
          <span className="text-xs font-normal text-gray-400">
            {dashOpen ? t("moduledash.hide") : t("moduledash.show")}
          </span>
        </button>
        {dashOpen && <div id="module-dashboard-audit"><ModuleDashboard module="audit" /></div>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(["audits", "auditors"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              tab === tabKey ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tabKey === "audits" ? <ClipboardList className="w-4 h-4" /> : <Users className="w-4 h-4" />}
            {tabKey === "audits" ? t("audits.tab_audits") : t("audits.auditor_accounts")}
            <span className="ms-1 text-xs bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">
              {tabKey === "audits" ? visibleRows.length : auditors.length}
            </span>
          </button>
        ))}
      </div>

      {/* ── REGISTER ── */}
      {tab === "audits" && (
        <>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: t("audits.kpi_active"), value: stats.active, sub: t("audits.kpi_active_sub") },
              { label: t("audits.kpi_closed"), value: stats.closed, sub: t("audits.kpi_closed_sub") },
              { label: t("audits.kpi_open_findings"), value: stats.openFindings, sub: t("audits.kpi_open_findings_sub") },
              { label: t("audit_report.section_nonconformities"), value: stats.nonconformities, sub: t("audits.kpi_total_findings_sub") },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* The tiles above are computed client-side over the rows actually
              received. When the register came back full, they describe a page
              and not the portfolio — said out loud rather than left to look
              like a total. */}
          {registerTruncated && (
            <p className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800" role="status">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t("audits.register_truncated", {
                  n: REGISTER_LIMIT,
                  defaultValue:
                    "Only the {{n}} most recent engagements are shown; the figures above cover those alone. Narrow the filters to see the rest.",
                })}
              </span>
            </p>
          )}

          {/* Filters */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-56">
                <Search className="w-4 h-4 text-gray-300 absolute start-3 top-1/2 -translate-y-1/2" />
                <input
                  className="w-full ps-9 pe-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t("common.search")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <select
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                title={t("audits.status_label")}
              >
                <option value="">{t("audits.status_label")} — {t("common.all")}</option>
                {STATUS_KEYS.map((k) => <option key={k} value={k}>{t(`audit_detail.statuses.${k}`)}</option>)}
              </select>
              <select
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                title={t("audits.type_label")}
              >
                <option value="">{t("audits.type_label")} — {t("common.all")}</option>
                {TYPE_KEYS.map((k) => <option key={k} value={k}>{t(`audits.type_${k}`)}</option>)}
              </select>
              <select
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}
                title={t("audit_campaign.title")}
              >
                <option value="">{t("audit_campaign.title")} — {t("common.all")}</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={cadenceFilter} onChange={(e) => setCadenceFilter(e.target.value)}
                title={t("audits.form_recurrence")}
              >
                <option value="">{t("audits.form_recurrence")} — {t("common.all")}</option>
                {RECURRENCE_KEYS.map((k) => <option key={k} value={k}>{t(`audits.recurrence_${k}`)}</option>)}
              </select>
              {filtersActive && (
                <button type="button"
                  onClick={() => { setQ(""); setStatusFilter(""); setTypeFilter(""); setCampaignFilter(""); setCadenceFilter(""); }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg">
                  <Filter className="w-3.5 h-3.5" /> {t("activity_log.clear_filters")}
                </button>
              )}
              <button type="button" onClick={() => loadRegister()} title={t("common.refresh")}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            {isAdmin && (
              <label className="flex items-center gap-2 mt-3 text-xs text-gray-500 cursor-pointer w-fit">
                <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)}
                  className="w-3.5 h-3.5 accent-blue-600" />
                {t("audits.show_withdrawn")}
              </label>
            )}
          </div>

          {loadingRows ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
              <ClipboardList className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500">{t("audits.no_audits")}</p>
              <p className="text-xs text-gray-400 mt-1">{t("audits.no_audits_help")}</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-start px-5 py-3 font-medium text-gray-500">{t("audits.title_label")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_campaign.title")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_detail.perimeter")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audits.form_recurrence")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_detail.lead_auditor")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_detail.period")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("common.status")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_report.status")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audits.findings")}</th>
                      <th className="text-end px-5 py-3 font-medium text-gray-500">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const st = STATUS_COLORS[row.status] ?? STATUS_COLORS.planning;
                      const lead = row.lead_auditor_id ? directory.find((d) => d.id === row.lead_auditor_id) : undefined;
                      const perimeterCount =
                        (row.process_ids?.length ?? 0) + (row.org_entity_ids?.length ?? 0) + (row.asset_ids?.length ?? 0);
                      const withdrawn = !!row.deleted_at;
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-gray-50 transition-colors ${
                            withdrawn ? "bg-red-50/40 text-gray-400" : "hover:bg-gray-50/60 cursor-pointer"
                          }`}
                          onClick={() => { if (!withdrawn) navigate(`/audits/${row.id}`); }}
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-start gap-2">
                              <div className="w-7 h-7 bg-orange-50 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                                <ClipboardList className="w-3.5 h-3.5 text-orange-500" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 truncate max-w-64">{row.title}</p>
                                <span className={`inline-flex items-center gap-1 mt-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_COLORS[row.audit_type] ?? "bg-gray-100 text-gray-600"}`}>
                                  <Tag className="w-2.5 h-2.5" />
                                  {t(`audits.type_${row.audit_type}`, row.audit_type)}
                                </span>
                                {withdrawn && (
                                  <span className="ms-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
                                    {t("policies.retired")}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-gray-600">
                            {campaignName(row.campaign_id) ? (
                              <span className="inline-flex items-center gap-1 text-xs">
                                <Layers className="w-3 h-3 text-indigo-400" />
                                <span className="truncate max-w-36">{campaignName(row.campaign_id)}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300">{t("audit_campaign.no_campaign")}</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {perimeterCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-gray-600" title={t("audit_detail.perimeter_hint")}>
                                <Network className="w-3 h-3 text-blue-400" />
                                {row.process_ids?.length ?? 0}/{row.org_entity_ids?.length ?? 0}/{row.asset_ids?.length ?? 0}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300">{t("audit_detail.perimeter_none")}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-600">
                            {t(`audits.recurrence_${recurrenceById[row.id] ?? "none"}`, recurrenceById[row.id] ?? "none")}
                          </td>
                          <td className="px-3 py-3">
                            {row.lead_auditor_name || lead?.name ? (
                              <div className="min-w-0">
                                <p className="text-xs text-gray-700 truncate max-w-36">{row.lead_auditor_name || lead?.name}</p>
                                {/* Only claimed when the roster actually answered — GET /users
                                    is administrator-only, and guessing "interne" would be a lie. */}
                                {lead && (
                                  <span className={`inline-flex items-center gap-1 mt-0.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                    lead.is_external ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"
                                  }`}>
                                    {lead.is_external ? <Building2 className="w-2.5 h-2.5" /> : <Users className="w-2.5 h-2.5" />}
                                    {lead.is_external
                                      ? (lead.external_org || t("audits.type_external"))
                                      : t("audits.type_internal")}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-300">{t("common.none")}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {row.planned_start ? (
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {row.planned_start} → {row.planned_end ?? "…"}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.color}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                              {t(`audit_detail.statuses.${row.status}`, row.status)}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${REPORT_COLORS[row.report_status] ?? "bg-gray-100 text-gray-600"}`}>
                              <FileText className="w-2.5 h-2.5" />
                              {t(`audit_report.statuses.${row.report_status}`, row.report_status)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs">
                            <span className="text-gray-700 font-medium">{row.findings_total}</span>
                            {row.findings_open > 0 && (
                              <span className="ms-2 inline-flex items-center gap-1 text-orange-600 font-medium">
                                <AlertTriangle className="w-3 h-3" />{row.findings_open}
                              </span>
                            )}
                            {row.nonconformities > 0 && (
                              <span className="ms-2 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
                                {t("audit_report.nonconformities_count", { count: row.nonconformities })}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {withdrawn ? (
                                isAdmin && (
                                  <button type="button" onClick={() => handleRestore(row.id)} title={t("audit_detail.restore")}
                                    className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                                    <Undo2 className="w-3.5 h-3.5" />
                                  </button>
                                )
                              ) : (
                                <>
                                  <button type="button" onClick={() => openPlan(row.id)} title={t("audit_detail.plan_title")}
                                    className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                                    <Sparkles className="w-3.5 h-3.5" />
                                  </button>
                                  <button type="button" onClick={() => openEdit(row.id)} title={t("common.edit")}
                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button type="button" onClick={() => navigate(`/audits/${row.id}`)} title={t("common.view")}
                                    className="p-1.5 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                    <ChevronRight className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── AUDITORS TAB ── */}
      {tab === "auditors" && (
        <div className="space-y-6">
          {loadingAuditors ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
            </div>
          ) : (
            <>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-600" /> {t("audits.auditor_accounts")}
                  </h2>
                  <button type="button" onClick={() => setShowCreateAuditor(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors">
                    <UserPlus className="w-3.5 h-3.5" /> {t("audits.create_auditor")}
                  </button>
                </div>
                {auditors.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <Users className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">{t("audits.no_auditor_accounts")}</p>
                    <p className="text-xs text-gray-400 mt-1">{t("audits.no_auditor_accounts_help")}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {auditors.map((a) => {
                      const ext = a as AuditorUser & MaybeExternal;
                      return (
                        <div key={a.id} className="flex items-center gap-4 px-6 py-3 group">
                          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-semibold text-sm shrink-0">
                            {a.first_name[0]}{a.last_name[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{a.first_name} {a.last_name}</p>
                            <p className="text-xs text-gray-400">{a.email}</p>
                          </div>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            ext.is_external ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"
                          }`}>
                            {ext.is_external
                              ? (ext.external_org || t("audits.type_external"))
                              : t("audits.type_internal")}
                          </span>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${a.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {a.is_active ? t("audits.active_status") : t("audits.inactive_status")}
                          </span>
                          {confirmDeleteAuditorId === a.id ? (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-xs text-red-600 font-medium">{t("audits.delete_account_confirm")}</span>
                              <button type="button" onClick={() => handleDeleteAuditor(a.id)} disabled={deletingAuditorId === a.id}
                                className="px-2 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors">
                                {deletingAuditorId === a.id ? t("audits.deleting") : t("audits.yes_delete")}
                              </button>
                              <button type="button" onClick={() => setConfirmDeleteAuditorId(null)}
                                className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md hover:bg-gray-200 transition-colors">
                                {t("common.cancel")}
                              </button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setConfirmDeleteAuditorId(a.id)}
                              className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              title={t("audits.delete_account_confirm")}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Assignments */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-600" /> {t("audits.assessment_assignments")}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => loadAuditors()} title={t("common.refresh")}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setShowAssign(true)}
                      disabled={auditors.length === 0 || assessments.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> {t("audits.assign_auditor")}
                    </button>
                  </div>
                </div>
                {assignments.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <Shield className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">{t("audits.no_assignments")}</p>
                    <p className="text-xs text-gray-400 mt-1">{t("audits.no_assignments_help")}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {assignments.map((a) => (
                      <div key={a.id} className="flex items-center gap-4 px-6 py-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                          <CheckCircle className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{a.auditor_name}</p>
                          <p className="text-xs text-gray-400">{a.auditor_email}</p>
                        </div>
                        <div className="text-end shrink-0">
                          <p className="text-xs font-medium text-gray-700 truncate max-w-48">{a.assessment_name}</p>
                          <p className="text-xs text-gray-400">{t("audits.assessment")}</p>
                        </div>
                        <button type="button" onClick={() => handleUnassign(a.id)} title={t("common.delete")}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-purple-50 border border-purple-100 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-purple-900 mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" /> {t("audits.how_auditors_login")}
                </h3>
                <ol className="text-xs text-purple-700 space-y-1.5 list-decimal list-inside">
                  <li>{t("audits.how_login_step1")}</li>
                  <li>{t("audits.how_login_step2")}</li>
                  <li>{t("audits.how_login_step3")}</li>
                  <li>{t("audits.how_login_step4")}</li>
                  <li>{t("audits.how_login_step5")}</li>
                </ol>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <AuditFormModal
          audit={editing}
          campaigns={campaigns}
          frameworks={frameworks}
          grids={grids}
          auditors={directory}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { loadRegister(); loadReference(); }}
        />
      )}

      {showCreateAuditor && (
        <CreateAuditorModal
          onClose={() => setShowCreateAuditor(false)}
          onCreated={() => {
            loadAuditors();
            loadReference();
            setShowCreateAuditor(false);
            setTab("auditors");
          }}
        />
      )}

      {showAssign && (
        <AssignAuditorModal
          auditors={auditors}
          assessments={assessments}
          onClose={() => setShowAssign(false)}
          onSaved={loadAuditors}
        />
      )}

      {planFor && (
        <AuditPlanModal
          auditId={planFor.id}
          auditTitle={planFor.title}
          frameworkId={planFor.framework_id ?? null}
          frameworkName={frameworks.find((f) => f.id === planFor.framework_id)?.name ?? ""}
          frameworkShortName={frameworks.find((f) => f.id === planFor.framework_id)?.short_name ?? ""}
          auditScope={planFor.scope ?? ""}
          auditType={planFor.audit_type}
          perimeter={planPerimeter}
          onSaved={() => { loadRegister(); }}
          onClose={() => setPlanFor(null)}
        />
      )}
    </div>
  );
}
