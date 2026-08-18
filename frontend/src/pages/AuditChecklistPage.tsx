import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Loader2, FileText, Eye,
  ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Clock, MinusCircle,
  ShieldCheck, ShieldAlert, MessageSquareWarning, ShieldOff,
} from "lucide-react";
import { auditorPortalApi, complianceApi, type AuditChecklistControl, type AuditChecklistDocument, type AuditChecklistLinkedDoc } from "@/api/endpoints";
import DocumentViewerModal, { type ViewableDoc } from "@/components/features/compliance/DocumentViewerModal";

// ─── Auditor verdict parsing (mirrors backend _AUDITOR_NOTE_RE) ────────────────

type Verdict = "verified" | "finding" | "observation" | "na";

const VERDICT_CFG: Record<Verdict, { label: string; cls: string; icon: typeof ShieldCheck }> = {
  verified:    { label: "Verified",    cls: "text-green-700 bg-green-50 border-green-200 ring-green-500",   icon: ShieldCheck },
  finding:     { label: "Finding",     cls: "text-red-700 bg-red-50 border-red-200 ring-red-500",           icon: ShieldAlert },
  observation: { label: "Observation", cls: "text-amber-700 bg-amber-50 border-amber-200 ring-amber-500",   icon: MessageSquareWarning },
  na:          { label: "N/A",         cls: "text-gray-500 bg-gray-50 border-gray-200 ring-gray-400",       icon: ShieldOff },
};
const VERDICT_ORDER: Verdict[] = ["verified", "finding", "observation", "na"];

function parseAuditorNote(raw: string | undefined | null): { verdict: Verdict | null; notes: string } {
  if (!raw) return { verdict: null, notes: "" };
  const m = /^\[AUDITOR:(\w+)\] ?([\s\S]*)/.exec(raw);
  if (!m) return { verdict: null, notes: raw };
  const v = m[1] as Verdict;
  return { verdict: (VERDICT_ORDER as string[]).includes(v) ? v : null, notes: m[2] ?? "" };
}

// ─── Status badge config ───────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  implemented:           { label: "Implemented",           cls: "text-green-700 bg-green-50 border-green-200",   icon: CheckCircle2  },
  partially_implemented: { label: "Partially Implemented", cls: "text-yellow-700 bg-yellow-50 border-yellow-200", icon: AlertCircle   },
  not_implemented:       { label: "Not Implemented",       cls: "text-red-700 bg-red-50 border-red-200",         icon: AlertCircle   },
  not_applicable:        { label: "Not Applicable",        cls: "text-gray-500 bg-gray-50 border-gray-200",      icon: MinusCircle   },
  not_started:           { label: "Not Started",           cls: "text-gray-400 bg-gray-50 border-gray-200",      icon: Clock         },
  in_progress:           { label: "In Progress",           cls: "text-blue-700 bg-blue-50 border-blue-200",      icon: Clock         },
};

function docToViewable(doc: AuditChecklistDocument): ViewableDoc {
  return {
    id: doc.id,
    fileName: doc.file_name,
    contentType: doc.content_type,
    fileSizeBytes: doc.file_size_bytes,
    subtitle: doc.clause_ref ? `Clause ${doc.clause_ref}` : doc.is_evidence ? "Stakeholder upload" : undefined,
    fetchUrl: doc.is_evidence
      ? complianceApi.downloadEvidenceUrl(doc.id)
      : complianceApi.downloadDocumentUrl(doc.id),
  };
}

