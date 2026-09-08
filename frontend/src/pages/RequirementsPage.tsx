/**
 * RequirementsPage — le référentiel centralisé (STB objectif 1).
 *
 * One register over GET /requirements, which unions the four silos a bank used
 * to have to open four menus for: framework controls, internal policies,
 * governance documents and the regulatory watch. Every line carries the four
 * classification axes the tender names — source, domaine, type, applicabilité —
 * and each one is a real filter here, backed by /requirements/facets so the
 * dropdown vocabulary is the data's own, never a hard-coded frontend list.
 *
 * The detail modal is where a requirement stops being a row: it shows the
 * internal policies that claim to cover it (GET /requirements/controls/{id}/
 * policies), its equivalences in other frameworks (the crosswalk), and — for a
 * framework control — lets a CISO record the applicability decision with the
 * justification an auditor will ask for.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Library, Search, Filter, Loader2, AlertCircle, CheckCircle, X,
  BookOpen, FileText, Landmark, Scale, ShieldCheck, CircleSlash,
  ExternalLink, RefreshCw, Link2, Save, Layers,
} from "lucide-react";
import {
  requirementsApi, frameworksApi, assetGraphApi,
} from "@/api/endpoints";
import DataActions from "@/components/common/DataActions";
import type {
  Requirement, RequirementFacets, RequirementFacetBucket,
  RequirementLinkedPolicy, Framework, ControlApplicabilityState,
  FrameworkControl,
} from "@/types";

// The four silos and the four source types are backend vocabularies
// (requirements.py SOURCE_KINDS / SOURCE_TYPES). They are listed here only to
// give each one an icon and a colour — the *values* rendered in the filters
// always come from the facets, so a vocabulary change on the server shows up
// here without a frontend release.
const KIND_STYLE: Record<string, { icon: typeof BookOpen; color: string; bg: string }> = {
  framework_control:   { icon: BookOpen,  color: "text-blue-600",    bg: "bg-blue-50"    },
  policy:              { icon: FileText,  color: "text-purple-600",  bg: "bg-purple-50"  },
  governance_document: { icon: Landmark,  color: "text-emerald-600", bg: "bg-emerald-50" },
  regulatory_update:   { icon: Scale,     color: "text-amber-600",   bg: "bg-amber-50"   },
};

const SOURCE_TYPE_STYLE: Record<string, string> = {
  norme:             "bg-blue-50 text-blue-700",
  reglementation:    "bg-amber-50 text-amber-700",
  loi:               "bg-rose-50 text-rose-700",
  politique_interne: "bg-purple-50 text-purple-700",
};

const APPLICABILITY_STYLE: Record<string, string> = {
  applicable:           "bg-green-50 text-green-700",
  partially_applicable: "bg-orange-50 text-orange-700",
  not_applicable:       "bg-gray-100 text-gray-500",
};

const APPLICABILITY_VALUES = ["applicable", "partially_applicable", "not_applicable"];

/** Lifecycle values from the non-policy silos, mapped onto the translated key
 *  that already carries that wording. Without this the Status column printed the
 *  raw backend enum ("under review", "not applicable") in the French and Arabic
 *  UI. Values with no equivalent anywhere in the locale files (new,
 *  pending_approval, action_required) fall through to the humanised default. */
const STATUS_ALIAS: Record<string, string> = {
  draft:          "policies.draft",
  in_review:      "policies.in_review",
  under_review:   "policies.under_review",
  approved:       "policies.approved",
  published:      "policies.published",
  retired:        "policies.retired",
  implemented:    "compliance.statuses.implemented",
  not_applicable: "applicability.values.not_applicable",
};

/** Where a row of the referential lives in the rest of the app. */
const KIND_ROUTE: Record<string, string> = {
  policy:              "/policies",
  governance_document: "/governance",
  regulatory_update:   "/regulatory",
  framework_control:   "/framework",
};

type Perimeter = { id: string; name: string };

