import { useState, useRef, useEffect } from "react";
import { Upload, CheckCircle, XCircle, FileText, Loader2, RefreshCw } from "lucide-react";
import { complianceApi } from "@/api/endpoints";
import type { DocumentChecklistResponse, MandatoryDocumentStatus } from "@/types";

interface Props {
  readonly assessmentId: string;
  readonly frameworkShortName: string;
}

function ClauseRow({
  item,
  assessmentId,
  onUploaded,
}: {
  readonly item: MandatoryDocumentStatus;
  readonly assessmentId: string;
  readonly onUploaded: (key: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError("");
    try {
      await complianceApi.uploadDocument(assessmentId, file);
      onUploaded(item.document_type_key);
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <tr className="hover:bg-gray-50 transition-colors">
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
            Uploaded
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
            <XCircle className="w-3 h-3" />
            Missing
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {item.is_uploaded ? (
          <div className="flex items-center justify-end gap-2">
            {item.uploaded_document && (
              <span className="text-xs text-gray-400 truncate max-w-[120px]">
                {item.uploaded_document.file_name}
              </span>
            )}
            <button
              onClick={() => inputRef.current?.click()}
              className="text-xs text-blue-600 hover:underline"
            >
              Replace
            </button>
          </div>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            {uploading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Upload className="w-3 h-3" />
            )}
            {uploading ? "Uploading…" : "Upload"}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </td>
    </tr>
  );
}

export default function DocumentChecklistTab({ assessmentId, frameworkShortName }: Props) {
  const [checklist, setChecklist] = useState<DocumentChecklistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "missing" | "uploaded">("all");

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

  function handleUploaded(key: string) {
    setChecklist((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        uploaded: prev.uploaded + 1,
        items: prev.items.map((item) =>
          item.document_type_key === key ? { ...item, is_uploaded: true } : item
        ),
      };
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
            <p className={`text-2xl font-bold ${pct >= 80 ? "text-green-600" : pct >= 50 ? "text-yellow-600" : "text-red-600"}`}>
              {pct}%
            </p>
            <p className="text-xs text-gray-400">complete</p>
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400"}`}
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

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["all", "missing", "uploaded"] as const).map((f) => {
          const counts = { all: checklist.total, missing: checklist.total - checklist.uploaded, uploaded: checklist.uploaded };
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
              {f === "all" ? "All" : f === "missing" ? "Missing" : "Uploaded"}
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
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((item) => (
                  <ClauseRow
                    key={item.document_type_key}
                    item={item}
                    assessmentId={assessmentId}
                    onUploaded={handleUploaded}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