function linkedDocToViewable(doc: AuditChecklistLinkedDoc): ViewableDoc {
  return {
    id: doc.id,
    fileName: doc.file_name,
    contentType: doc.content_type,
    fileSizeBytes: doc.file_size_bytes,
    subtitle: doc.clause_ref ? `Clause ${doc.clause_ref}` : doc.is_evidence ? "Stakeholder upload" : undefined,
    fetchUrl: doc.is_evidence
      ? complianceApi.downloadEvidenceUrl(doc.id)
      : complianceApi.downloadDocumentUrl(doc.id),
  };
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AuditChecklistPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const [controls, setControls]     = useState<AuditChecklistControl[]>([]);
  const [documents, setDocuments]   = useState<AuditChecklistDocument[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [viewingDoc, setViewingDoc] = useState<ViewableDoc | null>(null);

  // Auditor verdicts (RFP mod 13.2 — was read-only)
  const [draftVerdict, setDraftVerdict] = useState<Record<string, Verdict | null>>({});
  const [draftNotes, setDraftNotes]     = useState<Record<string, string>>({});
  const [savingVerdict, setSavingVerdict] = useState<string | null>(null);
  const [verdictError, setVerdictError]   = useState<Record<string, string>>({});

  useEffect(() => {
    if (!assessmentId) return;
    auditorPortalApi.getChecklist(assessmentId)
      .then((data) => {
        setControls(data.controls);
        setDocuments(data.documents ?? []);
        const verdicts: Record<string, Verdict | null> = {};
        const notes: Record<string, string> = {};
        for (const c of data.controls) {
          const parsed = parseAuditorNote(c.auditor_notes);
          verdicts[c.control_assessment_id] = parsed.verdict;
          notes[c.control_assessment_id] = parsed.notes;
        }
        setDraftVerdict(verdicts);
        setDraftNotes(notes);
      })
      .catch(() => setError("Failed to load checklist. Check your assignment status."))
      .finally(() => setLoading(false));
  }, [assessmentId]);

  async function saveVerdict(controlAssessmentId: string) {
    const verdict = draftVerdict[controlAssessmentId];
    if (!verdict) return;
    setSavingVerdict(controlAssessmentId);
    setVerdictError((prev) => ({ ...prev, [controlAssessmentId]: "" }));
    try {
      await auditorPortalApi.recordVerdict(controlAssessmentId, verdict, draftNotes[controlAssessmentId] || "");
      setControls((prev) => prev.map((c) =>
        c.control_assessment_id === controlAssessmentId
          ? { ...c, auditor_notes: `[AUDITOR:${verdict}] ${draftNotes[controlAssessmentId] || ""}` }
          : c
      ));
    } catch {
      setVerdictError((prev) => ({ ...prev, [controlAssessmentId]: "Failed to save verdict. Please try again." }));
    } finally {
      setSavingVerdict(null);
    }
  }

  const closeViewer = useCallback(() => setViewingDoc(null), []);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const implemented = controls.filter((c) => c.status === "implemented").length;
  const reviewedCount = controls.filter((c) => !!draftVerdict[c.control_assessment_id]).length;

  return (
    <>
      {viewingDoc && <DocumentViewerModal doc={viewingDoc} onClose={closeViewer} />}

      <div className="p-8 max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <button
            onClick={() => navigate("/auditor/portal")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to my assignments
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Audit Checklist</h1>
          <p className="text-sm text-gray-500 mt-1">Review evidence and record your verdict for each control</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
        )}

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { value: controls.length,  label: "Total Controls",  color: "text-gray-800"  },
            { value: implemented,      label: "Implemented",     color: "text-green-600" },
            { value: documents.length, label: "Evidence Files",  color: "text-blue-600"  },
            { value: `${reviewedCount}/${controls.length}`, label: "Auditor Reviewed", color: "text-slate-700" },
          ].map(({ value, label, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Top-level evidence documents */}
        {documents.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-gray-700">Company Evidence Documents</h2>
              <span className="text-xs text-gray-400 ml-1">
                {documents.length} file{documents.length !== 1 ? "s" : ""} shared
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {doc.document_name ?? doc.file_name}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {doc.clause_ref ? `Clause ${doc.clause_ref}` : doc.is_evidence ? "Stakeholder upload" : "Document"}
                      {doc.file_size_bytes ? ` · ${(doc.file_size_bytes / 1024).toFixed(1)} KB` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => setViewingDoc(docToViewable(doc))}
                    className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    View
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Controls list — evidence + auditor verdict */}
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {controls.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400">No controls found.</div>
          )}
          {controls.map((ctrl) => {
            const isExpanded = expanded.has(ctrl.control_assessment_id);
            const cfg = STATUS_CFG[ctrl.status] ?? STATUS_CFG["not_started"];
            const StatusIcon = cfg.icon;
            const hasNotes = !!(ctrl.implementation_notes || ctrl.company_notes);
            const hasLinkedDocs = (ctrl.linked_checklist_documents?.length ?? 0) > 0;
            const hasEvidence = hasNotes || hasLinkedDocs;

            return (
              <div key={ctrl.control_assessment_id} className="p-4">
                <button
                  onClick={() => toggleExpand(ctrl.control_assessment_id)}
                  className="w-full flex items-start gap-3 text-left group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                        {ctrl.control_identifier}
                      </span>
                      {ctrl.control_category && (
                        <span className="text-xs text-gray-400">{ctrl.control_category}</span>
                      )}
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.cls}`}>
                        <StatusIcon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                      {hasEvidence && (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                          <Eye className="w-3 h-3" />
                          Evidence
                        </span>
                      )}
                      {(() => {
                        const v = draftVerdict[ctrl.control_assessment_id];
                        if (!v) return null;
                        const vc = VERDICT_CFG[v];
                        const VIcon = vc.icon;
                        return (
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${vc.cls}`}>
                            <VIcon className="w-3 h-3" />
                            {vc.label}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-sm font-medium text-gray-800 group-hover:text-gray-900">
                      {ctrl.control_title}
                    </p>
                  </div>
                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                    : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  }
                </button>

                {isExpanded && (
                  <div className="mt-4 space-y-3 pl-4 border-l-2 border-gray-100">
                    {ctrl.control_description && (
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Requirement</p>
                        <p className="text-xs text-gray-600 leading-relaxed">{ctrl.control_description}</p>
                      </div>
                    )}

                    {hasNotes && (
                      <div className="bg-blue-50 rounded-xl p-4">
                        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5" />
                          Company Evidence
                        </p>
                        {ctrl.implementation_notes && (
                          <p className="text-xs text-blue-800 leading-relaxed">{ctrl.implementation_notes}</p>
                        )}
                        {ctrl.company_notes && (
                          <p className="text-xs text-blue-700 mt-1.5 opacity-80 leading-relaxed">{ctrl.company_notes}</p>
                        )}
                      </div>
                    )}

                    {hasLinkedDocs && (
                      <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
                        <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          Supporting Documents
                        </p>
                        <div className="space-y-1.5">
                          {ctrl.linked_checklist_documents!.map((doc: AuditChecklistLinkedDoc) => (
                            <div key={doc.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-teal-100">
                              <FileText className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-teal-800 truncate">{doc.document_name ?? doc.file_name}</p>
                                <p className="text-xs text-teal-400">
                                  {doc.clause_ref ? `Clause ${doc.clause_ref}` : doc.is_evidence ? "Stakeholder upload" : ""}
                                </p>
                              </div>
                              <button
                                onClick={() => setViewingDoc(linkedDocToViewable(doc))}
                                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors flex-shrink-0"
                              >
                                <Eye className="w-3 h-3" />
                                View
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!hasEvidence && (
                      <div className="flex items-center gap-2 py-2">
                        <AlertCircle className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                        <p className="text-xs text-gray-400 italic">No evidence provided for this control.</p>
                      </div>
                    )}

                    {/* Auditor verdict (RFP mod 13.2) */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2.5">
                        Auditor Verdict
                      </p>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {VERDICT_ORDER.map((v) => {
                          const vc = VERDICT_CFG[v];
                          const VIcon = vc.icon;
                          const active = draftVerdict[ctrl.control_assessment_id] === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setDraftVerdict((prev) => ({ ...prev, [ctrl.control_assessment_id]: v }))}
                              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                                active ? `${vc.cls} ring-2 ring-offset-1` : "text-gray-500 bg-white border-gray-200 hover:bg-gray-50"
                              }`}
                            >
                              <VIcon className="w-3.5 h-3.5" />
                              {vc.label}
                            </button>
                          );
                        })}
                      </div>
                      <textarea
                        value={draftNotes[ctrl.control_assessment_id] ?? ""}
                        onChange={(e) => setDraftNotes((prev) => ({ ...prev, [ctrl.control_assessment_id]: e.target.value }))}
                        rows={2}
                        placeholder="Auditor notes for this control (findings, rationale, follow-up)..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2.5"
                      />
                      {verdictError[ctrl.control_assessment_id] && (
                        <p className="text-xs text-red-600 mb-2">{verdictError[ctrl.control_assessment_id]}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => saveVerdict(ctrl.control_assessment_id)}
                        disabled={!draftVerdict[ctrl.control_assessment_id] || savingVerdict === ctrl.control_assessment_id}
                        className="inline-flex items-center gap-1.5 bg-slate-800 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-900 disabled:opacity-50"
                      >
                        {savingVerdict === ctrl.control_assessment_id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Save Verdict
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
