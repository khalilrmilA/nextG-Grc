/**
 * FrameworkBuilderPage — Build custom compliance frameworks by:
 * 1. Selecting controls from existing frameworks (mix-and-match)
 * 2. Getting AI suggestions tailored to industry/region
 * 3. Adding custom controls manually
 * 4. Saving as a tenant-owned framework
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  BookOpen, Sparkles, Plus, Check, ChevronRight, ChevronDown, Trash2,
  Search, Loader2, Save, ArrowLeft, AlertCircle, Lightbulb, Library, Wand2, Copy,
} from "lucide-react";
import { frameworksApi } from "@/api/endpoints";

interface Control {
  id: string;
  control_id: string;
  title: string;
  description: string | null;
  category: string | null;
  framework_id: string;
}

interface FrameworkBrowse {
  framework_id: string;
  framework_name: string;
  framework_short_name: string;
  controls: Control[];
}

interface AISuggestion {
  title: string;
  description: string;
  category: string;
  rationale: string;
  priority: string;
}

interface SelectedControl {
  control_id: string;
  title: string;
  description?: string;
  category?: string;
  source_framework?: string;
  source_id?: string;  // ID of source control (to deduplicate)
}

const STEPS = ["info", "browse", "ai", "review"] as const;
type Step = typeof STEPS[number];

// Values sent to the API as-is; only the displayed label is translated.
const BUILDER_INDUSTRIES = ["Technology", "Financial Services", "Healthcare", "Retail", "Manufacturing", "Government", "Education", "Telecommunications", "Energy"];
const BUILDER_REGIONS = ["Global", "USA", "European Union", "UK", "Asia Pacific", "MENA", "Latin America", "Africa"];

function vocab(t: TFunction, group: string, value: string): string {
  return t(`fw_options.${group}.${value.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, { defaultValue: value });
}

export default function FrameworkBuilderPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("info");

  // Form state
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [version, setVersion] = useState("1.0");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("Technology");
  const [region, setRegion] = useState("Global");

  // Browse state
  const [frameworks, setFrameworks] = useState<FrameworkBrowse[]>([]);
  const [loadingFrameworks, setLoadingFrameworks] = useState(false);
  const [expandedFramework, setExpandedFramework] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // AI state
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [aiRationale, setAiRationale] = useState("");
  const [loadingAi, setLoadingAi] = useState(false);
  const [editingCategoryIdx, setEditingCategoryIdx] = useState<number | null>(null);

  // Custom control form
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customCtrl, setCustomCtrl] = useState({ control_id: "", title: "", description: "", category: "" });
  const [customTab, setCustomTab] = useState<"new" | "import">("new");

  // Import-from-framework state (inside custom control form)
  const [importFwList, setImportFwList] = useState<{ id: string; name: string; short_name: string }[]>([]);
  const [importFwId, setImportFwId] = useState("");
  const [importFwControls, setImportFwControls] = useState<Control[]>([]);
  const [importFwLoading, setImportFwLoading] = useState(false);
  const [importSearch, setImportSearch] = useState("");
  const [importSelected, setImportSelected] = useState<string | null>(null);

  // Selected controls
  const [selected, setSelected] = useState<SelectedControl[]>([]);

  // Save state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load frameworks when entering browse step
  useEffect(() => {
    if (step === "browse" && frameworks.length === 0) {
      loadFrameworks();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load framework list for the import picker when tab switches to "import"
  useEffect(() => {
    if (customTab !== "import" || importFwList.length > 0) return;
    frameworksApi.list().then(list =>
      setImportFwList(list.map(f => ({ id: f.id, name: f.name, short_name: f.short_name })))
    ).catch(() => {});
  }, [customTab, importFwList.length]);

  // Load controls for the selected import framework
  useEffect(() => {
    if (!importFwId) { setImportFwControls([]); return; }
    setImportFwLoading(true);
    setImportSelected(null);
    setImportSearch("");
    // Stored text, not a machine translation: the picked control is copied
    // into the new framework.
    frameworksApi.getControls(importFwId, { original: 1 })
      .then(ctrls => setImportFwControls(ctrls as Control[]))
      .catch(() => setImportFwControls([]))
      .finally(() => setImportFwLoading(false));
  }, [importFwId]);

  async function loadFrameworks() {
    try {
      setLoadingFrameworks(true);
      const data = await frameworksApi.browseControls();
      setFrameworks(data || []);
    } catch (err) {
      console.error("Failed to load frameworks:", err);
    } finally {
      setLoadingFrameworks(false);
    }
  }

  async function loadAISuggestions() {
    try {
      setLoadingAi(true);
      setError("");
      const result = await frameworksApi.getAISuggestions({
        industry,
        region,
        use_case: description,
        selected_control_ids: selected.filter(c => c.source_id).map(c => c.source_id!),
      }) as { suggestions: AISuggestion[]; rationale: string };
      setAiSuggestions(result.suggestions || []);
      setAiRationale(result.rationale || "");
    } catch (err) {
      console.error("AI suggestions failed:", err);
      setError(t("frameworks.builder.err_ai_failed"));
    } finally {
      setLoadingAi(false);
    }
  }

  function isControlSelected(controlId: string): boolean {
    return selected.some(c => c.source_id === controlId);
  }

  function toggleControl(control: Control, frameworkName: string) {
    if (isControlSelected(control.id)) {
      setSelected(s => s.filter(c => c.source_id !== control.id));
    } else {
      setSelected(s => [
        ...s,
        {
          control_id: control.control_id,
          title: control.title,
          description: control.description || undefined,
          category: control.category || undefined,
          source_framework: frameworkName,
          source_id: control.id,
        },
      ]);
    }
  }

  function getFrameworkSelectionState(fw: FrameworkBrowse): "none" | "some" | "all" {
    if (fw.controls.length === 0) return "none";
    const selectedCount = fw.controls.filter(c => isControlSelected(c.id)).length;
    if (selectedCount === 0) return "none";
    if (selectedCount === fw.controls.length) return "all";
    return "some";
  }

  function toggleFramework(fw: FrameworkBrowse, e: React.MouseEvent) {
    e.stopPropagation();
    const state = getFrameworkSelectionState(fw);
    if (state === "all") {
      // Deselect all controls from this framework
      const idsToRemove = new Set(fw.controls.map(c => c.id));
      setSelected(s => s.filter(c => !c.source_id || !idsToRemove.has(c.source_id)));
    } else {
      // Select all controls from this framework (preserving already-selected, no duplicates)
      const alreadySelectedIds = new Set(selected.map(c => c.source_id).filter(Boolean));
      const newOnes: SelectedControl[] = fw.controls
        .filter(c => !alreadySelectedIds.has(c.id))
        .map(c => ({
          control_id: c.control_id,
          title: c.title,
          description: c.description || undefined,
          category: c.category || undefined,
          source_framework: fw.framework_short_name,
          source_id: c.id,
        }));
      setSelected(s => [...s, ...newOnes]);
    }
  }

  function isAISuggestionSelected(title: string): boolean {
    return selected.some(c => c.title === title && c.source_framework === "AI");
  }

  function toggleAISuggestion(suggestion: AISuggestion) {
    if (isAISuggestionSelected(suggestion.title)) {
      setSelected(s => s.filter(c => !(c.title === suggestion.title && c.source_framework === "AI")));
    } else {
      // Generate a control_id from title
      const ctrlId = "AI-" + suggestion.title.replace(/[^A-Za-z0-9]+/g, "").slice(0, 8).toUpperCase();
      setSelected(s => [
        ...s,
        {
          control_id: ctrlId,
          title: suggestion.title,
          description: suggestion.description,
          category: suggestion.category,
          source_framework: "AI",
        },
      ]);
    }
  }

  function removeSelected(idx: number) {
    setSelected(s => s.filter((_, i) => i !== idx));
  }

  function updateAISuggestionCategory(idx: number, category: string) {
    setAiSuggestions(prev => prev.map((s, i) => i === idx ? { ...s, category } : s));
    setEditingCategoryIdx(null);
    // Also update in selected list if already selected
    const sug = aiSuggestions[idx];
    if (sug) {
      setSelected(prev => prev.map(c =>
        c.title === sug.title && c.source_framework === "AI" ? { ...c, category } : c
      ));
    }
  }

  function addCustomControl() {
    if (!customCtrl.title.trim()) return;
    const ctrlId = customCtrl.control_id.trim()
      || ("CUSTOM-" + customCtrl.title.replace(/[^A-Za-z0-9]+/g, "").slice(0, 8).toUpperCase());
    setSelected(prev => [
      ...prev,
      {
        control_id: ctrlId,
        title: customCtrl.title.trim(),
        description: customCtrl.description.trim() || undefined,
        category: customCtrl.category.trim() || undefined,
        source_framework: customTab === "import" ? "Imported" : "Custom",
      },
    ]);
    setCustomCtrl({ control_id: "", title: "", description: "", category: "" });
    setImportFwId("");
    setImportSelected(null);
    setImportSearch("");
    setCustomTab("new");
    setShowCustomForm(false);
  }

  async function handleSave() {
    if (!name.trim() || !shortName.trim()) {
      setError(t("frameworks.builder.err_name_required"));
      return;
    }
    if (selected.length === 0) {
      setError(t("frameworks.builder.err_no_controls"));
      return;
    }

    try {
      setSaving(true);
      setError("");
      await frameworksApi.buildCustom({
        name: name.trim(),
        short_name: shortName.trim(),
        version,
        description: description || undefined,
        applicable_industries: [industry],
        applicable_regions: [region],
        controls: selected.map(c => ({
          control_id: c.control_id,
          title: c.title,
          description: c.description,
          category: c.category,
          source_framework: c.source_framework,
        })),
      });
      navigate("/framework");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("framework_builder.unknown_error");
      setError(t("framework_builder.save_failed", { msg }));
    } finally {
      setSaving(false);
    }
  }

  function nextStep() {
    setError("");
    const currentIdx = STEPS.indexOf(step);
    if (currentIdx < STEPS.length - 1) {
      setStep(STEPS[currentIdx + 1]);
    }
  }

  function prevStep() {
    const currentIdx = STEPS.indexOf(step);
    if (currentIdx > 0) {
      setStep(STEPS[currentIdx - 1]);
    }
  }

  // Filter frameworks by search
  const filteredFrameworks = frameworks.map(fw => ({
    ...fw,
    controls: search
      ? fw.controls.filter(c =>
          c.title.toLowerCase().includes(search.toLowerCase()) ||
          c.control_id.toLowerCase().includes(search.toLowerCase())
        )
      : fw.controls,
  }));

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate("/framework")}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="w-4 h-4" /> {t("frameworks.builder.back")}
          </button>
          <h1 className="text-2xl font-bold text-gray-900">{t("frameworks.builder.title")}</h1>
          <p className="text-gray-500 text-sm mt-1">{t("frameworks.builder.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
          <Library className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-blue-900">{selected.length} {t("frameworks.builder.controls_selected")}</span>
        </div>
      </div>

      {/* Step Indicators */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <div className="flex items-center justify-between">
          {STEPS.map((s, idx) => {
            const isActive = step === s;
            const isPast = STEPS.indexOf(step) > idx;
            const labels: Record<Step, string> = {
              info:   `1. ${t("frameworks.builder.step_info")}`,
              browse: `2. ${t("frameworks.builder.step_browse")}`,
              ai:     `3. ${t("frameworks.builder.step_ai")}`,
              review: `4. ${t("frameworks.builder.step_review")}`,
            };
            return (
              <div key={s} className="flex items-center flex-1">
                <button
                  onClick={() => setStep(s)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : isPast
                      ? "text-blue-600 hover:bg-blue-50"
                      : "text-gray-400"
                  }`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                    isActive ? "bg-white text-blue-600" : isPast ? "bg-blue-100" : "bg-gray-100"
                  }`}>
                    {isPast ? <Check className="w-3 h-3" /> : idx + 1}
                  </span>
                  {labels[s]}
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 ${isPast ? "bg-blue-300" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* STEP 1: INFO */}
      {step === "info" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">{t("frameworks.builder.framework_info")}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t("frameworks.builder.framework_name")} *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t("framework_builder.name_placeholder")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t("frameworks.builder.short_name")} *</label>
              <input
                type="text"
                value={shortName}
                onChange={e => setShortName(e.target.value.toUpperCase())}
                placeholder="CUSTOM-2026"
                maxLength={20}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t("frameworks.builder.version")}</label>
              <input
                type="text"
                value={version}
                onChange={e => setVersion(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t("frameworks.builder.industry")}</label>
              <select
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {BUILDER_INDUSTRIES.map(v => <option key={v} value={v}>{vocab(t, "industry", v)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t("frameworks.builder.region")}</label>
              <select
                value={region}
                onChange={e => setRegion(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {BUILDER_REGIONS.map(v => <option key={v} value={v}>{vocab(t, "region", v)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{t("frameworks.builder.description_label")}</label>
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t("frameworks.builder.description_placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>
      )}

      {/* STEP 2: BROWSE CONTROLS */}
      {step === "browse" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{t("frameworks.builder.browse_title")}</h2>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t("frameworks.builder.search_controls")}
                className="pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {loadingFrameworks ? (
            <div className="text-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto" />
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {filteredFrameworks.map(fw => {
                const isExpanded = expandedFramework === fw.framework_id;
                const selectedFromFw = fw.controls.filter(c => isControlSelected(c.id)).length;
                const fwState = getFrameworkSelectionState(fw);
                return (
                  <div key={fw.framework_id} className="border border-gray-200 rounded-lg">
                    <div className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3 flex-1">
                        {/* Framework-level checkbox (select all controls) */}
                        <button
                          type="button"
                          onClick={(e) => toggleFramework(fw, e)}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                            fwState === "all"
                              ? "bg-blue-600 border-blue-600"
                              : fwState === "some"
                              ? "bg-blue-100 border-blue-600"
                              : "border-gray-300 hover:border-blue-400"
                          }`}
                          title={fwState === "all" ? t("frameworks.builder.deselect_all") : t("frameworks.builder.select_all")}
                        >
                          {fwState === "all" && <Check className="w-3.5 h-3.5 text-white" />}
                          {fwState === "some" && <div className="w-2 h-0.5 bg-blue-600 rounded"></div>}
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedFramework(isExpanded ? null : fw.framework_id)}
                          className="flex items-center gap-3 flex-1 text-left"
                        >
                          <BookOpen className="w-5 h-5 text-blue-600" />
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{fw.framework_name}</p>
                            <p className="text-xs text-gray-500">
                              {fw.controls.length} {t("frameworks.builder.controls_count")} · <span className={selectedFromFw > 0 ? "text-blue-600 font-semibold" : ""}>{selectedFromFw} {t("frameworks.builder.selected_count")}</span>
                            </p>
                          </div>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedFramework(isExpanded ? null : fw.framework_id)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-gray-100 p-3 space-y-1.5 max-h-96 overflow-y-auto">
                        {fw.controls.length === 0 ? (
                          <p className="text-xs text-gray-500 text-center py-4">{t("frameworks.builder.no_controls")}</p>
                        ) : (
                          fw.controls.map(ctrl => {
                            const isSel = isControlSelected(ctrl.id);
                            return (
                              <button
                                key={ctrl.id}
                                onClick={() => toggleControl(ctrl, fw.framework_short_name)}
                                className={`w-full text-left p-2.5 rounded-lg transition-colors flex items-start gap-2.5 ${
                                  isSel ? "bg-blue-50 border border-blue-200" : "hover:bg-gray-50 border border-transparent"
                                }`}
                              >
                                <div className={`w-4 h-4 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                                  isSel ? "bg-blue-600 border-blue-600" : "border-gray-300"
                                }`}>
                                  {isSel && <Check className="w-3 h-3 text-white" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono font-semibold text-gray-600">{ctrl.control_id}</span>
                                    {ctrl.category && (
                                      <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{ctrl.category}</span>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-900 mt-0.5">{ctrl.title}</p>
                                  {ctrl.description && (
                                    <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{ctrl.description}</p>
                                  )}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* STEP 3: AI SUGGESTIONS */}
      {step === "ai" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              {t("frameworks.builder.ai_title")}
            </h2>
            <button
              onClick={loadAISuggestions}
              disabled={loadingAi}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loadingAi ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("frameworks.builder.ai_thinking")}
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  {aiSuggestions.length > 0 ? t("frameworks.builder.refresh_suggestions") : t("frameworks.builder.get_suggestions")}
                </>
              )}
            </button>
          </div>

          {aiSuggestions.length === 0 && !loadingAi && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 text-center">
              <Lightbulb className="w-10 h-10 text-blue-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-blue-900">{t("frameworks.builder.ai_empty_title")}</p>
              <p className="text-xs text-blue-700 mt-1">
                {t("frameworks.builder.ai_empty_sub", { industry: vocab(t, "industry", industry), region: vocab(t, "region", region) })}
              </p>
            </div>
          )}

          {aiRationale && (
            <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
              <p className="text-xs text-purple-900"><strong>{t("frameworks.builder.ai_rationale")}</strong> {aiRationale}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {aiSuggestions.map((sug, i) => {
              const isSel = isAISuggestionSelected(sug.title);
              const priorityColor = sug.priority === "high" ? "bg-red-100 text-red-700" :
                                    sug.priority === "medium" ? "bg-yellow-100 text-yellow-700" :
                                    "bg-green-100 text-green-700";
              return (
                <div
                  key={i}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    isSel ? "bg-blue-50 border-blue-300 ring-2 ring-blue-200" : "border-gray-200 hover:border-blue-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleAISuggestion(sug)}
                        className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                          isSel ? "bg-blue-600 border-blue-600" : "border-gray-300 hover:border-blue-400"
                        }`}
                      >
                        {isSel && <Check className="w-3 h-3 text-white" />}
                      </button>
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${priorityColor}`}>{sug.priority}</span>
                    </div>
                    {/* Editable category */}
                    {editingCategoryIdx === i ? (
                      <input
                        autoFocus
                        defaultValue={sug.category}
                        onBlur={(e) => updateAISuggestionCategory(i, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updateAISuggestionCategory(i, (e.target as HTMLInputElement).value);
                          if (e.key === "Escape") setEditingCategoryIdx(null);
                        }}
                        className="text-[10px] text-gray-700 bg-white border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 w-28"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditingCategoryIdx(i); }}
                        title={t("framework_builder.edit_category")}
                        className="text-[10px] text-gray-500 bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded transition-colors"
                      >
                        {sug.category}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleAISuggestion(sug)}
                    className="w-full text-left"
                  >
                    <h4 className="text-sm font-semibold text-gray-900">{sug.title}</h4>
                    <p className="text-xs text-gray-600 mt-1">{sug.description}</p>
                    <p className="text-[11px] text-gray-500 mt-2 italic">💡 {sug.rationale}</p>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Custom Control Form */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700">{t("frameworks.builder.add_own")}</p>
              <button
                type="button"
                onClick={() => { setShowCustomForm(v => !v); setCustomTab("new"); }}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {showCustomForm ? t("frameworks.builder.cancel") : t("frameworks.builder.add_custom")}
              </button>
            </div>

            {showCustomForm && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                {/* Tabs */}
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setCustomTab("new")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      customTab === "new" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    <Plus className="w-3 h-3" /> {t("frameworks.builder.create_scratch")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomTab("import")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      customTab === "import" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    <Copy className="w-3 h-3" /> {t("frameworks.builder.import_from")}
                  </button>
                </div>

                {/* Import picker */}
                {customTab === "import" && (
                  <div className="space-y-2">
                    <select
                      value={importFwId}
                      onChange={e => setImportFwId(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">{t("frameworks.builder.select_framework")}</option>
                      {importFwList.map(f => (
                        <option key={f.id} value={f.id}>{f.name} ({f.short_name})</option>
                      ))}
                    </select>

                    {importFwId && (
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                          type="text"
                          value={importSearch}
                          onChange={e => setImportSearch(e.target.value)}
                          placeholder={t("framework_editor.search_controls")}
                          className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}

                    {importFwId && (
                      <div className="border border-gray-200 rounded-lg bg-white overflow-y-auto max-h-40">
                        {importFwLoading ? (
                          <div className="flex items-center justify-center py-5 text-xs text-gray-400">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" /> {t("docgen.loading_controls")}
                          </div>
                        ) : importFwControls.filter(c =>
                            !importSearch ||
                            c.control_id.toLowerCase().includes(importSearch.toLowerCase()) ||
                            c.title.toLowerCase().includes(importSearch.toLowerCase())
                          ).length === 0 ? (
                          <div className="py-5 text-center text-xs text-gray-400">{t("frameworks.builder.no_controls")}</div>
                        ) : (
                          importFwControls
                            .filter(c =>
                              !importSearch ||
                              c.control_id.toLowerCase().includes(importSearch.toLowerCase()) ||
                              c.title.toLowerCase().includes(importSearch.toLowerCase())
                            )
                            .map(ctrl => (
                              <button
                                key={ctrl.id}
                                type="button"
                                onClick={() => {
                                  setImportSelected(ctrl.id);
                                  setCustomCtrl({
                                    control_id: ctrl.control_id,
                                    title: ctrl.title,
                                    description: ctrl.description || "",
                                    category: ctrl.category || "",
                                  });
                                }}
                                className={`w-full text-left px-3 py-2 border-b border-gray-50 last:border-0 hover:bg-blue-50 transition-colors ${
                                  importSelected === ctrl.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                                    {ctrl.control_id}
                                  </span>
                                  <span className="text-xs text-gray-800 line-clamp-1">{ctrl.title}</span>
                                </div>
                              </button>
                            ))
                        )}
                      </div>
                    )}

                    {importSelected && (
                      <p className="text-xs text-blue-600 font-medium">{t("frameworks.builder.selected_hint")}</p>
                    )}
                  </div>
                )}

                {/* Form fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t("frameworks.builder.control_id")} <span className="text-gray-400">({t("frameworks.builder.control_id_hint")})</span></label>
                    <input
                      type="text"
                      value={customCtrl.control_id}
                      onChange={e => setCustomCtrl(p => ({ ...p, control_id: e.target.value }))}
                      placeholder="e.g. CUSTOM-01"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t("frameworks.builder.category")}</label>
                    <input
                      type="text"
                      value={customCtrl.category}
                      onChange={e => setCustomCtrl(p => ({ ...p, category: e.target.value }))}
                      placeholder={t("framework_builder.category_placeholder")}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("frameworks.builder.ctrl_title")} *</label>
                  <input
                    type="text"
                    value={customCtrl.title}
                    onChange={e => setCustomCtrl(p => ({ ...p, title: e.target.value }))}
                    placeholder={t("framework_builder.title_placeholder")}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("frameworks.builder.ctrl_description")}</label>
                  <textarea
                    rows={2}
                    value={customCtrl.description}
                    onChange={e => setCustomCtrl(p => ({ ...p, description: e.target.value }))}
                    placeholder={t("framework_editor.control_description_placeholder")}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={addCustomControl}
                  disabled={!customCtrl.title.trim()}
                  className="flex items-center gap-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {t("frameworks.builder.add_to_framework")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* STEP 4: REVIEW & SAVE */}
      {step === "review" && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{t("frameworks.builder.review_title")}</h2>

          <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-xl p-4">
            <div>
              <p className="text-xs text-gray-500 uppercase">{t("frameworks.builder.lbl_name")}</p>
              <p className="text-sm font-semibold text-gray-900">{name || t("frameworks.builder.unnamed")}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">{t("frameworks.builder.lbl_short_name")}</p>
              <p className="text-sm font-semibold text-gray-900">{shortName || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">{t("frameworks.builder.lbl_version")}</p>
              <p className="text-sm font-semibold text-gray-900">{version}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">{t("frameworks.builder.lbl_total_controls")}</p>
              <p className="text-sm font-semibold text-blue-600">{selected.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">{t("frameworks.builder.lbl_industry")}</p>
              <p className="text-sm font-semibold text-gray-900">{vocab(t, "industry", industry)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">{t("frameworks.builder.lbl_region")}</p>
              <p className="text-sm font-semibold text-gray-900">{vocab(t, "region", region)}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">{t("frameworks.builder.selected_controls")} ({selected.length})</h3>
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {selected.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">{t("frameworks.builder.no_controls_selected")}</p>
              ) : (
                selected.map((c, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-semibold text-gray-700">{c.control_id}</span>
                        {c.source_framework && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            c.source_framework === "AI"     ? "bg-purple-100 text-purple-700" :
                            c.source_framework === "Custom" ? "bg-green-100 text-green-700"   :
                            "bg-blue-100 text-blue-700"
                          }`}>
                            {c.source_framework === "AI" || c.source_framework === "Custom" || c.source_framework === "Imported"
                              ? t(`framework_builder.source.${c.source_framework.toLowerCase()}`)
                              : c.source_framework}
                          </span>
                        )}
                        {c.category && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{c.category}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-900 mt-0.5">{c.title}</p>
                    </div>
                    <button
                      onClick={() => removeSelected(i)}
                      className="text-red-500 hover:bg-red-50 p-1 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={prevStep}
          disabled={step === "info"}
          className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {t("frameworks.builder.previous")}
        </button>

        {step !== "review" ? (
          <button
            onClick={nextStep}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            {t("frameworks.builder.next")}
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving || selected.length === 0}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("frameworks.builder.saving")}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {t("frameworks.builder.save_framework")}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
