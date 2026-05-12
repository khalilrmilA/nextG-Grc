import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Upload, CheckCircle, AlertCircle, FileText, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { shareLinksApi, type ShareLinkInfo } from "@/api/endpoints";

export default function EvidenceUploadPage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const [info, setInfo]             = useState<ShareLinkInfo | null>(null);
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [uploaded, setUploaded]     = useState<string[]>([]);
  const [error, setError]           = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    shareLinksApi.getInfo(token)
      .then(setInfo)
      .catch(() => setError(t("share_link.link_not_found")))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !token) return;
    setUploading(true);
    setError("");
    for (const file of Array.from(files)) {
      try {
        await shareLinksApi.uploadFile(token, file);
        setUploaded(prev => [...prev, file.name]);
      } catch {
        setError(t("share_link.failed_upload", { file: file.name }));
      }
    }
    setUploading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-2">{t("share_link.link_unavailable")}</h1>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (info && !info.is_valid) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-orange-400 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-2">{t("share_link.link_expired_title")}</h1>
          <p className="text-sm text-gray-500">{t("share_link.link_expired_desc")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <Upload className="w-7 h-7 text-blue-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">{t("share_link.upload_page_title")}</h1>
          {info?.label && (
            <p className="text-sm text-blue-600 font-medium mt-1">{info.label}</p>
          )}
          {info?.control_identifier && (
            <p className="text-xs text-gray-400 mt-0.5">
              {t("share_link.control_label")}: <span className="font-mono">{info.control_identifier}</span>
              {info.control_title && ` — ${info.control_title}`}
            </p>
          )}
        </div>

        {/* Instructions */}
        {info?.instructions && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm text-blue-800 leading-relaxed">{info.instructions}</p>
          </div>
        )}

        {/* Upload zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          className="border-2 border-dashed border-gray-200 hover:border-blue-300 rounded-2xl p-10 text-center cursor-pointer transition-all hover:bg-blue-50/30"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.xls,.txt"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {uploading ? (
            <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-2" />
          ) : (
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          )}
          <p className="text-sm font-medium text-gray-700">
            {uploading ? t("share_link.uploading") : t("share_link.drop_files")}
          </p>
          <p className="text-xs text-gray-400 mt-1">{t("share_link.file_types")}</p>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Uploaded files */}
        {uploaded.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("share_link.uploaded_label")}</p>
            {uploaded.map((name, i) => (
              <div key={i} className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-2.5">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                <FileText className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                <span className="text-sm font-medium text-green-800 truncate">{name}</span>
              </div>
            ))}
          </div>
        )}

        {info?.max_uses != null && (
          <p className="text-center text-xs text-gray-400">
            {t("share_link.uploads_used", { used: info.use_count, max: info.max_uses })}
          </p>
        )}
        {info?.expires_at && (
          <p className="text-center text-xs text-gray-400">
            {t("share_link.link_expires")} {new Date(info.expires_at).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}
