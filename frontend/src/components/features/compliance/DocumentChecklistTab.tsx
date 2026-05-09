import { useState, useRef, useEffect } from "react";
import {
  Upload, CheckCircle, XCircle, FileText, Loader2, RefreshCw, Plus,
  Eye, EyeOff, Trash2, Download,
} from "lucide-react";
import { complianceApi } from "@/api/endpoints";
import type { DocumentChecklistResponse, MandatoryDocumentStatus, ChecklistUploadedDoc } from "@/types";
import DocumentViewerModal, { type ViewableDoc } from "@/components/features/compliance/DocumentViewerModal";

interface Props {
  readonly assessmentId: string;
  readonly frameworkShortName: string;
}

// ─── Per-file action row ──────────────────────────────────────────────────────

function DocFileRow({
  doc,
  onView,
  onVisibilityToggled,
  onDeleted,
}: {
  readonly doc: ChecklistUploadedDoc;
  readonly onView: (doc: ChecklistUploadedDoc) => void;
  readonly onVisibilityToggled: (updated: ChecklistUploadedDoc) => void;
  readonly onDeleted: (id: string) => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleToggle() {
    setToggling(true);
    setToggleError(false);
    try {
      const updated = await complianceApi.toggleDocumentVisibility(doc.id);
      // toggleDocumentVisibility returns ChecklistDocItem — same shape as ChecklistUploadedDoc
      onVisibilityToggled(updated as unknown as ChecklistUploadedDoc);
    } catch {
      setToggleError(true);
      setTimeout(() => setToggleError(false), 3000);
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    setDeleting(true);
    try {
      await complianceApi.deleteDocument(doc.id);
      onDeleted(doc.id);
    } catch {
      setDeleting(false);
    }
  }

  function handleOpen() { onView(doc); }

  if (deleting) return null;

  const eyeBtn = toggling
    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
    : doc.is_visible_to_auditor
      ? <Eye className="w-3.5 h-3.5" />
      : <EyeOff className="w-3.5 h-3.5" />;

  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${
      toggleError
        ? "bg-red-50 border-red-200"
        : "bg-green-50 border-green-100"
    }`}>
      <FileText className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
      <span className="text-xs text-green-800 truncate flex-1 max-w-[150px]">{doc.file_name}</span>
      {toggleError && (
        <span className="text-xs text-red-600 flex-shrink-0">Save failed</span>
      )}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={handleOpen}
          title="View file"
          className="p-1 rounded hover:bg-green-100 text-green-600 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        {doc.kind !== "evidence" && (
          <>
            <button
              onClick={handleToggle}
              disabled={toggling}
              title={doc.is_visible_to_auditor ? "Hide from auditor" : "Show to auditor"}
              className={`p-1 rounded transition-colors ${
                doc.is_visible_to_auditor
                  ? "text-blue-600 hover:bg-blue-50"
                  : "text-gray-400 hover:bg-gray-100"
              }`}
            >
              {eyeBtn}
            </button>
            <button
              onClick={handleDelete}
              title="Delete file"
              className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Per-clause row ───────────────────────────────────────────────────────────

function ClauseRow({
  item,
  assessmentId,
  onView,
  onUploaded,
  onVisibilityToggled,
  onDeleted,
}: {
  readonly item: MandatoryDocumentStatus;
  readonly assessmentId: string;
  readonly onView: (doc: ChecklistUploadedDoc) => void;
  readonly onUploaded: (key: string, newDoc: ChecklistUploadedDoc) => void;
  readonly onVisibilityToggled: (key: string, updated: ChecklistUploadedDoc) => void;
  readonly onDeleted: (key: string, docId: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);
    if (!fileArr.length) return;
    setUploadingCount(fileArr.length);
    setError("");
    for (const file of fileArr) {
      setUploading(true);
      try {
        const result = await complianceApi.uploadDocument(assessmentId, file, item.document_type_key);
        // Backend now returns is_visible_to_auditor and file_path in UploadedDocumentResponse
        const newDoc: ChecklistUploadedDoc = {
          id: result.id,
          file_name: result.file_name,
          file_path: (result as unknown as { file_path?: string | null }).file_path ?? null,
          content_type: result.content_type ?? null,
          file_size_bytes: result.file_size_bytes ?? null,
          is_visible_to_auditor: (result as unknown as { is_visible_to_auditor?: boolean }).is_visible_to_auditor ?? true,
          created_at: result.created_at,
        };
        onUploaded(item.document_type_key, newDoc);
      } catch {
        setError("One or more uploads failed");
      }
    }
    setUploading(false);
    setUploadingCount(0);
  }

  const docs = item.uploaded_documents ?? [];

  const uploadBtnLabel = (() => {
    if (uploading) return uploadingCount > 1 ? `Uploading ${uploadingCount} files…` : "Uploading…";
    return docs.length > 0 ? "Add More" : "Upload";
  })();

  const uploadBtnIcon = uploading
    ? <Loader2 className="w-3 h-3 animate-spin" />
    : docs.length > 0
      ? <Plus className="w-3 h-3" />
      : <Upload className="w-3 h-3" />;

  return (
    <tr className="hover:bg-gray-50 transition-colors align-top">
      <td className="px-4 py-3 text-xs font-mono text-gray-500 whitespace-nowrap">{item.clause_ref}</td>
      <td className="px-4 py-3">
        <p className="text-sm text-gray-800 font-medium">{item.document_name}</p>
        {item.description && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        {item.is_mandatory ? (
          <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Required</span>
        ) : (
          <span className="text-xs font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">Optional</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        {item.is_uploaded ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
            <CheckCircle className="w-3 h-3" />
            {docs.length > 1 ? `${docs.length} files` : "Uploaded"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
            <XCircle className="w-3 h-3" />
            Missing
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 items-end">
          {docs.length > 0 && (
            <div className="w-full space-y-1">
              {docs.map((d) => (
                <DocFileRow
                  key={d.id}
                  doc={d}
                  onView={onView}
                  onVisibilityToggled={(updated) => onVisibilityToggled(item.document_type_key, updated)}
                  onDeleted={(id) => onDeleted(item.document_type_key, id)}
                />
              ))}
            </div>
          )}

          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
              docs.length > 0
                ? "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {uploadBtnIcon}
            {uploadBtnLabel}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.xls,.txt"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                handleFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DocumentChecklistTab({ assessmentId, frameworkShortName }: Props) {
  const [checklist, setChecklist] = useState<DocumentChecklistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "missing" | "uploaded">("all");
  const [viewingDoc, setViewingDoc] = useState<ViewableDoc | null>(null);

  function openViewer(doc: ChecklistUploadedDoc) {
    const fetchUrl = doc.kind === "evidence"
      ? complianceApi.downloadEvidenceUrl(doc.id)
      : complianceApi.downloadDocumentUrl(doc.id);
    setViewingDoc({
      id: doc.id,
      fetchUrl,
      fileName: doc.file_name,
      contentType: doc.content_type ?? undefined,
      fileSizeBytes: doc.file_size_bytes ?? undefined,
    });
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await complianceApi.getDocumentChecklist(assessmentId);
      setChecklist(data);
    } catch {
      setError("Failed to load document checklist.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [assessmentId]);

  function handleUploaded(key: string, newDoc: ChecklistUploadedDoc) {
    setChecklist((prev) => {
      if (!prev) return prev;
      const wasUploaded = prev.items.find(i => i.document_type_key === key)?.is_uploaded;
      return {
        ...prev,
        uploaded: wasUploaded ? prev.uploaded : prev.uploaded + 1,
        items: prev.items.map((item) => {
          if (item.document_type_key !== key) return item;
          return {
            ...item,
            is_uploaded: true,
            uploaded_documents: [...(item.uploaded_documents ?? []), newDoc],
          };
        }),
      };
    });
  }

  function handleVisibilityToggled(key: string, updated: ChecklistUploadedDoc) {
    setChecklist((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((item) => {
          if (item.document_type_key !== key) return item;
          return {
            ...item,
            uploaded_documents: (item.uploaded_documents ?? []).map((d) =>
              d.id === updated.id ? updated : d
            ),
          };
        }),
      };
    });
  }

  function handleDeleted(key: string, docId: string) {
    setChecklist((prev) => {
      if (!prev) return prev;
      const newItems = prev.items.map((item) => {
        if (item.document_type_key !== key) return item;
        const remaining = (item.uploaded_documents ?? []).filter(d => d.id !== docId);
        return { ...item, is_uploaded: remaining.length > 0, uploaded_documents: remaining };
      });
      const newUploaded = newItems.filter(i => i.is_uploaded).length;
      return { ...prev, uploaded: newUploaded, items: newItems };
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
        <span className="text-sm text-gray-500">Loading checklist…</span>
      </div>
    );
  }

  if (error || !checklist) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-red-600 mb-3">{error || "No checklist available."}</p>
        <button onClick={load} className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const pct = checklist.total > 0 ? Math.round((checklist.uploaded / checklist.total) * 100) : 0;

  const filtered = checklist.items.filter((item) => {
    if (filter === "missing") return !item.is_uploaded;
    if (filter === "uploaded") return item.is_uploaded;
    return true;
  });

  const missingMandatory = checklist.items.filter((i) => i.is_mandatory && !i.is_uploaded);

  const pctColor = pct >= 80 ? "text-green-600" : pct >= 50 ? "text-yellow-600" : "text-red-600";
  const barColor = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400";

  return (
    <div className="space-y-5">
      {/* Progress header */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Mandatory Documents — {frameworkShortName}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {checklist.uploaded} of {checklist.total} documents uploaded
            </p>
          </div>
          <div className="text-right">
            <p className={`text-2xl font-bold ${pctColor}`}>{pct}%</p>
            <p className="text-xs text-gray-400">complete</p>
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {missingMandatory.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            <span className="text-xs text-gray-400">Missing required:</span>
            {missingMandatory.slice(0, 5).map((d) => (
              <span key={d.document_type_key} className="text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                {d.document_name}
              </span>
            ))}
            {missingMandatory.length > 5 && (
              <span className="text-xs text-gray-400">+{missingMandatory.length - 5} more</span>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-1 text-xs text-gray-500">
        <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5 text-blue-500" /> Visible to auditor</span>
        <span className="flex items-center gap-1"><EyeOff className="w-3.5 h-3.5 text-gray-400" /> Hidden from auditor</span>
        <span className="flex items-center gap-1"><Download className="w-3.5 h-3.5 text-green-600" /> View / Download</span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["all", "missing", "uploaded"] as const).map((f) => {
          const counts = { all: checklist.total, missing: checklist.total - checklist.uploaded, uploaded: checklist.uploaded };
          const label = f === "all" ? "All" : f === "missing" ? "Missing" : "Uploaded";
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {label}
              <span className="ml-1.5 opacity-70">{counts[f]}</span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No documents in this category.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Clause</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Document</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Type</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Files & Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((item) => (
                  <ClauseRow
                    key={item.document_type_key}
                    item={item}
                    assessmentId={assessmentId}
                    onView={openViewer}
                    onUploaded={handleUploaded}
                    onVisibilityToggled={handleVisibilityToggled}
                    onDeleted={handleDeleted}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stakeholder uploads — files received via share link that don't match a specific clause */}
      {(checklist.other_uploads?.length ?? 0) > 0 && (
        <div className="bg-white rounded-2xl border border-orange-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-orange-100 bg-orange-50 flex items-center gap-2">
            <FileText className="w-4 h-4 text-orange-500" />
            <h3 className="text-sm font-semibold text-orange-800">Stakeholder Uploads</h3>
            <span className="text-xs text-orange-500 ml-1">
              {checklist.other_uploads!.length} file{checklist.other_uploads!.length !== 1 ? "s" : ""} received via share link
            </span>
          </div>
          <div className="divide-y divide-gray-50 px-5 py-3 space-y-1.5">
            {checklist.other_uploads!.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2 rounded-lg px-3 py-2 border bg-green-50 border-green-100">
                <FileText className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-green-800 truncate block">{doc.file_name}</span>
                  {doc.file_size_bytes && (
                    <span className="text-xs text-green-500">{(doc.file_size_bytes / 1024).toFixed(1)} KB</span>
                  )}
                </div>
                <button
                  onClick={() => openViewer(doc)}
                  title="View file"
                  className="p-1 rounded hover:bg-green-100 text-green-600 transition-colors flex-shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewingDoc && (
        <DocumentViewerModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />
      )}
    </div>
  );
}
