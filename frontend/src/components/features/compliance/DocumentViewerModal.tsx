import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Download, X, Loader2, AlertCircle, Shield, BookOpen, ChevronRight } from "lucide-react";

export interface ViewableDoc {
  id: string;
  fileName: string;
  contentType?: string | null;
  fileSizeBytes?: number | null;
  subtitle?: string | null;
  fetchUrl: string;
}

// ─── Smart text parser ─────────────────────────────────────────────────────────

type Block =
  | { type: "title"; text: string }
  | { type: "meta"; text: string }
  | { type: "divider" }
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "bullet"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "blank" };

function parseDocument(raw: string): Block[] {
  const lines = raw.split(/\r?\n/);
  const blocks: Block[] = [];
  let titleFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip pure box-drawing separator lines
    if (/^[═━─=─\-]{6,}$/.test(trimmed)) {
      blocks.push({ type: "divider" });
      continue;
    }

    // Empty line
    if (!trimmed) {
      blocks.push({ type: "blank" });
      continue;
    }

    // Very first non-empty lines = title block
    if (!titleFound && blocks.filter(b => b.type !== "blank").length < 3) {
      titleFound = true;
      blocks.push({ type: "title", text: trimmed });
      continue;
    }

    // Meta lines (Version, Date, Approved by, etc.)
    if (/^(Version|Effective Date|Classification|Approved by|Review Cycle|Next Review|Document Owner|Approved By|Author)[\s:]/i.test(trimmed)) {
      blocks.push({ type: "meta", text: trimmed });
      continue;
    }

    // SECTION heading with ═══ before and after  → H1
    const prevBlock = blocks[blocks.length - 1];
    const nextLine = lines[i + 1]?.trim() ?? "";
    if (
      prevBlock?.type === "divider" &&
      /^[═━─=─\-]{6,}$/.test(nextLine)
    ) {
      blocks.push({ type: "h1", text: trimmed });
      continue;
    }

    // Numbered section heading: "1.1 Title" or "SECTION 1 —"
    if (/^(SECTION\s+\d+|§\s*\d+)[\s—–\-]/i.test(trimmed)) {
      blocks.push({ type: "h1", text: trimmed });
      continue;
    }

    // Sub-section: "1.1 Title" pattern
    if (/^\d+\.\d+\s+[A-Z]/.test(trimmed)) {
      blocks.push({ type: "h2", text: trimmed });
      continue;
    }

    // Bold-style sub-section (short line, ends without punctuation, title case)
    if (
      trimmed.length < 80 &&
      /^[A-Z][a-zA-Z\s,&/()]+$/.test(trimmed) &&
      !trimmed.endsWith(".") &&
      !trimmed.endsWith(",") &&
      !trimmed.startsWith("-") &&
      trimmed.split(" ").length >= 2 &&
      trimmed.split(" ").length <= 10
    ) {
      blocks.push({ type: "h3", text: trimmed });
      continue;
    }

    // Bullet points
    if (/^[-•*]\s/.test(trimmed) || /^[A-Z][a-zA-Z\s]+:\s/.test(trimmed.substring(0, 40))) {
      if (/^[-•*]\s/.test(trimmed)) {
        blocks.push({ type: "bullet", text: trimmed.replace(/^[-•*]\s+/, "") });
        continue;
      }
    }

    // Indented sub-bullets
    if (/^\s{2,}[-•*]\s/.test(line)) {
      blocks.push({ type: "bullet", text: "  " + trimmed.replace(/^[-•*]\s+/, "") });
      continue;
    }

    blocks.push({ type: "paragraph", text: trimmed });
  }

  return blocks;
}

