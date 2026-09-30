import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Map, Plus, Edit2, Trash2, ArrowLeft, Download, Grid3x3,
  AlertTriangle, ChevronDown, ChevronUp, RotateCcw, Pencil,
  CheckCircle2, Loader2, X, Eye,
} from "lucide-react";
import { riskCartographyApi } from "@/api/endpoints";
import type {
  RiskCartography,
  RiskCartographyDetail,
  CartographyDefinition,
  CartographyRiskLevel,
  CartographyRisk,
  CartographyScope,
} from "@/types";
import appI18n from "@/i18n";

/** Intl locale for the current UI language (Arabic keeps Latin digits). */
function uiLocale(): string {
  const l = appI18n.language || "en";
  return l.startsWith("fr") ? "fr-FR" : l.startsWith("ar") ? "ar-u-nu-latn" : "en-US";
}


// ── Default template ──────────────────────────────────────────────────────────
const DEFAULT_GRID_PRESETS: Record<string, CartographyDefinition> = {
  "3": {
    grid_rows: 3, grid_cols: 3,
    likelihood_labels: ["Low", "Medium", "High"],
    impact_labels: ["Low", "Medium", "High"],
    risk_levels: [
      { name: "Low",      color: "#5BBD74", min_score: 1, max_score: 3 },
      { name: "Medium",   color: "#E4C64F", min_score: 4, max_score: 6 },
      { name: "High",     color: "#EF852E", min_score: 7, max_score: 9 },
    ],
  },
  "4": {
    grid_rows: 4, grid_cols: 4,
    likelihood_labels: ["Unlikely", "Possible", "Likely", "Almost Certain"],
    impact_labels: ["Negligible", "Minor", "Moderate", "Major"],
    risk_levels: [
      { name: "Low",      color: "#5BBD74", min_score: 1,  max_score: 4  },
      { name: "Medium",   color: "#E4C64F", min_score: 5,  max_score: 9  },
      { name: "High",     color: "#EF852E", min_score: 10, max_score: 13 },
      { name: "Critical", color: "#DB4241", min_score: 14, max_score: 16 },
    ],
  },
  "5": {
    grid_rows: 5, grid_cols: 5,
    likelihood_labels: ["Rare", "Unlikely", "Possible", "Likely", "Almost Certain"],
    impact_labels: ["Negligible", "Minor", "Moderate", "Major", "Catastrophic"],
    risk_levels: [
      { name: "Low",      color: "#5BBD74", min_score: 1,  max_score: 5  },
      { name: "Medium",   color: "#E4C64F", min_score: 6,  max_score: 12 },
      { name: "High",     color: "#EF852E", min_score: 13, max_score: 18 },
      { name: "Critical", color: "#DB4241", min_score: 19, max_score: 25 },
    ],
  },
};

// The preset labels above are English template values. They are localized when
// a preset seeds the builder (the user then edits and saves them as data), and
// a saved label that still equals one of these untouched English defaults is
// shown in the UI language — anything the user typed is displayed verbatim.
const PRESET_LABEL_KEYS: Record<string, string> = {
  "Very Low": "cartography_ui.lbl_very_low",
  "Low": "cartography_ui.lbl_low",
  "Medium": "cartography_ui.lbl_medium",
  "High": "cartography_ui.lbl_high",
  "Very High": "cartography_ui.lbl_very_high",
  "Critical": "cartography_ui.lbl_critical",
  "Rare": "cartography_ui.lbl_rare",
  "Unlikely": "cartography_ui.lbl_unlikely",
  "Possible": "cartography_ui.lbl_possible",
  "Likely": "cartography_ui.lbl_likely",
  "Almost Certain": "cartography_ui.lbl_almost_certain",
  "Negligible": "cartography_ui.lbl_negligible",
  "Minor": "cartography_ui.lbl_minor",
  "Moderate": "cartography_ui.lbl_moderate",
  "Major": "cartography_ui.lbl_major",
  "Catastrophic": "cartography_ui.lbl_catastrophic",
};

type TFn = TFunction;

function presetLabel(t: TFn, label: string): string {
  const key = PRESET_LABEL_KEYS[label];
  if (key) return String(t(key));
  const m = /^Level (\d+)$/.exec(label);
  return m ? String(t("cartography_ui.lbl_level", { n: m[1] })) : label;
}

