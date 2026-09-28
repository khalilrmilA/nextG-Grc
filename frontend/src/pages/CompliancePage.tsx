import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import {
  CheckCircle, Clock, AlertCircle, XCircle, Plus, FileText, Loader2, X, FolderUp,
  Sparkles, BarChart3, Trash2, Building2, Workflow, Server, Globe2, PieChart, Layers,
  AlertTriangle, ChevronDown, ChevronRight, FileSpreadsheet, RefreshCw, ShieldCheck,
} from "lucide-react";
import {
  complianceApi, complianceScalesApi, frameworksApi, assetGraphApi, assetsApi,
  dashboardApi, dashboardExportApi, parseDashboardExportError,
} from "@/api/endpoints";
import ModuleDashboard from "@/components/dashboards/ModuleDashboard";

/* The compliance strings this page used to register inline now live in
 * i18n/sweep/g3_compliance.ts (merged non-destructively in i18n/index.ts). */
import type {
  AssessmentListItem, Framework, ComplianceScale, ScopeCoverage, ScopeCoverageItem,
} from "@/types";

/** Objectif 6 covers « gouvernance et conformité », and its dashboard has to be
 *  reachable from both sections. Remembered per browser — localStorage THROWS in
 *  some privacy modes, so the preference can never take this page down. */
const DASH_LS_KEY = "grceye.moduledash.compliance.open";

function readDashOpen(): boolean {
  try {
    return window.localStorage.getItem(DASH_LS_KEY) !== "0";
  } catch {
    return true;
  }
}

/** How many assessments the register asks for in one call.
 *
 *  GET /compliance/assessments paginates (PaginationParams caps page_size at
 *  500) and returns the real `total` next to the page. The page used to ask for
 *  200 and throw the total away, so the KPI tiles — « score moyen », « total »,
 *  « terminées » — silently described the first 200 rows. It now asks for the
 *  server maximum and, when the total is larger, says so instead of presenting
 *  a page as if it were the register. */
const ASSESSMENTS_PAGE_SIZE = 500;

// ─── Perimeter (« périmètre ») plumbing ────────────────────────────────────────
// scope_type is the backend's own vocabulary: tenant | org_entity |
// business_process | assets. The UI calls them organisation / département /
// processus / systèmes, which is what compliance_scope.types.* holds.

export const SCOPE_TYPES = ["tenant", "org_entity", "business_process", "assets"] as const;
export type ScopeType = typeof SCOPE_TYPES[number];

export const SCOPE_ICON: Record<string, typeof Globe2> = {
  tenant: Globe2,
  org_entity: Building2,
  business_process: Workflow,
  assets: Server,
};

export interface PerimeterOption {
  id: string;
  name: string;
}

export interface PerimeterOptions {
  entities: PerimeterOption[];
  processes: PerimeterOption[];
  assets: PerimeterOption[];
  scales: ComplianceScale[];
  loading: boolean;
}

/** The lists a perimeter picker needs.
 *
 *  Deliberately LAZY per scope type. /asset-graph/org-entities and
 *  /asset-graph/business-processes sit behind the Elite feature gate, which
 *  answers 402 and makes the global listener throw an upsell modal on screen —
 *  so they must never be called just because somebody opened Compliance. They
 *  are fetched the first time the user actually selects that perimeter. The
 *  asset inventory is lazy too: it can run to thousands of rows.
 */