function renderBlocks(blocks: Block[]) {
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let blankCount = 0;

  function flushBullets() {
    if (bulletBuffer.length === 0) return;
    elements.push(
      <ul key={`ul-${elements.length}`} className="my-3 space-y-1.5 pl-1">
        {bulletBuffer.map((b, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-gray-700 leading-relaxed">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
            <span className={b.startsWith("  ") ? "text-gray-500 pl-4" : ""}>{b.trim()}</span>
          </li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    if (b.type !== "bullet") flushBullets();

    if (b.type === "blank") {
      blankCount++;
      if (blankCount === 1) elements.push(<div key={`sp-${i}`} className="h-2" />);
      continue;
    }
    blankCount = 0;

    if (b.type === "title") {
      elements.push(
        <h1 key={i} className="text-2xl font-bold text-gray-900 leading-tight mb-1">
          {b.text}
        </h1>
      );
    } else if (b.type === "meta") {
      elements.push(
        <p key={i} className="text-xs text-gray-500 leading-relaxed">{b.text}</p>
      );
    } else if (b.type === "divider") {
      // Only render visible divider if the previous was a heading
      const prev = blocks[i - 1];
      if (prev?.type === "h1" || prev?.type === "blank") {
        // skip — h1 already has a border
      } else {
        elements.push(<hr key={i} className="my-4 border-gray-100" />);
      }
    } else if (b.type === "h1") {
      elements.push(
        <div key={i} className="mt-8 mb-4 pb-2 border-b-2 border-blue-100">
          <div className="flex items-center gap-2">
            <div className="w-1 h-6 bg-blue-500 rounded-full flex-shrink-0" />
            <h2 className="text-base font-bold text-blue-800 uppercase tracking-wide">
              {b.text}
            </h2>
          </div>
        </div>
      );
    } else if (b.type === "h2") {
      elements.push(
        <h3 key={i} className="mt-5 mb-2 text-sm font-bold text-gray-800 flex items-center gap-1.5">
          <ChevronRight className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
          {b.text}
        </h3>
      );
    } else if (b.type === "h3") {
      elements.push(
        <h4 key={i} className="mt-3 mb-1 text-sm font-semibold text-gray-700">
          {b.text}
        </h4>
      );
    } else if (b.type === "bullet") {
      bulletBuffer.push(b.text);
    } else if (b.type === "paragraph") {
      elements.push(
        <p key={i} className="text-sm text-gray-700 leading-relaxed">
          {b.text}
        </p>
      );
    }
  }

  flushBullets();
  return elements;
}

// ─── Table of Contents ────────────────────────────────────────────────────────

function TableOfContents({ blocks, onJump }: { blocks: Block[]; onJump: (i: number) => void }) {
  const sections = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.type === "h1" || b.type === "h2");

  const { t } = useTranslation();
  if (sections.length < 3) return null;

  return (
    <div className="w-56 flex-shrink-0 bg-gray-50 border-r border-gray-100 overflow-y-auto p-4 hidden lg:block">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{t("doc_viewer.contents")}</p>
      <nav className="space-y-0.5">
        {sections.map(({ b, i }) => (
          <button
            key={i}
            onClick={() => onJump(i)}
            className={`w-full text-left px-2 py-1 rounded text-xs transition-colors hover:bg-blue-50 hover:text-blue-700 ${
              b.type === "h1"
                ? "font-semibold text-gray-700 mt-2"
                : "text-gray-500 pl-4"
            }`}
          >
            {(b as { text: string }).text.replace(/^SECTION \d+ — /i, "")}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function DocumentViewerModal({
  doc,
  onClose,
}: {
  readonly doc: ViewableDoc;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl]         = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [fetchError, setFetchError]   = useState("");
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);

  const isImage = doc.contentType?.startsWith("image/");
  const isPdf   = doc.contentType === "application/pdf" || doc.fileName?.toLowerCase().endsWith(".pdf");
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
        if (!res.ok) {
          // 409 is the integrity guard: the file no longer matches the
          // checksum recorded at upload. That is a very different thing from
          // "not found", and an auditor has to be told which one it is —
          // showing the same generic line for both hides a tampered file.
          if (res.status === 409) {
            // The backend's 409 detail is English-only; the translated line
            // says the same thing in the viewer's language.
            setFetchError(t("doc_viewer.integrity_failed"));
            return;
          }
          setFetchError(t("doc_viewer.load_failed"));
          return;
        }
        const blob = await res.blob();
        const looksLikeText =
          blob.type.startsWith("text/") ||
          doc.fileName?.toLowerCase().endsWith(".txt") ||
          doc.fileName?.toLowerCase().endsWith(".md") ||
          doc.fileName?.toLowerCase().endsWith(".csv");

        if (looksLikeText) {
          const text = await blob.text();
          setTextContent(text);
        } else {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      })
      .catch(() => setFetchError(t("doc_viewer.fetch_failed")))
      .finally(() => setLoading(false));

    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.fetchUrl, doc.fileName]);

  const blocks = useMemo(() =>
    textContent !== null ? parseDocument(textContent) : [],
    [textContent]
  );

  const rendered = useMemo(() => renderBlocks(blocks), [blocks]);

  function jumpToBlock(blockIndex: number) {
    if (!scrollContainer) return;
    const els = scrollContainer.querySelectorAll("[data-block]");
    els[blockIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const ext = doc.fileName?.split(".").pop()?.toUpperCase() ?? "FILE";
  const extColor: Record<string, string> = {
    PDF: "bg-red-100 text-red-700",
    TXT: "bg-blue-100 text-blue-700",
    DOCX: "bg-blue-100 text-blue-700",
    DOC: "bg-blue-100 text-blue-700",
    PNG: "bg-purple-100 text-purple-700",
    JPG: "bg-purple-100 text-purple-700",
    JPEG: "bg-purple-100 text-purple-700",
    CSV: "bg-green-100 text-green-700",
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal shell */}
      <div className="relative z-10 flex flex-col w-full h-full max-w-6xl mx-auto my-6 bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* ── Header bar ── */}
        <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-gray-100 flex-shrink-0">
          {/* Icon */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center flex-shrink-0 border border-blue-100">
            {isPdf ? (
              <BookOpen className="w-5 h-5 text-red-500" />
            ) : isImage ? (
              <Shield className="w-5 h-5 text-purple-500" />
            ) : (
              <FileText className="w-5 h-5 text-blue-500" />
            )}
          </div>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900 truncate">{doc.fileName}</p>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${extColor[ext] ?? "bg-gray-100 text-gray-500"}`}>
                {ext}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {doc.subtitle ?? t("doc_viewer.preview")}
              {doc.fileSizeBytes ? ` · ${(doc.fileSizeBytes / 1024).toFixed(1)} KB` : ""}
            </p>
          </div>

          {/* Actions */}
          {(blobUrl || textContent) && (
            <a
              href={blobUrl ?? `data:text/plain;charset=utf-8,${encodeURIComponent(textContent ?? "")}`}
              download={doc.fileName}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors border border-blue-100"
            >
              <Download className="w-3.5 h-3.5" />
              {t("common.download")}
            </a>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
            title={t("doc_viewer.close_esc")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden bg-gray-50">

          {/* Loading */}
          {loading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                </div>
                <p className="text-sm text-gray-400">{t("doc_viewer.loading")}</p>
              </div>
            </div>
          )}

          {/* Error */}
          {fetchError && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-6 h-6 text-red-400" />
                </div>
                <p className="text-sm font-medium text-red-600 mb-1">{t("doc_viewer.load_failed_title")}</p>
                <p className="text-xs text-gray-400">{fetchError}</p>
              </div>
            </div>
          )}

          {/* ── Rich text viewer ── */}
          {!loading && !fetchError && textContent !== null && (
            <>
              <TableOfContents blocks={blocks} onJump={jumpToBlock} />
              <div
                ref={setScrollContainer}
                className="flex-1 overflow-y-auto"
              >
                {/* Document paper */}
                <div className="max-w-3xl mx-auto my-8 px-4">
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    {/* Document header bar */}
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-8 py-5">
                      <div className="flex items-center gap-2 mb-1">
                        <Shield className="w-4 h-4 text-blue-200" />
                        <span className="text-blue-200 text-xs font-medium uppercase tracking-widest">
                          {t("doc_viewer.security_document")}
                        </span>
                      </div>
                      <p className="text-white font-bold text-lg leading-tight truncate">{doc.fileName}</p>
                      {doc.fileSizeBytes && (
                        <p className="text-blue-300 text-xs mt-1">
                          {(doc.fileSizeBytes / 1024).toFixed(1)} KB · {t("doc_viewer.ext_document", { ext })}
                        </p>
                      )}
                    </div>

                    {/* Document body */}
                    <div className="px-8 py-8 space-y-1">
                      {rendered}
                    </div>

                    {/* Footer */}
                    <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                      <p className="text-xs text-gray-400">
                        {doc.fileName}
                        {doc.fileSizeBytes ? ` · ${(doc.fileSizeBytes / 1024).toFixed(1)} KB` : ""}
                      </p>
                      <span className="text-xs text-gray-300">GRCEye — NextStep IT</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Image */}
          {!loading && !fetchError && blobUrl && isImage && (
            <div className="flex-1 flex items-center justify-center p-10">
              <img
                src={blobUrl}
                alt={doc.fileName}
                className="max-w-full max-h-full object-contain rounded-2xl shadow-xl border border-gray-100"
              />
            </div>
          )}

          {/* PDF */}
          {!loading && !fetchError && blobUrl && isPdf && (
            <iframe
              src={blobUrl}
              className="flex-1 border-0"
              title={doc.fileName}
            />
          )}

          {/* Unsupported */}
          {!loading && !fetchError && blobUrl && !isImage && !isPdf && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <div className="w-20 h-20 rounded-3xl bg-gray-100 flex items-center justify-center">
                <FileText className="w-10 h-10 text-gray-300" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700 mb-1">{t("doc_viewer.no_preview")}</p>
                <p className="text-xs text-gray-400">{t("doc_viewer.no_preview_hint")}</p>
              </div>
              <a
                href={blobUrl}
                download={doc.fileName}
                className="flex items-center gap-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-6 py-2.5 rounded-xl transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" />
                {t("doc_viewer.download_to_view")}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
