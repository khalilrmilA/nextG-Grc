import { TranslatedText } from "@/components/common/AutoTranslatedBadge";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  closestCorners,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckSquare, AlertTriangle, CheckCircle2, XCircle,
  Loader2, Filter, ChevronDown, ChevronUp, User,
  Calendar, ExternalLink, RotateCcw, Circle, GripVertical, Check,
  Plus, Pencil, Trash2, Paperclip, Upload, Repeat, X, Download, ShieldCheck,
} from "lucide-react";
import { complianceApi, usersApi, type ActionPlanItem, type TenantUserRecord } from "@/api/endpoints";
import type { ActionItemAttachment } from "@/types";

// ── Styles ────────────────────────────────────────────────────────────────────
const PRIORITY_STYLE = {
  critical: { color: "text-red-700",    bg: "bg-red-100",    dot: "bg-red-500"    },
  high:     { color: "text-orange-700", bg: "bg-orange-100", dot: "bg-orange-500" },
  medium:   { color: "text-yellow-700", bg: "bg-yellow-100", dot: "bg-yellow-500" },
  low:      { color: "text-green-700",  bg: "bg-green-100",  dot: "bg-green-500"  },
};

const STATUS_STYLE = {
  open:        { icon: Circle,        color: "text-gray-500",  bg: "bg-gray-100",  border: "border-gray-200"  },
  in_progress: { icon: Loader2,       color: "text-blue-600",  bg: "bg-blue-50",   border: "border-blue-200"  },
  completed:   { icon: CheckCircle2,  color: "text-green-600", bg: "bg-green-50",  border: "border-green-200" },
  cancelled:   { icon: XCircle,       color: "text-gray-400",  bg: "bg-gray-50",   border: "border-gray-200"  },
};

const SEV_COLOR: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high:     "bg-orange-100 text-orange-700",
  medium:   "bg-yellow-100 text-yellow-700",
  low:      "bg-gray-100 text-gray-600",
};

const COLUMNS = ["open", "in_progress", "completed", "cancelled"] as const;
type ColKey = typeof COLUMNS[number];

function isOverdue(d?: string | null) {
  return !!d && new Date(d) < new Date();
}

function saveBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

const ACTION_TYPES = ["corrective", "preventive"] as const;
type ActionType = typeof ACTION_TYPES[number];

/** The backend accepts exactly these four (ACTION_RECURRENCES in compliance.py);
 *  anything else is a 422, so this is a picker and never a free-text field. */
export const ACTION_RECURRENCES = ["monthly", "quarterly", "semiannual", "annual"] as const;

// ── Create / edit an action ───────────────────────────────────────────────────
// « Plan d'actions correctives ET préventives » — a preventive action has no
// gap behind it and could not be planned anywhere before POST /action-plan
// existed. start_date had schema support and no writer either.

interface ActionDraft {
  title: string;
  description: string;
  actionType: ActionType;
  priority: string;
  status: string;
  ownerId: string;
  startDate: string;
  dueDate: string;
  recurrence: string;
  notes: string;
}

function draftFrom(item: ActionPlanItem | null): ActionDraft {
  return {
    title: item?.title ?? "",
    description: item?.description ?? "",
    actionType: (item?.action_type === "preventive" ? "preventive" : "corrective"),
    priority: item?.priority ?? "medium",
    status: item?.status ?? "open",
    ownerId: item?.owner_id ?? "",
    startDate: (item?.start_date ?? "").slice(0, 10),
    dueDate: (item?.due_date ?? "").slice(0, 10),
    recurrence: item?.recurrence ?? "",
    notes: item?.notes ?? "",
  };
}

