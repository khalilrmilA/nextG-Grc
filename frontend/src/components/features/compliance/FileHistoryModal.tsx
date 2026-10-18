import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Loader2, X, ShieldCheck, ShieldAlert, ShieldQuestion, FileX, Download } from "lucide-react";
import { complianceApi } from "@/api/endpoints";
// GET /compliance/files/versions/{id}/download is HTTPBearer-only, so a bare
// <a href> (what this modal used to render) answers 401 for everyone. Until
// complianceApi grows a Blob sibling (api lane), the bytes are fetched on the
// same authenticated client the api objects wrap — never a bare fetch/axios.
import { apiClient } from "@/api/client";
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

// Labels are keys, not literals: this modal is opened from screens a Tunisian
// bank operates in French and Arabic, and a badge reading "Verified" in an
// otherwise French page is a defect the tender would flag. Until the locale
// files carry the compliance.file_* keys, each badge falls back to an existing
// key that IS translated in en/fr/ar — never to bare English.
const INTEGRITY: Record<
  string,
  { labelKey: string; fallbackKey: string; className: string; Icon: typeof ShieldCheck; blocked?: boolean }
> = {
  ok: { labelKey: "compliance.file_integrity_ok", fallbackKey: "audit_detail.evidence_integrity_ok", className: "bg-green-50 text-green-700 border-green-200", Icon: ShieldCheck },
  modified: { labelKey: "compliance.file_integrity_modified", fallbackKey: "audit_detail.evidence_integrity_failed", className: "bg-red-50 text-red-700 border-red-200", Icon: ShieldAlert },
  missing: { labelKey: "compliance.file_integrity_missing", fallbackKey: "compliance.doc_missing", className: "bg-gray-100 text-gray-600 border-gray-200", Icon: FileX, blocked: true },
  unreadable: { labelKey: "compliance.file_integrity_unreadable", fallbackKey: "errors.load_failed", className: "bg-amber-50 text-amber-700 border-amber-200", Icon: FileX, blocked: true },
  // Neutral on purpose: a file stored before checksums existed is not evidence
  // of tampering, and colouring it as a failure would cry wolf on every
  // pre-existing file.
  unrecorded: { labelKey: "compliance.file_integrity_unrecorded", fallbackKey: "common.none", className: "bg-gray-100 text-gray-500 border-gray-200", Icon: ShieldQuestion },
};

const STATUS: Record<string, { labelKey: string; fallbackKey: string; className: string }> = {
  current: { labelKey: "compliance.file_status_current", fallbackKey: "policies.current_version", className: "bg-blue-50 text-blue-700 border-blue-200" },
  superseded: { labelKey: "compliance.file_status_superseded", fallbackKey: "common.previous", className: "bg-gray-100 text-gray-600 border-gray-200" },
  deleted: { labelKey: "compliance.file_status_deleted", fallbackKey: "threats.action_deleted", className: "bg-orange-50 text-orange-700 border-orange-200" },
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
  mode = "parent",
}: {
  readonly parentType: string;
  readonly parentId: string;
  readonly title: string;
  readonly onClose: () => void;
  /** "deleted" lists every deleted file of the tenant (GET /compliance/files/deleted)
   *  instead of one parent's history — the recovery list (CISO / compliance manager). */
  readonly mode?: "parent" | "deleted";
}) {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((u) => u);
  const canOverride = hasAnyRole(user, ["ciso", "tenant_admin", "super_admin"]);

  const [versions, setVersions] = useState<StoredFileVersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");

  async function downloadVersion(version: StoredFileVersionItem, acknowledgeIntegrityFailure = false) {
    setDownloading(version.id);
    setError("");
    try {
      const blob = await apiClient
        .get(`/compliance/files/versions/${version.id}/download`, {
          params: acknowledgeIntegrityFailure ? { acknowledge_integrity_failure: true } : undefined,
          responseType: "blob",
        })
        .then((r) => r.data as Blob);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = version.file_name || `version-${version.version_number}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError(t("errors.load_failed"));
    } finally {
      setDownloading("");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (mode === "deleted" ? complianceApi.listDeletedFiles() : complianceApi.listFileVersions(parentType, parentId))
      .then((rows) => {
        if (!cancelled) setVersions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setError(t("compliance.file_history_load_failed", { defaultValue: t("errors.load_failed") }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parentType, parentId, mode, t]);

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
              {mode === "deleted"
                ? t("r2.compliance.deleted_files_title")
                : t("compliance.file_history_title", { defaultValue: t("treatment.history") })}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{title}</p>
            {mode === "deleted" ? (
              <p className="text-xs text-gray-400 mt-1">{t("r2.compliance.deleted_files_subtitle")}</p>
            ) : i18n.exists("compliance.file_history_subtitle") && (
              <p className="text-xs text-gray-400 mt-1">{t("compliance.file_history_subtitle")}</p>
            )}
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
              {t("compliance.file_history_empty", { defaultValue: t("common.no_data") })}
            </p>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => {
                const integrity = INTEGRITY[v.integrity] ?? INTEGRITY.unrecorded;
                const status = STATUS[v.status] ?? { labelKey: "", fallbackKey: "", className: "bg-gray-100 text-gray-600 border-gray-200" };
                const statusLabel = status.labelKey
                  ? t(status.labelKey, { defaultValue: t(status.fallbackKey) })
                  : v.status;
                const integrityLabel = t(integrity.labelKey, { defaultValue: t(integrity.fallbackKey) });
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
                            {v.file_name || t("compliance.file_history_unnamed", { defaultValue: t("common.none") })}
                          </span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold border ${status.className}`}>
                            {statusLabel}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${integrity.className}`}>
                            <Icon className="w-3 h-3" /> {integrityLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>{v.created_at ? new Date(v.created_at).toLocaleString(i18n.language?.startsWith("fr") ? "fr-FR" : i18n.language?.startsWith("ar") ? "ar-u-nu-latn" : "en-GB") : "—"}</span>
                          <span>{fmtSize(v.file_size_bytes)}</span>
                        </div>
                        {v.note && <p className="text-xs text-gray-400 mt-1 italic">{v.note}</p>}
                        {altered && (
                          <p className="text-xs text-red-600 mt-1">
                            {t("compliance.file_history_altered", {
                              defaultValue: t("archiving.evidence_integrity_failed"),
                            })}
                          </p>
                        )}
                      </div>

                      <div className="flex-shrink-0">
                        {integrity.blocked ? (
                          <span className="text-xs text-gray-400">
                            {t("compliance.file_history_unavailable", { defaultValue: t("compliance.doc_missing") })}
                          </span>
                        ) : altered ? (
                          canOverride ? (
                            <button
                              type="button"
                              onClick={() => downloadVersion(v, true)}
                              disabled={downloading === v.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-50"
                              title={t("compliance.file_history_override_hint", {
                                defaultValue: t("archiving.evidence_integrity_failed"),
                              })}
                            >
                              {downloading === v.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Download className="w-3 h-3" />}
                              {t("compliance.file_history_override", { defaultValue: t("common.download") })}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">
                              {t("compliance.file_history_ciso_only", { defaultValue: t("roles.ciso") })}
                            </span>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => downloadVersion(v)}
                            disabled={downloading === v.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-100 disabled:opacity-50"
                          >
                            {downloading === v.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Download className="w-3 h-3" />}
                            {t("compliance.file_history_download", { defaultValue: t("common.download") })}
                          </button>
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
