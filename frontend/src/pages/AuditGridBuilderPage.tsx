import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Grid3x3, Plus, X, Loader2, Trash2, Pencil, Sparkles, Search,
  ChevronDown, ChevronUp, Star, RotateCcw, Save, Layers,
} from "lucide-react";
import { auditGridsApi, frameworksApi } from "@/api/endpoints";
import type {
  AuditGrid, AuditGridItem, ComplianceScaleLevel, Framework,
} from "@/types";

// The scale a brand-new grid starts from — byte-for-byte the backend's
// DEFAULT_GRID_LEVELS (backend/app/models/audit_grid.py), so a grid created here
// and one created by the API are graded identically. These labels are DATA the
// tenant owns, never locale keys.
const DEFAULT_LEVELS: ComplianceScaleLevel[] = [
  { key: "conforme",               label_fr: "Conforme",               label_en: "Compliant",           label_ar: "مطابق",       color: "#0ca30c", weight: 1.0,  is_gap: false },
  { key: "partiellement_conforme", label_fr: "Partiellement conforme", label_en: "Partially compliant", label_ar: "مطابق جزئيًا", color: "#fab219", weight: 0.5,  is_gap: true  },
  { key: "non_conforme",           label_fr: "Non conforme",           label_en: "Non-compliant",       label_ar: "غير مطابق",   color: "#d03b3b", weight: 0.0,  is_gap: true  },
  { key: "non_applicable",         label_fr: "Non applicable",         label_en: "Not applicable",      label_ar: "لا ينطبق",    color: "#77807f", weight: null, is_gap: false },
];

function cloneLevels(levels: ComplianceScaleLevel[]): ComplianceScaleLevel[] {
  return levels.map((l) => ({ ...l }));
}

/** i18next asks Intl.PluralRules for the category, and Arabic has six of them
 *  (zero/one/two/few/many/other) while the locale files define only `_one` and
 *  `_other`. A count of 2, 3 or 11 therefore resolves nothing in Arabic and
 *  falls back to the ENGLISH string. Naming the defined form keeps the sentence
 *  in the reader's language. */
function pluralKey(base: string, count: number): string {
  return count === 1 ? `${base}_one` : `${base}_other`;
}

function levelLabel(level: ComplianceScaleLevel, lang: string): string {
  const picked = lang.startsWith("fr") ? level.label_fr
    : lang.startsWith("ar") ? level.label_ar
    : level.label_en;
  return (picked || level.label_en || level.label_fr || level.label_ar || level.key) as string;
}

type ItemDraft = {
  id: string | null;
  ref_code: string;
  title: string;
  description: string;
  guidance: string;
  section: string;
  sort_order: string;
  is_mandatory: boolean;
};

function emptyItemDraft(section = ""): ItemDraft {
  return { id: null, ref_code: "", title: "", description: "", guidance: "", section, sort_order: "", is_mandatory: false };
}

