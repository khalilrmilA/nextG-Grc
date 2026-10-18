/**
 * EditFrameworkPage — the editable referential (STB objectif 1, clauses « mise à
 * jour manuelle », « classée par domaine / type », « crosswalk », « FR et AR »).
 *
 * What changed here beyond the translation pass:
 *   * every string goes through t() — this screen was 100 % hard-coded English,
 *     which broke the Customize → Edit flow the tender's « mise à jour manuelle »
 *     clause depends on;
 *   * a control now carries its classification (domaine, type d'exigence,
 *     caractère obligatoire) and its crosswalk (`mapped_controls`), which was
 *     read-only and seeded on 93 of 4 537 controls;
 *   * a tenant fork can be compared with, and re-synced from, the built-in it
 *     was cloned from (GET /upstream-diff, POST /upstream-sync);
 *   * a control's French and Arabic wording can be authored per control
 *     (PUT .../translations/{lang}) — tenant-owned frameworks only, because the
 *     translation table is shared platform-wide for built-ins.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowLeft, Plus, Save, Trash2, Pencil, X, Loader2,
  AlertCircle, CheckCircle, BookOpen, Search, Copy, History, User as UserIcon,
  Languages, GitFork, Layers, RefreshCw,
} from "lucide-react";
import { frameworksApi, customFrameworkApi, usersApi } from "@/api/endpoints";
import type {
  Framework, FrameworkControl, FrameworkControlVersion, FrameworkCreate,
  ControlCreate, CrosswalkMapping, ControlTranslation, FrameworkUpstreamDiff,
} from "@/types";

// Free-text `category` keeps its legacy list; `domain` is the controlled
// vocabulary the backend validates against (DOMAIN_VALUES = ControlCategory
// values) — writing anything else is refused with a 422.
const CATEGORIES = [
  "ORGANIZATIONAL", "PEOPLE", "PHYSICAL", "TECHNOLOGICAL",
  "IDENTIFY", "PROTECT", "DETECT", "RESPOND", "RECOVER", "GOVERNANCE",
  "POLICY",
];
const DOMAINS = [
  "Organizational", "People", "Physical", "Technological",
  "IDENTIFY", "PROTECT", "DETECT", "RESPOND", "RECOVER", "GOVERNANCE", "POLICY",
];
const REQUIREMENT_TYPES = ["exigence", "recommandation", "mesure"];
const SOURCE_TYPES = ["norme", "reglementation", "loi", "politique_interne"];
const TRANSLATION_LANGS = ["fr", "ar"];

/** Display label for a controlled-vocabulary value (domain/category); the
 *  value itself is what the API stores, only the label is translated. */
