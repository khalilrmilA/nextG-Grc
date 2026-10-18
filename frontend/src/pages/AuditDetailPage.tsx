/**
 * AuditDetailPage — the engagement dossier (objectifs 5, 6, 7, 8).
 *
 * Everything an auditor and a CISO have to do on one mission, on one screen:
 *
 *   * a status stepper — planning → fieldwork → review → reporting → closed;
 *   * Constats: raise, edit, answer, close against a note and a preuve, and
 *     read the transition history that proves how the finding got there;
 *   * Preuves: a real file input, the list, the fingerprint and the download;
 *   * Plan: the programme, generated against the real framework and perimeter
 *     and persisted onto the engagement;
 *   * Recommandations: what the constats ask for, with owner and due date;
 *   * Rapport: the state machine — generate → submit → approve | reject →
 *     distribute — with the buttons disabled by the current report_status and
 *     the approval hidden from whoever produced the document;
 *   * Échanges: the contradictoire with the audited entity, internal notes kept
 *     on the audit team's side of the wall.
 *
 * The page is created here but NOT routed here: see needs_integration for the
 * route and the roles it expects.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, Loader2, Plus, X, Upload, Download, Trash2, FileText,
  AlertTriangle, CheckCircle, Clock, Send, ShieldCheck, XCircle,
  Sparkles, Save, MessageSquare, History, Lock, Users, Calendar,
  Layers, Network, Paperclip, Pencil, ListChecks, Building2,
} from "lucide-react";
import AuditPlanModal from "../components/ai/AuditPlanModal";
import {
  auditsApi, auditCommentsApi, auditCampaignsApi, frameworksApi,
  usersApi, assetGraphApi, assetsApi, authApi,
} from "@/api/endpoints";
import type { UserProfile } from "@/api/endpoints";
import { useEntitlements } from "@/context/EntitlementsContext";
import type {
  Audit, AuditFinding, AuditEvidence, AuditRecommendation, AuditComment,
  AuditReportDistribution, AuditFindingStatusEvent, FrameworkControl,
} from "@/types";

/** Display locale for dates: Latin digits in Arabic, French day-month order in French. */
const dateLocale = (lang: string) => (lang?.startsWith("fr") ? "fr-FR" : lang?.startsWith("ar") ? "ar-u-nu-latn" : "en-US");


// ── Vocabulary ────────────────────────────────────────────────────────────────

const STATUS_STEPS = ["planning", "fieldwork", "review", "reporting", "closed"] as const;
const FINDING_TYPES = ["nonconformity_major", "nonconformity_minor", "observation", "improvement"] as const;
const FINDING_SEVERITIES = ["critical", "high", "medium", "low", "observation"] as const;
const FINDING_STATUSES = ["open", "in_remediation", "remediated", "accepted", "closed"] as const;
const RECOMMENDATION_PRIORITIES = ["critical", "high", "medium", "low"] as const;

const SEVERITY_COLORS: Record<string, string> = {
  critical:    "bg-red-100 text-red-700",
  high:        "bg-orange-100 text-orange-700",
  medium:      "bg-yellow-100 text-yellow-700",
  low:         "bg-slate-100 text-slate-600",
  observation: "bg-blue-100 text-blue-700",
};

const FINDING_TYPE_COLORS: Record<string, string> = {
  nonconformity_major: "bg-red-100 text-red-700",
  nonconformity_minor: "bg-orange-100 text-orange-700",
  observation:         "bg-blue-100 text-blue-700",
  improvement:         "bg-emerald-100 text-emerald-700",
};

const FINDING_STATUS_COLORS: Record<string, string> = {
  open:           "bg-gray-100 text-gray-600",
  in_remediation: "bg-blue-100 text-blue-700",
  remediated:     "bg-teal-100 text-teal-700",
  accepted:       "bg-amber-100 text-amber-700",
  closed:         "bg-green-100 text-green-700",
};

const RECO_STATUS_COLORS: Record<string, string> = {
  pending:     "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  closed:      "bg-green-100 text-green-700",
  rejected:    "bg-slate-100 text-slate-600",
  overdue:     "bg-red-100 text-red-700",
};

const REPORT_COLORS: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-600",
  submitted: "bg-amber-100 text-amber-700",
  approved:  "bg-blue-100 text-blue-700",
  rejected:  "bg-red-100 text-red-700",
  issued:    "bg-green-100 text-green-700",
};

type TabKey = "overview" | "plan" | "findings" | "evidence" | "recommendations" | "report" | "comments";

