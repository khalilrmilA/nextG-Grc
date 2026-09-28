/**
 * CustomFrameworkPage — create a tenant-owned referential from scratch.
 *
 * Two changes beyond the translation pass (this screen had no useTranslation at
 * all, which made « mise à jour manuelle » unusable for a French- or
 * Arabic-speaking compliance officer):
 *   * the framework now declares its `source_type` — norme, réglementation, loi
 *     or politique interne — which is the tender's « classée par source »;
 *   * a control now carries its domaine, its type d'exigence, whether it is
 *     mandatory, and its crosswalk to other frameworks.
 *
 * Also fixed: the requirement rows sent `requirement_level`, but the endpoint
 * reads `level` (frameworks.py RequirementCreate), so every requirement was
 * silently stored as "must" whatever the user picked. Both are sent now.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight,
  Loader2, CheckCircle, Save,
} from "lucide-react";
import { customFrameworkApi } from "@/api/endpoints";
import type {
  Framework, FrameworkControl, RequirementCreate, FrameworkCreate, ControlCreate,
  CrosswalkMapping,
} from "@/types";

const REGIONS = ["Global", "EU", "US", "US-Gov", "UK", "APAC", "LATAM", "MEA"];
const INDUSTRIES = ["All", "Technology", "Finance", "Healthcare", "Government", "Retail", "Energy", "Manufacturing"];
const CATEGORIES = [
  "identify", "protect", "detect", "respond", "recover",
  "governance", "organizational", "technical", "physical",
];
// Controlled vocabularies the backend validates against.
const DOMAINS = [
  "Organizational", "People", "Physical", "Technological",
  "IDENTIFY", "PROTECT", "DETECT", "RESPOND", "RECOVER", "GOVERNANCE", "POLICY",
];
const REQUIREMENT_TYPES = ["exigence", "recommandation", "mesure"];

/** Display label for a controlled-vocabulary value (region, industry, domain);
 *  the value itself is what the API stores, only the label is translated. */
function vocab(t: TFunction, group: string, value: string): string {
  return t(`fw_options.${group}.${value.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, { defaultValue: value });
}
const SOURCE_TYPES = ["norme", "reglementation", "loi", "politique_interne"];

/** types/index.ts is owned by another lane and predates these columns; the
 *  endpoints accept them, so they are declared here and widened at the call. */
type FrameworkPayload = FrameworkCreate & { source_type?: string | null };
type ControlPayload = ControlCreate & {
  domain?: string | null;
  requirement_type?: string | null;
  is_mandatory?: boolean;
  mapped_controls?: CrosswalkMapping[];
};
/** The route reads `level`; the shared type still says `requirement_level`. */
type RequirementPayload = RequirementCreate & { level: string };

function parseMappings(text: string): CrosswalkMapping[] {
  const out: CrosswalkMapping[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[;,\n]/)) {
    const raw = part.trim();
    if (!raw) continue;
    const idx = raw.indexOf(":");
    if (idx <= 0) continue;
    const framework = raw.slice(0, idx).trim();
    const control = raw.slice(idx + 1).trim();
    if (!framework || !control) continue;
    const key = `${framework.toLowerCase()}:${control.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ framework, control });
  }
  return out;
}

// ─── Step 1: Framework Metadata ────────────────────────────────────────────────

