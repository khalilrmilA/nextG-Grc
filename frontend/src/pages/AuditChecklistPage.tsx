import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft, Loader2, FileText, Eye, Upload, Download,
  ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Clock, MinusCircle,
  MessageSquare, Plus, X, Grid3x3, ListChecks, Paperclip, ShieldAlert, Lock,
} from "lucide-react";
import {
  auditorPortalApi, auditCommentsApi, complianceApi,
  type AuditChecklistControl, type AuditChecklistDocument, type AuditChecklistLinkedDoc,
} from "@/api/endpoints";
import type {
  AuditorVerdictScale, AuditorGridPayload, AuditorGridRow,
  ComplianceScaleLevel, AuditComment, AuditCommentThread,
  AuditFinding, AuditEvidence,
} from "@/types";
import DocumentViewerModal, { type ViewableDoc } from "@/components/features/compliance/DocumentViewerModal";

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** The four legacy verdict tokens the backend still accepts on control rows.
 *  A tenant scale replaces them, but rows recorded before it exists still carry
 *  them, so they need a label of their own. */
const LEGACY_VERDICT_KEY: Record<string, string> = {
  verified:    "audits.verified",
  finding:     "audits.finding",
  observation: "audits.observation",
  na:          "audits.not_applicable",
};

const STATUS_CFG: Record<string, { key: string; cls: string; icon: typeof CheckCircle2 }> = {
  implemented:           { key: "compliance.status_options.implemented",           cls: "text-green-700 bg-green-50 border-green-200",     icon: CheckCircle2 },
  partially_implemented: { key: "compliance.status_options.partially_implemented", cls: "text-yellow-700 bg-yellow-50 border-yellow-200",  icon: AlertCircle  },
  not_implemented:       { key: "compliance.status_options.not_implemented",       cls: "text-red-700 bg-red-50 border-red-200",           icon: AlertCircle  },
  not_applicable:        { key: "compliance.status_options.not_applicable",        cls: "text-gray-500 bg-gray-50 border-gray-200",        icon: MinusCircle  },
  not_started:           { key: "compliance.status_options.not_started",           cls: "text-gray-400 bg-gray-50 border-gray-200",        icon: Clock        },
  in_progress:           { key: "compliance.status_options.in_progress",           cls: "text-blue-700 bg-blue-50 border-blue-200",        icon: Clock        },
};

const SEVERITIES = ["critical", "high", "medium", "low", "observation"] as const;
const SEVERITY_KEY: Record<string, string> = {
  critical:    "audits.finding_critical",
  high:        "audits.finding_high",
  medium:      "audits.finding_medium",
  low:         "audits.finding_low",
  observation: "audits.finding_observation",
};
const FINDING_TYPES = ["nonconformity_major", "nonconformity_minor", "observation", "improvement"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A conformity level is DATA: the tenant owns its wording, so the label comes
 *  from the level itself and never from a locale key. */
function levelLabel(level: ComplianceScaleLevel, lang: string): string {
  const picked = lang.startsWith("fr") ? level.label_fr
    : lang.startsWith("ar") ? level.label_ar
    : level.label_en;
  return (picked || level.label_en || level.label_fr || level.label_ar || level.key) as string;
}

/** i18next asks Intl.PluralRules for the category, and Arabic has six of them
 *  (zero/one/two/few/many/other) while the locale files define only `_one` and
 *  `_other`. A count of 2, 3 or 11 therefore resolves nothing in Arabic and
 *  falls back to the ENGLISH string. Naming the defined form keeps the sentence
 *  in the reader's language, which is the whole point of the clause. */
function pluralKey(base: string, count: number): string {
  return count === 1 ? `${base}_one` : `${base}_other`;
}

function levelByKey(levels: ComplianceScaleLevel[], key: string | null | undefined) {
  if (!key) return undefined;
  return levels.find((l) => l.key === key);
}

/** The row's own colour, kept subtle enough to sit inside the card. */
function levelChipStyle(level: ComplianceScaleLevel | undefined, active: boolean): React.CSSProperties {
  if (!level?.color) return {};
  return active
    ? { backgroundColor: `${level.color}1a`, borderColor: level.color, color: level.color }
    : { borderColor: `${level.color}55` };
}

type ChecklistControlRow = AuditChecklistControl & {
  auditor_verdict?: string | null;
  auditor_note?: string | null;
  auditor_verdict_at?: string | null;
  status_key?: string | null;
};

/** The two extra keys the backend adds to the legacy assessment checklist. The
 *  shipped `AuditChecklist` type predates them, so they are read through a cast
 *  rather than by changing a file this lane does not own. */
type LegacyChecklistExtras = {
  audit_id?: string | null;
  verdict_scale?: AuditorVerdictScale;
  grid?: AuditorGridPayload | null;
};

function docToViewable(doc: AuditChecklistDocument, subtitle: string | null): ViewableDoc {
  return {
    id: doc.id,
    fileName: doc.file_name,
    contentType: doc.content_type,
    fileSizeBytes: doc.file_size_bytes,
    subtitle,
    fetchUrl: doc.is_evidence ? complianceApi.downloadEvidenceUrl(doc.id) : complianceApi.downloadDocumentUrl(doc.id),
  };
}

function linkedDocToViewable(doc: AuditChecklistLinkedDoc, subtitle: string | null): ViewableDoc {
  return {
    id: doc.id,
    fileName: doc.file_name,
    contentType: doc.content_type,
    fileSizeBytes: doc.file_size_bytes,
    subtitle,
    fetchUrl: doc.is_evidence ? complianceApi.downloadEvidenceUrl(doc.id) : complianceApi.downloadDocumentUrl(doc.id),
  };
}

/** The HTTP status behind a rejected api call, when there is one. A 403 here is
 *  not a failure to save — it is "you were not appointed to this", and saying so
 *  is the difference between a bug report and an assignment request. */
function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | undefined)?.response?.status;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// ─── Contradictory exchange, one thread per anchor ────────────────────────────