type CrosswalkResponse = {
  control?: FrameworkControl;
  mapped_to?: Array<{ framework?: string; control?: string }>;
  resolved?: FrameworkControl[];
};

const PAGE_SIZES = [25, 50, 100, 200];

// ── Detail modal ─────────────────────────────────────────────────────────────

function RequirementDetailModal({
  requirement,
  onClose,
  onApplicabilitySaved,
}: {
  readonly requirement: Requirement;
  readonly onClose: () => void;
  readonly onApplicabilitySaved: (value: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isControl = requirement.source_kind === "framework_control";

  const [policies, setPolicies] = useState<RequirementLinkedPolicy[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [crosswalk, setCrosswalk] = useState<CrosswalkResponse | null>(null);

  // Applicability (framework controls only — the other silos carry their own
  // lifecycle and the decision would have nowhere to be stored).
  const [appState, setAppState] = useState<ControlApplicabilityState | null>(null);
  const [loadingApp, setLoadingApp] = useState(false);
  const [value, setValue] = useState<string>("applicable");
  const [justification, setJustification] = useState("");
  const [scope, setScope] = useState<"organisation" | "entity" | "process">("organisation");
  const [entityId, setEntityId] = useState("");
  const [processId, setProcessId] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [entities, setEntities] = useState<Perimeter[]>([]);
  const [processes, setProcesses] = useState<Perimeter[]>([]);
  const [saving, setSaving] = useState(false);
  const [appError, setAppError] = useState("");
  const [appSaved, setAppSaved] = useState(false);

  useEffect(() => {
    if (!isControl) return;
    let cancelled = false;
    setLoadingPolicies(true);
    requirementsApi.policiesForControl(requirement.source_id)
      .then((rows) => { if (!cancelled) setPolicies(rows); })
      .catch(() => { if (!cancelled) setPolicies([]); })
      .finally(() => { if (!cancelled) setLoadingPolicies(false); });
    return () => { cancelled = true; };
  }, [isControl, requirement.source_id]);

  useEffect(() => {
    if (!isControl || !requirement.framework_id) return;
    let cancelled = false;
    frameworksApi.getCrosswalk(requirement.framework_id, requirement.source_id)
      .then((data) => { if (!cancelled) setCrosswalk(data as CrosswalkResponse); })
      .catch(() => { if (!cancelled) setCrosswalk(null); });
    return () => { cancelled = true; };
  }, [isControl, requirement.framework_id, requirement.source_id]);

  useEffect(() => {
    if (!isControl || !requirement.framework_id) return;
    let cancelled = false;
    setLoadingApp(true);
    frameworksApi.getControlApplicability(requirement.framework_id, requirement.source_id)
      .then((state) => {
        if (cancelled) return;
        setAppState(state);
        const org = state.organisation_wide;
        setValue(org?.applicability ?? "applicable");
        setJustification(org?.justification ?? "");
        setReviewDate(org?.review_date ? org.review_date.slice(0, 10) : "");
      })
      .catch(() => { if (!cancelled) setAppState(null); })
      .finally(() => { if (!cancelled) setLoadingApp(false); });
    return () => { cancelled = true; };
  }, [isControl, requirement.framework_id, requirement.source_id]);

  useEffect(() => {
    if (!isControl) return;
    let cancelled = false;
    Promise.allSettled([assetGraphApi.listEntities(), assetGraphApi.listProcesses()])
      .then(([e, p]) => {
        if (cancelled) return;
        setEntities(e.status === "fulfilled" ? (e.value as Perimeter[]) : []);
        setProcesses(p.status === "fulfilled" ? (p.value as Perimeter[]) : []);
      });
    return () => { cancelled = true; };
  }, [isControl]);

  async function saveApplicability() {
    if (!requirement.framework_id) return;
    if (value === "not_applicable" && justification.trim().length < 10) {
      setAppError(t("applicability.justification_required"));
      return;
    }
    // A perimeter was chosen but not named: sending both ids as null would file
    // an ORGANISATION-WIDE decision under the label "this entity only", which is
    // exactly the kind of silent scope change an auditor would flag.
    if (scope === "entity" && !entityId) {
      setAppError(t("applicability.select_entity"));
      return;
    }
    if (scope === "process" && !processId) {
      setAppError(t("applicability.select_process"));
      return;
    }
    setSaving(true);
    setAppError("");
    setAppSaved(false);
    try {
      await frameworksApi.setControlApplicability(requirement.framework_id, requirement.source_id, {
        applicability: value,
        justification: justification.trim() || null,
        org_entity_id: scope === "entity" ? (entityId || null) : null,
        business_process_id: scope === "process" ? (processId || null) : null,
        review_date: reviewDate || null,
      });
      setAppSaved(true);
      if (scope === "organisation") onApplicabilitySaved(value);
      const refreshed = await frameworksApi.getControlApplicability(
        requirement.framework_id, requirement.source_id,
      );
      setAppState(refreshed);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAppError(typeof detail === "string" ? detail : t("applicability.error_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  const kind = KIND_STYLE[requirement.source_kind] ?? KIND_STYLE.framework_control;
  const KindIcon = kind.icon;
  const resolved = crosswalk?.resolved ?? [];
  const mappedTo = crosswalk?.mapped_to ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${kind.bg}`}>
            <KindIcon className={`w-5 h-5 ${kind.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {requirement.ref_code && (
                <span className="text-xs font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                  {requirement.ref_code}
                </span>
              )}
              <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600">
                {t(`requirements.source_kind.${requirement.source_kind}`, { defaultValue: requirement.source_kind })}
              </span>
            </div>
            <h2 className="font-bold text-gray-900 text-base leading-snug mt-1.5">{requirement.title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {requirement.source_name ?? t("requirements.source_unknown")}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            title={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Classification */}
          <div className="flex flex-wrap items-center gap-1.5">
            {requirement.source_type && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SOURCE_TYPE_STYLE[requirement.source_type] ?? "bg-gray-100 text-gray-600"}`}>
                {t(`requirements.source_type.${requirement.source_type}`, { defaultValue: requirement.source_type })}
              </span>
            )}
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600">
              {requirement.domain ?? t("requirements.domain_unclassified")}
            </span>
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600">
              {requirement.requirement_type
                ? t(`requirements.requirement_type.${requirement.requirement_type}`, { defaultValue: requirement.requirement_type })
                : t("requirements.type_unclassified")}
            </span>
            {requirement.applicability && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${APPLICABILITY_STYLE[requirement.applicability] ?? "bg-gray-100 text-gray-600"}`}>
                {t(`applicability.values.${requirement.applicability}`, { defaultValue: requirement.applicability })}
              </span>
            )}
          </div>

          {requirement.description && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                {t("common.description")}
              </p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{requirement.description}</p>
            </div>
          )}

          {/* Internal policies covering this requirement */}
          {isControl && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Link2 className="w-3 h-3" /> {t("requirements.linked_policies")}
              </p>
              {loadingPolicies ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
                </div>
              ) : policies.length === 0 ? (
                <p className="text-sm text-gray-400">{t("requirements.linked_policies_none")}</p>
              ) : (
                <div className="space-y-2">
                  {policies.map((p) => (
                    <button key={p.id} type="button" onClick={() => navigate("/policies")}
                      className="w-full flex items-center justify-between gap-3 border border-gray-100 rounded-xl px-3 py-2.5 hover:bg-gray-50 transition-colors text-left">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{p.title}</p>
                        <p className="text-xs text-gray-400">
                          {p.policy_number ? `${p.policy_number} · ` : ""}{p.category ?? ""}
                        </p>
                      </div>
                      <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600 flex-shrink-0">
                        {t(`policies.${p.status}`, { defaultValue: p.status })}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Crosswalk — « la même exigence issue de plusieurs sources » */}
          {isControl && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Layers className="w-3 h-3" /> {t("framework_editor.control_crosswalk")}
              </p>
              {mappedTo.length === 0 ? (
                <p className="text-sm text-gray-400">{t("framework_editor.control_crosswalk_none")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {mappedTo.map((m, i) => {
                    const hit = resolved.find(
                      (c) => (c.source_short_name ?? "").toLowerCase() === String(m.framework ?? "").toLowerCase()
                        && c.control_id.toLowerCase() === String(m.control ?? "").toLowerCase(),
                    );
                    return (
                      <span key={`${m.framework}-${m.control}-${i}`}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${hit ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500"}`}
                        title={hit?.title ?? undefined}>
                        {m.framework} · {m.control}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Applicability decision */}
          {isControl && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                {t("applicability.title")}
              </p>
              <p className="text-xs text-gray-400 mb-3">{t("applicability.subtitle")}</p>

              {loadingApp ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
                </div>
              ) : (
                <div className="space-y-3">
                  {!appState?.organisation_wide && (
                    <p className="text-xs text-gray-400">{t("applicability.no_decision")}</p>
                  )}
                  {appState?.is_mandatory && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      {t("framework_editor.control_mandatory")}
                    </p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="req-app-value" className="block text-xs font-medium text-gray-600 mb-1">
                        {t("applicability.label")}
                      </label>
                      <select id="req-app-value" value={value} onChange={(e) => setValue(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                        {APPLICABILITY_VALUES.map((v) => (
                          // A mandatory requirement cannot be excluded (the server
                          // refuses it with a 422), so the option is not offered —
                          // unless a decision predating the flag already holds it.
                          <option key={v} value={v}
                            disabled={v === "not_applicable" && Boolean(appState?.is_mandatory) && value !== "not_applicable"}>
                            {t(`applicability.values.${v}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="req-app-scope" className="block text-xs font-medium text-gray-600 mb-1">
                        {t("applicability.scope")}
                      </label>
                      <select id="req-app-scope" value={scope}
                        onChange={(e) => setScope(e.target.value as "organisation" | "entity" | "process")}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                        <option value="organisation">{t("applicability.scope_organisation")}</option>
                        <option value="entity">{t("applicability.scope_entity")}</option>
                        <option value="process">{t("applicability.scope_process")}</option>
                      </select>
                    </div>
                    {scope === "entity" && (
                      <div>
                        <label htmlFor="req-app-entity" className="block text-xs font-medium text-gray-600 mb-1">
                          {t("applicability.scope_entity")}
                        </label>
                        <select id="req-app-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                          <option value="">{t("applicability.select_entity")}</option>
                          {entities.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
                        </select>
                      </div>
                    )}
                    {scope === "process" && (
                      <div>
                        <label htmlFor="req-app-process" className="block text-xs font-medium text-gray-600 mb-1">
                          {t("applicability.scope_process")}
                        </label>
                        <select id="req-app-process" value={processId} onChange={(e) => setProcessId(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                          <option value="">{t("applicability.select_process")}</option>
                          {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    )}
                    <div>
                      <label htmlFor="req-app-review" className="block text-xs font-medium text-gray-600 mb-1">
                        {t("applicability.review_date")}
                      </label>
                      <input id="req-app-review" type="date" value={reviewDate}
                        onChange={(e) => setReviewDate(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <p className="text-xs text-gray-400 mt-1">{t("applicability.review_hint")}</p>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="req-app-just" className="block text-xs font-medium text-gray-600 mb-1">
                      {t("applicability.justification")}
                    </label>
                    <textarea id="req-app-just" rows={2} value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                      placeholder={t("applicability.justification_placeholder")}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>

                  {appError && (
                    <p className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" /> {appError}
                    </p>
                  )}
                  {appSaved && (
                    <p className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" /> {t("applicability.saved")}
                    </p>
                  )}

                  <div className="flex justify-end">
                    <button type="button" onClick={saveApplicability} disabled={saving}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {t("applicability.save")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button type="button" onClick={() => navigate(KIND_ROUTE[requirement.source_kind] ?? "/framework")}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
            <ExternalLink className="w-3.5 h-3.5" /> {t("requirements.open_source")}
          </button>
          <button type="button" onClick={onClose}
            className="text-sm px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function RequirementsPage() {
  const { t } = useTranslation();

  const [items, setItems] = useState<Requirement[]>([]);
  const [facets, setFacets] = useState<RequirementFacets | null>(null);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Requirement | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sourceKind, setSourceKind] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [domain, setDomain] = useState("");
  const [requirementType, setRequirementType] = useState("");
  const [applicability, setApplicability] = useState("");
  const [frameworkId, setFrameworkId] = useState("");
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [pageSize, setPageSize] = useState(50);

  const offsetRef = useRef(0);

  // Debounce the search box: one keystroke must not be one round-trip against a
  // 4 500-line referential.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const params = useMemo(() => ({
    ...(sourceKind ? { source_kind: sourceKind } : {}),
    ...(sourceType ? { source_type: sourceType } : {}),
    ...(domain ? { domain } : {}),
    ...(requirementType ? { requirement_type: requirementType } : {}),
    ...(applicability ? { applicability } : {}),
    ...(frameworkId ? { framework_id: frameworkId } : {}),
    ...(search ? { search } : {}),
    scope,
  }), [sourceKind, sourceType, domain, requirementType, applicability, frameworkId, search, scope]);

  const load = useCallback(async (append: boolean) => {
    const nextOffset = append ? offsetRef.current : 0;
    if (append) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const [listRes, facetRes] = await Promise.all([
        requirementsApi.list({ ...params, limit: pageSize, offset: nextOffset }),
        append ? Promise.resolve(null) : requirementsApi.facets(params),
      ]);
      setItems((prev) => (append ? [...prev, ...listRes.items] : listRes.items));
      setTotal(listRes.total);
      offsetRef.current = nextOffset + listRes.items.length;
      if (facetRes) setFacets(facetRes);
    } catch {
      // A failed "load more" used to be swallowed entirely — the spinner stopped
      // and nothing said the next page had not arrived.
      if (!append) {
        setItems([]);
        setTotal(0);
      }
      setError(t("requirements.load_error"));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [params, pageSize, t]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    frameworksApi.list().then(setFrameworks).catch(() => setFrameworks([]));
  }, []);

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setSourceKind("");
    setSourceType("");
    setDomain("");
    setRequirementType("");
    setApplicability("");
    setFrameworkId("");
  }

  const filtersActive = Boolean(
    sourceKind || sourceType || domain || requirementType || applicability || frameworkId,
  );

  function bucketCount(list: RequirementFacetBucket[] | undefined, value: string): number {
    return list?.find((b) => b.value === value)?.count ?? 0;
  }

  const applicableCount    = bucketCount(facets?.by_applicability, "applicable");
  const notApplicableCount = bucketCount(facets?.by_applicability, "not_applicable");
  const sourceCount        = (facets?.by_source_type ?? []).filter((b) => b.value).length;

  const domainOptions = (facets?.by_domain ?? []).filter((b) => b.value);
  const hasMore = items.length < total;

  function kindLabel(value: string | null): string {
    if (!value) return t("requirements.source_unknown");
    return t(`requirements.source_kind.${value}`, { defaultValue: value });
  }

  function statusLabel(r: Requirement): string {
    if (!r.status) return "";
    if (r.source_kind === "policy") return t(`policies.${r.status}`, { defaultValue: r.status });
    // The regulatory-watch lifecycle has no namespace of its own yet, so each
    // value is routed to the translated key that already carries that wording
    // rather than being printed as a raw English enum in a French/Arabic UI.
    const alias = STATUS_ALIAS[r.status];
    if (alias) return t(alias, { defaultValue: r.status.replace(/_/g, " ") });
    return t(`requirements.status.${r.status}`, { defaultValue: r.status.replace(/_/g, " ") });
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Library className="w-6 h-6 text-blue-600" /> {t("requirements.title")}
          </h1>
          <p className="text-gray-500 text-sm mt-1">{t("requirements.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <DataActions module="framework-controls" showImport={false} />
          <button type="button" onClick={() => load(false)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title={t("common.refresh")}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t("requirements.stat_total"),          value: facets?.total ?? total, sub: t("requirements.stat_total_sub"),          color: "text-blue-600",  icon: Library    },
          { label: t("requirements.stat_sources"),        value: sourceCount,            sub: t("requirements.stat_sources_sub"),        color: "text-purple-600", icon: Layers     },
          { label: t("requirements.stat_applicable"),     value: applicableCount,        sub: t("requirements.stat_applicable_sub"),     color: "text-green-600",  icon: ShieldCheck },
          { label: t("requirements.stat_not_applicable"), value: notApplicableCount,     sub: t("requirements.stat_not_applicable_sub"), color: "text-gray-500",   icon: CircleSlash },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-2">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
              <s.icon className={`w-4 h-4 ${s.color} opacity-60`} />
            </div>
            <p className="text-sm font-medium text-gray-700 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={t("requirements.search_placeholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button type="button" onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2.5 border rounded-lg text-sm font-medium transition-colors ${
              showFilters ? "bg-blue-50 border-blue-200 text-blue-600" : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            <Filter className="w-3.5 h-3.5" />
            {t("common.filter")}
            {filtersActive && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />}
          </button>
          <button type="button" onClick={() => setScope((s) => (s === "all" ? "selected" : "all"))}
            className={`px-3 py-2.5 border rounded-lg text-sm font-medium transition-colors ${
              scope === "all" ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            {t("frameworks.all_frameworks")}
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-gray-100">
            <div>
              <label htmlFor="req-f-kind" className="block text-xs text-gray-500 font-medium mb-1">
                {t("requirements.filter_register")}
              </label>
              <select id="req-f-kind" value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">{t("requirements.all_registers")}</option>
                {(facets?.by_source_kind ?? []).filter((b) => b.value).map((b) => (
                  <option key={b.value} value={b.value as string}>
                    {kindLabel(b.value)} ({b.count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="req-f-source" className="block text-xs text-gray-500 font-medium mb-1">
                {t("requirements.filter_source")}
              </label>
              <select id="req-f-source" value={sourceType} onChange={(e) => setSourceType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">{t("requirements.all_sources")}</option>
                {(facets?.by_source_type ?? []).filter((b) => b.value).map((b) => (
                  <option key={b.value} value={b.value as string}>
                    {t(`requirements.source_type.${b.value}`, { defaultValue: b.value as string })} ({b.count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="req-f-domain" className="block text-xs text-gray-500 font-medium mb-1">
                {t("requirements.filter_domain")}
              </label>
              <select id="req-f-domain" value={domain} onChange={(e) => setDomain(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">{t("requirements.all_domains")}</option>
                {domainOptions.map((b) => (
                  <option key={b.value} value={b.value as string}>{b.value} ({b.count})</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="req-f-type" className="block text-xs text-gray-500 font-medium mb-1">
                {t("requirements.filter_type")}
              </label>
              <select id="req-f-type" value={requirementType} onChange={(e) => setRequirementType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">{t("requirements.all_types")}</option>
                {(facets?.by_requirement_type ?? []).filter((b) => b.value).map((b) => (
                  <option key={b.value} value={b.value as string}>
                    {t(`requirements.requirement_type.${b.value}`, { defaultValue: b.value as string })} ({b.count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="req-f-app" className="block text-xs text-gray-500 font-medium mb-1">
                {t("requirements.filter_applicability")}
              </label>
              <select id="req-f-app" value={applicability} onChange={(e) => setApplicability(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">{t("requirements.all_applicability")}</option>
                {(facets?.by_applicability ?? []).filter((b) => b.value).map((b) => (
                  <option key={b.value} value={b.value as string}>
                    {t(`applicability.values.${b.value}`, { defaultValue: b.value as string })} ({b.count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="req-f-fw" className="block text-xs text-gray-500 font-medium mb-1">
                {t("requirements.filter_framework")}
              </label>
              <select id="req-f-fw" value={frameworkId} onChange={(e) => setFrameworkId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">{t("frameworks.all_frameworks")}</option>
                {frameworks.map((f) => (
                  <option key={f.id} value={f.id}>{f.short_name} — {f.name}</option>
                ))}
              </select>
            </div>
            {filtersActive && (
              <div className="md:col-span-3">
                <button type="button" onClick={clearFilters} className="text-xs text-blue-600 hover:underline">
                  {t("requirements.clear_filters")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> {t("common.loading")}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 px-8">
            <BookOpen className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">{t("requirements.empty_title")}</p>
            <p className="text-gray-400 text-sm mt-1">{t("requirements.empty_hint")}</p>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="mt-4 text-sm text-blue-600 hover:underline">
                {t("requirements.clear_filters")}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {[
                    t("requirements.col_ref"),
                    t("requirements.col_title"),
                    t("requirements.col_source"),
                    t("requirements.col_domain"),
                    t("requirements.col_type"),
                    t("requirements.col_applicability"),
                    t("requirements.col_status"),
                  ].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5 first:px-6">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((r) => {
                  const kind = KIND_STYLE[r.source_kind] ?? KIND_STYLE.framework_control;
                  const KindIcon = kind.icon;
                  return (
                    <tr key={`${r.source_kind}-${r.source_id}`} onClick={() => setSelected(r)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors group">
                      <td className="px-6 py-3.5">
                        <span className="text-xs font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          {r.ref_code ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-start gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${kind.bg}`}>
                            <KindIcon className={`w-3.5 h-3.5 ${kind.color}`} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors line-clamp-2">
                              {r.title}
                            </p>
                            <p className="text-xs text-gray-400">{kindLabel(r.source_kind)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-gray-600">{r.source_name ?? t("requirements.source_unknown")}</span>
                          {r.source_type && (
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold w-fit ${SOURCE_TYPE_STYLE[r.source_type] ?? "bg-gray-100 text-gray-600"}`}>
                              {t(`requirements.source_type.${r.source_type}`, { defaultValue: r.source_type })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-xs text-gray-500">
                          {r.domain ?? <span className="text-gray-300">{t("requirements.domain_unclassified")}</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-xs text-gray-500">
                          {r.requirement_type
                            ? t(`requirements.requirement_type.${r.requirement_type}`, { defaultValue: r.requirement_type })
                            : t("requirements.type_unclassified")}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        {r.applicability ? (
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${APPLICABILITY_STYLE[r.applicability] ?? "bg-gray-100 text-gray-600"}`}>
                            {t(`applicability.values.${r.applicability}`, { defaultValue: r.applicability })}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {r.status
                          ? <span className="text-xs text-gray-500">{statusLabel(r)}</span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && items.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-gray-500">
            {t("requirements.showing_range", { from: 1, to: items.length, total })}
          </p>
          <div className="flex items-center gap-3">
            <label htmlFor="req-page-size" className="text-xs text-gray-500">
              {t("requirements.per_page")}
            </label>
            <select id="req-page-size" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            {hasMore && (
              <button type="button" onClick={() => load(true)} disabled={loadingMore}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {t("requirements.load_more")}
              </button>
            )}
          </div>
        </div>
      )}

      {selected && (
        <RequirementDetailModal
          requirement={selected}
          onClose={() => setSelected(null)}
          onApplicabilitySaved={(value) => {
            setItems((prev) => prev.map((r) =>
              r.source_kind === selected.source_kind && r.source_id === selected.source_id
                ? { ...r, applicability: value }
                : r));
          }}
        />
      )}
    </div>
  );
}