function ActionItemModal({
  item,
  users,
  onClose,
  onSaved,
}: {
  readonly item: ActionPlanItem | null;
  readonly users: TenantUserRecord[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ActionDraft>(() => draftFrom(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const datesInvalid =
    !!draft.startDate && !!draft.dueDate && new Date(draft.dueDate) < new Date(draft.startDate);

  const fieldCls =
    "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) { setError(t("action_plan.error_title_required")); return; }
    if (datesInvalid) { setError(t("action_plan.dates_invalid")); return; }
    setSaving(true);
    setError("");
    try {
      const recurrence = draft.actionType === "preventive" ? draft.recurrence : "";
      if (item) {
        // PATCH treats null as "leave alone" and "" as "clear it" (`body.x or
        // None` on the server), so an emptied field has to travel as "" or the
        // user can never unset a date, an owner or a recurrence.
        await complianceApi.updateActionPlanItem(item.id, {
          title: draft.title.trim(),
          description: draft.description.trim(),
          notes: draft.notes.trim(),
          owner_id: draft.ownerId,
          start_date: draft.startDate,
          due_date: draft.dueDate,
          priority: draft.priority,
          status: draft.status,
          action_type: draft.actionType,
          recurrence,
        });
      } else {
        await complianceApi.createActionPlanItem({
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          notes: draft.notes.trim() || null,
          owner_id: draft.ownerId || null,
          start_date: draft.startDate || null,
          due_date: draft.dueDate || null,
          priority: draft.priority,
          status: draft.status,
          action_type: draft.actionType,
          recurrence: recurrence || null,
        });
      }
      onSaved();
    } catch {
      setError(t("action_plan.error_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {item ? t("action_plan.edit_action") : t("action_plan.new_action")}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title={t("common.close")}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ap-title">
              {t("action_plan.action_title")} *
            </label>
            <input
              id="ap-title"
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={t("action_plan.action_title_placeholder")}
              className={fieldCls}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("action_plan.action_type")}</label>
            <div className="flex gap-2">
              {ACTION_TYPES.map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setDraft({ ...draft, actionType: tp })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    draft.actionType === tp
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {t(`action_plan.action_types.${tp}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">{t("action_plan.action_type_hint")}</p>
          </div>

          {draft.actionType === "preventive" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ap-recurrence">
                {t("action_plan.recurrence")}
              </label>
              <select
                id="ap-recurrence"
                value={draft.recurrence}
                onChange={(e) => setDraft({ ...draft, recurrence: e.target.value })}
                className={fieldCls}
              >
                <option value="">{t("common.none")}</option>
                {ACTION_RECURRENCES.map((r) => (
                  <option key={r} value={r}>
                    {t(`action_plan.recurrences.${r}`, {
                      defaultValue: r.charAt(0).toUpperCase() + r.slice(1),
                    })}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">{t("action_plan.recurrence_hint")}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ap-owner">
                {t("action_plan.owner")}
              </label>
              <select
                id="ap-owner"
                value={draft.ownerId}
                onChange={(e) => setDraft({ ...draft, ownerId: e.target.value })}
                className={fieldCls}
              >
                <option value="">{t("action_plan.select_owner")}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {`${u.first_name} ${u.last_name}`.trim() || u.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ap-priority">
                {t("action_plan.priority")}
              </label>
              <select
                id="ap-priority"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                className={fieldCls}
              >
                <option value="critical">{t("action_plan.priority_critical")}</option>
                <option value="high">{t("action_plan.priority_high")}</option>
                <option value="medium">{t("action_plan.priority_medium")}</option>
                <option value="low">{t("action_plan.priority_low")}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ap-start">
                {t("action_plan.start_date")}
              </label>
              <input
                id="ap-start"
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                className={fieldCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ap-due">
                {t("action_plan.end_date")}
              </label>
              <input
                id="ap-due"
                type="date"
                value={draft.dueDate}
                onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                className={fieldCls}
              />
            </div>
          </div>
          {datesInvalid && <p className="text-xs text-red-600">{t("action_plan.dates_invalid")}</p>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ap-status">
              {t("common.status")}
            </label>
            <select
              id="ap-status"
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              className={fieldCls}
            >
              <option value="open">{t("action_plan.status_todo")}</option>
              <option value="in_progress">{t("action_plan.status_in_progress")}</option>
              <option value="completed">{t("action_plan.status_done")}</option>
              <option value="cancelled">{t("action_plan.status_cancelled")}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ap-desc">
              {t("action_plan.action_description")}
            </label>
            <textarea
              id="ap-desc"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder={t("action_plan.action_description_placeholder")}
              className={`${fieldCls} resize-none`}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ap-notes">
              {t("common.notes")}
            </label>
            <textarea
              id="ap-notes"
              rows={2}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className={`${fieldCls} resize-none`}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || !draft.title.trim()}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Pièces justificatives ─────────────────────────────────────────────────────
// Proof the action was actually carried out: upload, list, download, remove.

function AttachmentsModal({
  item,
  onClose,
}: {
  readonly item: ActionPlanItem;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<ActionItemAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    complianceApi.listActionAttachments(item.id)
      .then(setFiles)
      .catch(() => setError(t("action_plan.attachment_load_failed", "The supporting documents could not be loaded.")))
      .finally(() => setLoading(false));
  }, [item.id, t]);

  useEffect(() => { load(); }, [load]);

  async function upload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setError("");
    for (const file of Array.from(fileList)) {
      try {
        const created = await complianceApi.uploadActionAttachment(item.id, file);
        setFiles((prev) => [...prev, created]);
      } catch {
        setError(t("action_plan.attachment_upload_failed"));
      }
    }
    setBusy(false);
  }

  async function download(att: ActionItemAttachment) {
    setError("");
    try {
      const blob = await complianceApi.downloadActionAttachment(att.id);
      saveBlob(blob, att.file_name || att.name || "attachment");
    } catch {
      setError(t("action_plan.attachment_load_failed", "The supporting documents could not be loaded."));
    }
  }

  async function remove(att: ActionItemAttachment) {
    if (!window.confirm(t("action_plan.attachment_delete_confirm"))) return;
    setError("");
    try {
      await complianceApi.deleteActionAttachment(att.id);
      setFiles((prev) => prev.filter((f) => f.id !== att.id));
    } catch {
      // Not attachment_upload_failed ("the document could not be attached") —
      // that describes the opposite operation and told the user the wrong thing.
      setError(t("common.error_generic"));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">{t("action_plan.attachments")}</h2>
            <p className="text-xs text-gray-400 truncate">{item.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title={t("common.close")}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(e) => { upload(e.target.files); e.target.value = ""; }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-2 w-full justify-center border-2 border-dashed border-indigo-200 rounded-xl py-4 text-sm text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {t("action_plan.add_attachment")}
        </button>

        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-indigo-400" /></div>
          ) : files.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t("action_plan.no_attachments")}</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">
                {t(
                  files.length === 1 ? "action_plan.attachments_count_one" : "action_plan.attachments_count_other",
                  { count: files.length },
                )}
              </p>
              <div className="border border-gray-100 rounded-xl divide-y divide-gray-50">
                {files.map((att) => (
                  <div key={att.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Paperclip className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-gray-700">{att.file_name || att.name}</span>
                    <button
                      type="button"
                      onClick={() => download(att)}
                      title={t("action_plan.attachment_download")}
                      className="text-indigo-500 hover:text-indigo-700"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(att)}
                      title={t("action_plan.attachment_delete")}
                      className="text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Card (used both in sortable and in drag overlay) ─────────────────────────
function CardContent({
  item,
  isDragging = false,
  t,
  onNavigate,
  onStatusChange,
  onEdit,
  onDelete,
  onAttachments,
}: {
  item: ActionPlanItem;
  isDragging?: boolean;
  t: ReturnType<typeof useTranslation>["t"];
  onNavigate: (id: string) => void;
  onStatusChange?: (id: string, status: string) => void;
  onEdit?: (item: ActionPlanItem) => void;
  onDelete?: (item: ActionPlanItem) => void;
  onAttachments?: (item: ActionPlanItem) => void;
}) {
  const { i18n } = useTranslation();
  const pStyle  = PRIORITY_STYLE[item.priority as keyof typeof PRIORITY_STYLE] ?? PRIORITY_STYLE.medium;
  const overdue = isOverdue(item.due_date) && item.status !== "completed";

  const STATUS_LABELS: Record<string, string> = {
    open:        t("action_plan.status_todo", "To Do"),
    in_progress: t("action_plan.status_in_progress", "In Progress"),
    completed:   t("action_plan.status_done", "Done"),
    cancelled:   t("action_plan.status_cancelled", "Cancelled"),
  };
  const PRIORITY_LABELS: Record<string, string> = {
    critical: t("action_plan.priority_critical", "Critical"),
    high:     t("action_plan.priority_high", "High"),
    medium:   t("action_plan.priority_medium", "Medium"),
    low:      t("action_plan.priority_low", "Low"),
  };

  return (
    <div className={`bg-white rounded-xl border shadow-sm p-4 flex flex-col gap-3
      ${item.status === "completed" ? "opacity-60" : ""}
      ${overdue ? "border-red-200" : "border-gray-100"}
      ${isDragging ? "ring-2 ring-indigo-400 shadow-xl rotate-1 scale-105" : "hover:shadow-md"}
      transition-all`}
    >
      {/* Drag handle + priority + blocker */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0 cursor-grab active:cursor-grabbing" />
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${pStyle.bg} ${pStyle.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${pStyle.dot}`} />
            {PRIORITY_LABELS[item.priority] ?? item.priority}
          </span>
          {item.is_certification_blocker && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
              {t("action_plan.blocker", "BLOCKER")}
            </span>
          )}
          {item.gap_severity && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${SEV_COLOR[item.gap_severity] ?? "bg-gray-100 text-gray-600"}`}>
              {t(`compliance.severities.${item.gap_severity}`, { defaultValue: item.gap_severity })}
            </span>
          )}
        </div>
        {/* Current status badge */}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[item.status as ColKey]?.bg ?? ""} ${STATUS_STYLE[item.status as ColKey]?.color ?? ""} ${STATUS_STYLE[item.status as ColKey]?.border ?? ""}`}>
          {STATUS_LABELS[item.status] ?? item.status}
        </span>
      </div>

      {/* Title */}
      <div>
        <p className={`text-sm font-semibold text-gray-900 leading-snug ${item.status === "completed" ? "line-through text-gray-400" : ""}`}>
          {item.title}
        </p>
        {item.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</p>
        )}
      </div>

      {/* Tags */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span
          className={`px-1.5 py-0.5 rounded font-semibold border ${
            item.action_type === "preventive"
              ? "bg-teal-50 text-teal-700 border-teal-100"
              : "bg-amber-50 text-amber-700 border-amber-100"
          }`}
          title={t("action_plan.action_type")}
        >
          {t(`action_plan.action_types.${item.action_type === "preventive" ? "preventive" : "corrective"}`)}
        </span>
        {item.recurrence && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 border border-teal-100" title={t("action_plan.recurrence")}>
            <Repeat className="w-2.5 h-2.5" />
            {t(`action_plan.recurrences.${item.recurrence}`, { defaultValue: item.recurrence })}
          </span>
        )}
        {item.gap_resolved && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-100" title={t("action_plan.gap_resolved_hint")}>
            <ShieldCheck className="w-2.5 h-2.5" />
            {t("action_plan.gap_resolved")}
          </span>
        )}
        {item.framework_short_name && (
          <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-semibold border border-indigo-100">
            {item.framework_short_name}
          </span>
        )}
        {item.control_identifier && (
          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-mono font-semibold">
            {item.control_identifier}
          </span>
        )}
        {item.control_title && (
          <TranslatedText item={item} field="control_title" className="text-gray-400 truncate max-w-[160px]" />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400 border-t border-gray-50 pt-2">
        <div className="flex items-center gap-3">
          {item.owner_name && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {item.owner_name}
            </span>
          )}
          {item.due_date && (
            <span className={`flex items-center gap-1 ${overdue ? "text-red-500 font-semibold" : ""}`}>
              {overdue && <AlertTriangle className="w-3 h-3" />}
              <Calendar className="w-3 h-3" />
              {new Date(item.due_date).toLocaleDateString(i18n.language?.startsWith("fr") ? "fr-FR" : i18n.language?.startsWith("ar") ? "ar-u-nu-latn" : "en-GB")}
              {overdue && ` ${t("action_plan.overdue_label", "(Overdue)")}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {item.assessment_id && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onNavigate(item.assessment_id!); }}
              className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700 transition-colors px-1.5 py-1 rounded"
            >
              <ExternalLink className="w-3 h-3" />
              <span className="truncate max-w-[80px]">{item.assessment_name}</span>
            </button>
          )}
          {!isDragging && onAttachments && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAttachments(item); }}
              title={t("action_plan.attachments")}
              className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
          )}
          {!isDragging && onEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(item); }}
              title={t("action_plan.edit_action")}
              className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {!isDragging && onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(item); }}
              title={t("action_plan.delete_action")}
              className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Quick status buttons — only shown when not dragging */}
          {!isDragging && onStatusChange && item.status !== "completed" && item.status !== "cancelled" && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStatusChange(item.id, "completed"); }}
              title={t("action_plan.mark_done", "Mark as Done")}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 transition-colors"
            >
              <Check className="w-3 h-3" />
              {t("action_plan.done", "Done")}
            </button>
          )}
          {!isDragging && onStatusChange && item.status === "open" && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStatusChange(item.id, "in_progress"); }}
              title={t("action_plan.mark_in_progress", "Start")}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors"
            >
              <Loader2 className="w-3 h-3" />
              {t("action_plan.start", "Start")}
            </button>
          )}
          {!isDragging && onStatusChange && item.status === "completed" && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStatusChange(item.id, "open"); }}
              title={t("action_plan.reopen", "Reopen")}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              {t("action_plan.reopen", "Reopen")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sortable card wrapper ─────────────────────────────────────────────────────
function SortableCard({
  item,
  t,
  onNavigate,
  onStatusChange,
  onEdit,
  onDelete,
  onAttachments,
}: {
  item: ActionPlanItem;
  t: ReturnType<typeof useTranslation>["t"];
  onNavigate: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (item: ActionPlanItem) => void;
  onDelete: (item: ActionPlanItem) => void;
  onAttachments: (item: ActionPlanItem) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {/* Only the grip handle triggers drag, rest of card is interactive */}
      <div className="relative">
        <div
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="absolute top-4 left-4 z-10 cursor-grab active:cursor-grabbing touch-none"
          style={{ width: 16, height: 16 }}
        />
        <CardContent
          item={item}
          t={t}
          onNavigate={onNavigate}
          onStatusChange={onStatusChange}
          onEdit={onEdit}
          onDelete={onDelete}
          onAttachments={onAttachments}
        />
      </div>
    </div>
  );
}

// ── Kanban column ─────────────────────────────────────────────────────────────
function KanbanColumn({
  statusKey,
  items,
  t,
  onNavigate,
  onStatusChange,
  onEdit,
  onDelete,
  onAttachments,
}: {
  statusKey: ColKey;
  items: ActionPlanItem[];
  t: ReturnType<typeof useTranslation>["t"];
  onNavigate: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onEdit: (item: ActionPlanItem) => void;
  onDelete: (item: ActionPlanItem) => void;
  onAttachments: (item: ActionPlanItem) => void;
}) {
  const cfg = STATUS_STYLE[statusKey];
  const Icon = cfg.icon;

  // Make the column itself a drop target (needed for empty columns)
  const { setNodeRef, isOver } = useDroppable({ id: statusKey });

  const STATUS_LABELS: Record<string, string> = {
    open:        t("action_plan.status_todo", "To Do"),
    in_progress: t("action_plan.status_in_progress", "In Progress"),
    completed:   t("action_plan.status_done", "Done"),
    cancelled:   t("action_plan.status_cancelled", "Cancelled"),
  };

  return (
    <div className={`flex flex-col gap-3 min-w-0 rounded-2xl p-2 transition-all
      ${isOver ? "bg-indigo-50/60 ring-2 ring-indigo-300 ring-dashed" : ""}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${cfg.bg} border ${cfg.border}`}>
        <Icon className={`w-4 h-4 ${cfg.color}`} />
        <span className={`text-sm font-bold ${cfg.color}`}>{STATUS_LABELS[statusKey]}</span>
        <span className="ml-auto text-xs font-semibold text-gray-500 bg-white/70 px-1.5 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>

      {/* Drop zone + cards */}
      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex flex-col gap-2 min-h-[100px] rounded-xl transition-colors
            ${isOver ? "bg-indigo-50/40" : ""}`}
        >
          {items.length === 0 ? (
            <div className={`text-xs text-center py-10 border-2 border-dashed rounded-xl transition-all
              ${isOver ? "border-indigo-400 text-indigo-500 bg-indigo-50/60 scale-[1.01]" : "border-gray-100 text-gray-300"}`}>
              {isOver
                ? t("action_plan.drop_here", "Drop here")
                : t("action_plan.no_items", "No items")}
            </div>
          ) : (
            items.map((item) => (
              <SortableCard
                key={item.id}
                item={item}
                t={t}
                onNavigate={onNavigate}
                onStatusChange={onStatusChange}
                onEdit={onEdit}
                onDelete={onDelete}
                onAttachments={onAttachments}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ActionPlanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [items, setItems]       = useState<ActionPlanItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [activeItem, setActiveItem] = useState<ActionPlanItem | null>(null);

  // Filters
  const [filterPriority,  setFilterPriority]  = useState("all");
  const [filterFramework, setFilterFramework] = useState("all");
  const [filterType,      setFilterType]      = useState("all");
  const [showFilters,     setShowFilters]     = useState(false);

  // Create / edit / attachments
  const [users, setUsers] = useState<TenantUserRecord[]>([]);
  const [editing, setEditing] = useState<ActionPlanItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [attachmentsFor, setAttachmentsFor] = useState<ActionPlanItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // The full-page spinner belongs to the FIRST load only. Changing the nature
  // filter refetches server-side, and blanking the whole screen for it tore the
  // board and the filter panel out from under the user mid-interaction.
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // « corrective / préventive » is filtered by the server so a preventive
      // action with no gap behind it is never hidden by a client-side rule.
      setItems(
        filterType === "all"
          ? await complianceApi.listActionPlan()
          : await complianceApi.listActionPlanFiltered({ action_type: filterType }),
      );
    } catch {
      setError(t("action_plan.load_error", "Failed to load action plan"));
    } finally {
      setLoading(false);
      firstLoad.current = false;
    }
  }, [t, filterType]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    usersApi.list()
      .then((list) => { if (alive) setUsers(list.filter((u) => u.is_active)); })
      .catch(() => { /* the owner picker degrades to "unassigned" */ });
    return () => { alive = false; };
  }, []);

  async function handleDelete(item: ActionPlanItem) {
    if (!window.confirm(t("action_plan.delete_confirm"))) return;
    setError("");
    try {
      await complianceApi.deleteActionPlanItem(item.id);
      setItems((all) => all.filter((i) => i.id !== item.id));
    } catch {
      setError(t("action_plan.error_delete_failed", "The action could not be deleted. Nothing was changed."));
    }
  }

  // ── DnD handlers ────────────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    setActiveItem(items.find(i => i.id === event.active.id) ?? null);
  }

  function handleDragOver(_event: DragOverEvent) {
    // Column highlight is now handled by useDroppable's isOver inside KanbanColumn
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    const { active, over } = event;
    if (!over) return;

    // over.id is either a column key (from useDroppable) or a card id (from useSortable)
    const targetCol: ColKey | undefined = COLUMNS.includes(over.id as ColKey)
      ? (over.id as ColKey)
      : (items.find(i => i.id === over.id)?.status as ColKey | undefined);

    if (!targetCol) return;
    const draggedItem = items.find(i => i.id === active.id);
    if (!draggedItem || draggedItem.status === targetCol) return;

    await handleStatusChange(draggedItem.id, targetCol);
  }

  async function handleStatusChange(id: string, newStatus: string) {
    const prev = items.find(i => i.id === id);
    if (!prev) return;
    // Optimistic update
    setItems(all => all.map(i => i.id === id ? { ...i, status: newStatus as ActionPlanItem["status"] } : i));
    try {
      await complianceApi.updateActionPlanItem(id, { status: newStatus });
    } catch {
      setItems(all => all.map(i => i.id === id ? { ...i, status: prev.status } : i));
    }
  }

  // ── Stats ────────────────────────────────────────────────────────────────────
  const total    = items.length;
  const open     = items.filter(i => i.status === "open").length;
  const inProg   = items.filter(i => i.status === "in_progress").length;
  const done     = items.filter(i => i.status === "completed").length;
  const blockers = items.filter(i => i.is_certification_blocker && i.status !== "completed").length;
  const overdueN = items.filter(i => isOverdue(i.due_date) && i.status !== "completed").length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // ── Filters ──────────────────────────────────────────────────────────────────
  const frameworks = [...new Set(items.map(i => i.framework_short_name).filter(Boolean))] as string[];

  const columns: { key: ColKey; items: ActionPlanItem[] }[] = COLUMNS.map(key => ({
    key,
    items: items.filter(i => {
      if (i.status !== key) return false;
      if (filterPriority  !== "all" && i.priority            !== filterPriority)  return false;
      if (filterFramework !== "all" && i.framework_short_name !== filterFramework) return false;
      return true;
    }),
  }));

  if (loading && firstLoad.current) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-indigo-600" />
            {t("action_plan.page_title", "Compliance Action Plan")}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {t("action_plan.page_subtitle", "Prioritized to-do list generated from all open compliance gaps")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("action_plan.new_action")}
          </button>
          <button
            type="button"
            onClick={load}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title={t("common.refresh")}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {(creating || editing) && (
        <ActionItemModal
          item={editing}
          users={users}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}

      {attachmentsFor && (
        <AttachmentsModal item={attachmentsFor} onClose={() => setAttachmentsFor(null)} />
      )}

      {error && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: t("action_plan.total",       "Total"),       value: total,    color: "text-gray-900",   border: "border-gray-200"   },
          { label: t("action_plan.todo",         "To Do"),       value: open,     color: "text-gray-600",   border: "border-gray-200"   },
          { label: t("action_plan.in_progress",  "In Progress"), value: inProg,   color: "text-blue-600",   border: "border-blue-200"   },
          { label: t("action_plan.done",         "Done"),        value: done,     color: "text-green-600",  border: "border-green-200"  },
          { label: t("action_plan.blockers",     "Blockers"),    value: blockers, color: "text-red-600",    border: "border-red-200"    },
          { label: t("action_plan.overdue",      "Overdue"),     value: overdueN, color: "text-orange-600", border: "border-orange-200" },
        ].map(({ label, value, color, border }) => (
          <div key={label} className={`bg-white rounded-xl border ${border} p-4 text-center shadow-sm`}>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-semibold text-gray-700">{t("action_plan.overall_progress", "Overall Progress")}</span>
            <span className="font-bold text-indigo-600">{progress}%</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-green-400 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-400">
            <span className="text-green-600 font-medium">{done} {t("action_plan.done_label", "done")}</span>
            <span className="text-blue-500 font-medium">{inProg} {t("action_plan.in_progress_label", "in progress")}</span>
            <span className="text-gray-500">{open} {t("action_plan.todo_label", "to do")}</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {loading && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors ml-auto"
        >
          <Filter className="w-3.5 h-3.5" />
          {t("action_plan.filters", "Filters")}
          {showFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {showFilters && (
        <div className="flex gap-3 flex-wrap bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
              {t("action_plan.priority", "Priority")}
            </label>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="all">{t("action_plan.all_priorities", "All")}</option>
              <option value="critical">{t("action_plan.priority_critical", "Critical")}</option>
              <option value="high">{t("action_plan.priority_high", "High")}</option>
              <option value="medium">{t("action_plan.priority_medium", "Medium")}</option>
              <option value="low">{t("action_plan.priority_low", "Low")}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide" htmlFor="ap-filter-type">
              {t("action_plan.filter_action_type")}
            </label>
            <select
              id="ap-filter-type"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="all">{t("action_plan.all_action_types")}</option>
              <option value="corrective">{t("action_plan.action_types.corrective")}</option>
              <option value="preventive">{t("action_plan.action_types.preventive")}</option>
            </select>
          </div>
          {frameworks.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                {t("action_plan.framework", "Framework")}
              </label>
              <select
                value={filterFramework}
                onChange={(e) => setFilterFramework(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="all">{t("action_plan.all_frameworks", "All frameworks")}</option>
                {frameworks.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Empty state — never while a filter refetch is still in flight, or the
          board flashes « aucune action » between two populated results. */}
      {total === 0 && !loading ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
          </div>
          <div>
            <p className="text-gray-700 font-semibold">{t("action_plan.empty_title", "No action items yet")}</p>
            <p className="text-gray-400 text-sm mt-1">{t("action_plan.empty_hint", "Accept gap recommendations inside a compliance assessment to generate action items here.")}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("action_plan.new_action")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/compliance")}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              {t("action_plan.go_to_compliance", "Go to Compliance")}
            </button>
          </div>
        </div>
      ) : (
        /* Drag-and-drop Kanban */
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
            {columns.map(({ key, items: colItems }) => (
              <KanbanColumn
                key={key}
                statusKey={key}
                items={colItems}
                t={t}
                onNavigate={(aid) => navigate(`/compliance/${aid}`)}
                onStatusChange={handleStatusChange}
                onEdit={setEditing}
                onDelete={handleDelete}
                onAttachments={setAttachmentsFor}
              />
            ))}
          </div>

          {/* Drag overlay — ghost card that follows the cursor */}
          <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
            {activeItem && (
              <div className="w-72 rotate-2">
                <CardContent item={activeItem} isDragging t={t} onNavigate={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