export default function AuditGridBuilderPage() {
  const { t, i18n } = useTranslation();

  const [grids, setGrids] = useState<AuditGrid[]>([]);
  const [gridsLoading, setGridsLoading] = useState(true);
  const [search, setSearch] = useState("");
  // The grid list is re-fetched from the server on every change of this value.
  // Debounced so typing in the filter box does not fire one GET per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [grid, setGrid] = useState<AuditGrid | null>(null);
  const [items, setItems] = useState<AuditGridItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // Grid form (create / rename)
  const [showGridModal, setShowGridModal] = useState(false);
  const [gridDraft, setGridDraft] = useState({ id: "", name: "", description: "" });
  const [gridError, setGridError] = useState("");

  // Levels editor
  const [levelsDraft, setLevelsDraft] = useState<ComplianceScaleLevel[]>(DEFAULT_LEVELS);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [levelsError, setLevelsError] = useState("");

  // Items
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItemDraft());
  const [itemError, setItemError] = useState("");

  // Seeding
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [seedFrameworkId, setSeedFrameworkId] = useState("");
  const [seedDomain, setSeedDomain] = useState("");
  const [seedReplace, setSeedReplace] = useState(false);

  const loadGrids = useCallback(async () => {
    setGridsLoading(true);
    try {
      const data = await auditGridsApi.list(debouncedSearch ? { search: debouncedSearch } : undefined);
      const list = Array.isArray(data) ? data : [];
      setGrids(list);
      setSelectedId((cur) => (cur && list.some((g) => g.id === cur) ? cur : list[0]?.id ?? null));
    } catch {
      setError(t("audit_grid.load_error"));
      setGrids([]);
    } finally {
      setGridsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => { loadGrids(); }, [loadGrids]);

  useEffect(() => {
    frameworksApi.list()
      .then((f) => setFrameworks(Array.isArray(f) ? f : []))
      .catch(() => setFrameworks([]));
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const detail = await auditGridsApi.get(id);
      setGrid(detail.grid);
      setItems(Array.isArray(detail.items) ? detail.items : []);
      setLevelsDraft(cloneLevels(detail.grid.levels ?? detail.grid.levels_resolved ?? DEFAULT_LEVELS));
      setSeedFrameworkId(detail.grid.source_framework_id ?? "");
    } catch {
      setError(t("audit_grid.load_error"));
      setGrid(null);
      setItems([]);
    } finally {
      setDetailLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else { setGrid(null); setItems([]); }
  }, [selectedId, loadDetail]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  // ── Grid CRUD ─────────────────────────────────────────────────────────────
  function openCreateGrid() {
    setGridDraft({ id: "", name: "", description: "" });
    setGridError("");
    setShowGridModal(true);
  }

  function openEditGrid() {
    if (!grid) return;
    setGridDraft({ id: grid.id, name: grid.name, description: grid.description ?? "" });
    setGridError("");
    setShowGridModal(true);
  }

  async function submitGrid(e: React.FormEvent) {
    e.preventDefault();
    if (!gridDraft.name.trim()) { setGridError(t("audit_grid.error_name_required")); return; }
    setBusy("grid");
    setGridError("");
    try {
      if (gridDraft.id) {
        await auditGridsApi.update(gridDraft.id, {
          name: gridDraft.name.trim(),
          description: gridDraft.description.trim() || null,
        });
      } else {
        const created = await auditGridsApi.create({
          name: gridDraft.name.trim(),
          description: gridDraft.description.trim() || null,
          levels: cloneLevels(DEFAULT_LEVELS),
        });
        setSelectedId(created.id);
      }
      setShowGridModal(false);
      await loadGrids();
      if (gridDraft.id) await loadDetail(gridDraft.id);
    } catch {
      setGridError(t("audit_grid.error_save_failed"));
    } finally {
      setBusy("");
    }
  }

  async function removeGrid() {
    if (!grid) return;
    if (!window.confirm(t("audit_grid.delete_confirm"))) return;
    setBusy("delete-grid");
    try {
      await auditGridsApi.delete(grid.id);
      setSelectedId(null);
      await loadGrids();
    } catch {
      setError(t("audit_grid.error_save_failed"));
    } finally {
      setBusy("");
    }
  }

  async function toggleDefault() {
    if (!grid) return;
    setBusy("default");
    try {
      await auditGridsApi.update(grid.id, { is_default: !grid.is_default });
      await loadGrids();
      await loadDetail(grid.id);
    } catch {
      setError(t("audit_grid.error_save_failed"));
    } finally {
      setBusy("");
    }
  }

  // ── Levels ────────────────────────────────────────────────────────────────
  function patchLevel(index: number, patch: Partial<ComplianceScaleLevel>) {
    setLevelsDraft((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLevel() {
    setLevelsDraft((prev) => [...prev, { key: "", label_en: "", label_fr: "", label_ar: "", color: "#94a3b8", weight: 0, is_gap: true }]);
  }

  function removeLevel(index: number) {
    setLevelsDraft((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveLevels() {
    if (!grid) return;
    if (levelsDraft.length === 0) { setLevelsError(t("compliance_scale.error_levels_required")); return; }
    const keys = new Set<string>();
    for (const lvl of levelsDraft) {
      const key = (lvl.key ?? "").trim();
      if (!key) { setLevelsError(t("audit_grid.error_level_key_required")); return; }
      if (keys.has(key)) { setLevelsError(t("compliance_scale.error_key_duplicate")); return; }
      keys.add(key);
      if (!((lvl.label_en ?? "").trim() || (lvl.label_fr ?? "").trim() || (lvl.label_ar ?? "").trim())) {
        setLevelsError(t("audit_grid.error_level_label_required"));
        return;
      }
    }
    setBusy("levels");
    setLevelsError("");
    try {
      await auditGridsApi.update(grid.id, {
        levels: levelsDraft.map((l) => ({
          ...l,
          key: (l.key ?? "").trim(),
          weight: l.weight === null || l.weight === undefined || l.weight === ("" as unknown as number)
            ? null
            : Number(l.weight),
        })),
      });
      await loadDetail(grid.id);
      flash(t("audit_grid.saved"));
    } catch {
      setLevelsError(t("audit_grid.error_save_failed"));
    } finally {
      setBusy("");
    }
  }

  // ── Items ─────────────────────────────────────────────────────────────────
  function openCreateItem(section = "") {
    setItemDraft(emptyItemDraft(section));
    setItemError("");
    setShowItemModal(true);
  }

  function openEditItem(item: AuditGridItem) {
    setItemDraft({
      id: item.id,
      ref_code: item.ref_code ?? "",
      title: item.title,
      description: item.description ?? "",
      guidance: item.guidance ?? "",
      section: item.section ?? "",
      sort_order: String(item.sort_order ?? ""),
      is_mandatory: item.is_mandatory,
    });
    setItemError("");
    setShowItemModal(true);
  }

  async function submitItem(e: React.FormEvent) {
    e.preventDefault();
    if (!grid) return;
    if (!itemDraft.title.trim()) { setItemError(t("audits.title_required")); return; }
    setBusy("item");
    setItemError("");
    const payload = {
      title: itemDraft.title.trim(),
      ref_code: itemDraft.ref_code.trim() || null,
      description: itemDraft.description.trim() || null,
      guidance: itemDraft.guidance.trim() || null,
      section: itemDraft.section.trim() || null,
      sort_order: itemDraft.sort_order.trim() ? Number(itemDraft.sort_order) : null,
      is_mandatory: itemDraft.is_mandatory,
    };
    try {
      if (itemDraft.id) {
        // An omitted order must stay omitted: sending 0 would silently move the
        // line to the top of its section. PATCH ignores absent fields.
        const { sort_order, ...rest } = payload;
        await auditGridsApi.updateItem(grid.id, itemDraft.id, {
          ...rest,
          ...(sort_order === null ? {} : { sort_order }),
        });
      } else {
        await auditGridsApi.addItem(grid.id, payload);
      }
      setShowItemModal(false);
      await loadDetail(grid.id);
      await loadGrids();
    } catch {
      setItemError(t("audit_grid.error_save_failed"));
    } finally {
      setBusy("");
    }
  }

  async function removeItem(item: AuditGridItem) {
    if (!grid) return;
    if (!window.confirm(t("audit_grid.delete_item_confirm"))) return;
    setBusy(`item-${item.id}`);
    try {
      await auditGridsApi.deleteItem(grid.id, item.id);
      await loadDetail(grid.id);
      await loadGrids();
    } catch {
      setError(t("audit_grid.error_save_failed"));
    } finally {
      setBusy("");
    }
  }

  // ── Seeding ───────────────────────────────────────────────────────────────
  async function seed() {
    if (!grid || !seedFrameworkId) return;
    if (!window.confirm(t("audit_grid.seed_confirm"))) return;
    setBusy("seed");
    setError("");
    try {
      const result = await auditGridsApi.seedFromFramework(grid.id, {
        framework_id: seedFrameworkId,
        domain: seedDomain.trim() || null,
        replace: seedReplace,
      });
      await loadDetail(grid.id);
      await loadGrids();
      flash(t(pluralKey("audit_grid.seed_done", result.created), { count: result.created }));
    } catch {
      setError(t("audit_grid.error_save_failed"));
    } finally {
      setBusy("");
    }
  }

  const sections = useMemo(() => {
    const buckets = new Map<string, AuditGridItem[]>();
    for (const item of items) {
      const k = item.section ?? "";
      const list = buckets.get(k);
      if (list) list.push(item); else buckets.set(k, [item]);
    }
    return Array.from(buckets.entries())
      .map(([k, rows]) => ({ section: k || null, rows: [...rows].sort((a, b) => a.sort_order - b.sort_order) }))
      .sort((a, b) => (a.section ?? "").localeCompare(b.section ?? ""));
  }, [items]);

  return (
    <>
      {/* Grid create / rename modal */}
      {showGridModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowGridModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">
                {gridDraft.id ? t("audit_grid.edit_grid") : t("audit_grid.new_grid")}
              </h2>
              <button type="button" onClick={() => setShowGridModal(false)} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {gridError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{gridError}</div>}
            <form onSubmit={submitGrid} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_grid.name")}</label>
                <input
                  value={gridDraft.name}
                  onChange={(e) => setGridDraft({ ...gridDraft, name: e.target.value })}
                  placeholder={t("audit_grid.name_placeholder")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_grid.description")}</label>
                <textarea
                  value={gridDraft.description}
                  onChange={(e) => setGridDraft({ ...gridDraft, description: e.target.value })}
                  rows={3}
                  placeholder={t("audit_grid.description_placeholder")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowGridModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-xl">
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={busy === "grid"}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl"
                >
                  {busy === "grid" && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Item modal */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowItemModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">
                {itemDraft.id ? t("audit_grid.edit_item") : t("audit_grid.add_item")}
              </h2>
              <button type="button" onClick={() => setShowItemModal(false)} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {itemError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{itemError}</div>}
            <form onSubmit={submitItem} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_grid.item_reference")}</label>
                  <input
                    value={itemDraft.ref_code}
                    onChange={(e) => setItemDraft({ ...itemDraft, ref_code: e.target.value })}
                    placeholder={t("audit_grid.item_reference_placeholder")}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_grid.section")}</label>
                  <input
                    value={itemDraft.section}
                    onChange={(e) => setItemDraft({ ...itemDraft, section: e.target.value })}
                    placeholder={t("audit_grid.section_placeholder")}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_grid.item_question")}</label>
                <input
                  value={itemDraft.title}
                  onChange={(e) => setItemDraft({ ...itemDraft, title: e.target.value })}
                  placeholder={t("audit_grid.item_question_placeholder")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description")}</label>
                <textarea
                  value={itemDraft.description}
                  onChange={(e) => setItemDraft({ ...itemDraft, description: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_grid.item_guidance")}</label>
                <textarea
                  value={itemDraft.guidance}
                  onChange={(e) => setItemDraft({ ...itemDraft, guidance: e.target.value })}
                  rows={2}
                  placeholder={t("audit_grid.item_guidance_placeholder")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_grid.item_order")}</label>
                  <input
                    type="number"
                    value={itemDraft.sort_order}
                    onChange={(e) => setItemDraft({ ...itemDraft, sort_order: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                  <input
                    type="checkbox"
                    checked={itemDraft.is_mandatory}
                    onChange={(e) => setItemDraft({ ...itemDraft, is_mandatory: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  {t("common.required")}
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowItemModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-xl">
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={busy === "item"}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl"
                >
                  {busy === "item" && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="p-8 max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Grid3x3 className="w-6 h-6 text-teal-600" />
              {t("audit_grid.title")}
            </h1>
            <p className="text-sm text-gray-500 mt-1">{t("audit_grid.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={openCreateGrid}
            className="inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("audit_grid.new_grid")}
          </button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>}
        {notice && <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">{notice}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Grid list ── */}
          <div className="lg:col-span-1 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute top-2.5 start-3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("common.search")}
                className="w-full border border-gray-200 rounded-xl ps-9 pe-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {gridsLoading ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-10 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : grids.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
                <Grid3x3 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-600">{t("audit_grid.empty_title")}</p>
                <p className="text-xs text-gray-400 mt-1">{t("audit_grid.empty_hint")}</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
                {grids.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setSelectedId(g.id)}
                    className={`w-full text-start px-4 py-3 transition-colors ${
                      selectedId === g.id ? "bg-teal-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 truncate">{g.name}</span>
                      {g.is_default && (
                        <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700">
                          {t("compliance_scale.default_badge")}
                        </span>
                      )}
                      {!g.is_active && (
                        <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-500">
                          {t("compliance_scale.inactive")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t(pluralKey("audit_grid.items_count", g.item_count), { count: g.item_count })}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Grid detail ── */}
          <div className="lg:col-span-2 space-y-4">
            {detailLoading && (
              <div className="bg-white rounded-2xl border border-gray-100 p-16 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            )}

            {!detailLoading && !grid && (
              <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
                <Layers className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                <p className="text-base font-semibold text-gray-600">{t("audit_grid.select_grid")}</p>
                <p className="text-sm text-gray-400 mt-1">{t("audit_grid.empty_hint")}</p>
              </div>
            )}

            {!detailLoading && grid && (
              <>
                {/* Identity */}
                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-gray-900">{grid.name}</h2>
                      {grid.description && <p className="text-sm text-gray-500 mt-1">{grid.description}</p>}
                      <p className="text-xs text-gray-400 mt-2">
                        {t(pluralKey("audit_grid.items_count", items.length), { count: items.length })}
                        {grid.source_framework_id ? ` · ${t("audit_grid.source_framework")}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleDefault}
                        disabled={busy === "default"}
                        className="inline-flex items-center gap-1.5 text-xs border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Star className={`w-3.5 h-3.5 ${grid.is_default ? "text-amber-500" : ""}`} />
                        {t("compliance_scale.set_default")}
                      </button>
                      <button
                        type="button"
                        onClick={openEditGrid}
                        className="inline-flex items-center gap-1.5 text-xs border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {t("common.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={removeGrid}
                        disabled={busy === "delete-grid"}
                        className="inline-flex items-center gap-1.5 text-xs border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Seed from a framework */}
                <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-500" />
                    <h3 className="text-sm font-semibold text-gray-700">{t("audit_grid.seed_from_framework")}</h3>
                  </div>
                  <p className="text-xs text-gray-500">{t("audit_grid.seed_hint")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">{t("frameworks.builder.select_framework")}</label>
                      <select
                        value={seedFrameworkId}
                        onChange={(e) => setSeedFrameworkId(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">{t("common.none")}</option>
                        {frameworks.map((f) => (
                          <option key={f.id} value={f.id}>{f.short_name ? `${f.short_name} — ${f.name}` : f.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{t("requirements.filter_domain")}</label>
                      <input
                        value={seedDomain}
                        onChange={(e) => setSeedDomain(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={seedReplace}
                        onChange={(e) => setSeedReplace(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      {t("audit_grid.seed_replace", "Replace the existing lines")}
                    </label>
                    <button
                      type="button"
                      onClick={seed}
                      disabled={!seedFrameworkId || busy === "seed"}
                      className="inline-flex items-center gap-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-3.5 py-1.5 rounded-lg transition-colors"
                    >
                      {busy === "seed" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {t("audit_grid.seed_from_framework")}
                    </button>
                  </div>
                </div>

                {/* Conformity levels */}
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setLevelsOpen((v) => !v)}
                    className="w-full px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <Layers className="w-4 h-4 text-teal-500" />
                      {t("audit_grid.levels")}
                      <span className="text-xs text-gray-400">({levelsDraft.length})</span>
                    </span>
                    {levelsOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>

                  {!levelsOpen && (
                    <div className="px-5 py-3 flex flex-wrap gap-2">
                      {(grid.levels_resolved ?? []).map((lvl) => (
                        <span
                          key={lvl.key}
                          className="rounded-full px-2.5 py-0.5 text-xs font-semibold border border-gray-200 text-gray-500"
                          style={lvl.color ? { backgroundColor: `${lvl.color}1a`, borderColor: lvl.color, color: lvl.color } : undefined}
                        >
                          {levelLabel(lvl, i18n.language)}
                        </span>
                      ))}
                    </div>
                  )}

                  {levelsOpen && (
                    <div className="p-5 space-y-4">
                      <p className="text-xs text-gray-500">{t("audit_grid.levels_hint")}</p>
                      {levelsError && <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm">{levelsError}</div>}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 text-xs text-gray-400">
                              <th className="text-start font-medium py-2 pe-2">{t("audit_grid.level_key")}</th>
                              <th className="text-start font-medium py-2 px-2">{t("audit_grid.level_label_fr")}</th>
                              <th className="text-start font-medium py-2 px-2">{t("audit_grid.level_label_en")}</th>
                              <th className="text-start font-medium py-2 px-2">{t("audit_grid.level_label_ar")}</th>
                              <th className="text-start font-medium py-2 px-2">{t("audit_grid.level_color")}</th>
                              <th className="text-start font-medium py-2 px-2">{t("audit_grid.level_weight")}</th>
                              <th className="text-start font-medium py-2 px-2">{t("audit_grid.level_is_gap")}</th>
                              <th className="py-2 ps-2" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {levelsDraft.map((lvl, idx) => (
                              <tr key={idx}>
                                <td className="py-2 pe-2">
                                  <input
                                    value={lvl.key ?? ""}
                                    onChange={(e) => patchLevel(idx, { key: e.target.value })}
                                    className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input
                                    value={lvl.label_fr ?? ""}
                                    onChange={(e) => patchLevel(idx, { label_fr: e.target.value })}
                                    className="w-36 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input
                                    value={lvl.label_en ?? ""}
                                    onChange={(e) => patchLevel(idx, { label_en: e.target.value })}
                                    className="w-36 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input
                                    value={lvl.label_ar ?? ""}
                                    onChange={(e) => patchLevel(idx, { label_ar: e.target.value })}
                                    dir="rtl"
                                    className="w-36 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input
                                    type="color"
                                    value={lvl.color ?? "#94a3b8"}
                                    onChange={(e) => patchLevel(idx, { color: e.target.value })}
                                    className="w-10 h-7 border border-gray-200 rounded"
                                    aria-label={t("audit_grid.level_color")}
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="1"
                                    value={lvl.weight === null || lvl.weight === undefined ? "" : String(lvl.weight)}
                                    onChange={(e) => patchLevel(idx, { weight: e.target.value === "" ? null : Number(e.target.value) })}
                                    className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                </td>
                                <td className="py-2 px-2">
                                  <input
                                    type="checkbox"
                                    checked={!!lvl.is_gap}
                                    onChange={(e) => patchLevel(idx, { is_gap: e.target.checked })}
                                    className="rounded border-gray-300"
                                    aria-label={t("audit_grid.level_is_gap")}
                                  />
                                </td>
                                <td className="py-2 ps-2 text-end">
                                  <button
                                    type="button"
                                    onClick={() => removeLevel(idx)}
                                    className="text-gray-300 hover:text-red-500"
                                    title={t("audit_grid.remove_level")}
                                    aria-label={t("audit_grid.remove_level")}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={addLevel}
                          className="inline-flex items-center gap-1.5 text-xs border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {t("audit_grid.add_level")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setLevelsDraft(cloneLevels(DEFAULT_LEVELS))}
                          className="inline-flex items-center gap-1.5 text-xs border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {t("audit_grid.reset_levels")}
                        </button>
                        <button
                          type="button"
                          onClick={saveLevels}
                          disabled={busy === "levels"}
                          className="inline-flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white px-3.5 py-1.5 rounded-lg transition-colors"
                        >
                          {busy === "levels" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          {t("common.save")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sections and lines */}
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <Grid3x3 className="w-4 h-4 text-teal-500" />
                      {t("audit_grid.items")}
                      <span className="text-xs text-gray-400">({items.length})</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => openCreateItem()}
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t("audit_grid.add_item")}
                    </button>
                  </div>

                  {items.length === 0 ? (
                    <div className="py-12 text-center">
                      <Grid3x3 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-sm font-medium text-gray-500">{t("common.no_data")}</p>
                      <p className="text-xs text-gray-400 mt-1">{t("audit_grid.seed_hint")}</p>
                    </div>
                  ) : (
                    <div>
                      {sections.map(({ section, rows }) => (
                        <div key={section ?? "__none__"}>
                          <div className="px-5 py-2 bg-gray-50/60 border-y border-gray-100 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-600">{section ?? t("audit_grid.no_sections")}</span>
                            <button
                              type="button"
                              onClick={() => openCreateItem(section ?? "")}
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                            >
                              <Plus className="w-3 h-3" />
                              {t("audit_grid.add_item")}
                            </button>
                          </div>
                          <div className="divide-y divide-gray-50">
                            {rows.map((item) => (
                              <div key={item.id} className="flex items-start gap-3 px-5 py-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                    {item.ref_code && (
                                      <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{item.ref_code}</span>
                                    )}
                                    {item.is_mandatory && (
                                      <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-50 text-red-600">
                                        {t("common.required")}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-800">{item.title}</p>
                                  {item.guidance && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{item.guidance}</p>}
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => openEditItem(item)}
                                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-blue-600 transition-colors"
                                    title={t("audit_grid.edit_item")}
                                    aria-label={t("audit_grid.edit_item")}
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeItem(item)}
                                    disabled={busy === `item-${item.id}`}
                                    className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
                                    title={t("audit_grid.delete_item")}
                                    aria-label={t("audit_grid.delete_item")}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
