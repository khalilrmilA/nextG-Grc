/**
 * FrameworksPage — the referential's source registers (STB objectif 1).
 *
 * The classification shown here is the FRAMEWORK'S OWN: `source_type`
 * (norme | réglementation | loi | politique interne) and `applicable_regions`,
 * both returned by GET /frameworks. The previous version drove the type chip
 * and the type filter from an 18-entry hard-coded lookup that matched 7 of the
 * 79 built-ins — the other 72 silently fell through to "Security"/"Global", so
 * the filter an evaluator clicks answered the wrong question 72 times out of 79.
 * That lookup is gone: a framework nobody has classified is shown as
 * unclassified, never bucketed on a guess.
 *
 * Also here: the file import (POST /frameworks/import, with a dry run first)
 * and the fork lineage — which built-in a tenant copy was cloned from.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AutoTranslatedBadge, TranslatedText, pickText } from "../components/common/AutoTranslatedBadge";
import {
  Globe, BookOpen, Search, ArrowRight, Plus,
  Loader2, Trash2, AlertCircle, RefreshCw, Filter,
  Shield, FileText, Scale, Gavel, Upload,
  X, ChevronDown, ChevronRight as ChevronRightIcon, CheckSquare, Square, Copy, Check,
  Pencil, GitFork, Layers, CheckCircle,
} from "lucide-react";
import { frameworksApi, customFrameworkApi } from "@/api/endpoints";
import DataActions from "@/components/common/DataActions";
import type { Framework, FrameworkControl, FrameworkImportResult } from "@/types";

// The controlled vocabulary of `frameworks.source_type` (backend SOURCE_TYPES).
// Only presentation lives here — an unclassified framework keeps `null` and is
// rendered as such rather than being assigned a default.
const SOURCE_TYPES = ["norme", "reglementation", "loi", "politique_interne"] as const;

const SOURCE_TYPE_STYLE: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  chip: string;
}> = {
  norme:             { icon: Shield,   color: "text-blue-600",   bg: "bg-blue-50",   chip: "bg-blue-50 text-blue-700"     },
  reglementation:    { icon: Scale,    color: "text-amber-600",  bg: "bg-amber-50",  chip: "bg-amber-50 text-amber-700"   },
  loi:               { icon: Gavel,    color: "text-rose-600",   bg: "bg-rose-50",   chip: "bg-rose-50 text-rose-700"     },
  politique_interne: { icon: FileText, color: "text-purple-600", bg: "bg-purple-50", chip: "bg-purple-50 text-purple-700" },
};

const UNCLASSIFIED = "__unclassified__";

function sourceStyle(sourceType?: string | null) {
  return (sourceType && SOURCE_TYPE_STYLE[sourceType])
    || { icon: BookOpen, color: "text-gray-500", bg: "bg-gray-50", chip: "bg-gray-100 text-gray-600" };
}

/** The live data spells the same region several ways — "middle-east" /
 *  "middle_east" / "mea", "asia-pacific" / "apac". They are one bucket, and the
 *  surviving spelling is the one the locale files already translate, so the chip
 *  reads « Moyen-Orient » rather than an untranslated "middle east". */
const REGION_ALIASES: Record<string, string> = {
  mea: "middle_east",
  asia_pacific: "apac",
  asiapacific: "apac",
};

function regionKey(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return REGION_ALIASES[key] ?? key;
}

/** Fallback label for a region the locale files do not translate ("gcc",
 *  "saudi_arabia"): title-case it instead of showing a raw lower-case slug.
 *  Country/bloc codes stay upper-case; "new_york" must not become "NEW York". */
const REGION_ACRONYMS = new Set(["us", "usa", "uk", "eu", "gcc", "mea", "uae", "apac", "us_gov"]);

