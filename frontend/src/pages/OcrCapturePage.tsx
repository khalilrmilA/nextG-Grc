import { useState, useEffect, useRef } from "react";
import { ScanLine, Loader2, Crown, Upload, FileText, Copy, Check, Download, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ocrApi } from "@/api/endpoints";

type OcrPage = { page: number; method: string; chars: number; text: string };
type OcrResult = {
  lang: string; kind: string; method: string; chars: number;
  page_count: number; total_pages: number; truncated: boolean;
  text: string; pages: OcrPage[];
};
type OcrStatus = {
  ocr_available: boolean; languages: string[]; selectable_languages: string[];
  pdf_text_layer: boolean; pdf_scanned: boolean; max_upload_mb: number; max_pages: number;
};

const LANG_LABELS: Record<string, string> = {
  "fra+eng": "Français + English", fra: "Français", eng: "English",
  "ara+fra": "العربية + Français", "ara+eng": "العربية + English", ara: "العربية",
};

export default function OcrCapturePage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OcrStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState("fra+eng");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OcrResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ocrApi.status()
      .then((s: OcrStatus) => {
        setStatus(s);
        if (s.selectable_languages?.length && !s.selectable_languages.includes("fra+eng")) {
          setLang(s.selectable_languages[0]);
        }
      })
      .catch(() => setStatus(null));
  }, []);

  const maxMb = status?.max_upload_mb ?? 20;

  function pick(f: File | null) {
    setError(""); setResult(null);
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      setError(t("ocr.err_too_big", "File exceeds the {{mb}} MB limit", { mb: maxMb }));
      return;
    }
    setFile(f);
  }

  async function run() {
    if (!file) return;
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(await ocrApi.extract(file, lang));
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("ocr.err_failed", "Extraction failed. Check the file and try again."));
    } finally { setBusy(false); }
  }

  async function copyText() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — the textarea is selectable anyway */ }
  }

  function downloadText() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(file?.name || "extraction").replace(/\.[^.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const langOptions = status?.selectable_languages?.length ? status.selectable_languages : ["fra+eng", "fra", "eng"];

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">{t("ocr.title", "Document Capture (OCR)")}</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-600">
            <Crown className="w-3 h-3" /> {t("ocr.elite", "Elite Pack")}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {t("ocr.subtitle", "Extract text from scanned documents and PDFs — French and English recognition, page by page")}
        </p>
      </div>

      {status && !status.ocr_available && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm bg-amber-50 text-amber-800 border border-amber-100">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {t("ocr.engine_missing", "The OCR engine is not installed on this server. Install tesseract-ocr and tesseract-ocr-fra to enable capture.")}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0] || null); }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragging ? "border-blue-400 bg-blue-50/60" : "border-gray-200 hover:border-blue-300 hover:bg-gray-50/60"
            }`}
          >
            <input
              ref={inputRef} type="file" className="hidden"
              accept=".pdf,image/png,image/jpeg,image/tiff,image/bmp,image/webp"
              onChange={(e) => pick(e.target.files?.[0] || null)}
            />
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-700">
                <FileText className="w-5 h-5 text-blue-500" />
                <span className="font-medium">{file.name}</span>
                <span className="text-gray-400">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                <div className="text-sm font-medium text-gray-700">{t("ocr.drop", "Drop a scan or PDF here, or click to browse")}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {t("ocr.accepts", "PDF, PNG, JPEG, TIFF — up to {{mb}} MB, first {{pages}} pages", { mb: maxMb, pages: status?.max_pages ?? 20 })}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 shrink-0">{t("ocr.language", "Language")}</label>
            <select
              value={lang} onChange={(e) => setLang(e.target.value)}
              className="flex-1 border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {langOptions.map((l) => <option key={l} value={l}>{LANG_LABELS[l] || l}</option>)}
            </select>
            <button
              onClick={run} disabled={!file || busy || (status ? !status.ocr_available : false)}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />} {t("ocr.extract", "Extract text")}
            </button>
          </div>

          <p className="text-xs text-gray-400">
            {t("ocr.hint", "PDFs that already carry a text layer are read directly — only scanned pages go through OCR, so digital documents come back instantly and exactly.")}
          </p>

          {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-100">{error}</div>}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          {!result ? (
            <div className="text-center py-16 text-gray-400">
              <ScanLine className="w-8 h-8 mx-auto mb-3 text-gray-300" />
              {t("ocr.no_result", "Extracted text will appear here.")}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full px-2.5 py-0.5 font-semibold bg-blue-100 text-blue-700">
                    {result.kind === "pdf"
                      ? t("ocr.pages_read", "{{count}} of {{total}} pages", { count: result.page_count, total: result.total_pages })
                      : t("ocr.image", "Image")}
                  </span>
                  <span className="rounded-full px-2.5 py-0.5 font-semibold bg-gray-100 text-gray-600">
                    {result.method === "text_layer" ? t("ocr.m_text", "Text layer") : result.method === "mixed" ? t("ocr.m_mixed", "Mixed") : t("ocr.m_ocr", "OCR")}
                  </span>
                  <span className="text-gray-400">{t("ocr.chars", "{{n}} characters", { n: result.chars })}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={copyText} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50">
                    {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? t("ocr.copied", "Copied") : t("ocr.copy", "Copy")}
                  </button>
                  <button onClick={downloadText} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50">
                    <Download className="w-3.5 h-3.5" /> {t("ocr.download", "Download .txt")}
                  </button>
                </div>
              </div>

              {result.truncated && (
                <div className="p-3 rounded-xl text-xs bg-amber-50 text-amber-800 border border-amber-100">
                  {t("ocr.truncated", "Only the first {{count}} pages were processed out of {{total}}.", { count: result.page_count, total: result.total_pages })}
                </div>
              )}

              {/* Document reader — one white "sheet" per page on a soft canvas */}
              <div className="max-h-[32rem] overflow-auto rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-4">
                {(result.pages?.length
                  ? result.pages
                  : [{ page: 1, method: result.method, chars: result.chars, text: result.text }]
                ).map((p) => (
                  <div key={p.page} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50/70">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                        {t("ocr.page", "Page")} {p.page}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.chars === 0 ? "bg-gray-100 text-gray-400"
                            : p.method === "text_layer" ? "bg-green-100 text-green-700" : "bg-purple-100 text-purple-700"
                        }`}>
                          {p.method === "text_layer" ? t("ocr.m_text", "Text layer") : t("ocr.m_ocr", "OCR")}
                        </span>
                        <span className="text-[10px] text-gray-400 tabular-nums">{t("ocr.chars_short", "{{n}} chars", { n: p.chars })}</span>
                      </div>
                    </div>
                    <pre dir="auto" className="px-5 py-4 text-[13px] leading-relaxed text-gray-800 whitespace-pre-wrap break-words font-sans selection:bg-blue-100">
                      {p.text?.trim() ? p.text : <span className="text-gray-300 italic">{t("ocr.empty_page", "— no text on this page —")}</span>}
                    </pre>
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
