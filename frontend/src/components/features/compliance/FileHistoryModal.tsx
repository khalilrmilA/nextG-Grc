import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Loader2, X, ShieldCheck, ShieldAlert, ShieldQuestion, FileX, Download } from "lucide-react";
import { complianceApi } from "@/api/endpoints";
import type { StoredFileVersionItem } from "@/types";
import { useAuthStore, hasAnyRole } from "@/store/auth";

/**
 * Every file ever attached to one control assessment — including versions that
 * were replaced and files whose record was deleted.
 *
 * Scoped to the control assessment, never to a single evidence row: versions
 * are numbered per parent and each upload creates a new evidence record, so an
 * evidence-scoped history would always show exactly one entry.
 */

const INTEGRITY: Record<
  string,
  { label: string; className: string; Icon: typeof ShieldCheck; blocked?: boolean }
> = {
  ok: { label: "Verified", className: "bg-green-50 text-green-700 border-green-200", Icon: ShieldCheck },
  modified: { label: "Altered", className: "bg-red-50 text-red-700 border-red-200", Icon: ShieldAlert },
  missing: { label: "File gone", className: "bg-gray-100 text-gray-600 border-gray-200", Icon: FileX, blocked: true },
  unreadable: { label: "Unreadable", className: "bg-amber-50 text-amber-700 border-amber-200", Icon: FileX, blocked: true },
  // Neutral on purpose: a file stored before checksums existed is not evidence
  // of tampering, and colouring it as a failure would cry wolf on every
  // pre-existing file.
  unrecorded: { label: "No checksum", className: "bg-gray-100 text-gray-500 border-gray-200", Icon: ShieldQuestion },
};

const STATUS: Record<string, { label: string; className: string }> = {
  current: { label: "Current", className: "bg-blue-50 text-blue-700 border-blue-200" },
  superseded: { label: "Replaced", className: "bg-gray-100 text-gray-600 border-gray-200" },
  deleted: { label: "Deleted", className: "bg-orange-50 text-orange-700 border-orange-200" },
};

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileHistoryModal({
  parentType,
  parentId,
  title,
  onClose,
}: {
  readonly parentType: string;
  readonly parentId: string;
  readonly title: string;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const user = useAuthStore((u) => u);
  const canOverride = hasAnyRole(user, ["ciso", "tenant_admin", "super_admin"]);

  const [versions, setVersions] = useState<StoredFileVersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    complianceApi
      .listFileVersions(parentType, parentId)
      .then((rows) => {
        if (!cancelled) setVersions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setError(t("compliance.file_history_load_failed", "Could not load file history."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parentType, parentId, t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <History className="w-5 h-5 text-gray-400" />
              {t("compliance.file_history_title", "File history")}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{title}</p>
            <p className="text-xs text-gray-400 mt-1">
              {t(
                "compliance.file_history_subtitle",
                "Every file attached here over time. Deleted files keep their contents and stay downloadable.",
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4">
          {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : versions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">
              {t("compliance.file_history_empty", "No files have been attached here yet.")}
            </p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => {
                const integrity = INTEGRITY[v.integrity] ?? INTEGRITY.unrecorded;
                const status = STATUS[v.status] ?? { label: v.status, className: "bg-gray-100 text-gray-600 border-gray-200" };
                const Icon = integrity.Icon;
                const altered = v.integrity === "modified";
                return (
                  <div key={v.id} className="border border-gray-100 rounded-xl px-4 py-3 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                            v{v.version_number}
                          </span>
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {v.file_name || t("compliance.file_history_unnamed", "Unnamed file")}
                          </span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold border ${status.className}`}>
                            {status.label}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${integrity.className}`}>
                            <Icon className="w-3 h-3" /> {integrity.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>{v.created_at ? new Date(v.created_at).toLocaleString() : "—"}</span>
                          <span>{fmtSize(v.file_size_bytes)}</span>
                        </div>
                        {v.note && <p className="text-xs text-gray-400 mt-1 italic">{v.note}</p>}
                        {altered && (
                          <p className="text-xs text-red-600 mt-1">
                            {t(
                              "compliance.file_history_altered",
                              "This file no longer matches the checksum recorded when it was stored.",
                            )}
                          </p>
                        )}
                      </div>

                      <div className="flex-shrink-0">
                        {integrity.blocked ? (
                          <span className="text-xs text-gray-400">
                            {t("compliance.file_history_unavailable", "Unavailable")}
                          </span>
                        ) : altered ? (
                          canOverride ? (
                            <a
                              href={complianceApi.downloadFileVersionUrl(v.id, true)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50"
                              title={t(
                                "compliance.file_history_override_hint",
                                "Retrieve this altered file for investigation. The download is logged.",
                              )}
                            >
                              <Download className="w-3 h-3" />
                              {t("compliance.file_history_override", "Retrieve anyway")}
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">
                              {t("compliance.file_history_ciso_only", "CISO only")}
                            </span>
                          )
                        ) : (
                          <a
                            href={complianceApi.downloadFileVersionUrl(v.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-100"
                          >
                            <Download className="w-3 h-3" />
                            {t("compliance.file_history_download", "Download")}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FileHistoryModal;