type CommentAnchor = { audit_id?: string; finding_id?: string; control_assessment_id?: string };

function CommentThread({ anchor }: { readonly anchor: CommentAnchor }) {
  const { t, i18n } = useTranslation();
  const [thread, setThread]   = useState<AuditCommentThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [body, setBody]       = useState("");
  const [internal, setInternal] = useState(false);
  const [posting, setPosting] = useState(false);
  const [err, setErr]         = useState("");

  const anchorKey = `${anchor.audit_id ?? ""}|${anchor.finding_id ?? ""}|${anchor.control_assessment_id ?? ""}`;

  const reload = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setThread(await auditCommentsApi.list({ ...anchor, limit: 50 }));
    } catch (e) {
      setErr(httpStatus(e) === 403 ? t("errors.unauthorized") : t("audit_comments.load_error"));
      setThread(null);
    } finally {
      setLoading(false);
    }
    // anchorKey is the stable identity of `anchor`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);

  useEffect(() => { reload(); }, [reload]);

  async function post() {
    const text = body.trim();
    if (!text) { setErr(t("audit_comments.error_empty")); return; }
    setPosting(true);
    setErr("");
    try {
      await auditCommentsApi.create({ ...anchor, body: text, is_internal: internal });
      setBody("");
      setInternal(false);
      await reload();
    } catch (e) {
      setErr(httpStatus(e) === 403 ? t("errors.unauthorized") : t("audit_comments.error_post_failed"));
    } finally {
      setPosting(false);
    }
  }

  function fmt(value: string) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString(i18n.language);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5" />
        {t("audit_comments.title")}
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {!loading && thread && thread.items.length === 0 && (
        <div className="py-3">
          <p className="text-xs text-gray-400">{t("audit_comments.no_comments")}</p>
          <p className="text-xs text-gray-300 mt-0.5">{t("audit_comments.no_comments_hint")}</p>
        </div>
      )}

      {!loading && thread && thread.items.length > 0 && (
        <ul className="space-y-2.5 mb-3">
          {thread.items.map((c: AuditComment) => (
            <li key={c.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-gray-700">{c.author_name ?? c.author_email ?? ""}</span>
                <span className="text-xs text-gray-400">{fmt(c.created_at)}</span>
                {c.is_internal ? (
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-200 text-slate-700">
                    {t("audit_comments.internal_badge")}
                  </span>
                ) : (
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700">
                    {t("audit_comments.shared_badge")}
                  </span>
                )}
                {c.edited_at && <span className="text-xs text-gray-300">{t("audit_comments.edited")}</span>}
              </div>
              <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                {c.is_deleted ? t("common.none") : c.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

      {thread && (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder={t("audit_comments.placeholder")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            {thread.viewer_is_audit_team && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(e) => setInternal(e.target.checked)}
                  className="rounded border-gray-300"
                />
                {t("audit_comments.visibility_internal")}
              </label>
            )}
            <button
              type="button"
              onClick={post}
              disabled={posting || !body.trim()}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            >
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
              {posting ? t("audit_comments.posting") : t("audit_comments.post")}
            </button>
            <span className="text-xs text-gray-400">{t("audit_comments.visibility_hint")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabKey = "checklist" | "findings" | "evidence" | "documents" | "exchanges";

export default function AuditChecklistPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { auditId, assessmentId } = useParams<{ auditId?: string; assessmentId?: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [tab, setTab]         = useState<TabKey>("checklist");

  const [title, setTitle]           = useState("");
  const [engagementId, setEngagementId] = useState<string | null>(null);
  const [scale, setScale]           = useState<AuditorVerdictScale | null>(null);
  const [grid, setGrid]             = useState<AuditorGridPayload | null>(null);
  const [controls, setControls]     = useState<ChecklistControlRow[]>([]);
  const [documents, setDocuments]   = useState<AuditChecklistDocument[]>([]);

  const [findings, setFindings]     = useState<AuditFinding[]>([]);
  const [evidence, setEvidence]     = useState<AuditEvidence[]>([]);

  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [viewingDoc, setViewingDoc] = useState<ViewableDoc | null>(null);

  // Draft answers, keyed by grid item id or control assessment id.
  const [draftVerdict, setDraftVerdict] = useState<Record<string, string | null>>({});
  const [draftNote, setDraftNote]       = useState<Record<string, string>>({});
  const [savingRow, setSavingRow]       = useState<string | null>(null);
  const [savedRow, setSavedRow]         = useState<string | null>(null);
  const [rowError, setRowError]         = useState<Record<string, string>>({});

  // Evidence upload
  const [dragOver, setDragOver]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState("");

  // New finding
  const [showFinding, setShowFinding]   = useState(false);
  const [findingSaving, setFindingSaving] = useState(false);
  const [findingError, setFindingError] = useState("");
  const [findingForm, setFindingForm]   = useState({
    title: "", description: "", severity: "medium",
    finding_type: "nonconformity_minor", recommendation: "", due_date: "",
  });

  const levels: ComplianceScaleLevel[] = useMemo(() => scale?.levels ?? [], [scale]);

  const loadWorkspace = useCallback(async (id: string) => {
    const [f, e] = await Promise.allSettled([
      auditorPortalApi.listEngagementFindings(id),
      auditorPortalApi.listEngagementEvidence(id),
    ]);
    if (f.status === "fulfilled") setFindings(Array.isArray(f.value) ? f.value : []);
    if (e.status === "fulfilled") setEvidence(Array.isArray(e.value) ? e.value : []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let effectiveAudit: string | null = null;
      let rows: ChecklistControlRow[] = [];

      if (auditId) {
        const data = await auditorPortalApi.getEngagementChecklist(auditId);
        setTitle(data.audit_title ?? "");
        setScale(data.verdict_scale ?? null);
        setGrid(data.grid ?? null);
        rows = (data.controls ?? []) as unknown as ChecklistControlRow[];
        setDocuments((data.documents ?? []) as unknown as AuditChecklistDocument[]);
        effectiveAudit = data.audit_id ?? auditId;
      } else if (assessmentId) {
        const raw = await auditorPortalApi.getChecklist(assessmentId);
        const extra = raw as unknown as LegacyChecklistExtras;
        setTitle("");
        setScale(extra.verdict_scale ?? null);
        setGrid(extra.grid ?? null);
        rows = (raw.controls ?? []) as unknown as ChecklistControlRow[];
        setDocuments(raw.documents ?? []);
        effectiveAudit = extra.audit_id ?? null;
      } else {
        setError(t("errors.not_found"));
        return;
      }

      setControls(rows);
      setEngagementId(effectiveAudit);

      const verdicts: Record<string, string | null> = {};
      const notes: Record<string, string> = {};
      for (const c of rows) {
        verdicts[c.control_assessment_id] = c.auditor_verdict ?? null;
        notes[c.control_assessment_id] = c.auditor_note ?? "";
      }
      setDraftVerdict(verdicts);
      setDraftNote(notes);

      if (effectiveAudit) await loadWorkspace(effectiveAudit);
    } catch {
      setError(t("errors.load_failed"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId, assessmentId, loadWorkspace]);

  useEffect(() => { load(); }, [load]);

  // Grid answers arrive on the grid payload, not on the control rows. Saving one
  // row replaces `grid`, which re-runs this effect — so it may only SEED rows it
  // has never seen. Reassigning every row would silently discard the answers the
  // auditor has typed on the other lines but not yet saved. `load()` clears both
  // maps, so a genuine reload still re-seeds everything.
  useEffect(() => {
    if (!grid) return;
    setDraftVerdict((prev) => {
      const next = { ...prev };
      for (const row of grid.items) {
        if (!(row.item_id in next)) next[row.item_id] = row.verdict ?? null;
      }
      return next;
    });
    setDraftNote((prev) => {
      const next = { ...prev };
      for (const row of grid.items) {
        if (!(row.item_id in next)) next[row.item_id] = row.note ?? "";
      }
      return next;
    });
  }, [grid]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function flash(id: string) {
    setSavedRow(id);
    window.setTimeout(() => setSavedRow((cur) => (cur === id ? null : cur)), 2500);
  }

  async function saveGridVerdict(itemId: string) {
    if (!engagementId) return;
    setSavingRow(itemId);
    setRowError((p) => ({ ...p, [itemId]: "" }));
    try {
      // The route answers with the row as it was actually stored. Echoing the
      // draft instead would lie whenever the server kept a value the draft
      // dropped — deselecting a level does not clear it server-side.
      const saved = await auditorPortalApi.recordGridVerdict(engagementId, itemId, {
        verdict: draftVerdict[itemId] ?? null,
        note: draftNote[itemId] ?? "",
      }) as { verdict?: string | null; note?: string | null } | undefined;
      const storedVerdict = saved?.verdict ?? null;
      const storedNote = saved?.note ?? null;
      setDraftVerdict((p) => ({ ...p, [itemId]: storedVerdict }));
      setDraftNote((p) => ({ ...p, [itemId]: storedNote ?? "" }));
      setGrid((prev) => prev && ({
        ...prev,
        items: prev.items.map((r) => r.item_id === itemId
          ? { ...r, verdict: storedVerdict, note: storedNote }
          : r),
        items_answered: prev.items.filter((r) =>
          r.item_id === itemId ? !!storedVerdict : !!r.verdict).length,
      }));
      flash(itemId);
    } catch (e) {
      setRowError((p) => ({
        ...p,
        [itemId]: httpStatus(e) === 403 ? t("errors.unauthorized") : t("audit_grid.error_save_failed"),
      }));
    } finally {
      setSavingRow(null);
    }
  }

  async function saveControlVerdict(caId: string) {
    const verdict = draftVerdict[caId];
    if (!verdict) return;
    setSavingRow(caId);
    setRowError((p) => ({ ...p, [caId]: "" }));
    try {
      await auditorPortalApi.recordVerdict(caId, verdict, draftNote[caId] ?? "");
      setControls((prev) => prev.map((c) => c.control_assessment_id === caId
        ? { ...c, auditor_verdict: verdict, auditor_note: draftNote[caId] ?? "" }
        : c));
      flash(caId);
    } catch (e) {
      setRowError((p) => ({
        ...p,
        [caId]: httpStatus(e) === 403 ? t("errors.unauthorized") : t("audit_grid.error_save_failed"),
      }));
    } finally {
      setSavingRow(null);
    }
  }

  async function uploadEvidence(file: File, findingId?: string) {
    if (!engagementId) return;
    setUploading(true);
    setUploadError("");
    try {
      await auditorPortalApi.uploadEngagementEvidence(engagementId, file, {
        name: file.name,
        finding_id: findingId,
      });
      const list = await auditorPortalApi.listEngagementEvidence(engagementId);
      setEvidence(Array.isArray(list) ? list : []);
    } catch (e) {
      const status = httpStatus(e);
      setUploadError(
        status === 403 ? t("errors.unauthorized") : t("audit_detail.evidence_upload_failed"),
      );
    } finally {
      setUploading(false);
    }
  }

  async function downloadEvidence(item: AuditEvidence) {
    try {
      const blob = await auditorPortalApi.downloadEngagementEvidence(item.id);
      saveBlob(blob, item.file_name || item.name || "evidence");
    } catch {
      setUploadError(t("errors.load_failed"));
    }
  }

  async function submitFinding(e: React.FormEvent) {
    e.preventDefault();
    if (!engagementId) return;
    if (!findingForm.title.trim()) { setFindingError(t("audits.title_required")); return; }
    setFindingSaving(true);
    setFindingError("");
    try {
      await auditorPortalApi.createEngagementFinding(engagementId, {
        title: findingForm.title.trim(),
        description: findingForm.description.trim(),
        severity: findingForm.severity,
        finding_type: findingForm.finding_type || null,
        recommendation: findingForm.recommendation.trim() || null,
        due_date: findingForm.due_date || null,
      });
      setShowFinding(false);
      setFindingForm({ title: "", description: "", severity: "medium", finding_type: "nonconformity_minor", recommendation: "", due_date: "" });
      await loadWorkspace(engagementId);
      setTab("findings");
    } catch {
      setFindingError(t("audit_detail.error_save_failed"));
    } finally {
      setFindingSaving(false);
    }
  }

  function verdictLabel(key: string | null | undefined): string {
    if (!key) return t("audit_grid.not_evaluated");
    const lvl = levelByKey(levels, key);
    if (lvl) return levelLabel(lvl, i18n.language);
    const legacy = LEGACY_VERDICT_KEY[key];
    return legacy ? t(legacy) : key;
  }

  const gridSections = useMemo(() => {
    if (!grid) return [] as Array<{ section: string | null; rows: AuditorGridRow[] }>;
    const buckets = new Map<string, AuditorGridRow[]>();
    for (const row of grid.items) {
      const k = row.section ?? "";
      const list = buckets.get(k);
      if (list) list.push(row); else buckets.set(k, [row]);
    }
    return Array.from(buckets.entries()).map(([k, rows]) => ({ section: k || null, rows }));
  }, [grid]);

  const answeredCount = useMemo(() => {
    if (grid) return grid.items.filter((r) => !!draftVerdict[r.item_id]).length;
    return controls.filter((c) => !!draftVerdict[c.control_assessment_id]).length;
  }, [grid, controls, draftVerdict]);

  const totalCount = grid ? grid.items.length : controls.length;

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const TABS: Array<{ key: TabKey; label: string; icon: typeof ListChecks; count?: number }> = [
    { key: "checklist", label: grid ? t("audit_detail.tab_checklist") : t("audits.checklist"), icon: grid ? Grid3x3 : ListChecks, count: totalCount },
    { key: "findings",  label: t("audit_detail.tab_findings"),  icon: ShieldAlert, count: findings.length },
    { key: "evidence",  label: t("audit_detail.tab_evidence"),  icon: Paperclip,   count: evidence.length },
    { key: "documents", label: t("audits.reference_docs"),      icon: FileText,    count: documents.length },
    { key: "exchanges", label: t("audit_detail.tab_comments"),  icon: MessageSquare },
  ];

  /** `requireVerdict` is true on a CONTROL row: PATCH /control-assessments
   *  rejects an empty verdict, so saving with nothing selected used to return
   *  early and do nothing at all — a dead button with no explanation. A grid row
   *  accepts a note on its own, so it keeps the button enabled. */
  function renderVerdictBlock(rowId: string, onSave: () => void, requireVerdict = false) {
    const current = draftVerdict[rowId] ?? null;
    const blocked = requireVerdict && !current;
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2.5">
          {t("audit_grid.verdict")}
          {scale?.source_name ? ` · ${scale.source_name}` : ""}
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {levels.length === 0 && (
            <span className="text-xs text-gray-400">{t("audit_grid.not_evaluated")}</span>
          )}
          {levels.map((lvl) => {
            const active = current === lvl.key;
            return (
              <button
                key={lvl.key}
                type="button"
                onClick={() => setDraftVerdict((p) => ({ ...p, [rowId]: active ? null : lvl.key }))}
                style={levelChipStyle(lvl, active)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                  active ? "ring-2 ring-offset-1 ring-slate-300" : "text-gray-600 bg-white border-gray-200 hover:bg-gray-50"
                }`}
              >
                {active && <CheckCircle2 className="w-3.5 h-3.5" />}
                {levelLabel(lvl, i18n.language)}
              </button>
            );
          })}
        </div>
        <textarea
          value={draftNote[rowId] ?? ""}
          onChange={(e) => setDraftNote((p) => ({ ...p, [rowId]: e.target.value }))}
          rows={2}
          placeholder={t("audit_grid.verdict_note_placeholder")}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2.5"
        />
        {rowError[rowId] && <p className="text-xs text-red-600 mb-2">{rowError[rowId]}</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={savingRow === rowId || blocked}
            className="inline-flex items-center gap-1.5 bg-slate-800 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-900 disabled:opacity-50"
          >
            {savingRow === rowId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {savingRow === rowId ? t("audit_grid.saving") : t("audit_grid.save_responses")}
          </button>
          {savedRow === rowId && <span className="text-xs text-green-600">{t("audit_grid.saved")}</span>}
          {blocked && <span className="text-xs text-gray-400">{t("audit_grid.not_evaluated")}</span>}
        </div>
      </div>
    );
  }

  return (
    <>
      {viewingDoc && <DocumentViewerModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />}

      {/* New finding modal */}
      {showFinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowFinding(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("audit_detail.new_finding")}</h2>
              <button
                type="button"
                onClick={() => setShowFinding(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label={t("common.close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {findingError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{findingError}</div>}
            <form onSubmit={submitFinding} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_detail.finding_title")}</label>
                <input
                  value={findingForm.title}
                  onChange={(e) => setFindingForm({ ...findingForm, title: e.target.value })}
                  placeholder={t("audit_detail.finding_title_placeholder")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_detail.finding_description")}</label>
                <textarea
                  value={findingForm.description}
                  onChange={(e) => setFindingForm({ ...findingForm, description: e.target.value })}
                  rows={3}
                  placeholder={t("audit_detail.finding_description_placeholder")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_detail.finding_severity")}</label>
                  <select
                    value={findingForm.severity}
                    onChange={(e) => setFindingForm({ ...findingForm, severity: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {SEVERITIES.map((s) => <option key={s} value={s}>{t(SEVERITY_KEY[s])}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_detail.finding_type")}</label>
                  <select
                    value={findingForm.finding_type}
                    onChange={(e) => setFindingForm({ ...findingForm, finding_type: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {FINDING_TYPES.map((ft) => (
                      <option key={ft} value={ft}>{t(`audit_detail.finding_types.${ft}`)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_detail.finding_recommendation")}</label>
                <textarea
                  value={findingForm.recommendation}
                  onChange={(e) => setFindingForm({ ...findingForm, recommendation: e.target.value })}
                  rows={2}
                  placeholder={t("audit_detail.finding_recommendation_placeholder")}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("audit_detail.finding_due_date")}</label>
                <input
                  type="date"
                  value={findingForm.due_date}
                  onChange={(e) => setFindingForm({ ...findingForm, due_date: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFinding(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-xl"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={findingSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl"
                >
                  {findingSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="p-8 max-w-7xl space-y-6">
        {/* Header */}
        <div>
          <button
            type="button"
            onClick={() => navigate("/auditor/portal")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            {t("auditor.back_to_portal", { defaultValue: t("common.back") })}
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{title || t("audits.checklist")}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {grid ? t("audit_grid.checklist_title") : t("audits.checklist")}
                {grid?.grid_name ? ` · ${grid.grid_name}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {engagementId && (
                <button
                  type="button"
                  onClick={() => setShowFinding(true)}
                  className="inline-flex items-center gap-1.5 text-sm border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {t("audits.add_finding")}
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate(engagementId && auditId
                  ? `/auditor/portal/audits/${auditId}/report`
                  : `/auditor/portal/${assessmentId}/report`)}
                className="inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg transition-colors"
              >
                <FileText className="w-4 h-4" />
                {t("audits.audit_report")}
              </button>
            </div>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>}

        {!grid && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
            {t("audit_grid.no_grid_on_audit")}
          </div>
        )}

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { key: "total",    value: totalCount,                      label: grid ? t("audit_grid.items") : t("audits.checklist"), color: "text-gray-800"   },
            { key: "answered", value: `${answeredCount}/${totalCount}`, label: t("audit_detail.progress"),                          color: "text-slate-700"  },
            { key: "findings", value: findings.length,                  label: t("audits.findings"),                                color: "text-amber-600"  },
            { key: "evidence", value: evidence.length + documents.length, label: t("audit_detail.evidence_title"),                  color: "text-blue-600"   },
          ].map(({ key, value, label, color }) => (
            <div key={key} className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-gray-200">
          {TABS.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {count != null && <span className="text-xs text-gray-400">({count})</span>}
            </button>
          ))}
        </div>

        {/* ── Checklist tab ── */}
        {tab === "checklist" && grid && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              {t("audit_grid.progress_evaluated", { done: answeredCount, total: totalCount })}
            </p>
            {gridSections.map(({ section, rows }) => (
              <div key={section ?? "__none__"} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                  <Grid3x3 className="w-4 h-4 text-teal-500" />
                  <h2 className="text-sm font-semibold text-gray-700">{section ?? t("audit_grid.no_sections")}</h2>
                  <span className="text-xs text-gray-400">{t(pluralKey("audit_grid.items_count", rows.length), { count: rows.length })}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {rows.map((row) => {
                    const open = expanded.has(row.item_id);
                    const lvl = levelByKey(levels, draftVerdict[row.item_id]);
                    return (
                      <div key={row.item_id} className="p-4">
                        <button
                          type="button"
                          onClick={() => toggleExpand(row.item_id)}
                          className="w-full flex items-start gap-3 text-left group"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              {row.ref_code && (
                                <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{row.ref_code}</span>
                              )}
                              {row.is_mandatory && (
                                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-50 text-red-600">
                                  {t("common.required")}
                                </span>
                              )}
                              <span
                                className="rounded-full px-2.5 py-0.5 text-xs font-semibold border border-gray-200 text-gray-500"
                                style={levelChipStyle(lvl, true)}
                              >
                                {verdictLabel(draftVerdict[row.item_id])}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-gray-800 group-hover:text-gray-900">{row.title}</p>
                          </div>
                          {open
                            ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                            : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />}
                        </button>

                        {open && (
                          <div className="mt-4 space-y-3 pl-4 rtl:pl-0 rtl:pr-4 border-l-2 rtl:border-l-0 rtl:border-r-2 border-gray-100">
                            {row.description && (
                              <div>
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                                  {t("audit_grid.item_question")}
                                </p>
                                <p className="text-xs text-gray-600 leading-relaxed">{row.description}</p>
                              </div>
                            )}
                            {row.guidance && (
                              <div className="bg-blue-50 rounded-xl p-4">
                                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1.5">
                                  {t("audit_grid.item_guidance")}
                                </p>
                                <p className="text-xs text-blue-800 leading-relaxed">{row.guidance}</p>
                              </div>
                            )}
                            {renderVerdictBlock(row.item_id, () => saveGridVerdict(row.item_id))}
                            {engagementId && (
                              <button
                                type="button"
                                onClick={() => setTab("exchanges")}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                {t("audit_comments.thread_on_audit")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "checklist" && !grid && (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            {controls.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-400">{t("common.no_data")}</div>
            )}
            {controls.map((ctrl) => {
              const open = expanded.has(ctrl.control_assessment_id);
              const cfg = STATUS_CFG[ctrl.status] ?? STATUS_CFG.not_started;
              const StatusIcon = cfg.icon;
              const hasNotes = !!(ctrl.implementation_notes || ctrl.company_notes);
              const linked = ctrl.linked_checklist_documents ?? [];
              const hasEvidence = hasNotes || linked.length > 0;
              const lvl = levelByKey(levels, draftVerdict[ctrl.control_assessment_id]);
              return (
                <div key={ctrl.control_assessment_id} className="p-4">
                  <button
                    type="button"
                    onClick={() => toggleExpand(ctrl.control_assessment_id)}
                    className="w-full flex items-start gap-3 text-left group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                          {ctrl.control_identifier}
                        </span>
                        {ctrl.control_category && <span className="text-xs text-gray-400">{ctrl.control_category}</span>}
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${cfg.cls}`}>
                          <StatusIcon className="w-3 h-3" />
                          {t(cfg.key)}
                        </span>
                        {hasEvidence && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-blue-500">
                            <Eye className="w-3 h-3" />
                            {t("audit_detail.evidence_title")}
                          </span>
                        )}
                        <span
                          className="rounded-full px-2.5 py-0.5 text-xs font-semibold border border-gray-200 text-gray-500"
                          style={levelChipStyle(lvl, true)}
                        >
                          {verdictLabel(draftVerdict[ctrl.control_assessment_id])}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-800 group-hover:text-gray-900">{ctrl.control_title}</p>
                    </div>
                    {open
                      ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                      : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />}
                  </button>

                  {open && (
                    <div className="mt-4 space-y-3 pl-4 rtl:pl-0 rtl:pr-4 border-l-2 rtl:border-l-0 rtl:border-r-2 border-gray-100">
                      {ctrl.control_description && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                            {t("audit_grid.item_question")}
                          </p>
                          <p className="text-xs text-gray-600 leading-relaxed">{ctrl.control_description}</p>
                        </div>
                      )}

                      {hasNotes && (
                        <div className="bg-blue-50 rounded-xl p-4">
                          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                            <Eye className="w-3.5 h-3.5" />
                            {t("audit_detail.evidence_title")}
                          </p>
                          {ctrl.implementation_notes && (
                            <p className="text-xs text-blue-800 leading-relaxed">{ctrl.implementation_notes}</p>
                          )}
                          {ctrl.company_notes && (
                            <p className="text-xs text-blue-700 mt-1.5 opacity-80 leading-relaxed">{ctrl.company_notes}</p>
                          )}
                        </div>
                      )}

                      {linked.length > 0 && (
                        <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
                          <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5" />
                            {t("audit_grid.verdict_evidence")}
                          </p>
                          <div className="space-y-1.5">
                            {linked.map((doc) => (
                              <div key={doc.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-teal-100">
                                <FileText className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-teal-800 truncate">{doc.document_name ?? doc.file_name}</p>
                                  <p className="text-xs text-teal-400">{doc.clause_ref ?? ""}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setViewingDoc(linkedDocToViewable(doc, doc.clause_ref))}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors flex-shrink-0"
                                >
                                  <Eye className="w-3 h-3" />
                                  {t("common.view")}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {!hasEvidence && (
                        <div className="flex items-center gap-2 py-2">
                          <AlertCircle className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                          <p className="text-xs text-gray-400 italic">{t("audit_detail.evidence_none")}</p>
                        </div>
                      )}

                      {renderVerdictBlock(ctrl.control_assessment_id, () => saveControlVerdict(ctrl.control_assessment_id), true)}
                      <CommentThread anchor={{ control_assessment_id: ctrl.control_assessment_id }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Findings tab ── */}
        {tab === "findings" && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                {t("audit_detail.findings_title")}
              </h2>
              {engagementId && (
                <button
                  type="button"
                  onClick={() => setShowFinding(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t("audit_detail.new_finding")}
                </button>
              )}
            </div>
            {findings.length === 0 ? (
              <div className="py-12 text-center">
                <ShieldAlert className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-500">{t("audit_detail.no_findings")}</p>
                <p className="text-xs text-gray-400 mt-1">{t("audit_detail.no_findings_hint")}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {findings.map((f) => (
                  <div key={f.id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700">
                        {t(SEVERITY_KEY[f.severity] ?? "common.severity")}
                      </span>
                      <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-600">
                        {t(`audit_detail.finding_statuses.${f.status}`, f.status)}
                      </span>
                      {f.finding_type && (
                        <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-700">
                          {t(`audit_detail.finding_types.${f.finding_type}`, f.finding_type)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{f.title}</p>
                    {f.description && <p className="text-xs text-gray-600 leading-relaxed">{f.description}</p>}
                    {f.recommendation && (
                      <p className="text-xs text-gray-600">
                        <span className="font-semibold">{t("audit_detail.finding_recommendation")}: </span>
                        {f.recommendation}
                      </p>
                    )}
                    {f.management_response && (
                      <p className="text-xs text-gray-600">
                        <span className="font-semibold">{t("audit_detail.finding_management_response")}: </span>
                        {f.management_response}
                      </p>
                    )}

                    {engagementId && (
                      <label className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 cursor-pointer">
                        <Paperclip className="w-3.5 h-3.5" />
                        {t("audit_detail.evidence_upload")}
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadEvidence(file, f.id);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}

                    <CommentThread anchor={{ finding_id: f.id }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Evidence tab ── */}
        {tab === "evidence" && (
          <div className="space-y-4">
            {engagementId ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) uploadEvidence(file);
                }}
                className={`bg-white rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
                  dragOver ? "border-blue-400 bg-blue-50/40" : "border-gray-200"
                }`}
              >
                <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-600">{t("audit_detail.evidence_drop")}</p>
                <label className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg cursor-pointer transition-colors">
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {t("audit_detail.evidence_upload")}
                  <input
                    type="file"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadEvidence(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {uploadError && <p className="text-xs text-red-600 mt-3">{uploadError}</p>}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
                <Lock className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-500">{t("auditor.evidence_needs_engagement", "Evidence can only be attached from an audit engagement.")}</p>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-blue-500" />
                <h2 className="text-sm font-semibold text-gray-700">{t("audit_detail.evidence_title")}</h2>
                <span className="text-xs text-gray-400">{evidence.length}</span>
              </div>
              {evidence.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-gray-500">{t("audit_detail.evidence_none")}</p>
                  <p className="text-xs text-gray-400 mt-1">{t("audit_detail.evidence_none_hint")}</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {evidence.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                      <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{item.name || item.file_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {item.file_size_bytes ? `${(item.file_size_bytes / 1024).toFixed(1)} KB` : ""}
                          {item.file_sha256 ? ` · ${t("audit_detail.evidence_integrity_ok")}` : ""}
                        </p>
                      </div>
                      {item.has_file !== false && (
                        <button
                          type="button"
                          onClick={() => downloadEvidence(item)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {t("common.download")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Company documents tab ── */}
        {tab === "documents" && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-gray-700">{t("audits.reference_docs")}</h2>
              <span className="text-xs text-gray-400">{documents.length}</span>
            </div>
            {documents.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">{t("common.no_data")}</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{doc.document_name ?? doc.file_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {doc.clause_ref ?? ""}
                        {doc.file_size_bytes ? ` · ${(doc.file_size_bytes / 1024).toFixed(1)} KB` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewingDoc(docToViewable(doc, doc.clause_ref))}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {t("common.view")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Engagement-level exchange ── */}
        {tab === "exchanges" && (
          engagementId ? (
            <CommentThread anchor={{ audit_id: engagementId }} />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
              <MessageSquare className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-500">{t("audit_comments.no_comments")}</p>
              <p className="text-xs text-gray-400 mt-1">{t("audit_comments.no_comments_hint")}</p>
            </div>
          )
        )}
      </div>
    </>
  );
}