function vocab(t: TFunction, group: string, value: string): string {
  return t(`fw_options.${group}.${value.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, { defaultValue: value });
}

type Toast = { kind: "ok" | "err"; msg: string } | null;

/** The API client's types predate the classification columns; the routes accept
 *  them (ControlCreate / ControlUpdate on the backend) and types/index.ts is
 *  owned by another lane, so the extra fields are declared here and widened at
 *  the call site rather than being dropped. */
type ControlPayload = ControlCreate & {
  domain?: string | null;
  requirement_type?: string | null;
  is_mandatory?: boolean;
  mapped_controls?: CrosswalkMapping[];
};
type ControlPatch = Partial<ControlPayload>;
type FrameworkMetaPatch = Partial<FrameworkCreate> & { source_type?: string | null };

/** "ISO27001:A.5.1, PCI-DSS:1.1" ⇄ [{framework, control}] — the shape the corpus
 *  already stores and the only one the crosswalk endpoint understands. */
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

function formatMappings(mappings: CrosswalkMapping[] | undefined): string {
  return (mappings ?? []).map(m => `${m.framework}:${m.control}`).join(", ");
}

export default function EditFrameworkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const [fw, setFw] = useState<Framework | null>(null);
  const [controls, setControls] = useState<FrameworkControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  // Editable framework metadata (local copy)
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [issuingBody, setIssuingBody] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  // Add-control modal
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<{ title: string; description?: string; guidance?: string } | null>(null);

  // A "Draft framework control" prefill from RegulatoryUpdatesPage — open
  // the add-control modal pre-filled instead of creating anything directly.
  useEffect(() => {
    const draft = (location.state as { controlDraft?: { title: string; description?: string; guidance?: string } } | null)?.controlDraft;
    if (!draft) return;
    setAddDraft({ title: draft.title, description: draft.description, guidance: draft.guidance });
    setAddOpen(true);
    navigate(location.pathname, { replace: true, state: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Per-row inline-edit state
  const [editingId, setEditingId] = useState<string | null>(null);

  // Modals scoped to one control
  const [historyControl, setHistoryControl] = useState<FrameworkControl | null>(null);
  const [translateControl, setTranslateControl] = useState<FrameworkControl | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      // `original: 1`: this screen EDITS the stored text. Without it a FR/AR
      // reader would get machine translations here and saving would write them
      // over the originals.
      const [fwData, ctrlData] = await Promise.all([
        frameworksApi.get(id, { original: 1 }),
        frameworksApi.getControls(id, { original: 1 }),
      ]);
      setFw(fwData);
      setName(fwData.name);
      setShortName(fwData.short_name);
      setVersion(fwData.version);
      setDescription(fwData.description ?? "");
      setIssuingBody(fwData.issuing_body ?? "");
      setSourceType(fwData.source_type ?? "");
      setControls(ctrlData);
    } catch {
      setError(t("framework_editor.not_found"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  // Version history prints who changed a control; without this it printed a raw
  // UUID, which nobody can audit.
  useEffect(() => {
    usersApi.directory()
      .then(rows => setUserNames(Object.fromEntries(
        rows.map(u => [u.id, `${u.first_name} ${u.last_name}`.trim() || u.email]),
      )))
      .catch(() => setUserNames({}));
  }, []);

  function flash(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 2500);
  }

  async function saveMeta() {
    if (!fw) return;
    setSavingMeta(true);
    try {
      const patch: FrameworkMetaPatch = {
        name: name.trim(),
        short_name: shortName.trim(),
        version: version.trim(),
        description: description.trim() || undefined,
        issuing_body: issuingBody.trim() || undefined,
        source_type: sourceType || null,
      };
      const updated = await customFrameworkApi.updateMeta(fw.id, patch as Partial<FrameworkCreate>);
      setFw(updated);
      flash("ok", t("framework_editor.details_saved"));
    } catch {
      flash("err", t("framework_editor.error_save_details"));
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleAdd(data: ControlPayload) {
    if (!fw) return;
    try {
      const created = await customFrameworkApi.addControl(fw.id, data as ControlCreate);
      setControls(prev => [...prev, created]);
      setAddOpen(false);
      setAddDraft(null);
      flash("ok", t("framework_editor.control_added"));
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      flash("err", status === 403
        ? t("framework_editor.error_permission")
        : t("framework_editor.error_add_control"));
    }
  }

  async function handleUpdateRow(controlDbId: string, patch: ControlPatch) {
    if (!fw) return;
    try {
      const updated = await customFrameworkApi.updateControl(
        fw.id, controlDbId, patch as Partial<ControlCreate>,
      );
      setControls(prev => prev.map(c => (c.id === controlDbId ? updated : c)));
      setEditingId(null);
      flash("ok", t("framework_editor.control_updated"));
    } catch {
      flash("err", t("framework_editor.error_save_control"));
    }
  }

  async function handleDelete(controlDbId: string) {
    if (!fw) return;
    if (!confirm(t("framework_editor.delete_control_confirm"))) return;
    try {
      await customFrameworkApi.deleteControl(fw.id, controlDbId);
      setControls(prev => prev.filter(c => c.id !== controlDbId));
      flash("ok", t("framework_editor.control_deleted"));
    } catch {
      flash("err", t("framework_editor.error_delete_control"));
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-7xl flex items-center gap-2 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin" /> {t("common.loading")}
      </div>
    );
  }

  if (error || !fw) {
    return (
      <div className="p-8 max-w-7xl space-y-4">
        <button type="button" onClick={() => navigate("/framework")}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> {t("frameworks.builder.back")}
        </button>
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error || t("framework_editor.not_found")}
        </div>
      </div>
    );
  }

  const isCustom = !fw.is_builtin;

  // Group controls by domain when it is set, otherwise by the legacy category.
  const visible = search.trim()
    ? controls.filter(c => {
        const q = search.trim().toLowerCase();
        return c.control_id.toLowerCase().includes(q)
          || c.title.toLowerCase().includes(q)
          || (c.description ?? "").toLowerCase().includes(q);
      })
    : controls;

  const groups: Record<string, FrameworkControl[]> = {};
  for (const c of visible) {
    const grp = c.domain || c.category || t("requirements.domain_unclassified");
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(c);
  }
  const groupNames = Object.keys(groups).sort();

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <button type="button" onClick={() => navigate("/framework")}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> {t("frameworks.builder.back")}
        </button>
        {toast && (
          <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border ${
            toast.kind === "ok"
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}>
            {toast.kind === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {toast.msg}
          </div>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("framework_editor.title")}</h1>
        <p className="text-gray-500 text-sm mt-1">{t("framework_editor.subtitle")}</p>
      </div>

      {!isCustom && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>{t("framework_editor.builtin_readonly_title")}</strong>
            {" — "}
            {t("framework_editor.builtin_readonly_body")}
          </span>
        </div>
      )}

      {/* Framework metadata */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">{t("framework_editor.details_title")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label htmlFor="fw-name" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.name")}
            </label>
            <input
              id="fw-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={!isCustom}
              placeholder={t("framework_editor.name_placeholder")}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
          <div>
            <label htmlFor="fw-short" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.short_name")}
            </label>
            <input
              id="fw-short"
              type="text"
              value={shortName}
              onChange={e => setShortName(e.target.value)}
              disabled={!isCustom}
              placeholder={t("framework_editor.short_name_placeholder")}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
          <div>
            <label htmlFor="fw-version" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.version")}
            </label>
            <input
              id="fw-version"
              type="text"
              value={version}
              onChange={e => setVersion(e.target.value)}
              disabled={!isCustom}
              placeholder={t("framework_editor.version_placeholder")}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
          <div>
            <label htmlFor="fw-source-type" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.source_type")}
            </label>
            <select
              id="fw-source-type"
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
              disabled={!isCustom}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 bg-white"
            >
              <option value="">{t("requirements.type_unclassified")}</option>
              {SOURCE_TYPES.map(s => (
                <option key={s} value={s}>{t(`framework_editor.source_types.${s}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fw-issuer" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.issuing_body")}
            </label>
            <input
              id="fw-issuer"
              type="text"
              value={issuingBody}
              onChange={e => setIssuingBody(e.target.value)}
              disabled={!isCustom}
              placeholder={t("framework_editor.issuing_body_placeholder")}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="fw-desc" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.description")}
            </label>
            <textarea
              id="fw-desc"
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={!isCustom}
              placeholder={t("framework_editor.description_placeholder")}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
        </div>
        {isCustom && (
          <div className="flex justify-end">
            <button type="button" onClick={saveMeta} disabled={savingMeta}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {savingMeta ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t("framework_editor.save_details")}
            </button>
          </div>
        )}
      </div>

      {/* Upstream lineage — only a fork has one */}
      {isCustom && fw.cloned_from_framework_id && (
        <UpstreamPanel framework={fw} onSynced={load} />
      )}

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t("framework_editor.controls_title")}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {t(controls.length === 1 ? "framework_editor.controls_count_one" : "framework_editor.controls_count_other", { count: controls.length })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t("framework_editor.search_controls")}
                className="border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {isCustom && (
              <button type="button" onClick={() => setAddOpen(true)}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                <Plus className="w-4 h-4" /> {t("framework_editor.add_control")}
              </button>
            )}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-8">
            <BookOpen className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500">
              {controls.length === 0 ? t("framework_editor.no_controls") : t("framework_editor.no_controls_found")}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {groupNames.map(grp => (
              <div key={grp}>
                <div className="px-6 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {grp} <span className="ml-1 text-gray-400 font-normal normal-case">({groups[grp].length})</span>
                </div>
                {groups[grp].map(ctrl => (
                  <ControlRow
                    key={ctrl.id}
                    control={ctrl}
                    editable={isCustom}
                    isEditing={editingId === ctrl.id}
                    onStartEdit={() => setEditingId(ctrl.id)}
                    onCancel={() => setEditingId(null)}
                    onSave={(patch) => handleUpdateRow(ctrl.id, patch)}
                    onDelete={() => handleDelete(ctrl.id)}
                    onShowHistory={() => setHistoryControl(ctrl)}
                    onTranslate={() => setTranslateControl(ctrl)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {addOpen && (
        <AddControlModal
          onClose={() => { setAddOpen(false); setAddDraft(null); }}
          onSave={handleAdd}
          currentFrameworkId={fw.id}
          initial={addDraft ?? undefined}
        />
      )}
      {historyControl && (
        <ControlHistoryModal
          frameworkId={fw.id}
          control={historyControl}
          userNames={userNames}
          onClose={() => setHistoryControl(null)}
        />
      )}
      {translateControl && (
        <ControlTranslationsModal
          frameworkId={fw.id}
          control={translateControl}
          onClose={() => setTranslateControl(null)}
        />
      )}
    </div>
  );
}

// ── Upstream lineage panel ───────────────────────────────────────────────────
// « Mise à jour manuelle possible » implies a fork can take in the corrections
// made upstream. Locally edited controls are reported, never overwritten.

function UpstreamPanel({
  framework,
  onSynced,
}: {
  readonly framework: Framework;
  readonly onSynced: () => void;
}) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<FrameworkUpstreamDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadDiff = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      setDiff(await frameworksApi.getUpstreamDiff(framework.id));
    } catch {
      setDiff(null);
      setError(t("errors.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [framework.id, t]);

  async function sync() {
    if (!confirm(t("framework_editor.upstream_sync_confirm"))) return;
    setSyncing(true);
    setError("");
    try {
      const res = await frameworksApi.syncFromUpstream(framework.id, {
        adopt_new: true, update_unmodified: true,
      }) as { adopted?: number; refreshed?: number; skipped_locally_edited?: number };
      setMessage(`${t("framework_editor.upstream_added")}: ${res?.adopted ?? 0} · ${t("framework_editor.upstream_changed")}: ${res?.refreshed ?? 0}`);
      await loadDiff();
      onSynced();
    } catch {
      setError(t("framework_editor.error_save_details"));
    } finally {
      setSyncing(false);
    }
  }

  const totalChanges = diff
    ? diff.counts.added_upstream + diff.counts.modified
    : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <GitFork className="w-4 h-4 text-purple-500" />
          <h2 className="text-lg font-bold text-gray-900">{t("framework_editor.upstream_title")}</h2>
          {diff && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-purple-50 text-purple-700">
              {diff.upstream_name} v{diff.upstream_version}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={loadDiff} disabled={loading}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium px-3 py-1.5 rounded-lg">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {t("framework_editor.upstream_diff")}
          </button>
          {diff && totalChanges > 0 && (
            <button type="button" onClick={sync} disabled={syncing}
              className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {t("framework_editor.upstream_sync")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </p>
      )}
      {message && (
        <p className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" /> {message}
        </p>
      )}

      {diff && (
        totalChanges === 0 ? (
          <p className="text-sm text-gray-500">{t("framework_editor.upstream_up_to_date")}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {t(totalChanges === 1 ? "framework_editor.upstream_changes_one" : "framework_editor.upstream_changes_other", { count: totalChanges })}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: t("framework_editor.upstream_added"),   value: diff.counts.added_upstream },
                { label: t("framework_editor.upstream_changed"), value: diff.counts.modified },
                { label: t("framework_editor.upstream_removed"), value: diff.counts.only_in_this_copy },
              ].map(s => (
                <div key={s.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-gray-900">{s.value}</p>
                  <p className="text-xs text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
            {diff.added_upstream.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                  {t("framework_editor.upstream_added")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {diff.added_upstream.slice(0, 25).map(c => (
                    <span key={c.control_id} className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-50 text-green-700"
                      title={c.title}>
                      {c.control_id}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {diff.modified.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                  {t("framework_editor.upstream_changed")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {diff.modified.slice(0, 25).map(c => (
                    <span key={c.control_id}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        c.locally_edited ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
                      }`}
                      title={c.upstream_title}>
                      {c.control_id}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ── Control row (read mode + inline edit mode) ───────────────────────────────

function ControlRow({
  control,
  editable,
  isEditing,
  onStartEdit,
  onCancel,
  onSave,
  onDelete,
  onShowHistory,
  onTranslate,
}: {
  readonly control: FrameworkControl;
  readonly editable: boolean;
  readonly isEditing: boolean;
  readonly onStartEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: (patch: ControlPatch) => void;
  readonly onDelete: () => void;
  readonly onShowHistory: () => void;
  readonly onTranslate: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(control.title);
  const [description, setDescription] = useState(control.description ?? "");
  const [guidance, setGuidance] = useState(control.guidance ?? "");
  const [category, setCategory] = useState(control.category ?? "");
  const [domain, setDomain] = useState(control.domain ?? "");
  const [requirementType, setRequirementType] = useState(control.requirement_type ?? "");
  const [mandatory, setMandatory] = useState(Boolean(control.is_mandatory));
  const [mapped, setMapped] = useState(formatMappings(control.mapped_controls));

  useEffect(() => {
    if (isEditing) {
      setTitle(control.title);
      setDescription(control.description ?? "");
      setGuidance(control.guidance ?? "");
      setCategory(control.category ?? "");
      setDomain(control.domain ?? "");
      setRequirementType(control.requirement_type ?? "");
      setMandatory(Boolean(control.is_mandatory));
      setMapped(formatMappings(control.mapped_controls));
    }
  }, [isEditing, control]);

  if (isEditing) {
    return (
      <div className="px-6 py-4 bg-blue-50/30 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
            {control.control_id}
          </span>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t("framework_editor.control_title_placeholder")}
            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <textarea
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t("framework_editor.control_description_placeholder")}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <textarea
          rows={2}
          value={guidance}
          onChange={e => setGuidance(e.target.value)}
          placeholder={t("framework_editor.control_guidance_placeholder")}
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Classification — « chaque exigence est classée par domaine et type » */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t("framework_editor.control_domain")}
            </label>
            <select
              value={domain}
              onChange={e => setDomain(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">{t("requirements.domain_unclassified")}</option>
              {DOMAINS.map(d => <option key={d} value={d}>{vocab(t, "domain", d)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t("framework_editor.control_requirement_type")}
            </label>
            <select
              value={requirementType}
              onChange={e => setRequirementType(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">{t("requirements.type_unclassified")}</option>
              {REQUIREMENT_TYPES.map(r => (
                <option key={r} value={r}>{t(`framework_editor.requirement_types.${r}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {t("framework_editor.control_category")}
            </label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">{t("common.none")}</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{vocab(t, "domain", c)}</option>)}
            </select>
          </div>
        </div>

        {/* Crosswalk — editable at last */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {t("framework_editor.control_mapped")}
          </label>
          <input
            type="text"
            value={mapped}
            onChange={e => setMapped(e.target.value)}
            placeholder={t("framework_editor.control_mapped_placeholder")}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={mandatory}
              onChange={e => setMandatory(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t("framework_editor.control_mandatory")}
          </label>
          <div className="flex-1" />
          <button type="button" onClick={onCancel}
            className="text-sm px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg">
            {t("common.cancel")}
          </button>
          <button type="button"
            onClick={() => onSave({
              title: title.trim(),
              description: description.trim(),
              guidance: guidance.trim(),
              category: category || undefined,
              domain: domain || null,
              requirement_type: requirementType || null,
              is_mandatory: mandatory,
              mapped_controls: parseMappings(mapped),
            })}
            disabled={!title.trim()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
            <Save className="w-3.5 h-3.5" /> {t("common.save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-3 hover:bg-gray-50/50 group flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
            {control.control_id}
          </span>
          <span className="text-sm font-medium text-gray-800 leading-snug">{control.title}</span>
        </div>
        {control.description && (
          <p className="text-xs text-gray-500 mt-1">{control.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {control.domain && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600">
              {vocab(t, "domain", control.domain)}
            </span>
          )}
          {control.requirement_type && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700">
              {t(`framework_editor.requirement_types.${control.requirement_type}`, { defaultValue: control.requirement_type })}
            </span>
          )}
          {control.is_mandatory && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-50 text-red-600">
              {t("framework_editor.control_mandatory")}
            </span>
          )}
          {(control.mapped_controls?.length ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-indigo-50 text-indigo-700"
              title={formatMappings(control.mapped_controls)}>
              <Layers className="w-3 h-3" /> {control.mapped_controls.length}
            </span>
          )}
          {control.lang && control.lang !== "en" && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700">
              {control.lang.toUpperCase()}
            </span>
          )}
        </div>
      </div>
      {editable && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button type="button" onClick={onTranslate}
            className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg"
            title={t("framework_editor.translations")}>
            <Languages className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onShowHistory}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
            title={t("framework_editor.edit_history")}>
            <History className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onStartEdit}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
            title={t("framework_editor.edit_control")}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onDelete}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
            title={t("framework_editor.delete_control")}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Add Control modal ────────────────────────────────────────────────────────

function AddControlModal({
  onClose,
  onSave,
  currentFrameworkId,
  initial,
}: {
  readonly onClose: () => void;
  readonly onSave: (data: ControlPayload) => void;
  readonly currentFrameworkId: string;
  readonly initial?: { title: string; description?: string; guidance?: string };
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"new" | "import">("new");

  // "Create from scratch" fields
  const [controlId, setControlId] = useState("");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [guidance, setGuidance] = useState(initial?.guidance ?? "");
  const [category, setCategory] = useState("");
  const [domain, setDomain] = useState("");
  const [requirementType, setRequirementType] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [mapped, setMapped] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // "Import from framework" state
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [selectedFwId, setSelectedFwId] = useState("");
  const [fwControls, setFwControls] = useState<FrameworkControl[]>([]);
  const [fwLoading, setFwLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCtrl, setSelectedCtrl] = useState<FrameworkControl | null>(null);

  // Load framework list once when switching to import tab
  useEffect(() => {
    if (tab !== "import" || frameworks.length > 0) return;
    frameworksApi.list().then(list =>
      setFrameworks(list.filter(f => f.id !== currentFrameworkId))
    ).catch(() => {});
  }, [tab, frameworks.length, currentFrameworkId]);

  // Load controls when a framework is picked
  useEffect(() => {
    if (!selectedFwId) { setFwControls([]); return; }
    setFwLoading(true);
    setSelectedCtrl(null);
    setSearch("");
    // Stored text: the picked control is copied into a new control.
    frameworksApi.getControls(selectedFwId, { original: 1 })
      .then(setFwControls)
      .catch(() => setFwControls([]))
      .finally(() => setFwLoading(false));
  }, [selectedFwId]);

  function pickControl(ctrl: FrameworkControl) {
    setSelectedCtrl(ctrl);
    // Pre-fill the manual fields so the user can edit before saving
    setControlId(ctrl.control_id);
    setTitle(ctrl.title);
    setDescription(ctrl.description ?? "");
    setGuidance(ctrl.guidance ?? "");
    setCategory(ctrl.category ?? "");
    setDomain(ctrl.domain ?? "");
    setRequirementType(ctrl.requirement_type ?? "");
    setMandatory(Boolean(ctrl.is_mandatory));
    setMapped(formatMappings(ctrl.mapped_controls));
  }

  const filtered = fwControls.filter(c =>
    !search ||
    c.control_id.toLowerCase().includes(search.toLowerCase()) ||
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!controlId.trim() || !title.trim()) return;
    setSubmitting(true);
    await onSave({
      control_id: controlId.trim(),
      title: title.trim(),
      description: description.trim() || undefined,
      guidance: guidance.trim() || undefined,
      category: category || undefined,
      domain: domain || null,
      requirement_type: requirementType || null,
      is_mandatory: mandatory,
      mapped_controls: parseMappings(mapped),
      tags: [],
    });
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h3 className="text-lg font-bold text-gray-900">{t("framework_editor.add_control")}</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
            title={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pb-4 flex-shrink-0">
          <button
            type="button"
            onClick={() => setTab("new")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === "new" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <Plus className="w-3.5 h-3.5" /> {t("framework_editor.create_from_scratch")}
          </button>
          <button
            type="button"
            onClick={() => setTab("import")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === "import" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <Copy className="w-3.5 h-3.5" /> {t("framework_editor.import_from_framework")}
          </button>
        </div>

        {/* Import picker */}
        {tab === "import" && (
          <div className="px-6 pb-4 space-y-3 flex-shrink-0">
            <p className="text-xs text-gray-500">{t("framework_editor.import_hint")}</p>
            <select
              value={selectedFwId}
              onChange={e => setSelectedFwId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("frameworks.builder.select_framework")}</option>
              {frameworks.map(f => (
                <option key={f.id} value={f.id}>{f.name} ({f.short_name})</option>
              ))}
            </select>

            {selectedFwId && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t("framework_editor.search_controls")}
                  className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {selectedFwId && (
              <div className="border border-gray-200 rounded-lg overflow-y-auto max-h-48">
                {fwLoading ? (
                  <div className="flex items-center justify-center py-6 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> {t("common.loading")}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-6 text-center text-sm text-gray-400">{t("framework_editor.no_controls_found")}</div>
                ) : (
                  filtered.map(ctrl => (
                    <button
                      key={ctrl.id}
                      type="button"
                      onClick={() => pickControl(ctrl)}
                      className={`w-full text-left px-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-blue-50 transition-colors ${
                        selectedCtrl?.id === ctrl.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
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

            {selectedCtrl && (
              <p className="text-xs text-blue-600 font-medium">
                {t("frameworks.builder.selected_hint")}
              </p>
            )}
          </div>
        )}

        {/* Form fields (always visible, pre-filled when importing) */}
        <div className="px-6 pb-4 space-y-3 overflow-y-auto flex-1">
          <div>
            <label htmlFor="add-ctrl-id" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.control_id")} *
            </label>
            <input
              id="add-ctrl-id"
              type="text"
              value={controlId}
              onChange={e => setControlId(e.target.value)}
              placeholder={t("framework_editor.control_id_placeholder")}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="add-ctrl-title" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.control_title")} *
            </label>
            <input
              id="add-ctrl-title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t("framework_editor.control_title_placeholder")}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="add-ctrl-desc" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.control_description")}
            </label>
            <textarea
              id="add-ctrl-desc"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t("framework_editor.control_description_placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="add-ctrl-guid" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.control_guidance")}
            </label>
            <textarea
              id="add-ctrl-guid"
              rows={2}
              value={guidance}
              onChange={e => setGuidance(e.target.value)}
              placeholder={t("framework_editor.control_notes_placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label htmlFor="add-ctrl-domain" className="block text-sm font-medium text-gray-700 mb-1">
                {t("framework_editor.control_domain")}
              </label>
              <select
                id="add-ctrl-domain"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">{t("requirements.domain_unclassified")}</option>
                {DOMAINS.map(d => <option key={d} value={d}>{vocab(t, "domain", d)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="add-ctrl-type" className="block text-sm font-medium text-gray-700 mb-1">
                {t("framework_editor.control_requirement_type")}
              </label>
              <select
                id="add-ctrl-type"
                value={requirementType}
                onChange={e => setRequirementType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">{t("requirements.type_unclassified")}</option>
                {REQUIREMENT_TYPES.map(r => (
                  <option key={r} value={r}>{t(`framework_editor.requirement_types.${r}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="add-ctrl-cat" className="block text-sm font-medium text-gray-700 mb-1">
                {t("framework_editor.control_category")}
              </label>
              <select
                id="add-ctrl-cat"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">{t("common.none")}</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{vocab(t, "domain", c)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="add-ctrl-mapped" className="block text-sm font-medium text-gray-700 mb-1">
              {t("framework_editor.control_mapped")}
            </label>
            <input
              id="add-ctrl-mapped"
              type="text"
              value={mapped}
              onChange={e => setMapped(e.target.value)}
              placeholder={t("framework_editor.control_mapped_placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={mandatory}
              onChange={e => setMandatory(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t("framework_editor.control_mandatory")}
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button type="button" onClick={onClose}
            className="text-sm px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={submitting || !controlId.trim() || !title.trim()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t("framework_editor.add_control")}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Control translations modal ───────────────────────────────────────────────
// « Le référentiel doit être exploitable en français et en arabe » — the corpus
// ships in English, so a tenant has to be able to author its own wording.

function ControlTranslationsModal({
  frameworkId,
  control,
  onClose,
}: {
  readonly frameworkId: string;
  readonly control: FrameworkControl;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const [lang, setLang] = useState(TRANSLATION_LANGS[0]);
  const [translations, setTranslations] = useState<ControlTranslation[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [guidance, setGuidance] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    frameworksApi.listControlTranslations(frameworkId, control.id)
      .then(rows => { if (!cancelled) setTranslations(rows); })
      .catch(() => { if (!cancelled) setTranslations([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [frameworkId, control.id]);

  useEffect(() => {
    const row = translations.find(x => x.lang === lang);
    setTitle(row?.title ?? "");
    setDescription(row?.description ?? "");
    setGuidance(row?.guidance ?? "");
    setSaved(false);
  }, [lang, translations]);

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const row = await frameworksApi.upsertControlTranslation(frameworkId, control.id, lang, {
        title: title.trim() || null,
        description: description.trim() || null,
        guidance: guidance.trim() || null,
        source: "human",
      });
      setTranslations(prev => [...prev.filter(x => x.lang !== lang), row]);
      setSaved(true);
    } catch {
      setError(t("framework_editor.error_save_control"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Languages className="w-4 h-4 text-emerald-500" /> {t("framework_editor.translations")}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="font-mono font-semibold">{control.control_id}</span> — {control.title}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            title={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <p className="text-xs text-gray-500">{t("framework_editor.translation_hint")}</p>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="tr-lang" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("framework_editor.translation_lang")}
                </label>
                <select id="tr-lang" value={lang} onChange={e => setLang(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  {TRANSLATION_LANGS.map(l => (
                    <option key={l} value={l}>{l.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tr-title" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("framework_editor.translation_title")}
                </label>
                <input id="tr-title" type="text" value={title} onChange={e => setTitle(e.target.value)}
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="tr-desc" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("framework_editor.translation_description")}
                </label>
                <textarea id="tr-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)}
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="tr-guid" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("framework_editor.control_guidance")}
                </label>
                <textarea id="tr-guid" rows={2} value={guidance} onChange={e => setGuidance(e.target.value)}
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {error && (
                <p className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                </p>
              )}
              {saved && (
                <p className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" /> {t("framework_editor.translation_saved")}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button type="button" onClick={onClose}
            className="text-sm px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            {t("common.close")}
          </button>
          <button type="button" onClick={save} disabled={saving || loading}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t("framework_editor.save_translation")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Control edit-history modal ────────────────────────────────────────────────
// RFP: "suivi des modifications réglementaires avec historique" — shows every past
// snapshot of this control's editable fields, newest first, with who/when.

function ControlHistoryModal({
  frameworkId,
  control,
  userNames,
  onClose,
}: {
  readonly frameworkId: string;
  readonly control: FrameworkControl;
  readonly userNames: Record<string, string>;
  readonly onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [versions, setVersions] = useState<FrameworkControlVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    customFrameworkApi
      .getControlVersions(frameworkId, control.id)
      .then((data) => { if (!cancelled) setVersions(data); })
      .catch(() => { if (!cancelled) setError(t("framework_editor.error_load_history")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [frameworkId, control.id, t]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <History className="w-4 h-4 text-gray-400" /> {t("framework_editor.edit_history")}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="font-mono font-semibold">{control.control_id}</span> — {control.title}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            title={t("common.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History className="w-8 h-8 text-gray-200 mb-2" />
              <p className="text-sm font-medium text-gray-500">{t("framework_editor.history_empty")}</p>
              <p className="text-xs text-gray-400 mt-1">{t("framework_editor.history_hint")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-gray-400 pb-1">{t("framework_editor.history_hint")}</div>
              {versions.map((v) => (
                <div key={v.id} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600">
                      {t("framework_editor.history_version", { n: v.version_number })}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(v.created_at).toLocaleString(i18n.language?.startsWith("fr") ? "fr-FR" : i18n.language?.startsWith("ar") ? "ar-u-nu-latn" : "en-GB")}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-800">{v.title}</p>
                  {v.description && <p className="text-xs text-gray-500 mt-1">{v.description}</p>}
                  {v.guidance && <p className="text-xs text-gray-400 mt-1 italic">{v.guidance}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    {v.category && <span className="bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{vocab(t, "domain", v.category)}</span>}
                    {v.changed_by_id && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="w-3 h-3" /> {userNames[v.changed_by_id] ?? v.changed_by_id}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button type="button" onClick={onClose}
            className="text-sm px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