function MetadataStep({
  onCreated,
}: {
  readonly onCreated: (fw: Framework) => void;
}) {
  const { t } = useTranslation();
  const [name, setName]         = useState("");
  const [shortName, setShort]   = useState("");
  const [version, setVersion]   = useState("1.0");
  const [description, setDesc]  = useState("");
  const [issuingBody, setIssuer]= useState("");
  const [sourceType, setSourceType] = useState("");
  const [regions, setRegions]   = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  function autoSlug(n: string) {
    return n.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 20);
  }

  function toggleRegion(r: string) {
    setRegions((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  }
  function toggleIndustry(i: string) {
    setIndustries((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !shortName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const payload: FrameworkPayload = {
        name: name.trim(),
        short_name: shortName.trim(),
        version: version.trim() || "1.0",
        description: description.trim() || undefined,
        issuing_body: issuingBody.trim() || undefined,
        applicable_regions: regions,
        applicable_industries: industries,
        ...(sourceType ? { source_type: sourceType } : {}),
      };
      const fw = await customFrameworkApi.create(payload as FrameworkCreate);
      onCreated(fw);
    } catch {
      setError(t("framework_editor.error_create_failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label htmlFor="cf-name" className="block text-sm font-medium text-gray-700 mb-1">
            {t("framework_editor.name")} *
          </label>
          <input
            id="cf-name"
            type="text"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t("framework_editor.name_placeholder")}
            value={name}
            onChange={(e) => { setName(e.target.value); if (!shortName) setShort(autoSlug(e.target.value)); }}
            required
          />
        </div>

        <div>
          <label htmlFor="cf-short" className="block text-sm font-medium text-gray-700 mb-1">
            {t("framework_editor.short_name")} *
          </label>
          <input
            id="cf-short"
            type="text"
            maxLength={20}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t("framework_editor.short_name_placeholder")}
            value={shortName}
            onChange={(e) => setShort(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20))}
            required
          />
        </div>

        <div>
          <label htmlFor="cf-version" className="block text-sm font-medium text-gray-700 mb-1">
            {t("framework_editor.version")}
          </label>
          <input
            id="cf-version"
            type="text"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t("framework_editor.version_placeholder")}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </div>

        <div className="col-span-2">
          <label htmlFor="cf-desc" className="block text-sm font-medium text-gray-700 mb-1">
            {t("framework_editor.description")}
          </label>
          <textarea
            id="cf-desc"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={3}
            placeholder={t("framework_editor.description_placeholder")}
            value={description}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="cf-issuer" className="block text-sm font-medium text-gray-700 mb-1">
            {t("framework_editor.issuing_body")}
          </label>
          <input
            id="cf-issuer"
            type="text"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t("framework_editor.issuing_body_placeholder")}
            value={issuingBody}
            onChange={(e) => setIssuer(e.target.value)}
          />
        </div>

        {/* « Chaque exigence est classée par source » starts with the source itself */}
        <div>
          <label htmlFor="cf-source-type" className="block text-sm font-medium text-gray-700 mb-1">
            {t("framework_editor.source_type")}
          </label>
          <select
            id="cf-source-type"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
          >
            <option value="">{t("requirements.type_unclassified")}</option>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>{t(`framework_editor.source_types.${s}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className="block text-sm font-medium text-gray-700 mb-2">{t("framework_editor.regions")}</span>
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => toggleRegion(r)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                regions.includes(r)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {vocab(t, "region", r)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="block text-sm font-medium text-gray-700 mb-2">{t("framework_editor.industries")}</span>
        <div className="flex flex-wrap gap-2">
          {INDUSTRIES.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggleIndustry(i)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                industries.includes(i)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {vocab(t, "industry", i)}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !name.trim() || !shortName.trim()}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {t("framework_editor.save_details")}
      </button>
    </form>
  );
}

// ─── Requirement row in add-control form ──────────────────────────────────────

function RequirementInput({
  req,
  index,
  onChange,
  onRemove,
}: {
  readonly req: RequirementCreate;
  readonly index: number;
  readonly onChange: (i: number, r: RequirementCreate) => void;
  readonly onRemove: (i: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2">
      <select
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-20 flex-shrink-0"
        value={req.requirement_level}
        onChange={(e) => onChange(index, { ...req, requirement_level: e.target.value as RequirementCreate["requirement_level"] })}
      >
        <option value="must">{t("framework_editor.requirement_levels.must", "must")}</option>
        <option value="should">{t("framework_editor.requirement_levels.should", "should")}</option>
        <option value="may">{t("framework_editor.requirement_levels.may", "may")}</option>
      </select>
      <input
        type="text"
        className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        placeholder={t("framework_editor.control_requirement_placeholder")}
        value={req.requirement_text}
        onChange={(e) => onChange(index, { ...req, requirement_text: e.target.value })}
      />
      <button type="button" onClick={() => onRemove(index)} className="text-gray-300 hover:text-red-500 mt-1.5"
        title={t("common.delete")}>
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Step 2: Control Builder ───────────────────────────────────────────────────

function ControlBuilderStep({ framework }: { readonly framework: Framework }) {
  const { t } = useTranslation();
  const [controls, setControls] = useState<FrameworkControl[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Add control form state
  const [controlId, setControlId]     = useState("");
  const [title, setTitle]             = useState("");
  const [category, setCategory]       = useState("");
  const [domain, setDomain]           = useState("");
  const [requirementType, setRequirementType] = useState("");
  const [mandatory, setMandatory]     = useState(false);
  const [mapped, setMapped]           = useState("");
  const [description, setDescription] = useState("");
  const [guidance, setGuidance]       = useState("");
  const [tags, setTags]               = useState("");
  const [requirements, setRequirements] = useState<RequirementCreate[]>([
    { requirement_text: "", requirement_level: "must" },
  ]);
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState("");

  function resetForm() {
    setControlId(""); setTitle(""); setCategory(""); setDescription("");
    setGuidance(""); setTags(""); setDomain(""); setRequirementType("");
    setMandatory(false); setMapped("");
    setRequirements([{ requirement_text: "", requirement_level: "must" }]);
  }

  async function addControl(e: React.FormEvent) {
    e.preventDefault();
    if (!controlId.trim() || !title.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      const payload: ControlPayload = {
        control_id: controlId.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        guidance: guidance.trim() || undefined,
        category: category || undefined,
        domain: domain || null,
        requirement_type: requirementType || null,
        is_mandatory: mandatory,
        mapped_controls: parseMappings(mapped),
        tags: tags ? tags.split(",").map((x) => x.trim()).filter(Boolean) : [],
      };
      const ctrl = await customFrameworkApi.addControl(framework.id, payload as ControlCreate);

      // Add requirements — `level` is what the endpoint reads.
      const validReqs = requirements.filter((r) => r.requirement_text.trim());
      for (const req of validReqs) {
        const reqPayload: RequirementPayload = { ...req, level: req.requirement_level };
        await customFrameworkApi.addRequirement(framework.id, ctrl.id, reqPayload as RequirementCreate);
      }

      setControls((prev) => [...prev, ctrl]);
      resetForm();
    } catch {
      setSaveError(t("framework_editor.error_add_control"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteControl(ctrl: FrameworkControl) {
    try {
      await customFrameworkApi.deleteControl(framework.id, ctrl.id);
      setControls((prev) => prev.filter((c) => c.id !== ctrl.id));
      if (expanded === ctrl.id) setExpanded(null);
    } catch {
      setSaveError(t("framework_editor.error_delete_control"));
    }
  }

  return (
    <div className="grid grid-cols-5 gap-6">
      {/* Left: Control tree */}
      <div className="col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            {t(controls.length === 1 ? "framework_editor.controls_count_one" : "framework_editor.controls_count_other", { count: controls.length })}
          </h3>
        </div>
        {controls.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
            {t("framework_editor.no_controls")}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            {controls.map((ctrl) => (
              <div key={ctrl.id}>
                <div
                  className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpanded(expanded === ctrl.id ? null : ctrl.id)}
                >
                  {expanded === ctrl.id ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  )}
                  <span className="font-mono text-xs text-gray-400">{ctrl.control_id}</span>
                  <span className="flex-1 text-xs font-medium text-gray-700 truncate">{ctrl.title}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); deleteControl(ctrl); }}
                    className="text-gray-200 hover:text-red-500 flex-shrink-0"
                    title={t("framework_editor.delete_control")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {expanded === ctrl.id && (
                  <div className="px-4 pb-3 text-xs text-gray-500 space-y-1">
                    {ctrl.domain && (
                      <p><span className="font-medium">{t("framework_editor.control_domain")}:</span> {vocab(t, "domain", ctrl.domain)}</p>
                    )}
                    {ctrl.category && (
                      <p><span className="font-medium">{t("framework_editor.control_category")}:</span> {vocab(t, "domain", ctrl.category)}</p>
                    )}
                    {ctrl.requirement_type && (
                      <p>
                        <span className="font-medium">{t("framework_editor.control_requirement_type")}:</span>{" "}
                        {t(`framework_editor.requirement_types.${ctrl.requirement_type}`, { defaultValue: ctrl.requirement_type })}
                      </p>
                    )}
                    {ctrl.description && <p className="text-gray-600">{ctrl.description}</p>}
                    {ctrl.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {ctrl.tags.map((tag) => (
                          <span key={tag} className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-xs">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Framework summary */}
        {controls.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700 flex items-start gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>{framework.short_name}</strong>
              {" — "}
              {t(controls.length === 1 ? "framework_editor.controls_count_one" : "framework_editor.controls_count_other", { count: controls.length })}
            </span>
          </div>
        )}
      </div>

      {/* Right: Add control form */}
      <div className="col-span-3">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t("framework_editor.add_control")}</h3>
          <form onSubmit={addControl} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="cb-id" className="block text-xs font-medium text-gray-600 mb-1">
                  {t("framework_editor.control_id")} *
                </label>
                <input
                  id="cb-id"
                  type="text"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder={t("framework_editor.control_id_placeholder")}
                  value={controlId}
                  onChange={(e) => setControlId(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="cb-cat" className="block text-xs font-medium text-gray-600 mb-1">
                  {t("framework_editor.control_category")}
                </label>
                <select
                  id="cb-cat"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">{t("common.none")}</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{vocab(t, "domain", c)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="cb-title" className="block text-xs font-medium text-gray-600 mb-1">
                {t("framework_editor.control_title")} *
              </label>
              <input
                id="cb-title"
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder={t("framework_editor.control_title_placeholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            {/* Classification — domaine + type d'exigence */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="cb-domain" className="block text-xs font-medium text-gray-600 mb-1">
                  {t("framework_editor.control_domain")}
                </label>
                <select
                  id="cb-domain"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  <option value="">{t("requirements.domain_unclassified")}</option>
                  {DOMAINS.map((d) => <option key={d} value={d}>{vocab(t, "domain", d)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="cb-type" className="block text-xs font-medium text-gray-600 mb-1">
                  {t("framework_editor.control_requirement_type")}
                </label>
                <select
                  id="cb-type"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  value={requirementType}
                  onChange={(e) => setRequirementType(e.target.value)}
                >
                  <option value="">{t("requirements.type_unclassified")}</option>
                  {REQUIREMENT_TYPES.map((r) => (
                    <option key={r} value={r}>{t(`framework_editor.requirement_types.${r}`)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="cb-desc" className="block text-xs font-medium text-gray-600 mb-1">
                {t("framework_editor.control_description")}
              </label>
              <textarea
                id="cb-desc"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                rows={2}
                placeholder={t("framework_editor.control_description_placeholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="cb-guid" className="block text-xs font-medium text-gray-600 mb-1">
                {t("framework_editor.control_guidance")}
              </label>
              <textarea
                id="cb-guid"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                rows={2}
                placeholder={t("framework_editor.control_guidance_placeholder")}
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="cb-mapped" className="block text-xs font-medium text-gray-600 mb-1">
                {t("framework_editor.control_mapped")}
              </label>
              <input
                id="cb-mapped"
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder={t("framework_editor.control_mapped_placeholder")}
                value={mapped}
                onChange={(e) => setMapped(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="cb-tags" className="block text-xs font-medium text-gray-600 mb-1">
                {t("framework_editor.tags")}
              </label>
              <input
                id="cb-tags"
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder={t("framework_editor.tags_placeholder")}
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={mandatory}
                onChange={(e) => setMandatory(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              {t("framework_editor.control_mandatory")}
            </label>

            {/* Requirements */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600">{t("framework_editor.control_requirements")}</span>
                <button
                  type="button"
                  onClick={() => setRequirements((prev) => [...prev, { requirement_text: "", requirement_level: "must" }])}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  + {t("common.create")}
                </button>
              </div>
              <div className="space-y-2">
                {requirements.map((req, i) => (
                  <RequirementInput
                    key={i}
                    req={req}
                    index={i}
                    onChange={(idx, r) => setRequirements((prev) => prev.map((x, j) => j === idx ? r : x))}
                    onRemove={(idx) => setRequirements((prev) => prev.filter((_, j) => j !== idx))}
                  />
                ))}
              </div>
            </div>

            {saveError && <p className="text-xs text-red-600">{saveError}</p>}

            <button
              type="submit"
              disabled={saving || !controlId.trim() || !title.trim()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors w-full justify-center"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {t("framework_editor.add_control")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomFrameworkPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [framework, setFramework] = useState<Framework | null>(null);

  return (
    <div className="p-8 max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate("/framework")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("frameworks.builder.back")}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{t("framework_editor.custom_title")}</h1>
        <p className="text-gray-500 text-sm mt-1">{t("framework_editor.custom_subtitle")}</p>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-3 mb-2">
        <div className={`flex items-center gap-2 text-sm font-medium ${!framework ? "text-blue-600" : "text-green-600"}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${!framework ? "bg-blue-600 text-white" : "bg-green-100 text-green-700"}`}>
            {framework ? <CheckCircle className="w-3.5 h-3.5" /> : "1"}
          </span>
          {t("framework_editor.details_title")}
        </div>
        <div className="h-px w-8 bg-gray-200" />
        <div className={`flex items-center gap-2 text-sm font-medium ${framework ? "text-blue-600" : "text-gray-400"}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${framework ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-400"}`}>
            2
          </span>
          {t("framework_editor.add_control")}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        {!framework ? (
          <MetadataStep onCreated={(fw) => setFramework(fw)} />
        ) : (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800">{framework.name}</p>
                <p className="text-xs text-blue-600">
                  {framework.short_name} v{framework.version} · {t("framework_editor.details_saved")}
                </p>
              </div>
            </div>
            <ControlBuilderStep framework={framework} />
          </div>
        )}
      </div>
    </div>
  );
}