export function usePerimeterOptions(scopeType: ScopeType): PerimeterOptions {
  const [entities, setEntities] = useState<PerimeterOption[]>([]);
  const [processes, setProcesses] = useState<PerimeterOption[]>([]);
  const [assets, setAssets] = useState<PerimeterOption[]>([]);
  const [scales, setScales] = useState<ComplianceScale[]>([]);
  const [loading, setLoading] = useState(false);
  const asked = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    complianceScalesApi.list(true)
      .then((rows) => { if (alive) setScales(rows); })
      .catch(() => { /* the built-in default scale still applies */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (scopeType === "tenant" || asked.current.has(scopeType)) return;
    asked.current.add(scopeType);
    let alive = true;
    setLoading(true);
    const call =
      scopeType === "org_entity" ? assetGraphApi.listEntities()
        : scopeType === "business_process" ? assetGraphApi.listProcesses()
        : assetsApi.options();
    call
      .then((raw: unknown) => {
        if (!alive) return;
        const rows: PerimeterOption[] = Array.isArray(raw)
          ? raw
              .map((row) => row as { id?: string; name?: string })
              .filter((row): row is PerimeterOption => !!row?.id && !!row?.name)
          : [];
        if (scopeType === "org_entity") setEntities(rows);
        else if (scopeType === "business_process") setProcesses(rows);
        else setAssets(rows);
      })
      .catch(() => { /* an empty picker, never a broken screen */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scopeType]);

  return { entities, processes, assets, scales, loading };
}

export interface ScopeValue {
  scopeType: ScopeType;
  orgEntityId: string;
  businessProcessId: string;
  assetIds: string[];
  scaleId: string;
}

export const EMPTY_SCOPE: ScopeValue = {
  scopeType: "tenant",
  orgEntityId: "",
  businessProcessId: "",
  assetIds: [],
  scaleId: "",
};

/** Returns the compliance_scope.error_* key when the perimeter is incomplete. */
export function validateScope(value: ScopeValue): string | null {
  if (value.scopeType === "org_entity" && !value.orgEntityId) return "compliance_scope.error_entity_required";
  if (value.scopeType === "business_process" && !value.businessProcessId) return "compliance_scope.error_process_required";
  if (value.scopeType === "assets" && value.assetIds.length === 0) return "compliance_scope.error_assets_required";
  return null;
}

/** The perimeter + conformity-scale block, shared by "new assessment" and the
 *  assessment's own settings panel so the two can never drift apart. */
export function ScopeFields({
  value,
  onChange,
  options,
}: {
  readonly value: ScopeValue;
  readonly onChange: (next: ScopeValue) => void;
  readonly options: PerimeterOptions;
}) {
  const { t } = useTranslation();
  const inputCls =
    "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white";

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("compliance_scope.scope_type")}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {SCOPE_TYPES.map((st) => {
            const Icon = SCOPE_ICON[st];
            const active = value.scopeType === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => onChange({ ...value, scopeType: st })}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  active
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{t(`compliance_scope.types.${st}`)}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 mt-1.5">{t("compliance_scope.hint")}</p>
      </div>

      {value.scopeType === "org_entity" && (
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
            {t("compliance_scope.types.org_entity")} *
            {options.loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
          </label>
          <select
            className={inputCls}
            value={value.orgEntityId}
            onChange={(e) => onChange({ ...value, orgEntityId: e.target.value })}
          >
            <option value="">{t("compliance_scope.select_entity")}</option>
            {options.entities.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      {value.scopeType === "business_process" && (
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
            {t("compliance_scope.types.business_process")} *
            {options.loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
          </label>
          <select
            className={inputCls}
            value={value.businessProcessId}
            onChange={(e) => onChange({ ...value, businessProcessId: e.target.value })}
          >
            <option value="">{t("compliance_scope.select_process")}</option>
            {options.processes.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      {value.scopeType === "assets" && (
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
            {t("compliance_scope.types.assets")} *
            {options.loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
          </label>
          <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-50">
            {options.assets.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-3">{t("compliance_scope.select_assets")}</p>
            ) : (
              options.assets.map((o) => {
                const checked = value.assetIds.includes(o.id);
                return (
                  <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        onChange({
                          ...value,
                          assetIds: checked
                            ? value.assetIds.filter((id) => id !== o.id)
                            : [...value.assetIds, o.id],
                        })
                      }
                    />
                    <span className="truncate">{o.name}</span>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {t(
              value.assetIds.length === 1
                ? "compliance_scope.assets_selected_one"
                : "compliance_scope.assets_selected_other",
              { count: value.assetIds.length },
            )}
          </p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("compliance_scale.select_scale")}
        </label>
        <select
          className={inputCls}
          value={value.scaleId}
          onChange={(e) => onChange({ ...value, scaleId: e.target.value })}
        >
          <option value="">{t("compliance_scale.default_scale")}</option>
          {options.scales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.is_default ? ` · ${t("compliance_scale.default_badge")}` : ""}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">{t("compliance_scale.levels_hint")}</p>
      </div>
    </div>
  );
}

// ─── The list row, widened with the perimeter columns the API now returns ─────
// AssessmentListItem in @/types has not caught up with the backend's scope
// fields yet (reported under needs_integration); this local widening reads them
// without touching the api lane's file.
export type ScopedAssessment = AssessmentListItem & {
  scope_type?: string | null;
  org_entity_id?: string | null;
  org_entity_name?: string | null;
  business_process_id?: string | null;
  business_process_name?: string | null;
  scale_id?: string | null;
};

const STATUS_META: Record<string, { icon: typeof CheckCircle; color: string; labelKey: string }> = {
  draft:        { icon: XCircle,     color: "text-gray-500 bg-gray-100",     labelKey: "compliance.draft" },
  in_progress:  { icon: Clock,       color: "text-blue-600 bg-blue-50",      labelKey: "compliance.in_progress" },
  under_review: { icon: AlertCircle, color: "text-orange-600 bg-orange-50",  labelKey: "compliance.filter_under_review" },
  completed:    { icon: CheckCircle, color: "text-green-600 bg-green-50",    labelKey: "compliance.completed" },
  archived:     { icon: XCircle,     color: "text-gray-400 bg-gray-50",      labelKey: "compliance.archived" },
};

function scoreColor(score: number) {
  if (score >= 80) return "text-green-700 bg-green-50";
  if (score >= 60) return "text-yellow-700 bg-yellow-50";
  return "text-red-700 bg-red-50";
}

function barColor(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-400";
  return "bg-red-400";
}

function ScoreBadge({ score }: { readonly score: number | null | undefined }) {
  const { t } = useTranslation();
  if (score == null) return <span className="text-gray-400 text-sm italic">{t("compliance.score_not_run", "Not run")}</span>;
  return <span className={`text-xl font-bold px-3 py-1.5 rounded-xl ${scoreColor(score)}`}>{score}%</span>;
}

function StatusBadge({ status }: { readonly status: string }) {
  const { t } = useTranslation();
  const s = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>
      <s.icon className="w-3 h-3" />
      {t(s.labelKey)}
    </span>
  );
}

/** The minimum an object needs for its perimeter to be rendered. Both the list
 *  row and the assessment detail satisfy it. */
export interface ScopeSummary {
  scope_type?: string | null;
  org_entity_name?: string | null;
  business_process_name?: string | null;
}

/** « la DSI », « le processus Crédit », « le core banking » — what an assessment
 *  is actually measuring, on the card and in the header. */
export function ScopeBadge({ assessment }: { readonly assessment: ScopeSummary }) {
  const { t } = useTranslation();
  const type = (assessment.scope_type || "tenant") as ScopeType;
  const Icon = SCOPE_ICON[type] ?? Globe2;
  const name =
    type === "org_entity" ? assessment.org_entity_name
      : type === "business_process" ? assessment.business_process_name
      : null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700"
      title={t("compliance_scope.label")}
    >
      <Icon className="w-3 h-3" />
      {name || t(`compliance_scope.types.${type}`, { defaultValue: type })}
    </span>
  );
}

// ─── New Assessment Modal ──────────────────────────────────────────────────────

function NewAssessmentModal({
  frameworks,
  existingIds,
  onClose,
  onCreate,
}: {
  readonly frameworks: Framework[];
  /** Ids already in the register — how a handed-back duplicate is recognised. */
  readonly existingIds: readonly string[];
  readonly onClose: () => void;
  readonly onCreate: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [frameworkId, setFrameworkId] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [perimeter, setPerimeter] = useState<ScopeValue>(EMPTY_SCOPE);
  const options = usePerimeterOptions(perimeter.scopeType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!frameworkId || !name.trim()) return;
    const scopeError = validateScope(perimeter);
    if (scopeError) { setError(t(scopeError)); return; }
    setLoading(true);
    setError("");
    setDuplicateId(null);
    try {
      const result = await complianceApi.createScopedAssessment({
        framework_id: frameworkId,
        name: name.trim(),
        scope_description: scope.trim() || undefined,
        scope_type: perimeter.scopeType,
        org_entity_id: perimeter.scopeType === "org_entity" ? perimeter.orgEntityId : null,
        business_process_id: perimeter.scopeType === "business_process" ? perimeter.businessProcessId : null,
        in_scope_assets: perimeter.scopeType === "assets" ? perimeter.assetIds : null,
        scale_id: perimeter.scaleId || null,
      });
      // POST /compliance/assessments de-duplicates on framework + perimeter and
      // hands BACK the live assessment instead of creating a second one. The
      // response carries no "created vs existing" flag, so an id we already hold
      // is the tell — otherwise the user typed a name, pressed Create, and
      // silently landed on somebody else's older campaign under another name.
      if (existingIds.includes(result.id)) {
        setDuplicateId(result.id);
        return;
      }
      onCreate(result.id);
    } catch {
      setError(t("compliance.assessment_error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">{t("compliance.modal_title")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title={t("common.close")}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("compliance.framework")} *</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={frameworkId}
              onChange={(e) => { setFrameworkId(e.target.value); setDuplicateId(null); }}
              required
            >
              <option value="">{t("compliance.select_framework_placeholder")}</option>
              {frameworks.map((fw) => (
                <option key={fw.id} value={fw.id}>
                  {fw.name} ({t("compliance.controls_count", { count: fw.control_count })})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("compliance.assessment_name")} *</label>
            <input
              type="text"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("compliance.assessment_name_placeholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <ScopeFields
              value={perimeter}
              onChange={(next) => { setPerimeter(next); setDuplicateId(null); }}
              options={options}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("compliance.scope")} ({t("common.optional")})</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={2}
              placeholder={t("compliance.scope_optional_placeholder")}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {duplicateId && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-2">
              <span>{t("compliance_scope.duplicate_assessment")}</span>
              <button
                type="button"
                onClick={() => onCreate(duplicateId)}
                className="text-xs font-semibold border border-amber-300 hover:bg-amber-100 px-2.5 py-1 rounded-lg transition-colors"
              >
                {t("compliance.open_assessment")}
              </button>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || !frameworkId || !name.trim()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("compliance.create_assessment")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Coverage by perimeter ─────────────────────────────────────────────────────

type CoverageDim = "entity" | "process" | "asset";

function CoverageTable({ dim, frameworkId }: { readonly dim: CoverageDim; readonly frameworkId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<ScopeCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    const fw = frameworkId || undefined;
    const call =
      dim === "entity" ? complianceApi.coverageByEntity(fw)
        : dim === "process" ? complianceApi.coverageByProcess(fw)
        : complianceApi.coverageByAsset(fw);
    call
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError(t("compliance_scope.load_error")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [dim, frameworkId, t]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
    );
  }

  const items: ScopeCoverageItem[] = data?.items ?? [];
  const scored = items.filter((i) => i.compliance_score != null);

  return (
    <div className="space-y-3">
      {dim === "entity" && (
        <p className="text-xs text-gray-400">{t("compliance_scope.coverage_rollup_hint")}</p>
      )}
      {data && data.unscoped_assessment_count > 0 && (
        <p className="text-xs text-gray-400">
          {t("compliance_scope.organisation_wide")}: {data.unscoped_assessment_count}
        </p>
      )}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {items.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-400">
            {t("compliance_scope.coverage_none")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("common.name")}</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">{t("compliance_scope.coverage_assessments")}</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">{t("compliance_scope.coverage_assessed")}</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">{t("compliance.gaps")}</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("compliance_scope.coverage_score")}</th>
                  {dim === "entity" && (
                    <th
                      className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center"
                      title={t("compliance_scope.coverage_rollup_hint")}
                    >
                      {t("compliance_scope.coverage_rolled_up", "Consolidated")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-800">{item.name}</p>
                      {item.frameworks.length > 0 && (
                        <p className="text-xs text-gray-400 truncate max-w-xs">{item.frameworks.join(" · ")}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">{item.assessment_count}</td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">
                      {item.controls_scoreable}/{item.controls_total}
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-medium text-red-600">{item.open_gaps}</td>
                    <td className="px-4 py-3 min-w-[160px]">
                      {item.compliance_score == null ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor(item.compliance_score)}`}
                              style={{ width: `${item.compliance_score}%` }}
                            />
                          </div>
                          <span className="text-xs font-bold text-gray-700 w-10 text-right">{item.compliance_score}%</span>
                        </div>
                      )}
                    </td>
                    {dim === "entity" && (
                      <td className="px-4 py-3 text-center text-sm font-semibold text-indigo-600">
                        {item.rolled_up_score == null ? <span className="text-gray-300">—</span> : `${item.rolled_up_score}%`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {scored.length > 0 && (
        <p className="text-xs text-gray-400">
          {t("compliance_scope.coverage_assessed")}: {scored.length}/{items.length}
        </p>
      )}
    </div>
  );
}

/* ── Objectif 6 — « Tableau de bord de la conformité, accessible depuis la page
 *    dédiée à la conformité » ────────────────────────────────────────────────
 *
 * The page previously answered this clause with <ModuleDashboard
 * module="governance" hideWhenForbidden />. Two things were wrong with that.
 * First, the subject: politiques and attestations are governance artefacts, not
 * the conformity posture, and « la page dédiée à la conformité » asks for the
 * conformity dashboard on the conformity page. Second, and worse, that mount is
 * gated by require_roles_strict(EXECUTIVE, CISO) — no tenant_admin auto-pass —
 * so for the profile this page exists for (compliance_manager, auditor, and the
 * tenant owner) `hideWhenForbidden` rendered NOTHING: a « Tableau de bord »
 * toggle that expanded to empty space. A clause answered by a control that
 * opens onto nothing is not answered.
 *
 * The conformity dashboard the product actually has is
 * GET /dashboard/frameworks-overview (per-framework score, open gaps,
 * certification blockers, readiness) — the same source dashboard_export serves
 * under the key "compliance". It carries no plan gate and no role gate beyond
 * get_current_user, so it works for everyone who can already open this page.
 *
 * Every state this call can end in is owned here, because each is a clause:
 *   • loading   — a skeleton, never a blank rectangle.
 *   • EMPTY     — « aucun référentiel sélectionné », explicitly. Never sample
 *                 rows: fabricated figures on a bank's screen destroy trust in
 *                 every other number on it.
 *   • 402/403/404/424/5xx — an operator-actionable sentence, never a redirect
 *                 and never a blank card.
 *   • data      — with « alertes visuelles sur criticité élevée » on the
 *                 certification blockers: colour AND an icon AND the word.
 *   • « Export PDF/Excel » and « dernière actualisation » in the header.
 */
interface FrameworkOverviewCard {
  readonly framework_id: string;
  readonly framework_name: string;
  readonly framework_short_name?: string | null;
  readonly is_primary: boolean;
  readonly has_assessment: boolean;
  readonly assessment_id: string | null;
  readonly compliance_score: number | null;
  readonly open_gaps: number;
  /** Absent on the "no assessment yet" card — absent is not zero. */
  readonly open_blockers?: number;
  readonly cert_readiness: number | null;
  readonly controls_total: number;
  readonly controls_implemented: number;
  readonly status: string;
}

interface FrameworksOverview {
  readonly has_framework: boolean;
  readonly frameworks: FrameworkOverviewCard[];
}

function httpStatusOf(err: unknown): number {
  return (err as { response?: { status?: number } } | undefined)?.response?.status ?? 0;
}

/** The operator-actionable message key for a failed load, by status. */
function overviewErrorKey(status: number): string {
  if (status === 403) return "moduledash.restricted_hint";
  if (status === 404) return "moduledash.error_not_published";
  if (status === 424) return "moduledash.error_not_ready";
  if (status === 0) return "moduledash.error_unreachable";
  return "moduledash.error_generic";
}

function ComplianceDashboard() {
  const { t, i18n: i18nInstance } = useTranslation();
  const [data, setData] = useState<FrameworksOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [exporting, setExporting] = useState<"" | "pdf" | "xlsx">("");
  const [exportMessage, setExportMessage] = useState("");

  const lang = (() => {
    const raw = (i18nInstance.language || "en").toLowerCase();
    if (raw.startsWith("fr")) return "fr";
    if (raw.startsWith("ar")) return "ar";
    return "en";
  })();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = (await dashboardApi.getFrameworksOverview()) as FrameworksOverview;
      setData(payload);
      setErrorKey("");
      setLoadedAt(new Date());
    } catch (err) {
      // A failed read is NOT an empty register: leaving the panel to render
      // "no framework selected" would state something the server never said.
      setData(null);
      setErrorKey(overviewErrorKey(httpStatusOf(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runExport = useCallback(async (format: "pdf" | "xlsx") => {
    setExportMessage("");
    setExporting(format);
    try {
      const { blob, filename } = await dashboardExportApi.exportDashboardFile("compliance", format, lang);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // Every failure here is a MESSAGE, never a crash and never a redirect.
      const failure = await parseDashboardExportError(err);
      if (failure.status === 402) setExportMessage(t("moduledash.export_upgrade"));
      else if (failure.status === 403) setExportMessage(t("moduledash.export_forbidden"));
      else if (failure.status === 404) setExportMessage(t("moduledash.export_unavailable"));
      else if (failure.status === 424) setExportMessage(t("moduledash.export_not_ready"));
      else setExportMessage(t("moduledash.export_failed"));
    } finally {
      setExporting("");
    }
  }, [lang, t]);

  const cards = data?.frameworks ?? [];
  const scored = cards.filter((c) => c.compliance_score != null);
  // Averaged over the frameworks that HAVE a score only, and the denominator is
  // stated below — an average silently taken over "0" for every unassessed
  // referential is a figure nobody computed.
  const avgScore = scored.length
    ? Math.round(scored.reduce((s, c) => s + (c.compliance_score ?? 0), 0) / scored.length)
    : null;
  const totalGaps = cards.reduce((s, c) => s + (Number(c.open_gaps) || 0), 0);
  // `open_blockers` is absent from the no-assessment card, and absent is not
  // zero: it is summed over the cards that actually carry it, and the count of
  // those is what the tile's caption talks about.
  const blockerCards = cards.filter((c) => typeof c.open_blockers === "number");
  const totalBlockers = blockerCards.reduce((s, c) => s + (c.open_blockers ?? 0), 0);
  const isEmpty = !!data && (!data.has_framework || cards.length === 0);

  const card = "bg-white rounded-2xl border border-gray-100 shadow-sm";

  return (
    <section className={`${card} p-6 space-y-4`} aria-labelledby="compliance-dashboard-title">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-indigo-50 text-indigo-600">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="compliance-dashboard-title" className="text-sm font-semibold text-gray-900">
              {t("compliance.dash_title", { defaultValue: "Compliance dashboard" })}
            </h2>
            <p className="text-xs text-gray-500">
              {t("compliance.dash_subtitle", {
                defaultValue: "Score, gaps and certification readiness for every framework in scope",
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400">
            {loadedAt
              ? t("moduledash.last_updated_at", {
                  time: new Intl.DateTimeFormat(lang === "ar" ? "ar-TN" : lang, {
                    hour: "2-digit", minute: "2-digit",
                  }).format(loadedAt),
                })
              : t("moduledash.never_updated")}
          </span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            title={t("moduledash.refresh_now")}
            aria-label={t("moduledash.refresh_now")}
            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => runExport("pdf")}
            disabled={exporting !== ""}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            {exporting === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {t("moduledash.export_pdf")}
          </button>
          <button
            type="button"
            onClick={() => runExport("xlsx")}
            disabled={exporting !== ""}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            {exporting === "xlsx" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            {t("moduledash.export_excel")}
          </button>
        </div>
      </div>

      {exportMessage && (
        <p className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800" role="status">
          {exportMessage}
        </p>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="status" aria-busy="true">
          <span className="sr-only">{t("moduledash.loading")}</span>
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-gray-50 animate-pulse" />)}
        </div>
      ) : errorKey ? (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800" role="status">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="flex-1">
            <span className="font-medium">{t("moduledash.error_title")}</span> — {t(errorKey)}
          </span>
          <button type="button" onClick={load} className="shrink-0 text-xs font-medium underline">
            {t("moduledash.retry")}
          </button>
        </div>
      ) : isEmpty ? (
        <div className="rounded-xl bg-gray-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-gray-700">{t("moduledash.empty_title")}</p>
          <p className="text-xs text-gray-500 mt-1">
            {t("compliance.dash_empty", {
              defaultValue:
                "No framework is in scope yet. Pick the frameworks that apply to you, then open an assessment — the dashboard fills in from there.",
            })}
          </p>
          <Link to="/frameworks" className="inline-block mt-3 text-xs font-medium text-blue-600 hover:text-blue-700">
            {t("nav.frameworks")}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="text-2xl font-bold text-gray-900 tabular-nums">{cards.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">{t("compliance.dash_frameworks", { defaultValue: "Frameworks in scope" })}</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="text-2xl font-bold text-gray-900 tabular-nums">
                {avgScore == null ? <span className="text-gray-300">{t("moduledash.not_available")}</span> : `${avgScore}%`}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {t("compliance.dash_avg_score", { defaultValue: "Average compliance score" })}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {t("compliance.dash_scored_of", {
                  scored: scored.length, total: cards.length,
                  defaultValue: "over the {{scored}} of {{total}} framework(s) that have been assessed",
                })}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="text-2xl font-bold text-gray-900 tabular-nums">{totalGaps}</p>
              <p className="text-xs text-gray-500 mt-0.5">{t("compliance.dash_open_gaps", { defaultValue: "Open gaps" })}</p>
            </div>
            <div className={`rounded-xl border p-3 ${totalBlockers > 0 ? "border-red-200 bg-red-50" : "border-gray-100"}`}>
              <p className={`text-2xl font-bold tabular-nums ${totalBlockers > 0 ? "text-red-700" : "text-gray-900"}`}>
                {blockerCards.length === 0
                  ? <span className="text-gray-300">{t("moduledash.not_available")}</span>
                  : totalBlockers}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {t("compliance.dash_blockers", { defaultValue: "Open certification blockers" })}
              </p>
              {totalBlockers > 0 && (
                /* « Alertes visuelles sur criticité élevée » — colour is never
                   the only carrier: an icon and the word travel with it. */
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-[11px] font-semibold">
                  <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                  {t("moduledash.alert_critical_high")}
                </span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-3 py-2 font-medium text-gray-500">{t("compliance.framework")}</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">{t("compliance_scope.coverage_score")}</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">{t("compliance_scope.coverage_assessed")}</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">{t("compliance.gaps")}</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">{t("compliance.dash_blockers", { defaultValue: "Open certification blockers" })}</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">{t("compliance.dash_readiness", { defaultValue: "Certification readiness" })}</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.framework_id} className="border-b border-gray-50">
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-gray-900">{c.framework_short_name || c.framework_name}</span>
                      {c.is_primary && (
                        <span className="ms-1.5 inline-flex rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-[11px] font-semibold">
                          {t("compliance.primary_framework", { defaultValue: "Primary" })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 min-w-[150px]">
                      {c.compliance_score == null ? (
                        <span className="text-xs text-gray-300">{t("moduledash.not_available")}</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                            <div className={`h-full rounded-full ${barColor(c.compliance_score)}`} style={{ width: `${Math.min(c.compliance_score, 100)}%` }} />
                          </div>
                          <span className="text-xs font-bold text-gray-700 w-10 text-right tabular-nums">{c.compliance_score}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-600 tabular-nums">
                      {c.controls_total > 0 ? `${c.controls_implemented}/${c.controls_total}` : <span className="text-gray-300">{t("moduledash.not_available")}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center font-medium text-gray-700 tabular-nums">{c.open_gaps}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums">
                      {typeof c.open_blockers !== "number" ? (
                        <span className="text-gray-300">{t("moduledash.not_available")}</span>
                      ) : c.open_blockers > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-semibold">
                          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                          {c.open_blockers}
                        </span>
                      ) : (
                        <span className="text-gray-600">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-700 tabular-nums">
                      {c.cert_readiness == null ? <span className="text-gray-300">{t("moduledash.not_available")}</span> : `${c.cert_readiness}%`}
                    </td>
                    <td className="px-3 py-2.5">
                      {c.has_assessment && c.assessment_id ? (
                        // STATUS_META, not moduledash.vocab: the assessment
                        // statuses under_review / completed / archived have no
                        // entry in the shared vocabulary, so the raw-value
                        // fallback would have printed English words to a French
                        // or Arabic reader. This page already owns their keys.
                        <Link to={`/compliance/${c.assessment_id}`} className="text-xs font-medium text-blue-600 hover:text-blue-700">
                          {t(STATUS_META[c.status]?.labelKey ?? "common.status")}
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {t("compliance.dash_no_assessment", { defaultValue: "No assessment yet" })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState<ScopedAssessment[]>([]);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [view, setView] = useState<"assessments" | "coverage">("assessments");
  const [coverageDim, setCoverageDim] = useState<CoverageDim>("entity");
  const [coverageFramework, setCoverageFramework] = useState("");
  const [dashOpen, setDashOpen] = useState<boolean>(readDashOpen);
  // Rows the server holds beyond the page received; 0 when nothing was cut.
  const [notShown, setNotShown] = useState(0);
  // A register that could not be READ is not an empty register. With only the
  // fulfilled branch handled below, a rejected call left `assessments` at [] and
  // the screen answered with the « create your first assessment » guide — i.e.
  // it asserted that the organisation has assessed nothing, which is a statement
  // the server never made and the opposite of what happened. Same class of
  // defect as showing sample rows: a fact invented by the client.
  const [registerError, setRegisterError] = useState("");

  const load = useCallback(() => {
    // Not an object literal at the call site on purpose: the api lane's
    // listAssessments() signature does not carry include_archived yet (see
    // needs_integration), and the route does accept it.
    const params = { page: 1, page_size: ASSESSMENTS_PAGE_SIZE, include_archived: true };
    Promise.allSettled([
      complianceApi.listAssessments(params),
      frameworksApi.list(),
    ]).then(([aResult, fwResult]) => {
      if (aResult.status === "fulfilled") {
        setRegisterError("");
        setAssessments(aResult.value.items as ScopedAssessment[]);
        // The KPI tiles below are computed client-side over what arrived. Any
        // remainder makes them describe a page rather than the register, and
        // an under-count nobody is told about reads as a fact.
        setNotShown(Math.max(0, (aResult.value.total ?? 0) - aResult.value.items.length));
      } else {
        setAssessments([]);
        setNotShown(0);
        setRegisterError(t("compliance.register_failed"));
      }
      if (fwResult.status === "fulfilled") setFrameworks(fwResult.value.filter((fw) => fw.control_count > 0));
    }).finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const live = assessments.filter((a) => a.status !== "archived");

  const filtered = assessments.filter((a) =>
    statusFilter === "all" ? a.status !== "archived" : a.status === statusFilter
  );

  const withScore = live.filter((a) => a.compliance_score != null);
  const avgScore = withScore.length > 0
    ? Math.round(withScore.reduce((s, a) => s + (a.compliance_score ?? 0), 0) / withScore.length)
    : null;

  function handleCreate(id: string) {
    setShowModal(false);
    navigate(`/compliance/${id}`);
  }

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

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError("");
    try {
      await complianceApi.deleteAssessment(id);
      setAssessments((prev) => prev.filter((a) => a.id !== id));
      setConfirmDeleteId(null);
    } catch {
      // Previously swallowed: the row disappeared whether or not the server
      // accepted the delete.
      setDeleteError(t("compliance.delete_failed", "The assessment could not be deleted. Nothing was changed."));
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {showModal && (
        <NewAssessmentModal
          frameworks={frameworks}
          existingIds={assessments.map((a) => a.id)}
          onClose={() => setShowModal(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("compliance.title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {t("compliance.assessments_subtitle", { count: live.length, active: live.filter((a) => a.status === "in_progress").length })}
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("compliance.new_assessment")}
        </button>
      </div>

      {/*
        Objectif 6 covers « gouvernance et conformité », and its clause asks for
        the dashboard to be reachable from the sections it describes — not only
        from Analytics, which is where GET /dashboards/governance was called
        from and nowhere else. Politiques, attestations and comités de pilotage
        are the documentary half of conformité, so the same dashboard is mounted
        here as well as on /governance.

        This mount deliberately does NOT pass hideWhenForbidden. It did, and
        that was wrong: the gate is strict (executive / ciso, the tenant owner
        excluded) and the profile that lives on this page — compliance_manager —
        is outside it, so the component returned null while the collapse button
        above it stayed on screen. A control that says « masquer le tableau de
        bord » and does nothing when clicked is a broken control, and a section
        the tender says is here vanishing without a word is the same silence
        finding E is about. ModuleDashboard's documented default — an explicit
        « accès restreint » panel — is the « accès filtré par profil » clause
        working as specified, so it is what renders. The plan gate renders its
        translated upsell either way.

        The compliance dashboard proper is now the first panel below
        (<ComplianceDashboard/>): /dashboards has no "compliance" key, so it
        reads central_dashboard's get_frameworks_overview — the same source
        dashboard_export already serves under the key "compliance".
      */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={toggleDash}
          aria-expanded={dashOpen}
          aria-controls="module-dashboard-compliance"
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
        {dashOpen && (
          <div id="module-dashboard-compliance" className="space-y-3">
            {/* The conformity dashboard proper — ungated beyond
                get_current_user, so it is on screen for the profile this page
                exists for (compliance_manager, auditor, the tenant owner),
                which the governance tile below never is. */}
            <ComplianceDashboard />
            {/* Kept for the executive / RSSI who read conformité and gouvernance
                together. Its own strict role gate renders « accès restreint »
                for everyone else, which is honest now that the clause is
                answered by the panel above rather than by this one. */}
            <ModuleDashboard module="governance" />
          </div>
        )}
      </div>

      {/* View switch: the register, or « la DSI est à 62 % de conformité » */}
      <div className="flex gap-2">
        {([
          { key: "assessments", label: t("compliance.assessments"), icon: Layers },
          { key: "coverage", label: t("compliance_scope.coverage_title"), icon: PieChart },
        ] as const).map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
              view === v.key
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            <v.icon className="w-4 h-4" />
            {v.label}
          </button>
        ))}
      </div>

      {view === "coverage" ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t("compliance_scope.coverage_title")}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{t("compliance_scope.coverage_subtitle")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {([
              { key: "entity",  label: t("compliance_scope.coverage_by_entity") },
              { key: "process", label: t("compliance_scope.coverage_by_process") },
              { key: "asset",   label: t("compliance_scope.coverage_by_asset") },
            ] as const).map((d) => (
              <button
                key={d.key}
                onClick={() => setCoverageDim(d.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  coverageDim === d.key
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {d.label}
              </button>
            ))}
            <select
              value={coverageFramework}
              onChange={(e) => setCoverageFramework(e.target.value)}
              className="ml-auto border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              title={t("compliance.framework")}
            >
              <option value="">{t("common.all")} — {t("compliance.framework")}</option>
              {frameworks.map((fw) => (
                <option key={fw.id} value={fw.id}>{fw.short_name || fw.name}</option>
              ))}
            </select>
          </div>

          <CoverageTable dim={coverageDim} frameworkId={coverageFramework} />
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: t("compliance.kpi_avg_score"),   value: avgScore != null ? `${avgScore}%` : "—", sub: t("compliance.kpi_avg_score_sub") },
              { label: t("compliance.kpi_total"),       value: live.length,                              sub: t("compliance.kpi_total_sub") },
              { label: t("compliance.kpi_completed"),   value: live.filter((a) => a.status === "completed").length,   sub: t("compliance.kpi_completed_sub") },
              { label: t("compliance.kpi_in_progress"), value: live.filter((a) => a.status === "in_progress").length, sub: t("compliance.kpi_in_progress_sub") },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>

          {registerError && (
            <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800" role="status">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="flex-1">{registerError}</span>
              <button
                type="button"
                onClick={() => { setLoading(true); load(); }}
                className="shrink-0 text-xs font-medium underline"
              >
                {t("moduledash.retry")}
              </button>
            </div>
          )}

          {notShown > 0 && (
            <p className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800" role="status">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {t("compliance.assessments_truncated", {
                  n: notShown,
                  defaultValue:
                    "{{n}} further assessment(s) are held but not loaded here; the figures above cover the ones listed only.",
                })}
              </span>
            </p>
          )}

          {/* Filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {[
              { key: "all",          label: t("common.all")                     },
              { key: "in_progress",  label: t("compliance.filter_in_progress")  },
              { key: "under_review", label: t("compliance.filter_under_review") },
              { key: "completed",    label: t("compliance.filter_completed")    },
              { key: "draft",        label: t("compliance.filter_draft")        },
              { key: "archived",     label: t("compliance.archived")            },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  statusFilter === tab.key
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {deleteError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center justify-between gap-3">
              <span>{deleteError}</span>
              <button onClick={() => setDeleteError("")} className="text-red-400 hover:text-red-600" title={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Assessment cards */}
          <div className="space-y-4">
            {filtered.map((a) => (
              <div
                key={a.id}
                onClick={() => confirmDeleteId !== a.id && navigate(`/compliance/${a.id}`)}
                className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="text-base font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                        {a.name}
                      </h3>
                      <StatusBadge status={a.status} />
                      <ScopeBadge assessment={a} />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <span className="font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">
                        {a.framework_short_name}
                      </span>
                      <span>{a.framework_name}</span>
                      {a.document_count > 0 && (
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {t(a.document_count === 1 ? "compliance.documents_label_one" : "compliance.documents_label_other", { count: a.document_count })}
                        </span>
                      )}
                      <span className="text-gray-400">
                        {t("common.created_at")} {new Date(a.created_at).toLocaleDateString(i18n.language?.startsWith("fr") ? "fr-FR" : i18n.language?.startsWith("ar") ? "ar-u-nu-latn" : "en-GB")}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    <ScoreBadge score={a.compliance_score} />
                    {a.status === "draft" && (
                      confirmDeleteId === a.id ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <span className="text-xs text-red-600 font-medium">
                            {t("compliance.delete_draft_confirm", "Delete?")}
                          </span>
                          <button
                            onClick={() => handleDelete(a.id)}
                            disabled={deletingId === a.id}
                            className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingId === a.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : t("compliance.delete_draft_yes", "Yes, delete")}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg border border-gray-200"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(a.id); }}
                          title={t("compliance.delete_draft_title", "Delete this draft assessment")}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </div>
                </div>

                {a.compliance_score != null && (
                  <div className="mt-4">
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor(a.compliance_score)}`}
                        style={{ width: `${a.compliance_score}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* How-to guide — shown when the register is genuinely empty, never
              when it could not be read: the guide states « you have no
              assessments yet », which is a claim only a successful read can
              support. */}
          {assessments.length === 0 && !registerError && (
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <FolderUp className="w-5 h-5 text-blue-600" />
                <p className="font-bold text-blue-900">{t("compliance.how_to_title")}</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { num: 1, icon: Plus,        color: "bg-blue-100 text-blue-600",     title: t("compliance.how_to_step1_title"), desc: t("compliance.how_to_step1_desc") },
                  { num: 2, icon: FolderUp,    color: "bg-purple-100 text-purple-600", title: t("compliance.how_to_step2_title"), desc: t("compliance.how_to_step2_desc") },
                  { num: 3, icon: Sparkles,    color: "bg-orange-100 text-orange-600", title: t("compliance.how_to_step3_title"), desc: t("compliance.how_to_step3_desc") },
                  { num: 4, icon: BarChart3,   color: "bg-green-100 text-green-600",   title: t("compliance.how_to_step4_title"), desc: t("compliance.how_to_step4_desc") },
                  { num: 5, icon: FileText,    color: "bg-teal-100 text-teal-600",     title: t("compliance.how_to_step5_title"), desc: t("compliance.how_to_step5_desc") },
                  { num: 6, icon: CheckCircle, color: "bg-green-100 text-green-600",   title: t("compliance.how_to_step6_title"), desc: t("compliance.how_to_step6_desc") },
                ].map(({ num, icon: Icon, color, title, desc }) => (
                  <div key={num} className="bg-white rounded-xl border border-blue-100 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-bold text-gray-400">{t("compliance.step_label", { num })}</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{title}</p>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => setShowModal(true)}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" /> {t("compliance.create_first_assessment")}
                </button>
                <Link to="/help" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                  {t("compliance.full_guide")}
                </Link>
              </div>
            </div>
          )}

          {filtered.length === 0 && assessments.length > 0 && (
            <div className="text-center py-16 text-gray-400 text-sm">
              {t("compliance.no_filter_match")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
