import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { complianceApi, type ActionPlanItem } from "@/api/endpoints";

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

// ── Card (used both in sortable and in drag overlay) ─────────────────────────
function CardContent({
  item,
  isDragging = false,
  t,
  onNavigate,
  onStatusChange,
}: {
  item: ActionPlanItem;
  isDragging?: boolean;
  t: ReturnType<typeof useTranslation>["t"];
  onNavigate: (id: string) => void;
  onStatusChange?: (id: string, status: string) => void;
}) {
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
              {item.gap_severity}
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
          <span className="text-gray-400 truncate max-w-[160px]" title={item.control_title}>
            {item.control_title}
          </span>
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
              {new Date(item.due_date).toLocaleDateString()}
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
}: {
  item: ActionPlanItem;
  t: ReturnType<typeof useTranslation>["t"];
  onNavigate: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
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
        <CardContent item={item} t={t} onNavigate={onNavigate} onStatusChange={onStatusChange} />
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
}: {
  statusKey: ColKey;
  items: ActionPlanItem[];
  t: ReturnType<typeof useTranslation>["t"];
  onNavigate: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
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
  const [showFilters,     setShowFilters]     = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await complianceApi.listActionPlan());
    } catch {
      setError(t("action_plan.load_error", "Failed to load action plan"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

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

  if (loading) {
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
        <button
          type="button"
          onClick={load}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

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

      {/* Empty state */}
      {total === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
          </div>
          <div>
            <p className="text-gray-700 font-semibold">{t("action_plan.empty_title", "No action items yet")}</p>
            <p className="text-gray-400 text-sm mt-1">{t("action_plan.empty_hint", "Accept gap recommendations inside a compliance assessment to generate action items here.")}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/compliance")}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {t("action_plan.go_to_compliance", "Go to Compliance")}
          </button>
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
