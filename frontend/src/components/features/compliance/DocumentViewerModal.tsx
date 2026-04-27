import { useState, useEffect } from "react";
import { FileText, Download, X, Loader2, AlertCircle } from "lucide-react";

export interface ViewableDoc {
  id: string;
  fileName: string;
  contentType?: string | null;
  fileSizeBytes?: number | null;
  subtitle?: string | null;
  /** Fully-qualified URL to fetch the file (auth header is added automatically). */
  fetchUrl: string;
}

export default function DocumentViewerModal({
  doc,
  onClose,
}: {
  readonly doc: ViewableDoc;
  readonly onClose: () => void;
}) {
  const [blobUrl, setBlobUrl]       = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState("");

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const stored = localStorage.getItem("grc_user_v2");
    const token = stored ? (JSON.parse(stored)?.accessToken ?? "") : "";
    let objectUrl: string | null = null;

    fetch(doc.fetchUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => {
        if (!res.ok) { setFetchError("Could not load document."); return; }
        const blob = await res.blob();
        const isText =
          blob.type.startsWith("text/") ||
          doc.fileName?.endsWith(".txt") ||
          doc.fileName?.endsWith(".md");
        if (isText) {
          setTextContent(await blob.text());
        } else {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      })
      .catch(() => setFetchError("Failed to fetch document."))
      .finally(() => setLoading(false));

    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.fetchUrl, doc.fileName]);

  const isImage = doc.contentType?.startsWith("image/");
  const isPdf   = doc.contentType === "application/pdf" || doc.fileName?.endsWith(".pdf");

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Overlay */}
      <div className="absolute inset-0 bg-gray-900/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 flex flex-col w-full h-full max-w-5xl mx-auto my-6 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 bg-white border-b border-gray-100 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{doc.fileName}</p>
            <p className="text-xs text-gray-400">
              {doc.subtitle ?? "Document"}
              {doc.fileSizeBytes ? ` · ${(doc.fileSizeBytes / 1024).toFixed(1)} KB` : ""}
            </p>
          </div>

          {blobUrl && (
            <a
              href={blobUrl}
              download={doc.fileName}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden bg-gray-50">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-3" />
                <p className="text-sm text-gray-400">Loading document…</p>
              </div>
            </div>
          )}

          {fetchError && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <AlertCircle className="w-10 h-10 text-red-300 mx-auto mb-3" />
                <p className="text-sm text-red-500">{fetchError}</p>
              </div>
            </div>
          )}

          {/* Plain text */}
          {!loading && !fetchError && textContent !== null && (
            <div className="h-full overflow-auto p-6 md:p-10">
              <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="px-7 py-4 border-b border-gray-100 flex items-center gap-3">
                  <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <span className="text-xs font-medium text-gray-500 truncate">{doc.fileName}</span>
                </div>
                <div className="px-7 py-6">
                  <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono leading-7 break-words">
                    {textContent}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Image */}
          {!loading && !fetchError && blobUrl && isImage && (
            <div className="flex items-center justify-center h-full p-8">
              <img
                src={blobUrl}
                alt={doc.fileName}
                className="max-w-full max-h-full object-contain rounded-xl shadow-lg"
              />
            </div>
          )}

          {/* PDF */}
          {!loading && !fetchError && blobUrl && isPdf && (
            <iframe
              src={blobUrl}
              className="w-full h-full border-0"
              title={doc.fileName}
            />
          )}

          {/* Unsupported */}
          {!loading && !fetchError && blobUrl && !isImage && !isPdf && (
            <div className="flex flex-col items-center justify-center h-full gap-5">
              <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center">
                <FileText className="w-10 h-10 text-gray-300" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600 mb-1">Preview not available</p>
                <p className="text-xs text-gray-400">This file type cannot be previewed in the browser.</p>
              </div>
              <a
                href={blobUrl}
                download={doc.fileName}
                className="flex items-center gap-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-5 py-2.5 rounded-xl transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" />
                Download to view
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