function localizedPreset(t: TFn, size: string): CartographyDefinition | undefined {
  const p = DEFAULT_GRID_PRESETS[size];
  if (!p) return undefined;
  return {
    ...p,
    likelihood_labels: p.likelihood_labels.map((l) => presetLabel(t, l)),
    impact_labels: p.impact_labels.map((l) => presetLabel(t, l)),
    risk_levels: p.risk_levels.map((r) => ({ ...r, name: presetLabel(t, r.name) })),
  };
}

// ── Helper: zone color for a cell score ──────────────────────────────────────
function zoneColor(score: number, riskLevels: CartographyRiskLevel[]): string {
  for (const lvl of [...riskLevels].sort((a, b) => a.min_score - b.min_score)) {
    if (score >= lvl.min_score && score <= lvl.max_score) return lvl.color;
  }
  return "#ECECE9";
}

function hexToRgba(hex: string, alpha = 0.15): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Severity dot color ────────────────────────────────────────────────────────
const SEV_COLOR: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-yellow-500",
  low:      "bg-green-500",
};

// ════════════════════════════════════════════════════════════════════════════════
// CartographyGrid — the main visual grid component
// ════════════════════════════════════════════════════════════════════════════════
function CartographyGrid({
  definition,
  risks,
  editMode,
  selectedRiskId,
  onSelectRisk,
  onMoveRisk,
  onResetRisk,
}: {
  definition: CartographyDefinition;
  risks: CartographyRisk[];
  editMode: boolean;
  selectedRiskId: string | null;
  onSelectRisk: (id: string | null) => void;
  onMoveRisk: (riskId: string, likelihood: number, impact: number) => void;
  onResetRisk: (riskId: string) => void;
}) {
  const { t } = useTranslation();
  const { grid_rows, grid_cols, likelihood_labels, impact_labels, risk_levels } = definition;

  // Group risks by effective cell
  const cellRisks: Record<string, CartographyRisk[]> = {};
  for (const r of risks) {
    const l = Math.max(1, Math.min(grid_rows, Math.round(r.effective_likelihood)));
    const i = Math.max(1, Math.min(grid_cols, Math.round(r.effective_impact)));
    const key = `${l}_${i}`;
    if (!cellRisks[key]) cellRisks[key] = [];
    cellRisks[key].push(r);
  }

  function handleCellClick(l: number, i: number) {
    if (!editMode || !selectedRiskId) return;
    onMoveRisk(selectedRiskId, l, i);
  }

  const colWidth = `${100 / (grid_cols + 1)}%`;

  return (
    <div className="select-none">
      {/* Impact axis label */}
      <div className="flex items-center justify-center mb-1 ml-16">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {t("cartography.impact_axis")}
        </span>
      </div>

      <div className="flex gap-0">
        {/* Likelihood axis label (vertical) */}
        <div className="flex items-center justify-center" style={{ width: "2.5rem", minWidth: "2.5rem" }}>
          <span
            className="text-xs font-semibold text-gray-500 uppercase tracking-wide"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {t("cartography.likelihood_axis")}
          </span>
        </div>

        {/* Grid */}
        <div className="flex-1">
          {/* Impact header row */}
          <div className="flex mb-0.5" style={{ paddingLeft: "2.5rem" }}>
            {Array.from({ length: grid_cols }, (_, ci) => (
              <div
                key={ci}
                className="text-center text-xs text-gray-500 font-medium truncate px-0.5"
                style={{ width: colWidth }}
                title={impact_labels[ci] != null ? presetLabel(t, impact_labels[ci]) : String(ci + 1)}
              >
                {impact_labels[ci] != null ? presetLabel(t, impact_labels[ci]) : ci + 1}
              </div>
            ))}
          </div>

          {/* Grid rows: high likelihood at top */}
          {Array.from({ length: grid_rows }, (_, ri) => {
            const l = grid_rows - ri; // likelihood value (high → low)
            return (
              <div key={l} className="flex items-stretch mb-0.5">
                {/* Row label */}
                <div
                  className="flex items-center justify-end pr-1 text-xs text-gray-500 font-medium truncate"
                  style={{ width: "2.5rem", minWidth: "2.5rem" }}
                  title={likelihood_labels[l - 1] != null ? presetLabel(t, likelihood_labels[l - 1]) : String(l)}
                >
                  <span className="text-right leading-tight">
                    {likelihood_labels[l - 1] != null ? presetLabel(t, likelihood_labels[l - 1]) : l}
                  </span>
                </div>

                {/* Cells */}
                {Array.from({ length: grid_cols }, (_, ci) => {
                  const imp = ci + 1;
                  const score = l * imp;
                  const bg = zoneColor(score, risk_levels);
                  const cellKey = `${l}_${imp}`;
                  const cellRiskList = cellRisks[cellKey] ?? [];
                  const isTargetCell = editMode && selectedRiskId;

                  return (
                    <div
                      key={imp}
                      onClick={() => handleCellClick(l, imp)}
                      className={[
                        "relative border border-white/60 rounded-md flex flex-col gap-0.5 p-1 overflow-hidden transition-all",
                        isTargetCell
                          ? "cursor-pointer hover:ring-2 hover:ring-indigo-400 hover:ring-offset-1 hover:scale-[1.02]"
                          : "cursor-default",
                      ].join(" ")}
                      style={{
                        width: colWidth,
                        minHeight: "4.5rem",
                        backgroundColor: hexToRgba(bg, 0.25),
                        borderColor: bg,
                      }}
                      title={isTargetCell ? t("cartography.click_to_move_here") : undefined}
                    >
                      {/* Score label */}
                      <span
                        className="absolute top-0.5 right-1 text-[10px] font-bold opacity-40"
                        style={{ color: bg }}
                      >
                        {score}
                      </span>

                      {/* Risk chips */}
                      {cellRiskList.map((r) => (
                        <div
                          key={r.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!editMode) return;
                            onSelectRisk(selectedRiskId === r.id ? null : r.id);
                          }}
                          className={[
                            "flex items-start gap-1 px-1.5 py-0.5 rounded text-[10px] leading-tight font-medium transition-all",
                            editMode ? "cursor-pointer" : "cursor-default",
                            selectedRiskId === r.id
                              ? "bg-indigo-600 text-white ring-2 ring-indigo-400 ring-offset-1"
                              : "bg-white/80 text-gray-700 hover:bg-white",
                          ].join(" ")}
                          title={r.title}
                        >
                          {r.severity && (
                            <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEV_COLOR[r.severity] ?? "bg-gray-400"}`} />
                          )}
                          <span className="line-clamp-2 flex-1">{r.title}</span>
                          {r.is_overridden && (
                            <Pencil className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
                          )}
                          {editMode && r.is_overridden && selectedRiskId !== r.id && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onResetRisk(r.id); }}
                              className="flex-shrink-0 hover:text-red-500 transition-colors"
                              title={t("cartography.reset_position")}
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-2 ml-10">
        {risk_levels.map((lvl) => (
          <div key={lvl.name} className="flex items-center gap-1.5 text-xs text-gray-600">
            <div
              className="w-3 h-3 rounded-sm border border-white/60"
              style={{ backgroundColor: lvl.color }}
            />
            <span>{presetLabel(t, lvl.name)}</span>
            <span className="text-gray-400">({lvl.min_score}–{lvl.max_score})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// CartographyBuilderModal — create or edit a cartography's definition
// ════════════════════════════════════════════════════════════════════════════════
function CartographyBuilderModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: RiskCartographyDetail | null;
  onClose: () => void;
  onSave: (data: { name: string; description: string; definition: CartographyDefinition }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"general" | "grid" | "zones">("general");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  const initScope = initial?.definition?.scope ?? { type: "all" as const, value: "" };
  const [scopeType, setScopeType] = useState<CartographyScope["type"]>(initScope.type);
  const [scopeValue, setScopeValue] = useState(initScope.value ?? "");

  const initDef = initial?.definition ?? localizedPreset(t, "5")!;
  const [gridRows, setGridRows] = useState(initDef.grid_rows);
  const [gridCols, setGridCols] = useState(initDef.grid_cols);
  const [llLabels, setLlLabels] = useState<string[]>(initDef.likelihood_labels);
  const [ilLabels, setIlLabels] = useState<string[]>(initDef.impact_labels);
  const [riskLevels, setRiskLevels] = useState<CartographyRiskLevel[]>(initDef.risk_levels);

  const isPreset = (r: number, c: number) => r === c && ["3","4","5"].includes(String(r));

  function applyGridPreset(size: string) {
    const n = parseInt(size);
    setGridRows(n);
    setGridCols(n);
    const preset = localizedPreset(t, size);
    if (preset) {
      setLlLabels([...preset.likelihood_labels]);
      setIlLabels([...preset.impact_labels]);
      setRiskLevels([...preset.risk_levels.map(l => ({ ...l }))]);
    }
  }

  function resizeLabels(
    current: string[],
    newSize: number,
    defaults: string[],
  ): string[] {
    if (newSize > current.length) {
      return [...current, ...defaults.slice(current.length, newSize)];
    }
    return current.slice(0, newSize);
  }

  function handleRowsChange(val: number) {
    const n = Math.max(2, Math.min(10, val));
    setGridRows(n);
    const defaults = ["Very Low","Low","Medium","High","Very High","Level 6","Level 7","Level 8","Level 9","Level 10"].map((l) => presetLabel(t, l));
    setLlLabels(prev => resizeLabels(prev, n, defaults));
  }

  function handleColsChange(val: number) {
    const n = Math.max(2, Math.min(10, val));
    setGridCols(n);
    const defaults = ["Negligible","Minor","Moderate","Major","Catastrophic","Level 6","Level 7","Level 8","Level 9","Level 10"].map((l) => presetLabel(t, l));
    setIlLabels(prev => resizeLabels(prev, n, defaults));
  }

  function updateLabel(type: "ll" | "il", idx: number, value: string) {
    if (type === "ll") {
      const next = [...llLabels];
      next[idx] = value;
      setLlLabels(next);
    } else {
      const next = [...ilLabels];
      next[idx] = value;
      setIlLabels(next);
    }
  }

  function updateZone(idx: number, field: keyof CartographyRiskLevel, value: string | number) {
    const next = riskLevels.map((z, i) =>
      i === idx ? { ...z, [field]: value } : z
    );
    setRiskLevels(next);
  }

  async function handleSubmit() {
    if (!name.trim()) { setError(t("cartography.name_required")); return; }
    const scope: CartographyScope = scopeType === "all"
      ? { type: "all" }
      : { type: scopeType, value: scopeValue.trim() };
    const definition: CartographyDefinition = {
      grid_rows: gridRows,
      grid_cols: gridCols,
      likelihood_labels: llLabels.slice(0, gridRows),
      impact_labels: ilLabels.slice(0, gridCols),
      risk_levels: riskLevels,
      scope,
    };
    setSaving(true);
    setError("");
    try {
      await onSave({ name: name.trim(), description, definition });
      onClose();
    } catch {
      setError(t("cartography.save_error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {initial ? t("cartography.edit_cartography") : t("cartography.new_cartography")}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">{t("cartography.builder_subtitle")}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          {(["general", "grid", "zones"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t(`cartography.tab_${tab}`)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* ── General tab ── */}
          {activeTab === "general" && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {t("cartography.name")} *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("cartography.name_placeholder")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {t("common.description")}
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("cartography.description_placeholder")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                />
              </div>

              {/* Scope filter */}
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    {t("cartography.scope_type")}
                  </label>
                  <select
                    value={scopeType}
                    onChange={(e) => { setScopeType(e.target.value as CartographyScope["type"]); setScopeValue(""); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="all">{t("cartography.scope_all")}</option>
                    <option value="control">{t("cartography.scope_control")}</option>
                    <option value="category">{t("cartography.scope_category")}</option>
                    <option value="tag">{t("cartography.scope_tag")}</option>
                  </select>
                </div>
                {scopeType !== "all" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      {t(`cartography.scope_value_${scopeType}`)}
                    </label>
                    <input
                      type="text"
                      value={scopeValue}
                      onChange={(e) => setScopeValue(e.target.value)}
                      placeholder={t(`cartography.scope_placeholder_${scopeType}`)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">{t("cartography.scope_hint")}</p>
                  </div>
                )}
                {scopeType === "all" && (
                  <p className="text-xs text-gray-400">{t("cartography.scope_all_hint")}</p>
                )}
              </div>
            </div>
          )}

          {/* ── Grid tab ── */}
          {activeTab === "grid" && (
            <div className="space-y-5">
              {/* Size selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {t("cartography.grid_size")}
                </label>
                {/* Preset shortcuts */}
                <div className="flex gap-2 mb-3">
                  {["3", "4", "5"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => applyGridPreset(s)}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        isPreset(gridRows, gridCols) && String(gridRows) === s
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <Grid3x3 className="w-3.5 h-3.5" />
                      {s}×{s}
                    </button>
                  ))}
                </div>
                {/* Custom rows × cols inputs */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                      {t("cartography.rows")}
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      value={gridRows}
                      onChange={(e) => handleRowsChange(parseInt(e.target.value) || 2)}
                      className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <span className="text-gray-400 font-bold text-lg mt-4">×</span>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                      {t("cartography.cols")}
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      value={gridCols}
                      onChange={(e) => handleColsChange(parseInt(e.target.value) || 2)}
                      className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div className="ml-2 flex-1">
                    <p className="text-xs text-gray-500 font-medium">{gridRows}×{gridCols} {t("cartography.grid")}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{t("cartography.max_score_info", { max: gridRows * gridCols })}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">{t("cartography.grid_size_hint")}</p>
              </div>

              {/* Likelihood labels */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {t("cartography.likelihood_labels")} ({t("cartography.low_to_high")})
                </label>
                <div className="space-y-1.5">
                  {Array.from({ length: gridRows }, (_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-5 text-xs text-gray-400 text-right flex-shrink-0">{i + 1}</span>
                      <input
                        type="text"
                        value={llLabels[i] ?? ""}
                        onChange={(e) => updateLabel("ll", i, e.target.value)}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Impact labels */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {t("cartography.impact_labels")} ({t("cartography.low_to_high")})
                </label>
                <div className="space-y-1.5">
                  {Array.from({ length: gridCols }, (_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-5 text-xs text-gray-400 text-right flex-shrink-0">{i + 1}</span>
                      <input
                        type="text"
                        value={ilLabels[i] ?? ""}
                        onChange={(e) => updateLabel("il", i, e.target.value)}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Zones tab ── */}
          {activeTab === "zones" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">{t("cartography.zones_hint")}</p>
              {riskLevels.map((zone, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl bg-gray-50">
                  {/* Color */}
                  <div className="flex-shrink-0">
                    <input
                      type="color"
                      value={zone.color}
                      onChange={(e) => updateZone(idx, "color", e.target.value)}
                      className="w-9 h-9 rounded-lg cursor-pointer border border-gray-200 p-0.5"
                      title={t("cartography.pick_color")}
                    />
                  </div>
                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={zone.name}
                      onChange={(e) => updateZone(idx, "name", e.target.value)}
                      placeholder={t("cartography.zone_name")}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  {/* Min score */}
                  <div className="w-20 flex-shrink-0">
                    <label className="block text-[10px] text-gray-400 mb-0.5">{t("cartography.min_score")}</label>
                    <input
                      type="number"
                      min={1}
                      value={zone.min_score}
                      onChange={(e) => updateZone(idx, "min_score", parseInt(e.target.value) || 1)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  {/* Max score */}
                  <div className="w-20 flex-shrink-0">
                    <label className="block text-[10px] text-gray-400 mb-0.5">{t("cartography.max_score")}</label>
                    <input
                      type="number"
                      min={1}
                      value={zone.max_score}
                      onChange={(e) => updateZone(idx, "max_score", parseInt(e.target.value) || 1)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  {/* Preview swatch */}
                  <div
                    className="w-5 h-8 rounded flex-shrink-0"
                    style={{ backgroundColor: zone.color }}
                  />
                </div>
              ))}
              {/* Live gradient preview */}
              <div
                className="h-4 rounded-full mt-2"
                style={{
                  background: `linear-gradient(to right, ${riskLevels.map(l => l.color).join(", ")})`,
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// DetailView — shows one cartography with the grid and edit-positions mode
// ════════════════════════════════════════════════════════════════════════════════
function DetailView({
  id,
  onBack,
  onEdit,
}: {
  id: string;
  onBack: () => void;
  onEdit: (detail: RiskCartographyDetail) => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<RiskCartographyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDetail(await riskCartographyApi.get(id));
    } catch {
      setError(t("cartography.load_error"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  async function handleMoveRisk(riskId: string, likelihood: number, impact: number) {
    if (!detail) return;
    setSaving(true);
    try {
      const updated = await riskCartographyApi.updatePositions(detail.id, {
        [riskId]: { likelihood, impact },
      });
      setDetail(updated);
      setSelectedRiskId(null);
    } catch {
      // silent — user can retry
    } finally {
      setSaving(false);
    }
  }

  async function handleResetRisk(riskId: string) {
    if (!detail) return;
    setSaving(true);
    try {
      const updated = await riskCartographyApi.updatePositions(detail.id, {
        [riskId]: null,
      });
      setDetail(updated);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  async function handleExportPdf() {
    if (!detail) return;
    setExporting(true);
    try {
      const resp = await riskCartographyApi.exportPdf(detail.id);
      const url = URL.createObjectURL(new Blob([resp.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `cartography_${detail.name}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <p className="text-gray-600 text-sm">{error || t("cartography.load_error")}</p>
        <button onClick={load} className="text-sm text-indigo-600 hover:underline">{t("common.retry")}</button>
      </div>
    );
  }

  const overriddenCount = detail.risks.filter((r) => r.is_overridden).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="mt-1 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{detail.name}</h1>
            {detail.description && (
              <p className="text-gray-500 text-sm mt-0.5">{detail.description}</p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              {detail.definition.grid_rows}×{detail.definition.grid_cols} · {detail.risks.length} {t("cartography.risks")}
              {overriddenCount > 0 && ` · ${overriddenCount} ${t("cartography.overridden")}`}
            </p>
            {detail.definition.scope && detail.definition.scope.type !== "all" && (
              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-100">
                {t(`cartography.scope_${detail.definition.scope.type}`)} — {detail.definition.scope.value}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Edit positions toggle */}
          <button
            type="button"
            onClick={() => { setEditMode(!editMode); setSelectedRiskId(null); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              editMode
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            <Pencil className="w-4 h-4" />
            {editMode ? t("cartography.editing_positions") : t("cartography.edit_positions")}
          </button>

          <button
            type="button"
            onClick={() => onEdit(detail)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Edit2 className="w-4 h-4" />
            {t("cartography.edit_settings")}
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t("cartography.export_pdf")}
          </button>
        </div>
      </div>

      {/* Edit mode instruction banner */}
      {editMode && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-700">
          <Pencil className="w-4 h-4 flex-shrink-0" />
          <div>
            {selectedRiskId
              ? t("cartography.risk_selected_instruction")
              : t("cartography.edit_positions_instruction")}
          </div>
          {selectedRiskId && (
            <button
              type="button"
              onClick={() => setSelectedRiskId(null)}
              className="ml-auto flex-shrink-0 text-xs underline"
            >
              {t("cartography.deselect")}
            </button>
          )}
          {saving && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
        </div>
      )}

      {/* Grid */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <CartographyGrid
          definition={detail.definition}
          risks={detail.risks}
          editMode={editMode}
          selectedRiskId={selectedRiskId}
          onSelectRisk={setSelectedRiskId}
          onMoveRisk={handleMoveRisk}
          onResetRisk={handleResetRisk}
        />
      </div>

      {/* Risk list (collapsed by default) */}
      <RiskListPanel risks={detail.risks} />
    </div>
  );
}

// ── Risk list accordion ───────────────────────────────────────────────────────
function RiskListPanel({ risks }: { risks: CartographyRisk[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sorted = [...risks].sort(
    (a, b) => b.effective_likelihood * b.effective_impact - a.effective_likelihood * a.effective_impact
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-2xl transition-colors"
      >
        <span>{t("cartography.risk_list")} ({risks.length})</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {sorted.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-6 py-3">
              {r.severity && (
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEV_COLOR[r.severity] ?? "bg-gray-300"}`} />
              )}
              <span className="flex-1 text-sm text-gray-700 truncate">{r.title}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                L{r.effective_likelihood} × I{r.effective_impact} = {r.effective_likelihood * r.effective_impact}
              </span>
              {r.is_overridden && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded flex-shrink-0">
                  <Pencil className="w-2.5 h-2.5" /> {t("cartography.overridden")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════════════════
export default function RiskCartographyPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingDetail, setEditingDetail] = useState<RiskCartographyDetail | null>(null);

  const [cartographies, setCartographies] = useState<RiskCartography[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      setCartographies(await riskCartographyApi.list());
    } catch {
      setNotice(t("cartography.load_error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadList(); }, [loadList]);

  async function handleCreate(data: { name: string; description: string; definition: CartographyDefinition }) {
    await riskCartographyApi.create(data);
    await loadList();
  }

  async function handleUpdate(data: { name: string; description: string; definition: CartographyDefinition }) {
    if (!editingDetail) return;
    await riskCartographyApi.update(editingDetail.id, data);
    if (view === "detail" && selectedId === editingDetail.id) {
      // force detail reload
      setSelectedId(null);
      setTimeout(() => setSelectedId(editingDetail.id), 50);
    }
    await loadList();
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await riskCartographyApi.delete(id);
      setDeleteId(null);
      if (view === "detail" && selectedId === id) {
        setView("list");
        setSelectedId(null);
      }
      await loadList();
    } catch {
      setNotice(t("cartography.delete_error"));
    } finally {
      setDeleting(false);
    }
  }

  // ── List view ──────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="p-8 max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Map className="w-6 h-6 text-indigo-600" />
              {t("cartography.page_title")}
            </h1>
            <p className="text-gray-500 text-sm mt-1">{t("cartography.page_subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => { setEditingDetail(null); setShowBuilder(true); }}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> {t("cartography.new_cartography")}
          </button>
        </div>

        {notice && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice("")}><X className="w-4 h-4 opacity-50 hover:opacity-100" /></button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        ) : cartographies.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center">
              <Map className="w-8 h-8 text-indigo-400" />
            </div>
            <div>
              <p className="text-gray-700 font-semibold">{t("cartography.no_cartographies")}</p>
              <p className="text-gray-400 text-sm mt-1">{t("cartography.no_cartographies_hint")}</p>
            </div>
            <button
              type="button"
              onClick={() => { setEditingDetail(null); setShowBuilder(true); }}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> {t("cartography.create_first")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cartographies.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3 hover:border-indigo-200 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
                        {c.name}
                      </h3>
                      {c.is_default && (
                        <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          {t("cartography.default")}
                        </span>
                      )}
                    </div>
                    {c.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{c.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      title={t("cartography.edit_settings")}
                      onClick={async () => {
                        try {
                          const detail = await riskCartographyApi.get(c.id);
                          setEditingDetail(detail);
                          setShowBuilder(true);
                        } catch { /* ignore */ }
                      }}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title={t("common.delete")}
                      onClick={() => setDeleteId(c.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Meta */}
                <div className="flex items-center flex-wrap gap-2 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <Grid3x3 className="w-3 h-3" />
                    {c.definition.grid_rows}×{c.definition.grid_cols}
                  </span>
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {c.risk_count ?? 0} {t("cartography.risks")}
                  </span>
                  <span>{new Date(c.created_at).toLocaleDateString(uiLocale())}</span>
                </div>
                {/* Scope badge */}
                {c.definition.scope && c.definition.scope.type !== "all" && (
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-100">
                      <span className="uppercase">{t(`cartography.scope_${c.definition.scope.type}`)}</span>
                      <span className="font-bold">{c.definition.scope.value}</span>
                    </span>
                  </div>
                )}

                {/* Zone preview strip */}
                <div
                  className="h-2 rounded-full"
                  style={{
                    background: `linear-gradient(to right, ${c.definition.risk_levels.map(l => l.color).join(", ")})`,
                  }}
                />

                {/* Open button */}
                <button
                  type="button"
                  onClick={() => { setSelectedId(c.id); setView("detail"); }}
                  className="flex items-center justify-center gap-2 w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-sm font-medium transition-colors"
                >
                  <Eye className="w-4 h-4" /> {t("cartography.open")}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Confirm delete */}
        {deleteId && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 max-w-sm w-full space-y-4">
              <h3 className="font-bold text-gray-900">{t("cartography.confirm_delete_title")}</h3>
              <p className="text-sm text-gray-500">{t("cartography.confirm_delete_body")}</p>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setDeleteId(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(deleteId)}
                  disabled={deleting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.delete")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Builder modal */}
        {showBuilder && (
          <CartographyBuilderModal
            initial={editingDetail}
            onClose={() => { setShowBuilder(false); setEditingDetail(null); }}
            onSave={editingDetail ? handleUpdate : handleCreate}
          />
        )}
      </div>
    );
  }

  // ── Detail view ────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-7xl space-y-6">
      {selectedId && (
        <DetailView
          id={selectedId}
          onBack={() => { setView("list"); setSelectedId(null); }}
          onEdit={(detail) => {
            setEditingDetail(detail);
            setShowBuilder(true);
          }}
        />
      )}

      {showBuilder && (
        <CartographyBuilderModal
          initial={editingDetail}
          onClose={() => { setShowBuilder(false); setEditingDetail(null); }}
          onSave={editingDetail ? handleUpdate : handleCreate}
        />
      )}
    </div>
  );
}