function regionFallback(key: string): string {
  return key.split("_").filter(Boolean)
    .map(w => (REGION_ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// ── Framework controls drawer ─────────────────────────────────────────────────
function FrameworkDrawer({
  fw,
  open,
  onClose,
  onUseInDocGen,
}: {
  readonly fw: Framework | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onUseInDocGen: (fw: Framework, selected: FrameworkControl[]) => void;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [controls, setControls]       = useState<FrameworkControl[]>([]);
  const [loadingCtrl, setLoadingCtrl] = useState(false);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed]     = useState<Set<string>>(new Set());
  const [copied, setCopied]           = useState(false);
  // Crosswalk — « une même exigence issue de plusieurs sources doit être
  // rapprochable ». The endpoint existed and nothing in the UI ever called it.
  const [crosswalkFor, setCrosswalkFor] = useState<string | null>(null);
  const [crosswalk, setCrosswalk] = useState<Array<{ framework?: string; control?: string }>>([]);
  const [crosswalkLoading, setCrosswalkLoading] = useState(false);
  // Built-in framework text is machine-translated into the UI language by the
  // API; this shows the stored text instead, for the whole drawer.
  const [showOriginal, setShowOriginal] = useState(false);

  const load = useCallback(async () => {
    if (!fw) return;
    setLoadingCtrl(true);
    setSelected(new Set());
    setCrosswalkFor(null);
    try {
      const list = await frameworksApi.getControls(fw.id);
      setControls(list);
    } catch {
      setControls([]);
    } finally {
      setLoadingCtrl(false);
    }
  }, [fw]);

  useEffect(() => { if (open && fw) load(); }, [open, fw, load]);

  if (!fw) return null;

  const style = sourceStyle(fw.source_type);
  const Icon = style.icon;

  // Group controls by domain when the referential is classified, otherwise by
  // the legacy free-text category — never by a guess.
  const groups: Record<string, FrameworkControl[]> = {};
  for (const c of controls) {
    const grp = c.domain || c.category || t("requirements.domain_unclassified");
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(c);
  }
  const groupNames = Object.keys(groups).sort();

  function toggleControl(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGroup(grp: string) {
    const ids = groups[grp].map(c => c.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  function selectAll() { setSelected(new Set(controls.map(c => c.id))); }
  function clearAll()  { setSelected(new Set()); }

  function toggleCollapse(grp: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(grp)) next.delete(grp); else next.add(grp);
      return next;
    });
  }

  function copySelected() {
    const selectedControls = controls.filter(c => selected.has(c.id));
    const text = selectedControls.map(c => `${c.control_id} — ${c.title}`).join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function showCrosswalk(ctrl: FrameworkControl) {
    if (!fw) return;
    if (crosswalkFor === ctrl.id) { setCrosswalkFor(null); return; }
    setCrosswalkFor(ctrl.id);
    setCrosswalk([]);
    setCrosswalkLoading(true);
    try {
      const data = await frameworksApi.getCrosswalk(fw.id, ctrl.id) as {
        mapped_to?: Array<{ framework?: string; control?: string }>;
      };
      setCrosswalk(data?.mapped_to ?? []);
    } catch {
      setCrosswalk([]);
    } finally {
      setCrosswalkLoading(false);
    }
  }

  const selectedControls = controls.filter(c => selected.has(c.id));

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-[620px] max-w-full bg-white z-50 shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${style.bg}`}>
            <Icon className={`w-5 h-5 ${style.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 text-base leading-tight">{pickText(fw, "name", showOriginal)}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {fw.short_name}{fw.version ? ` · v${fw.version}` : ""} · {controls.length} {t("frameworks.controls")}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            title={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Classification + description */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 flex-shrink-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.chip}`}>
              {fw.source_type
                ? t(`framework_editor.source_types.${fw.source_type}`, { defaultValue: fw.source_type })
                : t("requirements.type_unclassified")}
            </span>
            {fw.issuing_body && (
              <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600">
                {fw.issuing_body}
              </span>
            )}
            {(fw.applicable_regions ?? []).slice(0, 4).map(r => (
              <span key={r} className="flex items-center gap-0.5 text-xs text-gray-500 bg-white border border-gray-200 px-1.5 py-0.5 rounded-full">
                <Globe className="w-2.5 h-2.5" />
                {t(`frameworks.${regionKey(r)}`, { defaultValue: regionFallback(regionKey(r)) })}
              </span>
            ))}
          </div>
          {fw.description && (
            <p className="text-xs text-gray-500 leading-relaxed">{pickText(fw, "description", showOriginal)}</p>
          )}
          {(fw.translated || controls.some(c => c.translated)) && (
            <AutoTranslatedBadge showingOriginal={showOriginal} onToggle={() => setShowOriginal(v => !v)}
              official={controls.some(c => c.translated) && controls.every(c => !c.translated || c.translation_official)} />
          )}
        </div>

        {/* Toolbar */}
        {controls.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0 gap-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={selectAll}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium transition-colors">
                {t("frameworks.builder.select_all")}
              </button>
              <button type="button" onClick={clearAll}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium transition-colors">
                {t("frameworks.builder.deselect_all")}
              </button>
              {selected.size > 0 && (
                <span className="text-xs text-gray-500 font-medium">
                  {selected.size} / {controls.length} {t("frameworks.builder.selected_count")}
                </span>
              )}
            </div>
            {selected.size > 0 && (
              <button type="button" onClick={copySelected}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium transition-colors">
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                {copied ? t("common.success") : t("docgen.copy")}
              </button>
            )}
          </div>
        )}

        {/* Controls list */}
        <div className="flex-1 overflow-y-auto">
          {loadingCtrl ? (
            <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          ) : controls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-8">
              <BookOpen className="w-10 h-10 text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500">{t("framework_editor.no_controls")}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {groupNames.map(grp => {
                const items = groups[grp];
                const allGrpSelected = items.every(c => selected.has(c.id));
                const someGrpSelected = items.some(c => selected.has(c.id));
                const isCollapsed = collapsed.has(grp);
                return (
                  <div key={grp}>
                    {/* Group header */}
                    <div className="flex items-center gap-2 px-6 py-2.5 bg-gray-50 sticky top-0 z-10">
                      <button type="button" onClick={() => toggleGroup(grp)} className="flex-shrink-0"
                        title={t("frameworks.builder.select_all")}>
                        {allGrpSelected
                          ? <CheckSquare className="w-4 h-4 text-blue-600" />
                          : someGrpSelected
                          ? <CheckSquare className="w-4 h-4 text-blue-300" />
                          : <Square className="w-4 h-4 text-gray-300" />}
                      </button>
                      <button type="button" onClick={() => toggleCollapse(grp)}
                        className="flex items-center gap-1.5 flex-1 text-left">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{grp}</span>
                        <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded-full">{items.length}</span>
                        {isCollapsed
                          ? <ChevronRightIcon className="w-3 h-3 text-gray-400 ml-auto" />
                          : <ChevronDown className="w-3 h-3 text-gray-400 ml-auto" />}
                      </button>
                    </div>

                    {/* Controls in group */}
                    {!isCollapsed && items.map(ctrl => (
                      <div key={ctrl.id} className="border-b border-gray-50 last:border-0">
                        <div
                          onClick={() => toggleControl(ctrl.id)}
                          className={`flex items-start gap-3 px-6 py-3 cursor-pointer transition-colors hover:bg-blue-50/50 ${
                            selected.has(ctrl.id) ? "bg-blue-50/30" : ""
                          }`}
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            {selected.has(ctrl.id)
                              ? <CheckSquare className="w-4 h-4 text-blue-600" />
                              : <Square className="w-4 h-4 text-gray-300" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                                {ctrl.control_id}
                              </span>
                              <span className="text-sm font-medium text-gray-800 leading-snug">{pickText(ctrl, "title", showOriginal)}</span>
                            </div>
                            {ctrl.description && (
                              <p className="text-xs text-gray-400 mt-1 line-clamp-2">{pickText(ctrl, "description", showOriginal)}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-1 mt-1.5">
                              {ctrl.requirement_type && (
                                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600">
                                  {t(`requirements.requirement_type.${ctrl.requirement_type}`, { defaultValue: ctrl.requirement_type })}
                                </span>
                              )}
                              {ctrl.is_mandatory && (
                                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-50 text-red-600">
                                  {t("framework_editor.control_mandatory")}
                                </span>
                              )}
                              {(ctrl.mapped_controls?.length ?? 0) > 0 && (
                                <button type="button"
                                  onClick={(e) => { e.stopPropagation(); showCrosswalk(ctrl); }}
                                  className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors">
                                  <Layers className="w-3 h-3" />
                                  {ctrl.mapped_controls.length}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {crosswalkFor === ctrl.id && (
                          <div className="px-6 pb-3 -mt-1">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                              {t("framework_editor.control_crosswalk")}
                            </p>
                            {crosswalkLoading ? (
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("common.loading")}
                              </div>
                            ) : crosswalk.length === 0 ? (
                              <p className="text-xs text-gray-400">{t("framework_editor.control_crosswalk_none")}</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {crosswalk.map((m, i) => (
                                  <span key={`${m.framework}-${m.control}-${i}`}
                                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-indigo-50 text-indigo-700">
                                    {m.framework} · {m.control}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3 flex-shrink-0 bg-white">
          <button
            type="button"
            onClick={() => { onUseInDocGen(fw, selectedControls); navigate("/policy-generator"); }}
            disabled={selected.size === 0}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-xl text-sm transition-colors"
          >
            <FileText className="w-4 h-4" />
            {t("policies.generate_with_ai")}{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
          <button
            type="button"
            onClick={() => navigate("/compliance")}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 px-4 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            {t("compliance.open_assessment")}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Import modal ──────────────────────────────────────────────────────────────
// POST /frameworks/import (multipart). A dry run is offered first because the
// import upserts on (framework_id, control_id) — a bank re-importing a corrected
// circular is entitled to see what would change before it changes.
function ImportFrameworkModal({
  frameworks,
  onClose,
  onImported,
}: {
  readonly frameworks: Framework[];
  readonly onClose: () => void;
  readonly onImported: () => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState("");           // "" = create a new framework
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [version, setVersion] = useState("1.0");
  const [sourceType, setSourceType] = useState("");
  const [issuingBody, setIssuingBody] = useState("");
  const [busy, setBusy] = useState<"dry" | "real" | null>(null);
  const [result, setResult] = useState<FrameworkImportResult | null>(null);
  const [error, setError] = useState("");

  // Only tenant-owned frameworks are writable — built-ins are shared platform-wide.
  const targets = frameworks.filter(f => !f.is_builtin);

  async function run(dryRun: boolean) {
    if (!file) return;
    if (!target && (!name.trim() || !shortName.trim())) {
      setError(t("frameworks.builder.err_name_required"));
      return;
    }
    setBusy(dryRun ? "dry" : "real");
    setError("");
    setResult(null);
    try {
      const res = await frameworksApi.importControls(file, {
        ...(target ? { framework_id: target } : {
          name: name.trim(),
          short_name: shortName.trim(),
          version: version.trim() || "1.0",
          ...(sourceType ? { source_type: sourceType } : {}),
          ...(issuingBody.trim() ? { issuing_body: issuingBody.trim() } : {}),
        }),
        dry_run: dryRun,
      });
      setResult(res);
      if (!dryRun) onImported();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (status === 403) {
        setError(t("frameworks.import_forbidden", "Only a CISO or a compliance manager can import a referential."));
      } else {
        setError(typeof detail === "string" ? detail : t("data.import_failed"));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h3 className="text-lg font-bold text-gray-900">{t("frameworks.import_framework")}</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
            title={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pb-4 space-y-3 overflow-y-auto flex-1">
          <p className="text-xs text-gray-500">
            {t("frameworks.import_hint", "CSV, Excel or YAML. Rows are matched on the control reference, so re-importing a corrected file updates it in place instead of duplicating it.")}
          </p>

          <div>
            <label htmlFor="fw-import-file" className="block text-sm font-medium text-gray-700 mb-1">
              {t("frameworks.import_file", "File")} *
            </label>
            <input
              id="fw-import-file"
              type="file"
              accept=".csv,.xlsx,.yaml,.yml"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="fw-import-target" className="block text-sm font-medium text-gray-700 mb-1">
              {t("frameworks.import_target", "Import into")}
            </label>
            <select
              id="fw-import-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">{t("frameworks.import_new_framework", "Create a new framework")}</option>
              {targets.map(f => (
                <option key={f.id} value={f.id}>{f.name} ({f.short_name})</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              {t("frameworks.import_builtin_note", "Built-in frameworks are read-only: import into one of your own, or create a new one.")}
            </p>
          </div>

          {!target && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label htmlFor="fw-import-name" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("framework_editor.name")} *
                </label>
                <input id="fw-import-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder={t("framework_editor.name_placeholder")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="fw-import-short" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("framework_editor.short_name")} *
                </label>
                <input id="fw-import-short" type="text" value={shortName}
                  onChange={(e) => setShortName(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20))}
                  placeholder={t("framework_editor.short_name_placeholder")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="fw-import-version" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("framework_editor.version")}
                </label>
                <input id="fw-import-version" type="text" value={version} onChange={(e) => setVersion(e.target.value)}
                  placeholder={t("framework_editor.version_placeholder")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="fw-import-source" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("framework_editor.source_type")}
                </label>
                <select id="fw-import-source" value={sourceType} onChange={(e) => setSourceType(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">{t("common.none")}</option>
                  {SOURCE_TYPES.map(s => (
                    <option key={s} value={s}>{t(`framework_editor.source_types.${s}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="fw-import-body" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("framework_editor.issuing_body")}
                </label>
                <input id="fw-import-body" type="text" value={issuingBody} onChange={(e) => setIssuingBody(e.target.value)}
                  placeholder={t("framework_editor.issuing_body_placeholder")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          )}

          {error && (
            <p className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </p>
          )}

          {result && (
            <div className={`rounded-xl border px-4 py-3 space-y-2 ${
              result.error_count > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"
            }`}>
              <p className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                {result.error_count > 0
                  ? <AlertCircle className="w-4 h-4 text-amber-600" />
                  : <CheckCircle className="w-4 h-4 text-green-600" />}
                {result.dry_run
                  ? t("frameworks.import_dry_run_done", "Validation only — nothing was written")
                  : t("frameworks.import_done", "Import applied")}
              </p>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: t("frameworks.import_rows", "Rows"),        value: result.total_rows },
                  { label: t("frameworks.import_created", "Created"),  value: result.created    },
                  { label: t("frameworks.import_updated", "Updated"),  value: result.updated    },
                  { label: t("frameworks.import_errors", "Errors"),    value: result.error_count },
                ].map(s => (
                  <div key={s.label}>
                    <p className="text-lg font-bold text-gray-900">{s.value}</p>
                    <p className="text-xs text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>
              {result.errors.length > 0 && (
                <ul className="text-xs text-red-600 space-y-0.5 max-h-32 overflow-y-auto">
                  {result.errors.slice(0, 20).map((e, i) => <li key={`${i}-${e}`}>• {e}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button type="button" onClick={onClose}
            className="text-sm px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            {t("common.close")}
          </button>
          <button type="button" onClick={() => run(true)} disabled={!file || busy !== null}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium px-4 py-2 rounded-lg">
            {busy === "dry" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t("frameworks.import_dry_run", "Validate without importing")}
          </button>
          <button type="button" onClick={() => run(false)} disabled={!file || busy !== null}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {busy === "real" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {t("common.import")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Framework card ─────────────────────────────────────────────────────────────
function FrameworkCard({
  fw,
  upstreamName,
  onDelete,
  onViewControls,
  onCustomize,
  onEdit,
}: {
  readonly fw: Framework;
  readonly upstreamName?: string;
  readonly onDelete: (id: string) => void;
  readonly onViewControls: (fw: Framework) => void;
  readonly onCustomize: (fw: Framework) => void;
  readonly onEdit: (fw: Framework) => void;
}) {
  const { t } = useTranslation();
  const style = sourceStyle(fw.source_type);
  const Icon = style.icon;
  const isCustom = !fw.is_builtin;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [customizing, setCustomizing] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await frameworksApi.delete(fw.id);
      onDelete(fw.id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleCustomize(e: React.MouseEvent) {
    e.stopPropagation();
    setCustomizing(true);
    try {
      const cloned = await customFrameworkApi.clone(fw.id);
      onCustomize(cloned);
    } catch {
      setCustomizing(false);
    }
  }

  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all group relative overflow-hidden flex flex-col cursor-pointer"
      onClick={() => onViewControls(fw)}
    >
      {/* Top bar */}
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${style.bg}`}>
              <Icon className={`w-5 h-5 ${style.color}`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2">
                <TranslatedText item={fw} field="name" />
              </h3>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold">{fw.short_name}</span>
                {fw.version && <span className="text-xs text-gray-400">v{fw.version}</span>}
                {isCustom && (
                  <span className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded font-medium">{t("frameworks.tenant")}</span>
                )}
              </div>
            </div>
          </div>
          {/* Delete for custom */}
          {isCustom && (
            confirmDelete ? (
              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button type="button" onClick={handleDelete} disabled={deleting}
                  className="text-xs px-2 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
                  {deleting ? "…" : t("common.delete")}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                  {t("common.cancel")}
                </button>
              </div>
            ) : (
              <button type="button" onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                title={t("common.delete")}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )
          )}
        </div>

        {/* Description */}
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-3">
          <TranslatedText item={fw} field="description">{fw.description ?? ""}</TranslatedText>
        </p>

        {/* Fork lineage — which built-in this copy came from */}
        {isCustom && fw.cloned_from_framework_id && (
          <p className="flex items-center gap-1.5 text-xs text-purple-600 bg-purple-50 rounded-lg px-2 py-1 mb-3 w-fit">
            <GitFork className="w-3 h-3 flex-shrink-0" />
            {t("framework_editor.upstream_title")}: {upstreamName ?? fw.cloned_from_framework_id}
          </p>
        )}

        {/* Classification */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.chip}`}>
            {fw.source_type
              ? t(`framework_editor.source_types.${fw.source_type}`, { defaultValue: fw.source_type })
              : t("requirements.type_unclassified")}
          </span>
          {(fw.applicable_regions ?? []).slice(0, 2).map(r => (
            <span key={r} className="flex items-center gap-0.5 text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">
              <Globe className="w-2.5 h-2.5" />
              {t(`frameworks.${regionKey(r)}`, { defaultValue: regionFallback(regionKey(r)) })}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 border-t border-gray-50 pt-3 flex items-center justify-between" onClick={e => e.stopPropagation()}>
        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">{fw.control_count ?? 0}</p>
          <p className="text-xs text-gray-400">{t("frameworks.controls")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {isCustom ? (
            <button
              type="button"
              onClick={() => onEdit(fw)}
              className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 hover:text-purple-700 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-all"
              title={t("framework_editor.title")}
            >
              <Pencil className="w-3 h-3" /> {t("common.edit")}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCustomize}
              disabled={customizing}
              className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 hover:text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-all"
              title={t("framework_editor.builtin_readonly_body")}
            >
              {customizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitFork className="w-3 h-3" />}
              {t("framework_editor.customize")}
            </button>
          )}
          {fw.control_count && fw.control_count > 0 ? (
            <button
              type="button"
              onClick={() => onViewControls(fw)}
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all"
            >
              {t("frameworks.controls")} <ArrowRight className="w-3 h-3" />
            </button>
          ) : (
            <span className="text-xs text-gray-400 italic">{t("framework_editor.no_controls")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function FrameworksPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [search, setSearch]       = useState("");
  const [sourceType, setSourceType] = useState("all");
  const [region, setRegion]       = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [frameworks, setFrameworks]   = useState<Framework[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [drawerFw, setDrawerFw]   = useState<Framework | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await frameworksApi.list();
      setFrameworks(list);
    } catch {
      setError(t("errors.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  function handleDelete(id: string) {
    setFrameworks(prev => prev.filter(f => f.id !== id));
  }

  function openDrawer(fw: Framework) {
    setDrawerFw(fw);
    setDrawerOpen(true);
  }

  function handleCustomized(cloned: Framework) {
    setFrameworks(prev => [cloned, ...prev]);
    navigate(`/framework/${cloned.id}/edit`);
  }

  function handleEdit(fw: Framework) {
    navigate(`/framework/${fw.id}/edit`);
  }

  function handleUseInDocGen(fw: Framework, selected: FrameworkControl[]) {
    // Pass selected controls to doc generator via sessionStorage
    sessionStorage.setItem("docgen_framework", JSON.stringify({ id: fw.id, name: fw.name, short_name: fw.short_name }));
    sessionStorage.setItem("docgen_controls", JSON.stringify(selected));
  }

  // Filter vocabularies come from the data, not from a constant: every region
  // actually present, and the source types actually used (plus an explicit
  // "unclassified" bucket when some framework has none).
  const regionOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const fw of frameworks) {
      for (const raw of fw.applicable_regions ?? []) {
        const key = regionKey(raw);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [frameworks]);

  const sourceTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const fw of frameworks) {
      const key = fw.source_type ?? UNCLASSIFIED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [frameworks]);

  const filtered = frameworks.filter(fw => {
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    const searchFields = [
      fw.name,
      fw.original_name ?? "",   // a machine-translated name still matches its original
      fw.short_name,
      fw.description ?? "",
      fw.issuing_body ?? "",
      fw.source_type ?? "",
      ...(fw.applicable_industries ?? []),
      ...(fw.applicable_regions ?? []),
    ].map(s => s.toLowerCase());
    const matchSearch = tokens.length === 0 || tokens.every(tok => searchFields.some(f => f.includes(tok)));
    const matchType =
      sourceType === "all" ||
      (sourceType === UNCLASSIFIED ? !fw.source_type : fw.source_type === sourceType);
    const matchRegion =
      region === "all" || (fw.applicable_regions ?? []).some(r => regionKey(r) === region);
    return matchSearch && matchType && matchRegion;
  });

  const builtins = filtered.filter(fw => fw.is_builtin);
  const customs  = filtered.filter(fw => !fw.is_builtin);
  const nameById = new Map(frameworks.map(f => [f.id, f.name]));

  const totalControls = frameworks.reduce((s, f) => s + (f.control_count ?? 0), 0);
  const classified = frameworks.filter(f => f.source_type).length;
  const filtersActive = sourceType !== "all" || region !== "all";

  return (
    <div className="p-8 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("frameworks.title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {frameworks.filter(f => f.is_builtin).length} {t("frameworks.builtin").toLowerCase()} · {frameworks.filter(f => !f.is_builtin).length} {t("frameworks.tenant").toLowerCase()} · {totalControls.toLocaleString()} {t("frameworks.total_controls_sub")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DataActions module="frameworks" showImport={false} />
          <button type="button" onClick={load}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title={t("common.refresh")}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setShowImport(true)}
            className="flex items-center gap-2 border border-gray-200 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Upload className="w-4 h-4" />
            {t("frameworks.import_framework")}
          </button>
          {/* Hand-written referential (norme / réglementation / politique interne) —
              the builder above assembles one from existing controls instead. */}
          <button type="button" onClick={() => navigate("/framework/custom/new")}
            className="flex items-center gap-2 border border-gray-200 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <FileText className="w-4 h-4" />
            {t("frameworks.create_from_scratch", "Create from scratch")}
          </button>
          <button type="button" onClick={() => navigate("/framework/builder")}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />
            {t("frameworks.build_custom_framework")}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t("frameworks.builtin"),               value: frameworks.filter(f => f.is_builtin).length,  sub: t("frameworks.ready_to_use"),          color: "text-blue-600"  },
          { label: t("frameworks.tenant"),                value: frameworks.filter(f => !f.is_builtin).length, sub: t("frameworks.in_your_workspace"),     color: "text-purple-600"},
          { label: t("frameworks.total_controls_label"),  value: totalControls.toLocaleString(),               sub: t("frameworks.across_all_frameworks"), color: "text-green-600" },
          { label: t("framework_editor.source_type"),     value: classified,                                   sub: t("requirements.stat_sources_sub"),    color: "text-orange-600"},
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-sm font-medium text-gray-700 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={t("common.search")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button type="button" onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2.5 border rounded-lg text-sm font-medium transition-colors ${showFilters ? "bg-blue-50 border-blue-200 text-blue-600" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            <Filter className="w-3.5 h-3.5" />
            {t("common.filter")}
            {filtersActive && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />}
          </button>
        </div>

        {showFilters && (
          <div className="space-y-3 pt-1 border-t border-gray-100">
            {/* Source type — the tender's « classée par source » */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">{t("framework_editor.source_type")}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setSourceType("all")}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    sourceType === "all" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}>
                  {t("common.all")} ({frameworks.length})
                </button>
                {SOURCE_TYPES.map(st => (
                  <button key={st} type="button" onClick={() => setSourceType(st)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      sourceType === st ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}>
                    {t(`framework_editor.source_types.${st}`)} ({sourceTypeCounts.get(st) ?? 0})
                  </button>
                ))}
                {(sourceTypeCounts.get(UNCLASSIFIED) ?? 0) > 0 && (
                  <button type="button" onClick={() => setSourceType(UNCLASSIFIED)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      sourceType === UNCLASSIFIED ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}>
                    {t("requirements.type_unclassified")} ({sourceTypeCounts.get(UNCLASSIFIED)})
                  </button>
                )}
              </div>
            </div>
            {/* Region filter — driven by applicable_regions, which is populated */}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-2">{t("frameworks.regions")}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setRegion("all")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    region === "all" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}>
                  <Globe className="w-2.5 h-2.5" />
                  {t("common.all")}
                </button>
                {regionOptions.map(([key, count]) => (
                  <button key={key} type="button" onClick={() => setRegion(key)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      region === key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}>
                    <Globe className="w-2.5 h-2.5" />
                    {t(`frameworks.${key}`, { defaultValue: regionFallback(key) })} ({count})
                  </button>
                ))}
              </div>
            </div>
            {filtersActive && (
              <button type="button" onClick={() => { setSourceType("all"); setRegion("all"); }}
                className="text-xs text-blue-600 hover:underline">
                {t("requirements.clear_filters")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <>
          {/* Custom frameworks */}
          {customs.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">{t("frameworks.custom")}</h2>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{customs.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customs.map(fw => (
                  <FrameworkCard key={fw.id} fw={fw}
                    upstreamName={fw.cloned_from_framework_id ? nameById.get(fw.cloned_from_framework_id) : undefined}
                    onDelete={handleDelete} onViewControls={openDrawer} onCustomize={handleCustomized} onEdit={handleEdit} />
                ))}
              </div>
            </section>
          )}

          {/* Built-in frameworks */}
          {builtins.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">{t("frameworks.library")}</h2>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{builtins.length}</span>
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-50 text-green-600">
                  {t("frameworks.ready_to_use")}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {builtins.map(fw => (
                  <FrameworkCard key={fw.id} fw={fw}
                    onDelete={handleDelete} onViewControls={openDrawer} onCustomize={handleCustomized} onEdit={handleEdit} />
                ))}
              </div>
            </section>
          )}

          {filtered.length === 0 && (
            <div className="text-center py-16">
              <BookOpen className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">{t("frameworks.no_frameworks")}</p>
              <button type="button" onClick={() => { setSearch(""); setSourceType("all"); setRegion("all"); }}
                className="mt-4 text-sm text-blue-600 hover:underline">
                {t("requirements.clear_filters")}
              </button>
            </div>
          )}
        </>
      )}

      {/* Controls drawer */}
      <FrameworkDrawer
        fw={drawerFw}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onUseInDocGen={handleUseInDocGen}
      />

      {showImport && (
        <ImportFrameworkModal
          frameworks={frameworks}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
    </div>
  );
}