interface DirectoryEntry { id: string; name: string; email: string }

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function humanSize(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Finding create / edit ─────────────────────────────────────────────────────

function FindingModal({
  auditId, finding, directory, controls, onClose, onSaved,
}: {
  readonly auditId: string;
  readonly finding: AuditFinding | null;
  readonly directory: DirectoryEntry[];
  readonly controls: FrameworkControl[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!finding;
  const [form, setForm] = useState({
    title: finding?.title ?? "",
    description: finding?.description ?? "",
    severity: finding?.severity ?? "medium",
    finding_type: finding?.finding_type ?? "",
    status: finding?.status ?? "open",
    control_id: finding?.control_id ?? "",
    remediation_owner_id: finding?.remediation_owner_id ?? "",
    due_date: finding?.due_date ?? "",
    recommendation: finding?.recommendation ?? "",
    remediation_notes: finding?.remediation_notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError(t("audits.title_required"));
      return;
    }
    if (!form.description.trim()) {
      setError(`${t("common.required")}: ${t("audit_detail.finding_description")}`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (isEdit && finding) {
        // CLOSED / ACCEPTED are refused by PATCH on purpose — a closure goes
        // through /close, which demands a note and a certifying human. So the
        // field is simply omitted rather than echoed back and 400'd.
        const terminal = form.status === "closed" || form.status === "accepted";
        await auditsApi.updateFinding(auditId, finding.id, {
          title: form.title.trim(),
          description: form.description.trim(),
          severity: form.severity as AuditFinding["severity"],
          ...(terminal ? {} : { status: form.status as AuditFinding["status"] }),
          finding_type: form.finding_type || null,
          remediation_owner_id: form.remediation_owner_id || undefined,
          due_date: form.due_date || undefined,
          recommendation: form.recommendation || undefined,
          remediation_notes: form.remediation_notes || null,
        });
      } else {
        await auditsApi.createFinding(auditId, {
          title: form.title.trim(),
          description: form.description.trim(),
          severity: form.severity,
          finding_type: form.finding_type || null,
          control_id: form.control_id || null,
          remediation_owner_id: form.remediation_owner_id || null,
          due_date: form.due_date || null,
          recommendation: form.recommendation || null,
        });
      }
      onSaved();
      onClose();
    } catch {
      setError(t("audit_detail.error_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">
            {isEdit ? t("audit_detail.edit_finding") : t("audit_detail.new_finding")}
          </h2>
          <button type="button" onClick={onClose} title={t("common.close")} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label htmlFor="f-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              {t("audit_detail.finding_title")} *
            </label>
            <input id="f-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t("audit_detail.finding_title_placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label htmlFor="f-desc" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              {t("audit_detail.finding_description")} *
            </label>
            <textarea id="f-desc" rows={3} value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t("audit_detail.finding_description_placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="f-type" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.finding_type")}</label>
              <select id="f-type" value={form.finding_type} onChange={(e) => setForm((f) => ({ ...f, finding_type: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{t("common.none")}</option>
                {FINDING_TYPES.map((k) => <option key={k} value={k}>{t(`audit_detail.finding_types.${k}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-sev" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.finding_severity")}</label>
              <select id="f-sev" value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as AuditFinding["severity"] }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {FINDING_SEVERITIES.map((k) => <option key={k} value={k}>{t(`audits.finding_${k}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.status")}</label>
              <select id="f-status" disabled={!isEdit} value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AuditFinding["status"] }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {FINDING_STATUSES.map((k) => (
                  <option key={k} value={k} disabled={k === "closed" || k === "accepted"}>
                    {t(`audit_detail.finding_statuses.${k}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="f-control" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.finding_control")}</label>
              <input id="f-control" list="audit-controls" disabled={isEdit} value={form.control_id}
                onChange={(e) => setForm((f) => ({ ...f, control_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <datalist id="audit-controls">
                {controls.slice(0, 500).map((c) => (
                  <option key={c.id} value={c.control_id}>{c.title}</option>
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="f-owner" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.finding_owner")}</label>
              <select id="f-owner" value={form.remediation_owner_id}
                onChange={(e) => setForm((f) => ({ ...f, remediation_owner_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{t("common.none")}</option>
                {directory.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-due" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.finding_due_date")}</label>
              <input id="f-due" type="date" value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label htmlFor="f-reco" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.finding_recommendation")}</label>
            <textarea id="f-reco" rows={2} value={form.recommendation}
              onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))}
              placeholder={t("audit_detail.finding_recommendation_placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {isEdit && (
            <div>
              <label htmlFor="f-notes" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.finding_remediation_notes")}</label>
              <textarea id="f-notes" rows={2} value={form.remediation_notes}
                onChange={(e) => setForm((f) => ({ ...f, remediation_notes: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Close a finding ───────────────────────────────────────────────────────────

function CloseFindingModal({
  auditId, finding, evidence, onClose, onSaved,
}: {
  readonly auditId: string;
  readonly finding: AuditFinding;
  readonly evidence: AuditEvidence[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [status, setStatus] = useState<"closed" | "accepted">("closed");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) { setError(t("audit_detail.close_note_required")); return; }
    setSaving(true);
    setError("");
    try {
      await auditsApi.closeFinding(auditId, finding.id, {
        closure_note: note.trim(),
        closure_evidence_id: evidenceId || null,
        status,
      });
      onSaved();
      onClose();
    } catch {
      setError(t("audit_detail.error_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-green-600" /> {t("audit_detail.close_finding")}
          </h2>
          <button type="button" onClick={onClose} title={t("common.close")} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <p className="text-sm text-gray-600">{finding.title}</p>

          <div>
            <label htmlFor="c-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.status")}</label>
            <select id="c-status" value={status} onChange={(e) => setStatus(e.target.value as "closed" | "accepted")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="closed">{t("audit_detail.finding_statuses.closed")}</option>
              <option value="accepted">{t("audit_detail.finding_statuses.accepted")}</option>
            </select>
          </div>

          <div>
            <label htmlFor="c-note" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              {t("audit_detail.close_note")} *
            </label>
            <textarea id="c-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t("audit_detail.close_note_placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          <div>
            <label htmlFor="c-evidence" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("audit_detail.close_evidence")}</label>
            <select id="c-evidence" value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">{t("common.none")}</option>
              {evidence.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("audit_detail.close_finding")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditDetailPage() {
  const { t, i18n } = useTranslation();
  const { hasFeature } = useEntitlements();
  // /asset-graph/* is gated behind "asset_cartography"; calling it without the
  // entitlement answers 402 and the global interceptor raises an upsell dialog
  // over the dossier. Read the entitlement instead and fall back to the ids.
  const canReadOrgGraph = hasFeature("asset_cartography");
  const navigate = useNavigate();
  const { id: auditId = "" } = useParams<{ id: string }>();

  const [audit, setAudit] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [controls, setControls] = useState<FrameworkControl[]>([]);
  const [frameworkLabel, setFrameworkLabel] = useState("");
  const [frameworkShort, setFrameworkShort] = useState("");
  const [campaignLabel, setCampaignLabel] = useState("");
  const [perimeterNames, setPerimeterNames] = useState<{ processes: string[]; entities: string[]; systems: string[] }>({
    processes: [], entities: [], systems: [],
  });

  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [evidence, setEvidence] = useState<AuditEvidence[]>([]);
  const [recommendations, setRecommendations] = useState<AuditRecommendation[]>([]);
  const [distributions, setDistributions] = useState<AuditReportDistribution[]>([]);
  const [comments, setComments] = useState<AuditComment[]>([]);
  const [viewerIsAuditTeam, setViewerIsAuditTeam] = useState(false);

  // Findings UI
  const [findingModal, setFindingModal] = useState<{ open: boolean; finding: AuditFinding | null }>({ open: false, finding: null });
  const [closingFinding, setClosingFinding] = useState<AuditFinding | null>(null);
  const [history, setHistory] = useState<Record<string, AuditFindingStatusEvent[]>>({});
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState<Record<string, string>>({});
  const [findingTypeFilter, setFindingTypeFilter] = useState("");
  const [deleteReason, setDeleteReason] = useState<Record<string, string>>({});

  // Evidence UI
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [evidenceFinding, setEvidenceFinding] = useState("");

  // Plan UI
  const [planDraft, setPlanDraft] = useState("");
  const [planSaved, setPlanSaved] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);

  // Report UI
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [distributeNote, setDistributeNote] = useState("");
  const [generatedByMe, setGeneratedByMe] = useState(false);

  // Withdrawal (objectif 8: a soft delete that keeps the record and its reason)
  const [withdrawReason, setWithdrawReason] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  // Recommendation UI
  const [showRecoForm, setShowRecoForm] = useState(false);
  const [recoDraft, setRecoDraft] = useState({ title: "", description: "", priority: "medium", owner_id: "", due_date: "", finding_id: "" });

  // Comments UI
  const [commentDraft, setCommentDraft] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);
  const [replyTo, setReplyTo] = useState<AuditComment | null>(null);
  const [postingComment, setPostingComment] = useState(false);

  const fmtDate = useCallback(
    (value?: string | null) => {
      if (!value) return "—";
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(dateLocale(i18n.language));
    },
    [i18n.language],
  );

  // GET /users is administrator-only, so the roster can legitimately be empty.
  // A raw uuid tells a reader nothing, so an unresolved id renders as a dash.
  const nameOf = useCallback(
    (userId?: string | null) => (userId ? directory.find((d) => d.id === userId)?.name ?? "—" : "—"),
    [directory],
  );

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadAudit = useCallback(async () => {
    if (!auditId) return;
    try {
      const a = await auditsApi.get(auditId);
      setAudit(a);
      setPlanDraft(a.audit_plan ?? "");
      setLoadError("");
    } catch {
      setLoadError(t("audit_detail.error_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [auditId, t]);

  const loadFindings = useCallback(async () => {
    if (!auditId) return;
    try {
      setFindings(await auditsApi.listFindings(auditId));
    } catch {
      setFindings([]);
    }
  }, [auditId]);

  const loadEvidence = useCallback(async () => {
    if (!auditId) return;
    try {
      setEvidence(await auditsApi.listEvidence(auditId));
    } catch {
      setEvidence([]);
    }
  }, [auditId]);

  const loadRecommendations = useCallback(async () => {
    if (!auditId) return;
    try {
      setRecommendations(await auditsApi.listAuditRecommendations(auditId));
    } catch {
      setRecommendations([]);
    }
  }, [auditId]);

  const loadDistributions = useCallback(async () => {
    if (!auditId) return;
    try {
      setDistributions(await auditsApi.listReportDistributions(auditId));
    } catch {
      setDistributions([]);
    }
  }, [auditId]);

  const loadComments = useCallback(async () => {
    if (!auditId) return;
    try {
      const thread = await auditCommentsApi.list({ audit_id: auditId, limit: 200 });
      setComments(thread.items ?? []);
      setViewerIsAuditTeam(!!thread.viewer_is_audit_team);
    } catch {
      setComments([]);
    }
  }, [auditId]);

  useEffect(() => {
    setLoading(true);
    loadAudit();
    loadFindings();
    loadEvidence();
    loadRecommendations();
    loadDistributions();
    loadComments();
  }, [loadAudit, loadFindings, loadEvidence, loadRecommendations, loadDistributions, loadComments]);

  useEffect(() => {
    let cancelled = false;
    async function loadDirectory() {
      const [me, users] = await Promise.allSettled([authApi.getProfile(), usersApi.directory()]);
      if (cancelled) return;
      if (me.status === "fulfilled") setProfile(me.value);
      if (users.status === "fulfilled") {
        setDirectory(users.value.map((u) => ({
          id: u.id,
          name: `${u.first_name} ${u.last_name}`.trim() || u.email,
          email: u.email,
        })));
      }
    }
    loadDirectory();
    return () => { cancelled = true; };
  }, []);

  // Framework, campaign and perimeter labels — every one of them optional, so a
  // refusal on any single call leaves the dossier readable.
  useEffect(() => {
    let cancelled = false;
    async function decorate() {
      if (!audit) return;
      if (audit.framework_id) {
        const [fw, ctrls] = await Promise.allSettled([
          frameworksApi.get(audit.framework_id),
          frameworksApi.getControls(audit.framework_id),
        ]);
        if (cancelled) return;
        if (fw.status === "fulfilled") {
          setFrameworkLabel(fw.value.name);
          setFrameworkShort(fw.value.short_name);
        }
        if (ctrls.status === "fulfilled") setControls(ctrls.value);
      }
      if (audit.campaign_id) {
        try {
          const c = await auditCampaignsApi.get(audit.campaign_id);
          if (!cancelled) setCampaignLabel(c.name);
        } catch { /* the campaign is a label, not a dependency */ }
      }
      const wantsPerimeter =
        (audit.process_ids?.length ?? 0) + (audit.org_entity_ids?.length ?? 0) + (audit.asset_ids?.length ?? 0) > 0;
      if (wantsPerimeter) {
        const [proc, ent, ast] = await Promise.allSettled([
          canReadOrgGraph ? assetGraphApi.listProcesses() : Promise.resolve([]),
          canReadOrgGraph ? assetGraphApi.listEntities() : Promise.resolve([]),
          assetsApi.options(),
        ]);
        if (cancelled) return;
        const resolve = (settled: PromiseSettledResult<unknown>, ids: string[]): string[] => {
          if (settled.status !== "fulfilled" || !Array.isArray(settled.value)) return ids;
          const byId = new Map<string, string>();
          for (const raw of settled.value) {
            const r = raw as { id?: string; name?: string };
            if (r.id) byId.set(r.id, r.name || r.id);
          }
          return ids.map((x) => byId.get(x) ?? x);
        };
        setPerimeterNames({
          processes: resolve(proc, audit.process_ids ?? []),
          entities: resolve(ent, audit.org_entity_ids ?? []),
          systems: resolve(ast, audit.asset_ids ?? []),
        });
      }
    }
    decorate();
    return () => { cancelled = true; };
  }, [audit, canReadOrgGraph]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function setStatus(next: string) {
    if (!audit || audit.status === next) return;
    setBusy(true);
    try {
      setAudit(await auditsApi.update(audit.id, { status: next as Audit["status"] }));
    } catch {
      setNotice(t("audit_detail.error_save_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function withdrawAudit() {
    if (!audit) return;
    if (withdrawReason.trim().length < 5) { setNotice(t("audit_detail.delete_reason_required")); return; }
    setBusy(true);
    try {
      await auditsApi.delete(audit.id, withdrawReason.trim());
      navigate("/audits");
    } catch {
      // A closed engagement can only be withdrawn by an administrator.
      setNotice(audit.status === "closed"
        ? t("audit_detail.delete_closed_forbidden")
        : t("audit_detail.error_save_failed"));
    } finally {
      setBusy(false);
      setConfirmWithdraw(false);
    }
  }

  async function savePlan() {
    if (!audit) return;
    setBusy(true);
    setPlanSaved(false);
    try {
      setAudit(await auditsApi.savePlan(audit.id, planDraft));
      setPlanSaved(true);
    } catch {
      setNotice(t("audit_detail.error_save_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence(file: File) {
    if (!audit) return;
    setUploading(true);
    try {
      await auditsApi.uploadEvidence(audit.id, file, {
        name: file.name,
        finding_id: evidenceFinding || undefined,
      });
      await loadEvidence();
    } catch {
      setNotice(t("audit_detail.evidence_upload_failed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function downloadEvidence(ev: AuditEvidence) {
    if (!audit) return;
    try {
      const blob = await auditsApi.downloadEvidence(audit.id, ev.id);
      saveBlob(blob, ev.file_name || ev.name);
    } catch {
      setNotice(t("audit_detail.error_load_failed"));
    }
  }

  async function removeEvidence(ev: AuditEvidence) {
    if (!audit) return;
    try {
      await auditsApi.deleteEvidence(audit.id, ev.id);
      await loadEvidence();
    } catch {
      setNotice(t("audit_detail.error_save_failed"));
    }
  }

  async function toggleHistory(finding: AuditFinding) {
    if (expandedFinding === finding.id) { setExpandedFinding(null); return; }
    setExpandedFinding(finding.id);
    if (!history[finding.id] && audit) {
      try {
        const events = await auditsApi.findingHistory(audit.id, finding.id);
        setHistory((prev) => ({ ...prev, [finding.id]: events }));
      } catch {
        setHistory((prev) => ({ ...prev, [finding.id]: [] }));
      }
    }
  }

  async function sendResponse(finding: AuditFinding) {
    if (!audit) return;
    const text = (responseDraft[finding.id] ?? "").trim();
    if (!text) return;
    try {
      await auditsApi.respondToFinding(audit.id, finding.id, text);
      setResponseDraft((prev) => ({ ...prev, [finding.id]: "" }));
      await loadFindings();
    } catch {
      setNotice(t("audit_detail.error_save_failed"));
    }
  }

  async function removeFinding(finding: AuditFinding) {
    if (!audit) return;
    const reason = (deleteReason[finding.id] ?? "").trim();
    if (reason.length < 5) { setNotice(t("audit_detail.delete_reason_required")); return; }
    try {
      await auditsApi.deleteFinding(audit.id, finding.id, reason);
      setDeleteReason((prev) => ({ ...prev, [finding.id]: "" }));
      await loadFindings();
    } catch {
      setNotice(t("audit_detail.error_save_failed"));
    }
  }

  async function reportAction(action: "generate" | "submit" | "approve" | "reject" | "distribute") {
    if (!audit) return;
    setBusy(true);
    setNotice("");
    try {
      if (action === "generate") {
        setAudit(await auditsApi.generateReport(audit.id));
        setGeneratedByMe(true);
      } else if (action === "submit") {
        setAudit(await auditsApi.submitReport(audit.id));
      } else if (action === "approve") {
        setAudit(await auditsApi.approveReport(audit.id));
      } else if (action === "reject") {
        if (!rejectReason.trim()) { setNotice(t("audit_report.reject_reason_required")); return; }
        setAudit(await auditsApi.rejectReport(audit.id, rejectReason.trim()));
        setRejectReason("");
        setShowReject(false);
      } else {
        const list = recipients.split(/[,;\n]/).map((r) => r.trim()).filter(Boolean);
        if (list.length === 0) { setNotice(t("audit_report.recipients_required")); return; }
        await auditsApi.distributeReport(audit.id, {
          recipients: list,
          channel: "email",
          note: distributeNote.trim() || null,
        });
        setRecipients("");
        setDistributeNote("");
        setAudit(await auditsApi.get(audit.id));
        await loadDistributions();
      }
    } catch {
      setNotice(action === "generate" ? t("audit_report.error_generate_failed") : t("audit_report.error_action_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport() {
    if (!audit) return;
    try {
      const blob = await auditsApi.downloadReport(audit.id);
      saveBlob(blob, `${audit.title.replace(/\s+/g, "_")}_report.pdf`);
    } catch {
      setNotice(t("audit_report.blocked_not_approved"));
    }
  }

  async function createRecommendation(e: React.FormEvent) {
    e.preventDefault();
    if (!audit || !recoDraft.title.trim()) return;
    setBusy(true);
    try {
      await auditsApi.createRecommendation(audit.id, {
        title: recoDraft.title.trim(),
        description: recoDraft.description.trim() || null,
        priority: recoDraft.priority || null,
        owner_id: recoDraft.owner_id || null,
        due_date: recoDraft.due_date || null,
        finding_id: recoDraft.finding_id || null,
      });
      setRecoDraft({ title: "", description: "", priority: "medium", owner_id: "", due_date: "", finding_id: "" });
      setShowRecoForm(false);
      await loadRecommendations();
    } catch {
      setNotice(t("recommendations.error_save_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!audit || !commentDraft.trim()) { setNotice(t("audit_comments.error_empty")); return; }
    setPostingComment(true);
    try {
      await auditCommentsApi.create({
        body: commentDraft.trim(),
        audit_id: audit.id,
        parent_id: replyTo?.id ?? null,
        is_internal: commentInternal,
      });
      setCommentDraft("");
      setReplyTo(null);
      await loadComments();
    } catch {
      setNotice(t("audit_comments.error_post_failed"));
    } finally {
      setPostingComment(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const reportStatus = audit?.report_status ?? "draft";
  const hasReport = !!audit?.report_url;
  // The person who produced or submitted the document must not be the one who
  // validates it — the backend refuses it, so the button is not offered either.
  const selfProduced = generatedByMe || (!!profile && profile.id === audit?.report_submitted_by_id);
  const canSubmit = hasReport && (reportStatus === "draft" || reportStatus === "rejected");
  const canDecide = hasReport && reportStatus === "submitted";
  const canDistribute = hasReport && (reportStatus === "approved" || reportStatus === "issued");

  const visibleFindings = useMemo(
    () => (findingTypeFilter ? findings.filter((f) => (f.finding_type ?? "") === findingTypeFilter) : findings),
    [findings, findingTypeFilter],
  );

  const today = new Date().toISOString().slice(0, 10);
  const perimeterTotal =
    perimeterNames.processes.length + perimeterNames.entities.length + perimeterNames.systems.length;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 max-w-7xl space-y-6">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="p-8 max-w-7xl space-y-6">
        <button type="button" onClick={() => navigate("/audits")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> {t("common.back")}
        </button>
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <AlertTriangle className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-500">{loadError || t("audit_detail.error_load_failed")}</p>
        </div>
      </div>
    );
  }

  const TABS: Array<{ key: TabKey; label: string; icon: typeof FileText; badge?: number }> = [
    { key: "overview",        label: t("audit_detail.tab_overview"),        icon: ListChecks },
    { key: "plan",            label: t("audit_detail.tab_plan"),            icon: Sparkles },
    { key: "findings",        label: t("audit_detail.tab_findings"),        icon: AlertTriangle, badge: findings.length },
    { key: "evidence",        label: t("audit_detail.tab_evidence"),        icon: Paperclip,     badge: evidence.length },
    { key: "recommendations", label: t("audit_detail.tab_recommendations"), icon: CheckCircle,   badge: recommendations.length },
    { key: "report",          label: t("audit_detail.tab_report"),          icon: FileText },
    { key: "comments",        label: t("audit_detail.tab_comments"),        icon: MessageSquare, badge: comments.length },
  ];

  return (
    <div className="p-8 max-w-7xl space-y-6">

      {/* Header */}
      <div>
        <button type="button" onClick={() => navigate("/audits")}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft className="w-4 h-4" /> {t("audits.management_title")}
        </button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{audit.title}</h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap text-sm text-gray-500">
              <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600">
                {t(`audits.type_${audit.audit_type}`, audit.audit_type)}
              </span>
              {campaignLabel && (
                <span className="inline-flex items-center gap-1 text-xs">
                  <Layers className="w-3 h-3 text-indigo-400" /> {campaignLabel}
                </span>
              )}
              {frameworkLabel && (
                <span className="inline-flex items-center gap-1 text-xs">
                  <ListChecks className="w-3 h-3 text-blue-400" /> {frameworkLabel}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-xs">
                <Calendar className="w-3 h-3" /> {audit.planned_start ?? "—"} → {audit.planned_end ?? "—"}
              </span>
              <span className="inline-flex items-center gap-1 text-xs">
                <Users className="w-3 h-3" /> {nameOf(audit.lead_auditor_id)}
              </span>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 ${REPORT_COLORS[reportStatus] ?? "bg-gray-100 text-gray-600"}`}>
            {t("audit_report.status")}: {t(`audit_report.statuses.${reportStatus}`, reportStatus)}
          </span>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} title={t("common.close")}>
            <X className="w-4 h-4 opacity-50 hover:opacity-100" />
          </button>
        </div>
      )}

      {/* Status stepper */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_STEPS.map((step, index) => {
            const currentIndex = STATUS_STEPS.indexOf(audit.status as typeof STATUS_STEPS[number]);
            const reached = currentIndex >= index;
            const isCurrent = audit.status === step;
            return (
              <button
                key={step}
                type="button"
                disabled={busy}
                onClick={() => setStatus(step)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  isCurrent
                    ? "bg-blue-600 text-white"
                    : reached
                      ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                      : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                }`}
              >
                <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center ${
                  isCurrent ? "bg-white/20" : reached ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-500"
                }`}>{index + 1}</span>
                {t(`audit_detail.statuses.${step}`)}
              </button>
            );
          })}
          {busy && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.key}
            type="button"
            onClick={() => setTab(tabDef.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              tab === tabDef.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <tabDef.icon className="w-4 h-4" />
            {tabDef.label}
            {tabDef.badge !== undefined && tabDef.badge > 0 && (
              <span className="ms-1 text-xs bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">{tabDef.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-2">{t("audits.scope")}</h2>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{audit.scope || t("common.no_data")}</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-1">
                <Network className="w-4 h-4 text-blue-500" />
                <h2 className="text-sm font-semibold text-gray-800">{t("audit_detail.perimeter")}</h2>
              </div>
              <p className="text-xs text-gray-400 mb-3">{t("audit_detail.perimeter_hint")}</p>
              {perimeterTotal === 0 ? (
                <p className="text-sm text-gray-400 italic">{t("audit_detail.perimeter_none")}</p>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: t("audit_detail.perimeter_processes"), values: perimeterNames.processes },
                    { label: t("audit_detail.perimeter_entities"),  values: perimeterNames.entities },
                    { label: t("audit_detail.perimeter_systems"),   values: perimeterNames.systems },
                  ].map((block) => (
                    <div key={block.label}>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{block.label}</p>
                      {block.values.length === 0 ? (
                        <p className="text-xs text-gray-300">—</p>
                      ) : (
                        <ul className="space-y-1">
                          {block.values.map((v) => (
                            <li key={v} className="text-xs text-gray-600 truncate">{v}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-800">{t("audits.findings")}</h2>
              {[
                { label: t("audit_report.section_nonconformities"), value: findings.filter((f) => (f.finding_type ?? "").startsWith("nonconformity")).length },
                { label: t("audit_detail.finding_statuses.open"), value: findings.filter((f) => f.status === "open").length },
                { label: t("audit_detail.finding_statuses.closed"), value: findings.filter((f) => f.status === "closed" || f.status === "accepted").length },
                { label: t("audit_detail.overdue_badge"), value: findings.filter((f) => f.due_date && f.due_date < today && f.status !== "closed").length },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{s.label}</span>
                  <span className="font-semibold text-gray-900">{s.value}</span>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-2">{t("audit_detail.tab_team")}</h2>
              <p className="text-xs text-gray-400 mb-2">{t("audit_detail.team_hint")}</p>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Building2 className="w-4 h-4 text-gray-300" />
                {nameOf(audit.lead_auditor_id)}
              </div>
            </div>

            {/* Withdrawal — the engagement leaves the register but survives in
                the trail, which is what « conservation » requires. */}
            <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-5 space-y-2">
              <h2 className="text-sm font-semibold text-gray-800">
                {`${t("common.delete")} · ${t("audit_detail.title")}`}
              </h2>
              <label htmlFor="withdraw-reason" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {t("audit_detail.delete_reason")}
              </label>
              <input
                id="withdraw-reason"
                value={withdrawReason}
                onChange={(e) => { setWithdrawReason(e.target.value); setConfirmWithdraw(false); }}
                placeholder={t("audit_detail.delete_reason_placeholder")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              {confirmWithdraw ? (
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busy} onClick={withdrawAudit}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                    {t("audits.yes_delete")}
                  </button>
                  <button type="button" onClick={() => setConfirmWithdraw(false)}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium hover:bg-gray-200">
                    {t("common.cancel")}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmWithdraw(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors">
                  <Trash2 className="w-3 h-3" /> {t("common.delete")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── PLAN ── */}
      {tab === "plan" && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">{t("audit_detail.plan_title")}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{t("audit_detail.plan_hint")}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => setShowPlanModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors">
                <Sparkles className="w-3.5 h-3.5" />
                {audit.audit_plan ? t("audit_detail.plan_regenerate") : t("audit_detail.plan_generate")}
              </button>
              <button type="button" onClick={savePlan} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {t("audit_detail.plan_save")}
              </button>
            </div>
          </div>
          {planSaved && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" /> {t("audit_detail.plan_saved")}
            </p>
          )}
          {!audit.framework_id && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {t("audit_detail.plan_needs_framework")}
            </p>
          )}
          <textarea
            rows={18}
            value={planDraft}
            onChange={(e) => { setPlanDraft(e.target.value); setPlanSaved(false); }}
            placeholder={t("audit_detail.plan_placeholder")}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {!planDraft && (
            <p className="text-xs text-gray-400">{t("audit_detail.plan_empty_hint")}</p>
          )}
        </div>
      )}

      {/* ── FINDINGS ── */}
      {tab === "findings" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <select
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={findingTypeFilter} onChange={(e) => setFindingTypeFilter(e.target.value)}
                title={t("audit_detail.filter_finding_type")}
              >
                <option value="">{t("audit_detail.all_finding_types")}</option>
                {FINDING_TYPES.map((k) => <option key={k} value={k}>{t(`audit_detail.finding_types.${k}`)}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => setFindingModal({ open: true, finding: null })}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t("audit_detail.new_finding")}
            </button>
          </div>

          {visibleFindings.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
              <AlertTriangle className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500">{t("audit_detail.no_findings")}</p>
              <p className="text-xs text-gray-400 mt-1">{t("audit_detail.no_findings_hint")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleFindings.map((f) => {
                const overdue = !!f.due_date && f.due_date < today && f.status !== "closed" && f.status !== "accepted";
                const terminal = f.status === "closed" || f.status === "accepted";
                return (
                  <div key={f.id} className={`bg-white rounded-2xl border shadow-sm p-5 ${overdue ? "border-red-200" : "border-gray-100"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900">{f.title}</h3>
                          {f.finding_type && (
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${FINDING_TYPE_COLORS[f.finding_type] ?? "bg-gray-100 text-gray-600"}`}>
                              {t(`audit_detail.finding_types.${f.finding_type}`, f.finding_type)}
                            </span>
                          )}
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_COLORS[f.severity] ?? "bg-gray-100 text-gray-600"}`}>
                            {t(`audits.finding_${f.severity}`, f.severity)}
                          </span>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${FINDING_STATUS_COLORS[f.status] ?? "bg-gray-100 text-gray-600"}`}>
                            {t(`audit_detail.finding_statuses.${f.status}`, f.status)}
                          </span>
                          {overdue && (
                            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
                              {t("audit_detail.overdue_badge")}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{f.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 flex-wrap">
                          {f.control_id && <span>{t("audit_detail.finding_control")}: {f.control_id}</span>}
                          <span>{t("audit_detail.finding_owner")}: {nameOf(f.remediation_owner_id)}</span>
                          <span>{t("audit_detail.finding_due_date")}: {f.due_date ?? "—"}</span>
                        </div>
                        {f.recommendation && (
                          <div className="mt-3 bg-blue-50/60 border border-blue-100 rounded-lg px-3 py-2">
                            <p className="text-xs font-semibold text-blue-700 mb-0.5">{t("audit_detail.finding_recommendation")}</p>
                            <p className="text-xs text-blue-900 whitespace-pre-wrap">{f.recommendation}</p>
                          </div>
                        )}
                        {f.management_response && (
                          <div className="mt-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                            <p className="text-xs font-semibold text-gray-600 mb-0.5">{t("audit_detail.finding_management_response")}</p>
                            <p className="text-xs text-gray-700 whitespace-pre-wrap">{f.management_response}</p>
                          </div>
                        )}
                        {terminal && f.closure_note && (
                          <div className="mt-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                            <p className="text-xs font-semibold text-green-700 mb-0.5">{t("audit_detail.close_note")}</p>
                            <p className="text-xs text-green-900 whitespace-pre-wrap">{f.closure_note}</p>
                            <p className="text-xs text-green-600 mt-1">
                              {t("audit_detail.closed_on", { date: fmtDate(f.closed_at) })} · {t("audit_detail.closed_by", { name: nameOf(f.closed_by_id) })}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => toggleHistory(f)} title={t("audit_detail.history_title")}
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => setFindingModal({ open: true, finding: f })} title={t("common.edit")}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {!terminal && (
                          <button type="button" onClick={() => setClosingFinding(f)} title={t("audit_detail.close_finding")}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                            <ShieldCheck className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Management response composer — the audité's own field */}
                    {!terminal && (
                      <div className="mt-3 flex items-start gap-2">
                        <textarea
                          rows={1}
                          value={responseDraft[f.id] ?? ""}
                          onChange={(e) => setResponseDraft((prev) => ({ ...prev, [f.id]: e.target.value }))}
                          placeholder={t("audit_detail.respond_placeholder")}
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button type="button" onClick={() => sendResponse(f)}
                          className="px-3 py-2 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium hover:bg-gray-200 transition-colors">
                          {t("audit_detail.respond")}
                        </button>
                      </div>
                    )}

                    {expandedFinding === f.id && (
                      <div className="mt-4 border-t border-gray-100 pt-3 space-y-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("audit_detail.history_title")}</p>
                        {(history[f.id] ?? []).length === 0 ? (
                          <p className="text-xs text-gray-400">{t("audit_detail.history_empty")}</p>
                        ) : (
                          <ol className="space-y-2">
                            {(history[f.id] ?? []).map((ev) => (
                              <li key={ev.id} className="flex items-start gap-2 text-xs">
                                <Clock className="w-3 h-3 text-gray-300 mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-gray-700">
                                    {t("audit_detail.history_from_to", {
                                      from: ev.from_status ? t(`audit_detail.finding_statuses.${ev.from_status}`, ev.from_status) : "—",
                                      to: t(`audit_detail.finding_statuses.${ev.to_status}`, ev.to_status),
                                    })}
                                    <span className="ms-2 text-gray-400">
                                      {ev.is_automatic ? t("audit_detail.history_automatic") : t("audit_detail.history_manual")}
                                    </span>
                                  </p>
                                  <p className="text-gray-400">
                                    {fmtDate(ev.created_at)} · {ev.actor_name || nameOf(ev.actor_id)}
                                  </p>
                                  {ev.note && <p className="text-gray-500 mt-0.5">{ev.note}</p>}
                                </div>
                              </li>
                            ))}
                          </ol>
                        )}

                        <div className="flex items-center gap-2 pt-2 border-t border-gray-50">
                          <input
                            value={deleteReason[f.id] ?? ""}
                            onChange={(e) => setDeleteReason((prev) => ({ ...prev, [f.id]: e.target.value }))}
                            placeholder={t("audit_detail.delete_reason_placeholder")}
                            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
                          />
                          <button type="button" onClick={() => removeFinding(f)} title={t("audit_detail.delete_finding")}
                            className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors flex items-center gap-1">
                            <Trash2 className="w-3 h-3" /> {t("common.delete")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── EVIDENCE ── */}
      {tab === "evidence" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">{t("audit_detail.evidence_title")}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{t("audit_detail.evidence_none_hint")}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={evidenceFinding} onChange={(e) => setEvidenceFinding(e.target.value)}
                  title={t("audit_detail.finding_title")}
                >
                  <option value="">{t("common.none")}</option>
                  {findings.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                </select>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadEvidence(file); }}
                />
                <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {t("audit_detail.evidence_upload")}
                </button>
              </div>
            </div>
          </div>

          {evidence.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
              <Paperclip className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500">{t("audit_detail.evidence_none")}</p>
              <p className="text-xs text-gray-400 mt-1">{t("audit_detail.evidence_none_hint")}</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-start px-5 py-3 font-medium text-gray-500">{t("audit_detail.evidence_name")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_detail.finding_title")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_detail.evidence_size")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_detail.evidence_uploaded_by")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_detail.evidence_uploaded_at")}</th>
                      <th className="text-start px-3 py-3 font-medium text-gray-500">{t("audit_detail.evidence_integrity")}</th>
                      <th className="text-end px-5 py-3 font-medium text-gray-500">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.map((ev) => (
                      <tr key={ev.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-900 truncate max-w-64">{ev.name}</p>
                          {ev.file_name && <p className="text-xs text-gray-400 truncate max-w-64">{ev.file_name}</p>}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-600">
                          {ev.finding_id ? (findings.find((f) => f.id === ev.finding_id)?.title ?? ev.finding_id) : "—"}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-600">{humanSize(ev.file_size_bytes)}</td>
                        <td className="px-3 py-3 text-xs text-gray-600">{nameOf(ev.uploaded_by_id)}</td>
                        <td className="px-3 py-3 text-xs text-gray-600">{fmtDate(ev.created_at)}</td>
                        <td className="px-3 py-3">
                          {ev.file_sha256 ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-700"
                              title={ev.file_sha256}>
                              <CheckCircle className="w-3 h-3" /> {t("audit_detail.evidence_integrity_ok")}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {ev.has_file !== false && (
                              <button type="button" onClick={() => downloadEvidence(ev)} title={t("audit_detail.evidence_download")}
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button type="button" onClick={() => removeEvidence(ev)} title={t("audit_detail.evidence_delete")}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── RECOMMENDATIONS ── */}
      {tab === "recommendations" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">{t("recommendations.subtitle")}</p>
            <div className="flex items-center gap-2">
              <Link to="/recommendations"
                className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                {t("recommendations.dashboard_title")}
              </Link>
              <button type="button" onClick={() => setShowRecoForm((v) => !v)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                <Plus className="w-4 h-4" /> {t("recommendations.new")}
              </button>
            </div>
          </div>

          {showRecoForm && (
            <form onSubmit={createRecommendation} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              <div>
                <label htmlFor="r-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.recommendation")} *</label>
                <input id="r-title" value={recoDraft.title} onChange={(e) => setRecoDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder={t("recommendations.recommendation_placeholder")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label htmlFor="r-finding" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.finding")}</label>
                  <select id="r-finding" value={recoDraft.finding_id} onChange={(e) => setRecoDraft((d) => ({ ...d, finding_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">{t("common.none")}</option>
                    {findings.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="r-priority" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.priority")}</label>
                  <select id="r-priority" value={recoDraft.priority} onChange={(e) => setRecoDraft((d) => ({ ...d, priority: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {RECOMMENDATION_PRIORITIES.map((p) => <option key={p} value={p}>{t(`audits.finding_${p}`, p)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="r-owner" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.owner")}</label>
                  <select id="r-owner" value={recoDraft.owner_id} onChange={(e) => setRecoDraft((d) => ({ ...d, owner_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">{t("common.none")}</option>
                    {directory.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="r-due" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("recommendations.due_date")}</label>
                  <input id="r-due" type="date" value={recoDraft.due_date} onChange={(e) => setRecoDraft((d) => ({ ...d, due_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowRecoForm(false)}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                  {t("common.cancel")}
                </button>
                <button type="submit" disabled={busy}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium">
                  {t("common.save")}
                </button>
              </div>
            </form>
          )}

          {recommendations.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
              <CheckCircle className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500">{t("recommendations.empty_title")}</p>
              <p className="text-xs text-gray-400 mt-1">{t("recommendations.empty_hint")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.map((r) => (
                <div key={r.id} className={`bg-white rounded-2xl border shadow-sm p-5 ${r.is_overdue ? "border-red-200" : "border-gray-100"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r.ref_code && <span className="font-mono text-xs text-gray-400">{r.ref_code}</span>}
                        <h3 className="font-semibold text-gray-900">{r.title}</h3>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RECO_STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {t(`recommendations.statuses.${r.status}`, r.status)}
                        </span>
                        {r.is_overdue && (
                          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
                            {t("recommendations.overdue_badge")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-400 flex-wrap">
                        <span>{t("recommendations.owner")}: {r.owner_name || nameOf(r.owner_id)}</span>
                        <span>{t("recommendations.due_date")}: {r.due_date ?? "—"}</span>
                        <span>{t("audit_detail.linked_actions")}: {r.action_items_done ?? 0}/{r.action_items_total ?? 0}</span>
                      </div>
                    </div>
                    <div className="w-32 shrink-0">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>{t("recommendations.progress")}</span><span>{r.progress}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, r.progress)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── REPORT ── */}
      {tab === "report" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">{t("audit_report.title")}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{t("audit_report.subtitle")}</p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REPORT_COLORS[reportStatus] ?? "bg-gray-100 text-gray-600"}`}>
                {t(`audit_report.statuses.${reportStatus}`, reportStatus)}
              </span>
            </div>

            {/* State machine */}
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" disabled={busy} onClick={() => reportAction("generate")}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {hasReport ? t("audit_report.regenerate") : t("audit_report.generate")}
              </button>

              <button type="button" disabled={!hasReport} onClick={downloadReport}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
                <Download className="w-4 h-4" /> {t("audit_report.download_pdf")}
              </button>

              <button type="button" disabled={!canSubmit || busy} onClick={() => reportAction("submit")}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors">
                <Send className="w-4 h-4" /> {t("audit_report.submit")}
              </button>

              {/* Separation of duties: never offered to whoever produced it. */}
              {!selfProduced && (
                <>
                  <button type="button" disabled={!canDecide || busy} onClick={() => reportAction("approve")}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
                    <ShieldCheck className="w-4 h-4" /> {t("audit_report.approve")}
                  </button>
                  <button type="button" disabled={!canDecide || busy} onClick={() => setShowReject((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors">
                    <XCircle className="w-4 h-4" /> {t("audit_report.reject")}
                  </button>
                </>
              )}
              {selfProduced && reportStatus === "submitted" && (
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <Lock className="w-3.5 h-3.5" /> {t("audit_report.blocked_self_approval")}
                </span>
              )}
            </div>

            {showReject && !selfProduced && (
              <div className="border border-red-200 bg-red-50/60 rounded-xl p-4 space-y-2">
                <label htmlFor="reject-reason" className="block text-xs font-semibold text-red-700 uppercase tracking-wide">
                  {t("audit_report.reject_reason")} *
                </label>
                <textarea id="reject-reason" rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                  placeholder={t("audit_report.reject_reason_placeholder")}
                  className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowReject(false); setRejectReason(""); }}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:bg-gray-50">
                    {t("common.cancel")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => reportAction("reject")}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                    {t("audit_report.reject")}
                  </button>
                </div>
              </div>
            )}

            {/* Lifecycle facts */}
            <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
              {audit.report_submitted_at && (
                <p>{t("audit_report.submitted_on", { date: fmtDate(audit.report_submitted_at), name: nameOf(audit.report_submitted_by_id) })}</p>
              )}
              {audit.report_approved_at && (
                <p>{t("audit_report.approved_on", { date: fmtDate(audit.report_approved_at), name: nameOf(audit.report_approved_by_id) })}</p>
              )}
              {audit.report_issued_at && <p>{t("audit_report.issued_on", { date: fmtDate(audit.report_issued_at) })}</p>}
              {audit.report_rejected_reason && (
                <p className="text-red-600">
                  {t("audit_report.rejected_reason_label")}: {audit.report_rejected_reason}
                </p>
              )}
            </div>
            {!hasReport && (
              <div className="text-center py-8">
                <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-500">{t("audit_report.empty_title")}</p>
                <p className="text-xs text-gray-400 mt-1">{t("audit_report.empty_hint")}</p>
              </div>
            )}
          </div>

          {/* Diffusion */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-800">{t("audit_report.distribute")}</h2>
            {!canDistribute && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t("audit_report.blocked_not_approved")}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="dist-recipients" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {t("audit_report.recipients")}
                </label>
                <input id="dist-recipients" list="audit-directory-emails" value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder={t("audit_report.recipients_placeholder")}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <datalist id="audit-directory-emails">
                  {directory.map((d) => <option key={d.id} value={d.email}>{d.name}</option>)}
                </datalist>
              </div>
              <div>
                <label htmlFor="dist-note" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("common.notes")}</label>
                <input id="dist-note" value={distributeNote} onChange={(e) => setDistributeNote(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <button type="button" disabled={!canDistribute || busy} onClick={() => reportAction("distribute")}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors">
              <Send className="w-4 h-4" /> {t("audit_report.distribute")}
            </button>

            <div className="pt-3 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t("audit_report.distributions_title")}</h3>
              {distributions.length === 0 ? (
                <p className="text-xs text-gray-400">{t("audit_report.no_distributions")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/50">
                        <th className="text-start px-3 py-2 font-medium text-gray-500">{t("audit_report.distribution_recipient")}</th>
                        <th className="text-start px-3 py-2 font-medium text-gray-500">{t("audit_report.distribution_channel")}</th>
                        <th className="text-start px-3 py-2 font-medium text-gray-500">{t("audit_report.distribution_sent_at")}</th>
                        <th className="text-start px-3 py-2 font-medium text-gray-500">{t("frameworks.version")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distributions.map((d) => (
                        <tr key={d.id} className="border-b border-gray-50">
                          <td className="px-3 py-2 text-xs text-gray-700">{d.recipients}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">{d.channel}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">{fmtDate(d.distributed_at ?? d.created_at)}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">{d.report_version}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── COMMENTS ── */}
      {tab === "comments" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-800">{t("audit_comments.title")}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{t("audit_comments.subtitle")}</p>
          </div>

          {comments.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <MessageSquare className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500">{t("audit_comments.no_comments")}</p>
              <p className="text-xs text-gray-400 mt-1">{t("audit_comments.no_comments_hint")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {comments.map((c) => (
                <div key={c.id}
                  className={`bg-white rounded-2xl border shadow-sm p-4 ${c.parent_id ? "ms-8 border-gray-100" : "border-gray-100"} ${c.is_internal ? "bg-amber-50/40" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{c.author_name || c.author_email || "—"}</span>
                        {c.author_is_external && (
                          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-violet-100 text-violet-700">
                            {t("audits.type_external")}
                          </span>
                        )}
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.is_internal ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                          {c.is_internal ? t("audit_comments.internal_badge") : t("audit_comments.shared_badge")}
                        </span>
                        <span className="text-xs text-gray-400">{fmtDate(c.created_at)}</span>
                        {c.edited_at && <span className="text-xs text-gray-300">{t("audit_comments.edited")}</span>}
                      </div>
                      <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">
                        {c.is_deleted
                          ? <span className="italic text-gray-400">{t("threats.action_deleted")}</span>
                          : c.body}
                      </p>
                    </div>
                    {!c.is_deleted && (
                      <button type="button" onClick={() => setReplyTo(c)}
                        className="text-xs text-blue-600 hover:text-blue-800 shrink-0">
                        {t("audit_comments.reply")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={postComment} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            {replyTo && (
              <div className="flex items-center justify-between gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                <span className="truncate">{t("audit_comments.reply")}: {replyTo.body ?? ""}</span>
                <button type="button" onClick={() => setReplyTo(null)} title={t("common.cancel")}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <textarea
              rows={3}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder={replyTo ? t("audit_comments.reply_placeholder") : t("audit_comments.placeholder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center justify-between gap-3">
              {viewerIsAuditTeam ? (
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={commentInternal} onChange={(e) => setCommentInternal(e.target.checked)}
                    className="w-3.5 h-3.5 accent-amber-500" />
                  {t("audit_comments.visibility_internal")}
                  <span className="text-gray-400">— {t("audit_comments.visibility_hint")}</span>
                </label>
              ) : <span />}
              <button type="submit" disabled={postingComment}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {postingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {postingComment ? t("audit_comments.posting") : t("audit_comments.post")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modals */}
      {findingModal.open && (
        <FindingModal
          auditId={audit.id}
          finding={findingModal.finding}
          directory={directory}
          controls={controls}
          onClose={() => setFindingModal({ open: false, finding: null })}
          onSaved={loadFindings}
        />
      )}

      {closingFinding && (
        <CloseFindingModal
          auditId={audit.id}
          finding={closingFinding}
          evidence={evidence.filter((e) => !e.finding_id || e.finding_id === closingFinding.id)}
          onClose={() => setClosingFinding(null)}
          onSaved={() => { loadFindings(); setHistory({}); }}
        />
      )}

      {showPlanModal && (
        <AuditPlanModal
          auditId={audit.id}
          auditTitle={audit.title}
          frameworkId={audit.framework_id ?? null}
          frameworkName={frameworkLabel}
          frameworkShortName={frameworkShort}
          auditScope={audit.scope ?? ""}
          auditType={audit.audit_type}
          perimeter={perimeterNames}
          controls={controls.slice(0, 60).map((c) => ({
            control_id: c.control_id, title: c.title, category: c.category ?? "",
          }))}
          onSaved={(plan) => { setPlanDraft(plan); loadAudit(); }}
          onClose={() => setShowPlanModal(false)}
        />
      )}
    </div>
  );
}
