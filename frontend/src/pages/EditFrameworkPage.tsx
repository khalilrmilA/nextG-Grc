import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Plus, Save, Trash2, Pencil, X, Loader2,
  AlertCircle, CheckCircle, BookOpen, Search, Copy,
} from "lucide-react";
import { frameworksApi, customFrameworkApi } from "@/api/endpoints";
import type { Framework, FrameworkControl } from "@/types";

const CATEGORIES = [
  "ORGANIZATIONAL", "PEOPLE", "PHYSICAL", "TECHNOLOGICAL",
  "IDENTIFY", "PROTECT", "DETECT", "RESPOND", "RECOVER", "GOVERNANCE",
  "POLICY",
];

type Toast = { kind: "ok" | "err"; msg: string } | null;

export default function EditFrameworkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [fw, setFw] = useState<Framework | null>(null);
  const [controls, setControls] = useState<FrameworkControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);

  // Editable framework metadata (local copy)
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  // Add-control modal
  const [addOpen, setAddOpen] = useState(false);

  // Per-row inline-edit state
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const [fwData, ctrlData] = await Promise.all([
        frameworksApi.get(id),
        frameworksApi.getControls(id),
      ]);
      setFw(fwData);
      setName(fwData.name);
      setShortName(fwData.short_name);
      setVersion(fwData.version);
      setDescription(fwData.description ?? "");
      setControls(ctrlData);
    } catch {
      setError("Failed to load framework. It may not exist or be a built-in framework you cannot edit.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function flash(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 2500);
  }

  async function saveMeta() {
    if (!fw) return;
    setSavingMeta(true);
    try {
      const updated = await customFrameworkApi.updateMeta(fw.id, {
        name: name.trim(),
        short_name: shortName.trim(),
        version: version.trim(),
        description: description.trim() || undefined,
      });
      setFw(updated);
      flash("ok", "Framework details saved");
    } catch {
      flash("err", "Failed to save framework details");
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleAdd(data: { control_id: string; title: string; description?: string; category?: string }) {
    if (!fw) return;
    try {
      const created = await customFrameworkApi.addControl(fw.id, { ...data, tags: [] });
      setControls(prev => [...prev, created]);
      setAddOpen(false);
      flash("ok", "Control added");
    } catch {
      flash("err", "Failed to add control");
    }
  }

  async function handleUpdateRow(controlDbId: string, patch: Partial<FrameworkControl>) {
    if (!fw) return;
    try {
      const updated = await customFrameworkApi.updateControl(fw.id, controlDbId, patch);
      setControls(prev => prev.map(c => (c.id === controlDbId ? updated : c)));
      setEditingId(null);
      flash("ok", "Control updated");
    } catch {
      flash("err", "Failed to update control");
    }
  }

  async function handleDelete(controlDbId: string) {
    if (!fw) return;
    if (!confirm("Delete this control? This cannot be undone.")) return;
    try {
      await customFrameworkApi.deleteControl(fw.id, controlDbId);
      setControls(prev => prev.filter(c => c.id !== controlDbId));
      flash("ok", "Control deleted");
    } catch {
      flash("err", "Failed to delete control");
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-7xl flex items-center gap-2 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading framework…
      </div>
    );
  }

  if (error || !fw) {
    return (
      <div className="p-8 max-w-7xl space-y-4">
        <button type="button" onClick={() => navigate("/frameworks")}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> Back to Frameworks
        </button>
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error || "Framework not found"}
        </div>
      </div>
    );
  }

  const isCustom = !fw.is_builtin;

  // Group controls by category for clearer editing
  const groups: Record<string, FrameworkControl[]> = {};
  for (const c of controls) {
    const grp = c.category || "General";
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(c);
  }
  const groupNames = Object.keys(groups).sort();

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <button type="button" onClick={() => navigate("/frameworks")}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> Back to Frameworks
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

      {!isCustom && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>This is a built-in framework. To edit it, go back and click <strong>Customize</strong> to fork your own copy.</span>
        </div>
      )}

      {/* Framework metadata */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Framework details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={!isCustom}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Short name</label>
            <input
              type="text"
              value={shortName}
              onChange={e => setShortName(e.target.value)}
              disabled={!isCustom}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
            <input
              type="text"
              value={version}
              onChange={e => setVersion(e.target.value)}
              disabled={!isCustom}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={!isCustom}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
        </div>
        {isCustom && (
          <div className="flex justify-end">
            <button type="button" onClick={saveMeta} disabled={savingMeta}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {savingMeta ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save details
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Controls</h2>
            <p className="text-xs text-gray-500 mt-0.5">{controls.length} control{controls.length === 1 ? "" : "s"} in this framework</p>
          </div>
          {isCustom && (
            <button type="button" onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              <Plus className="w-4 h-4" /> Add control
            </button>
          )}
        </div>

        {controls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-8">
            <BookOpen className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500">No controls yet</p>
            {isCustom && (
              <p className="text-xs text-gray-400 mt-1">Click <em>Add control</em> to create the first one.</p>
            )}
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
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {addOpen && <AddControlModal onClose={() => setAddOpen(false)} onSave={handleAdd} currentFrameworkId={fw.id} />}
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
}: {
  readonly control: FrameworkControl;
  readonly editable: boolean;
  readonly isEditing: boolean;
  readonly onStartEdit: () => void;
  readonly onCancel: () => void;
  readonly onSave: (patch: Partial<FrameworkControl>) => void;
  readonly onDelete: () => void;
}) {
  const [title, setTitle] = useState(control.title);
  const [description, setDescription] = useState(control.description ?? "");
  const [category, setCategory] = useState(control.category ?? "");

  useEffect(() => {
    if (isEditing) {
      setTitle(control.title);
      setDescription(control.description ?? "");
      setCategory(control.category ?? "");
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
            placeholder="Control title"
            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <textarea
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center gap-3">
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— No category —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex-1" />
          <button type="button" onClick={onCancel}
            className="text-sm px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <button type="button"
            onClick={() => onSave({ title: title.trim(), description: description.trim(), category: category || undefined })}
            disabled={!title.trim()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
            <Save className="w-3.5 h-3.5" /> Save
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
      </div>
      {editable && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button type="button" onClick={onStartEdit}
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onDelete}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete">
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
}: {
  readonly onClose: () => void;
  readonly onSave: (data: { control_id: string; title: string; description?: string; category?: string }) => void;
  readonly currentFrameworkId: string;
}) {
  const [tab, setTab] = useState<"new" | "import">("new");

  // "Create from scratch" fields
  const [controlId, setControlId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
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
    frameworksApi.getControls(selectedFwId)
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
    setCategory(ctrl.category ?? "");
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
      category: category || undefined,
    });
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h3 className="text-lg font-bold text-gray-900">Add control</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg">
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
            <Plus className="w-3.5 h-3.5" /> Create from scratch
          </button>
          <button
            type="button"
            onClick={() => setTab("import")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === "import" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <Copy className="w-3.5 h-3.5" /> Import from framework
          </button>
        </div>

        {/* Import picker */}
        {tab === "import" && (
          <div className="px-6 pb-4 space-y-3 flex-shrink-0">
            <select
              value={selectedFwId}
              onChange={e => setSelectedFwId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select a framework —</option>
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
                  placeholder="Search controls…"
                  className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {selectedFwId && (
              <div className="border border-gray-200 rounded-lg overflow-y-auto max-h-48">
                {fwLoading ? (
                  <div className="flex items-center justify-center py-6 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-6 text-center text-sm text-gray-400">No controls found</div>
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
                ✓ Selected — edit the fields below before saving
              </p>
            )}
          </div>
        )}

        {/* Form fields (always visible, pre-filled when importing) */}
        <div className="px-6 pb-4 space-y-3 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Control ID *</label>
            <input
              type="text"
              value={controlId}
              onChange={e => setControlId(e.target.value)}
              placeholder="e.g. CC1.1, A.5.1, PR.AC-1"
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Short, descriptive title"
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does this control require?"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— No category —</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button type="button" onClick={onClose}
            className="text-sm px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <button type="submit" disabled={submitting || !controlId.trim() || !title.trim()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add control
          </button>
        </div>
      </form>
    </div>
  );
}
