import { useState, useEffect, useMemo } from "react";
import {
  Plus, Search, X, Loader2, Filter, Shield, Trash2, Tag, BarChart3,
  Sparkles, Download, ThumbsUp, ThumbsDown, Clock, CheckCircle2, RefreshCw,
  AlertTriangle, ExternalLink, CheckCheck, ChevronRight, ChevronDown, Pencil, Lock, Rss,
  BadgeCheck, CalendarClock, CopyPlus, History, TrendingUp, Languages,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { threatsApi, assetsApi, vulnerabilitiesApi } from "@/api/endpoints";
// Same axios instance as every `api` object (auth header, 401 refresh, outage
// guard) — used directly only because api/endpoints.ts is owned by another lane
// in this wave and cannot gain a `trend()` wrapper here. See needs_integration.
import { apiClient } from "@/api/client";
import { MultiSelect, type MultiSelectOption } from "@/components/common/MultiSelect";
import ModuleDashboard from "@/components/dashboards/ModuleDashboard";
import { useBucketLabel } from "@/components/common/Breakdown";
import i18n from "@/i18n";

// Dates follow the UI language (Arabic keeps Latin digits).
const uiLocale = () => { const l = i18n.language || "en"; return l.startsWith("fr") ? "fr-FR" : l.startsWith("ar") ? "ar-u-nu-latn" : "en-US"; };

const PROBABILITY_LEVELS = ["rare", "peu_probable", "possible", "probable", "quasiment_certain"];
const SEVERITY_LEVELS = ["mineur", "notable", "fort", "tres_fort", "critique"];
// The four families the threat register must be classifiable by.
const THREAT_TYPES = ["operationnelle", "organisationnelle", "environnementale", "technologique"];

const CATEGORY_OPTIONS = [
  "cyber_attack", "social_engineering", "insider_threat", "supply_chain",
  "physical", "natural_disaster", "technical_failure", "human_error", "legal_regulatory",
];

const CATEGORY_BADGE: Record<string, string> = {
  cyber_attack:       "bg-red-100 text-red-700 border-red-200",
  social_engineering: "bg-orange-100 text-orange-700 border-orange-200",
  insider_threat:     "bg-purple-100 text-purple-700 border-purple-200",
  supply_chain:       "bg-yellow-100 text-yellow-700 border-yellow-200",
  physical:           "bg-gray-100 text-gray-700 border-gray-200",
  natural_disaster:   "bg-blue-100 text-blue-700 border-blue-200",
  technical_failure:  "bg-cyan-100 text-cyan-700 border-cyan-200",
  human_error:        "bg-pink-100 text-pink-700 border-pink-200",
  legal_regulatory:   "bg-indigo-100 text-indigo-700 border-indigo-200",
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high:     "bg-orange-100 text-orange-700 border-orange-200",
  medium:   "bg-yellow-100 text-yellow-700 border-yellow-200",
  low:      "bg-green-100 text-green-700 border-green-200",
};

// NOTE: the former `fmt()` humaniser is gone. It was not a label function —
// `fmt("cyber_attack")` reads "Cyber Attack" in every language, so a French or
// Arabic reader was shown English enum values on every card, every group
// heading and every filter of this page. Everything user-visible goes through
// `useBucketLabel()` instead (vocab → moduledash.vocab → humanised fallback).

/** Remember whether the operator keeps the dashboard panel open. localStorage
 *  THROWS outright in some privacy modes — a preference must never take the
 *  threat page down with it. */
const DASH_LS_KEY = "grceye.moduledash.threats.open";

function readDashOpen(): boolean {
  try {
    return window.localStorage.getItem(DASH_LS_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The server's own message for a failed call — it is the one an operator can
 *  act on. Never a redirect: a 5xx hard-redirects this SPA to /service-down,
 *  i.e. ejects the user out of the application instead of showing the failure. */
function errorDetail(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : "";
}

// ── Machine-translated feed text ──────────────────────────────────────────────
//
// System threats — the built-in catalogue (MITRE in English, BQ-* in French) and
// feed imports (SANS ISC / CISA KEV / OSM) — and watch items are stored in one
// language. For a reader of another UI language the API swaps in a cached
// machine translation and sets `translated`, keeping the stored text in
// original_* — so the reader is told the text was machine-translated and can
// always see the original.

/** Name/description (or title/summary) to display, honouring "show original". */
function feedText(item: any, showOriginal: boolean, fields: [string, string] = ["name", "description"]) {
  const [a, b] = fields;
  if (!item?.translated || !showOriginal) return { primary: item?.[a], secondary: item?.[b] };
  return {
    primary: item[`original_${a}`] ?? item[a],
    secondary: item[`original_${b}`] ?? item[b],
  };
}

function AutoTranslatedBadge({ showingOriginal, onToggle }: { showingOriginal: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold bg-sky-50 text-sky-700 border border-sky-200"
        title={t("threats.auto_translated_hint", "Machine-translated from the original text")}
      >
        <Languages className="w-3 h-3" />
        {t("threats.auto_translated", "Auto-translated")}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="font-medium text-sky-700 hover:text-sky-900 underline-offset-2 hover:underline"
      >
        {showingOriginal
          ? t("threats.show_translation", "Show translation")
          : t("threats.show_original", "Show original")}
      </button>
    </span>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────

const EMPTY_PROFILE_FORM = {
  origin: "",
  objectives: "",
  aggravating_factors: "",
  occurrence_conditions: "",
  estimated_frequency: "",
  mode_operatoire: "",
  probability_level: "",
  severity_level: "",
  threat_type: "",
  linked_asset_ids: [] as string[],
  linked_vulnerability_ids: [] as string[],
};

function ThreatDetailModal({ threat, onClose, onUpdated }: { threat: any; onClose: () => void; onUpdated: (updated: any) => void }) {
  const { t } = useTranslation();
  const label = useBucketLabel();
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [profileError, setProfileError] = useState("");
  const [saving, setSaving] = useState(false);
  const [assetOptions, setAssetOptions] = useState<MultiSelectOption[]>([]);
  const [vulnOptions, setVulnOptions] = useState<MultiSelectOption[]>([]);
  const [busy, setBusy] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const shown = feedText(threat, showOriginal);

  async function runAction(kind: "adopt" | "validate" | "review") {
    setBusy(kind); setProfileError("");
    try {
      const updated =
        kind === "adopt" ? await threatsApi.adopt(threat.id)
        : kind === "validate" ? await threatsApi.validateProfile(threat.id)
        : await threatsApi.reviewProfile(threat.id);
      onUpdated(updated);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setProfileError(typeof detail === "string" ? detail : t("common.error", "Something went wrong."));
    } finally { setBusy(""); }
  }

  async function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history === null) {
      try { setHistory(await threatsApi.history(threat.id)); } catch { setHistory([]); }
    }
  }

  const hasProfile = !!(
    threat.origin || threat.objectives || threat.aggravating_factors || threat.occurrence_conditions ||
    threat.estimated_frequency || threat.mode_operatoire || threat.probability_level || threat.severity_level ||
    threat.linked_asset_ids?.length || threat.linked_vulnerability_ids?.length
  );

  useEffect(() => {
    Promise.allSettled([assetsApi.options(), vulnerabilitiesApi.list()]).then(([a, v]) => {
      const unwrap = (r: PromiseSettledResult<any>): any[] => {
        if (r.status !== "fulfilled") return [];
        const d = r.value;
        return Array.isArray(d) ? d : d.items || [];
      };
      setAssetOptions(unwrap(a).map((x: any) => ({ id: x.id, label: x.name })));
      setVulnOptions(unwrap(v).map((x: any) => ({ id: x.id, label: x.title })));
    });
  }, []);

  function startEditingProfile() {
    setProfileForm({
      origin: threat.origin || "",
      objectives: threat.objectives || "",
      aggravating_factors: threat.aggravating_factors || "",
      occurrence_conditions: threat.occurrence_conditions || "",
      estimated_frequency: threat.estimated_frequency || "",
      mode_operatoire: threat.mode_operatoire || "",
      probability_level: threat.probability_level || "",
      severity_level: threat.severity_level || "",
      // Only send a type the assessor actually chose. Sending back a derived
      // default would silently promote a guess into a stated classification.
      threat_type: threat.threat_type_derived ? "" : (threat.threat_type || ""),
      linked_asset_ids: threat.linked_asset_ids || [],
      linked_vulnerability_ids: threat.linked_vulnerability_ids || [],
    });
    setProfileError("");
    setEditingProfile(true);
  }

  async function saveProfile() {
    setSaving(true);
    setProfileError("");
    try {
      const updated = await threatsApi.updateProfile(threat.id, profileForm);
      onUpdated(updated);
      setEditingProfile(false);
    } catch (err: any) {
      setProfileError(err?.response?.data?.detail || t("threats.error_profile_save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {threat.ref_id && (
                <span className="font-mono text-xs font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                  {threat.ref_id}
                </span>
              )}
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CATEGORY_BADGE[threat.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                {label(threat.category || "other")}
              </span>
              {threat.severity && (
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${SEVERITY_BADGE[threat.severity] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                  {label(threat.severity)}
                </span>
              )}
              {threat.is_builtin && (
                <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                  {t("threats.builtin")}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{shown.primary}</h2>
            {threat.translated && (
              <div className="mt-1.5">
                <AutoTranslatedBadge showingOriginal={showOriginal} onToggle={() => setShowOriginal((v) => !v)} />
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0 mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Description */}
          {shown.secondary && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t("common.description")}</h3>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{shown.secondary}</p>
            </div>
          )}

          {/* Threat actors */}
          {threat.typical_threat_actors?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t("threats.threat_actors")}</h3>
              <div className="flex flex-wrap gap-1.5">
                {threat.typical_threat_actors.map((a: string, i: number) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs bg-red-50 text-red-700 border border-red-200">
                    <AlertTriangle className="w-3 h-3" />{a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Attack vectors / tags */}
          {threat.typical_attack_vectors?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t("threats.attack_vectors")}</h3>
              <div className="flex flex-wrap gap-1.5">
                {threat.typical_attack_vectors.map((v: string, i: number) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs bg-orange-50 text-orange-700 border border-orange-200">
                    <Tag className="w-3 h-3" />{v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* MITRE IDs */}
          {threat.mitre_ids?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t("threats.mitre_ids")}</h3>
              <div className="flex flex-wrap gap-1.5">
                {threat.mitre_ids.map((id: string, i: number) => (
                  <span key={i} className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-mono bg-purple-50 text-purple-700 border border-purple-200">
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Affected assets */}
          {threat.affected_assets?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t("threats.affected_assets")}</h3>
              <div className="flex flex-wrap gap-1.5">
                {threat.affected_assets.map((a: string, i: number) => (
                  <span key={i} className="inline-flex rounded-full px-2.5 py-0.5 text-xs bg-gray-100 text-gray-600 border border-gray-200">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source + link */}
          {(threat.source || threat.url) && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t("threats.col_source")}</h3>
              <div className="flex items-center gap-3">
                {threat.source && (
                  <span className="text-sm text-gray-600 font-medium">{threat.source}</span>
                )}
                {threat.url && (
                  <a
                    href={threat.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> {t("threats.view_advisory")}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Threat profile (RFP mod 4.2) */}
          <div className="border-t border-gray-100 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t("threats.profile_section_title")}</h3>
              {!threat.is_builtin && !editingProfile && (
                <button
                  onClick={startEditingProfile}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
                >
                  <Pencil className="w-3.5 h-3.5" /> {hasProfile ? t("threats.btn_edit_profile") : t("threats.btn_add_profile")}
                </button>
              )}
            </div>

            {threat.is_builtin && (
              <div className="flex items-start gap-2 mb-4 text-xs bg-gray-50 rounded-lg px-3 py-2.5">
                <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                <div className="flex-1">
                  <p className="text-gray-500">
                    {t("threats.builtin_shared", "This is a shared catalogue entry, so it cannot carry your organisation's assessment. Add it to your register to profile it.")}
                  </p>
                  <button
                    onClick={() => runAction("adopt")}
                    disabled={busy === "adopt"}
                    className="mt-2 inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy === "adopt" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CopyPlus className="w-3.5 h-3.5" />}
                    {t("threats.btn_adopt", "Add to my register")}
                  </button>
                </div>
              </div>
            )}

            {!threat.is_builtin && (
              <div className="mb-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                    threat.profile_status === "validated"
                      ? "bg-green-100 text-green-700 border-green-200"
                      : "bg-amber-100 text-amber-700 border-amber-200"}`}>
                    {threat.profile_status === "validated"
                      ? <><BadgeCheck className="w-3 h-3" /> {t("threats.profile_validated", "Profile validated")}</>
                      : <><Clock className="w-3 h-3" /> {t("threats.profile_draft", "Profile in draft")}</>}
                  </span>
                  {threat.threat_type && (
                    <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                      {String(t(`threats.type_${threat.threat_type}` as never, threat.threat_type))}
                      {threat.threat_type_derived && <span className="ml-1 text-gray-400">{t("threats.type_derived", "(from category)")}</span>}
                    </span>
                  )}
                  {threat.next_review_due && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                      threat.review_overdue
                        ? "bg-red-100 text-red-700 border-red-200"
                        : "bg-gray-100 text-gray-600 border-gray-200"}`}>
                      <CalendarClock className="w-3 h-3" />
                      {threat.review_overdue
                        ? t("threats.review_overdue", "Review overdue since {{date}}", { date: threat.next_review_due })
                        : t("threats.review_due", "Review due {{date}}", { date: threat.next_review_due })}
                    </span>
                  )}
                </div>

                {threat.profile_missing?.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {t("threats.profile_missing", "Still to document before it can be signed off:")}{" "}
                    <span className="text-gray-700">
                      {threat.profile_missing.map((f: string) => String(t(`threats.field_${f}` as never, f))).join(", ")}
                    </span>
                  </p>
                )}

                {!editingProfile && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {threat.profile_status !== "validated" && (
                      <button
                        onClick={() => runAction("validate")}
                        disabled={busy === "validate" || threat.profile_missing?.length > 0}
                        title={threat.profile_missing?.length > 0 ? t("threats.validate_blocked", "Complete the profile first") : undefined}
                        className="inline-flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-40"
                      >
                        {busy === "validate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
                        {t("threats.btn_validate_profile", "Validate profile")}
                      </button>
                    )}
                    {threat.profile_status === "validated" && (
                      <button
                        onClick={() => runAction("review")}
                        disabled={busy === "review"}
                        className="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
                      >
                        {busy === "review" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
                        {t("threats.btn_review_profile", "Record a review")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {profileError && <div className="mb-3 p-2.5 bg-red-50 text-red-700 rounded-lg text-xs">{profileError}</div>}

            {!threat.is_builtin && (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={toggleHistory}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  {showHistory ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <History className="w-3.5 h-3.5" /> {t("threats.history_title", "Change history")}
                </button>
                {showHistory && (
                  <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
                    {history === null ? (
                      <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-blue-400" /></div>
                    ) : history.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">{t("threats.history_empty", "Nothing recorded yet.")}</p>
                    ) : history.map((h: any) => (
                      <div key={h.id} className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-700">
                            {String(t(`threats.action_${h.action}` as never, h.action.replace(/_/g, " ")))}
                          </span>
                          <span className="text-[11px] text-gray-400 whitespace-nowrap">
                            {h.created_at ? new Date(h.created_at).toLocaleString(uiLocale()) : ""}
                          </span>
                        </div>
                        {h.actor_email && <p className="text-[11px] text-gray-400">{h.actor_email}</p>}
                        {h.note && <p className="text-xs text-gray-500 italic mt-0.5">{h.note}</p>}
                        {h.changes && Object.keys(h.changes).length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {Object.entries(h.changes).slice(0, 6).map(([field, ch]: any) => (
                              <li key={field} className="text-[11px] text-gray-600 break-words">
                                <span className="text-gray-400">{String(t(`threats.field_${field}` as never, field))}:</span>{" "}
                                <span className="line-through text-gray-400">{String(ch?.from ?? "—").slice(0, 40) || "—"}</span>
                                {" → "}
                                <span className="text-gray-800">{String(ch?.to ?? "—").slice(0, 40) || "—"}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {editingProfile ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_origin")}</label>
                  <textarea value={profileForm.origin} onChange={(e) => setProfileForm({ ...profileForm, origin: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_objectives")}</label>
                  <textarea value={profileForm.objectives} onChange={(e) => setProfileForm({ ...profileForm, objectives: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_mode_operatoire")}</label>
                  <textarea value={profileForm.mode_operatoire} onChange={(e) => setProfileForm({ ...profileForm, mode_operatoire: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_occurrence_conditions")}</label>
                  <textarea value={profileForm.occurrence_conditions} onChange={(e) => setProfileForm({ ...profileForm, occurrence_conditions: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_aggravating_factors")}</label>
                  <textarea value={profileForm.aggravating_factors} onChange={(e) => setProfileForm({ ...profileForm, aggravating_factors: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_estimated_frequency")}</label>
                  <input value={profileForm.estimated_frequency} onChange={(e) => setProfileForm({ ...profileForm, estimated_frequency: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_probability_level")}</label>
                    <select value={profileForm.probability_level} onChange={(e) => setProfileForm({ ...profileForm, probability_level: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">-</option>
                      {PROBABILITY_LEVELS.map((p) => <option key={p} value={p}>{t(`threats.probability_${p}` as never)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_severity_level")}</label>
                    <select value={profileForm.severity_level} onChange={(e) => setProfileForm({ ...profileForm, severity_level: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">-</option>
                      {SEVERITY_LEVELS.map((s) => <option key={s} value={s}>{t(`threats.severity_${s}` as never)}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_threat_type", "Threat family")}</label>
                  <select
                    value={profileForm.threat_type}
                    onChange={(e) => setProfileForm({ ...profileForm, threat_type: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t("threats.type_from_category", "Derive from the category")}</option>
                    {THREAT_TYPES.map((ty) => <option key={ty} value={ty}>{String(t(`threats.type_${ty}` as never, ty))}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_linked_assets")}</label>
                  <MultiSelect options={assetOptions} selected={profileForm.linked_asset_ids} onChange={(ids) => setProfileForm({ ...profileForm, linked_asset_ids: ids })} placeholder={t("risk_scenarios.select_placeholder")} emptyLabel={t("risk_scenarios.no_options")} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("threats.profile_linked_vulnerabilities")}</label>
                  <MultiSelect options={vulnOptions} selected={profileForm.linked_vulnerability_ids} onChange={(ids) => setProfileForm({ ...profileForm, linked_vulnerability_ids: ids })} placeholder={t("risk_scenarios.select_placeholder")} emptyLabel={t("risk_scenarios.no_options")} />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setEditingProfile(false)} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">{t("threats.btn_cancel")}</button>
                  <button type="button" onClick={saveProfile} disabled={saving} className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("common.save")}
                  </button>
                </div>
              </div>
            ) : hasProfile ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {threat.probability_level && (
                  <div>
                    <dt className="text-xs text-gray-400">{t("threats.profile_probability_level")}</dt>
                    <dd className="text-gray-800 font-medium">{t(`threats.probability_${threat.probability_level}` as never)}</dd>
                  </div>
                )}
                {threat.severity_level && (
                  <div>
                    <dt className="text-xs text-gray-400">{t("threats.profile_severity_level")}</dt>
                    <dd className="text-gray-800 font-medium">{t(`threats.severity_${threat.severity_level}` as never)}</dd>
                  </div>
                )}
                {threat.origin && (
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-400">{t("threats.profile_origin")}</dt>
                    <dd className="text-gray-700 whitespace-pre-line">{threat.origin}</dd>
                  </div>
                )}
                {threat.objectives && (
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-400">{t("threats.profile_objectives")}</dt>
                    <dd className="text-gray-700 whitespace-pre-line">{threat.objectives}</dd>
                  </div>
                )}
                {threat.mode_operatoire && (
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-400">{t("threats.profile_mode_operatoire")}</dt>
                    <dd className="text-gray-700 whitespace-pre-line">{threat.mode_operatoire}</dd>
                  </div>
                )}
                {threat.occurrence_conditions && (
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-400">{t("threats.profile_occurrence_conditions")}</dt>
                    <dd className="text-gray-700 whitespace-pre-line">{threat.occurrence_conditions}</dd>
                  </div>
                )}
                {threat.aggravating_factors && (
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-400">{t("threats.profile_aggravating_factors")}</dt>
                    <dd className="text-gray-700 whitespace-pre-line">{threat.aggravating_factors}</dd>
                  </div>
                )}
                {threat.estimated_frequency && (
                  <div>
                    <dt className="text-xs text-gray-400">{t("threats.profile_estimated_frequency")}</dt>
                    <dd className="text-gray-700">{threat.estimated_frequency}</dd>
                  </div>
                )}
                {threat.last_reviewed_at && (
                  <div>
                    <dt className="text-xs text-gray-400">{t("threats.profile_last_reviewed")}</dt>
                    <dd className="text-gray-700">{threat.last_reviewed_at.slice(0, 10)}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-gray-400">{t("threats.profile_empty")}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
          >
            {t("threats.btn_close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

/* ── Historical trend (objectif 3 — « tendances ») ────────────────────────────
 *
 * GET /threats/trend returns one point per calendar month, read from the daily
 * `trend_snapshots` history and degrading to an intake-volume proxy while that
 * history is still thin — the pattern RiskSnapshot has been proving in
 * production, cloned rather than reinvented.
 *
 * Four things this panel must never do:
 *   • Draw a missing month as a zero. `total: null` means "no snapshot existed
 *     for that month", not "the register was empty". A zero there is an
 *     invented figure, so a null month is drawn as an explicit gap.
 *   • Pass an intake-volume series off as a balance — the two answer different
 *     questions, so the source is named on screen in the user's language.
 *   • Render the backend's `month` field: it is `strftime("%b")`, i.e. always
 *     English ("Sep"). The axis is formatted from `period` through Intl.
 *   • Take the page down when the route is not deployed. These endpoints ship
 *     in this wave but the running uvicorn workers predate them, so until the
 *     backend is restarted the call answers 405 here (the router has /threats
 *     but not /threats/trend). That is shown as a translated "not published
 *     yet" note, never as an error and never as a redirect.
 *
 * IMPORTANT on the denominator: this series counts the TENANT'S OWN register
 * and excludes the built-in catalogue, which is ~729 identical rows on every
 * tenant of this installation — including them would add the same constant to
 * every point and flatten the movement the chart exists to show. The grid below
 * lists catalogue entries too, so the two numbers legitimately differ; the
 * snapshot payload carries `builtin_catalogue` and it is printed under the
 * chart so a reader can reconcile them instead of assuming one of them is wrong.
 * For that reason the bar is labelled « Nombre » and NOT "Menaces répertoriées",
 * which would assert a total this series does not measure.
 *
 * It goes through `apiClient` rather than a `threatsApi.trend()` wrapper because
 * api/endpoints.ts belongs to another lane in this wave — same axios instance,
 * same auth, same interceptors, so this is not a raw fetch. Reported for
 * integration.
 */
const TREND_MONTHS = 6;

interface TrendPoint {
  month: string;
  period: string;
  as_of: string | null;
  /** null = no reading for that month. NEVER coerce to 0. */
  total: number | null;
  counts: Record<string, any>;
}

interface TrendEnvelope {
  metric: string;
  months: number;
  source: string;
  note?: string;
  series: TrendPoint[];
}

/** Operator-actionable message per HTTP status, reusing ModuleDashboard's own
 *  vocabulary so the two panels never describe the same failure differently.
 *  405 sits next to 404 because a router that has the module but not this path
 *  answers "Method Not Allowed" — same cause, same fix. */
function trendErrorKey(status?: number): string {
  if (status === 404 || status === 405) return "moduledash.error_not_published";
  if (status === 424) return "moduledash.error_not_ready";
  if (status === undefined) return "moduledash.error_unreachable";
  return "moduledash.error_generic";
}

function TrendPanel({
  load,
  legendLabel,
  footnote,
}: {
  load: () => Promise<TrendEnvelope>;
  legendLabel: string;
  footnote?: (d: TrendEnvelope) => string;
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<TrendEnvelope | null>(null);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  // Month names in the UI language — see the note above about `%b`.
  const monthFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(i18n.language || "en", { month: "short" });
    } catch {
      return null;
    }
  }, [i18n.language]);

  function monthLabel(p: TrendPoint): string {
    const m = /^(\d{4})-(\d{2})$/.exec(p.period || "");
    if (!m || !monthFmt) return p.month || p.period || "";
    return monthFmt.format(new Date(Number(m[1]), Number(m[2]) - 1, 1));
  }

  useEffect(() => {
    let alive = true;
    setState("loading");
    load()
      .then((d) => { if (alive) { setData(d); setState("ready"); } })
      .catch((err: any) => {
        if (!alive) return;
        setStatus(err?.response?.status);
        setState("error");
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const series = data?.series ?? [];
  const readings = series.filter((p) => typeof p.total === "number");
  const max = Math.max(1, ...readings.map((p) => p.total as number));
  const intake = data?.source === "intake_volume";
  // "unavailable" is the envelope returned when even the fallback could not be
  // READ — every total null because the query failed, not because nothing was
  // measured. The two must not share a message: « historique encore
  // insuffisant » states a fact about the register, and stating it when the
  // truth is a fact about this request is the same fabrication as plotting a 0.
  // The backend distinguishes them with `source`, so the panel does too.
  const unavailable = data?.source === "unavailable";
  const noHistory = state === "ready" && readings.length === 0;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <TrendingUp className="w-4 h-4 text-gray-400 self-center" aria-hidden="true" />
        <p className="text-sm font-semibold text-gray-900">{t("moduledash.trend_title")}</p>
        <span className="text-xs text-gray-400">{t("moduledash.trend_months", { n: TREND_MONTHS })}</span>
        <span className="ms-auto text-xs text-gray-400">{t("moduledash.trend_updated_monthly")}</span>
      </div>

      {state === "loading" && (
        <div className="h-24 rounded-lg bg-gray-100 animate-pulse" role="status" aria-busy="true">
          <span className="sr-only">{t("moduledash.loading")}</span>
        </div>
      )}

      {state === "error" && (
        <p className="text-xs text-gray-500" role="status">{t(trendErrorKey(status))}</p>
      )}

      {state === "ready" && noHistory && (
        <p className="text-xs text-gray-500" role="status">
          {t(unavailable ? "moduledash.error_not_ready" : "moduledash.trend_no_history")}
        </p>
      )}

      {state === "ready" && !noHistory && (
        <>
          {intake && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2" role="status">
              {t("moduledash.trend_intake")}
            </p>
          )}

          <div className="flex items-end gap-1.5 h-28">
            {series.map((p) => {
              const value = p.total;
              const height = value == null ? 0 : Math.max(4, Math.round((value / max) * 92));
              const title = value == null
                ? `${monthLabel(p)} — ${t("moduledash.no_data")}`
                : `${monthLabel(p)} — ${t("moduledash.trend_count")}: ${value}`;
              return (
                <div key={p.period} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1">
                  {value == null ? (
                    // An explicit gap. Never a zero-height bar sitting on the
                    // axis, which reads as "zero" to anyone glancing at it.
                    <div
                      className="w-full h-6 rounded-md border border-dashed border-gray-300 bg-white/60"
                      title={title}
                      aria-hidden="true"
                    />
                  ) : (
                    <div className="w-full rounded-t-md bg-orange-500/80" style={{ height: `${height}px` }} title={title} />
                  )}
                  <span className="text-[10px] font-medium text-gray-600 tabular-nums">
                    {value == null ? "—" : value}
                  </span>
                  <span className="text-[10px] text-gray-400 truncate max-w-full">{monthLabel(p)}</span>
                </div>
              );
            })}
          </div>

          {/* The same series in text, for a screen reader and for a printed
              board pack where the bar heights carry nothing. */}
          <ul className="sr-only">
            {series.map((p) => (
              <li key={p.period}>
                {t("moduledash.trend_period")}: {monthLabel(p)} — {t("moduledash.trend_count")}:{" "}
                {p.total == null ? t("moduledash.no_data") : p.total}
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-4 flex-wrap text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-orange-500/80" aria-hidden="true" /> {legendLabel}
            </span>
          </div>

          <p className="text-[11px] text-gray-400">
            {intake ? t("moduledash.trend_source_intake") : t("moduledash.trend_source_snapshot")}
            {data && footnote ? ` ${footnote(data)}` : ""}
          </p>
        </>
      )}
    </div>
  );
}

export default function ThreatLibraryPage() {
  const { t, i18n } = useTranslation();
  // Raw backend enum values (`cyber_attack`, `technical_failure`) through the
  // product vocabulary — the raw values read as English on every screen.
  const label = useBucketLabel();
  const [items, setItems]           = useState<any[]>([]);
  const [pending, setPending]       = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [detail, setDetail]         = useState<any | null>(null);
  const [search, setSearch]         = useState("");
  const [catFilter, setCatFilter]   = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [probFilter, setProbFilter] = useState("");
  const [sevFilter, setSevFilter]   = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [watch, setWatch] = useState<any[]>([]);
  const [watchKind, setWatchKind] = useState("");
  const [watchBusy, setWatchBusy] = useState("");
  const [showWatch, setShowWatch] = useState(false);
  // Ids of machine-translated cards/rows the reader flipped back to the English original.
  const [originalIds, setOriginalIds] = useState<Set<string>>(() => new Set());
  const toggleOriginal = (id: string) => setOriginalIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [error, setError]           = useState("");
  const [loadError, setLoadError]   = useState("");
  const [dashOpen, setDashOpen]     = useState<boolean>(readDashOpen);
  const [submitting, setSubmitting] = useState(false);

  // button states
  const [importing, setImporting]     = useState(false);
  const [fetching, setFetching]       = useState(false);
  const [actioning, setActioning]     = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [notice, setNotice]           = useState<{ msg: string; ok: boolean } | null>(null);

  const [form, setForm] = useState({
    ref_id: "", name: "", description: "",
    category: "cyber_attack", typical_threat_actors: "", mitre_ids: "",
  });

  async function load() {
    try {
      const params: any = {};
      if (catFilter) params.category = catFilter;
      if (typeFilter) params.threat_type = typeFilter;
      if (probFilter) params.probability_level = probFilter;
      if (sevFilter) params.severity_level = sevFilter;
      if (overdueOnly) params.review_overdue = true;
      const [data, pend] = await Promise.all([
        threatsApi.list(params),
        threatsApi.listPending(),
      ]);
      setItems(Array.isArray(data) ? data : []);
      setPending(Array.isArray(pend) ? pend : []);
      setLoadError("");
    } catch (err) {
      // Never swallow this. An empty register on a failed call made the screen
      // say « aucune menace » — telling a bank its library is empty when the
      // server refused to answer is the same class of lie as inventing rows.
      setItems([]);
      setPending([]);
      setLoadError(errorDetail(err) || t("errors.load_failed"));
    } finally {
      setLoading(false);
    }
  }

  function toggleDash() {
    setDashOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(DASH_LS_KEY, next ? "1" : "0");
      } catch {
        // Private browsing — the panel simply reopens next visit.
      }
      return next;
    });
  }

  useEffect(() => { load(); }, [catFilter, typeFilter, probFilter, sevFilter, overdueOnly, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadWatch() {
    try {
      const d = await threatsApi.watch(watchKind ? { kind: watchKind } : undefined);
      setWatch(Array.isArray(d) ? d : []);
    } catch { setWatch([]); }
  }
  useEffect(() => { loadWatch(); }, [watchKind, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  async function dismissWatch(id: string) {
    setWatchBusy(id);
    try { await threatsApi.dismissWatch(id); await loadWatch(); }
    catch {} finally { setWatchBusy(""); }
  }
  async function promoteWatch(item: any) {
    setWatchBusy(item.id);
    try {
      // The register keeps the feed's own (English) title; a translation is display-only.
      await threatsApi.promoteWatch(item.id, { name: item.original_title ?? item.title, category: "cyber_attack" });
      await loadWatch(); await load();
      setNotice({ msg: t("threats_ui.promoted_pending", { title: String(item.title).slice(0, 60) }), ok: true });
    } catch (e: any) {
      setNotice({ msg: e?.response?.data?.detail || t("threats_ui.promote_failed"), ok: false });
    } finally { setWatchBusy(""); }
  }

  /* ── MITRE one-time import ── */
  async function handleImportMitre() {
    if (!confirm(t("threats.confirm_import"))) return;
    setImporting(true);
    setNotice(null);
    try {
      const r = await threatsApi.importMitre();
      setNotice({ msg: r.message, ok: true });
      setLoading(true);
      load();
    } catch {
      setNotice({ msg: t("threats.error_import_failed"), ok: false });
    } finally {
      setImporting(false);
    }
  }

  /* ── Ongoing feed ── */
  async function handleFetchNews() {
    setFetching(true);
    setNotice(null);
    try {
      const r = await threatsApi.fetchNews();
      setNotice({ msg: r.message, ok: r.created > 0 });
      if (r.created > 0) load();
    } catch {
      setNotice({ msg: t("threats.error_fetch_failed"), ok: false });
    } finally {
      setFetching(false);
    }
  }

  /* ── Approve single ── */
  async function handleApprove(id: string) {
    setActioning(id);
    try { await threatsApi.approve(id); load(); }
    finally { setActioning(null); }
  }

  /* ── Approve all pending ── */
  async function handleApproveAll() {
    if (!confirm(t("threats_ui.confirm_approve_all", { count: pending.length }))) return;
    setApprovingAll(true);
    setNotice(null);
    try {
      await Promise.all(pending.map((th) => threatsApi.approve(th.id)));
      setNotice({ msg: t("threats_ui.approved_all", { count: pending.length }), ok: true });
      load();
    } catch {
      setNotice({ msg: t("threats.error_approve_failed"), ok: false });
    } finally {
      setApprovingAll(false);
    }
  }

  /* ── Reject single ── */
  async function handleReject(id: string) {
    setActioning(id);
    try { await threatsApi.reject(id); load(); }
    finally { setActioning(null); }
  }

  /* ── Manual create ── */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError(t("threats.error_name_required")); return; }
    setSubmitting(true);
    setError("");
    try {
      await threatsApi.create({
        ...form,
        typical_threat_actors: form.typical_threat_actors
          ? form.typical_threat_actors.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        mitre_ids: form.mitre_ids
          ? form.mitre_ids.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      });
      setShowModal(false);
      setForm({ ref_id: "", name: "", description: "", category: "cyber_attack", typical_threat_actors: "", mitre_ids: "" });
      setLoading(true);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("threats_ui.create_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("threats.confirm_delete"))) return;
    try { await threatsApi.delete(id); load(); } catch {}
  }

  const filtered = items.filter(
    (i) => i.name?.toLowerCase().includes(search.toLowerCase()) ||
           i.original_name?.toLowerCase().includes(search.toLowerCase()) ||
           i.ref_id?.toLowerCase().includes(search.toLowerCase()),
  );

  // The grid lists the tenant's own register AND the shared built-in catalogue.
  // GET /threats returns the whole library unpaged (`limit` defaults to None in
  // threats.py), so both of these are complete counts, not page counts.
  const builtinThreatCount = items.filter((i: any) => i.is_builtin).length;
  const ownThreatCount = items.length - builtinThreatCount;

  const grouped: Record<string, any[]> = {};
  for (const item of filtered) {
    const cat = item.category || "other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("threats.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {/*
              Two numbers, each named for what it counts. `items` is the whole
              grid below — the tenant's own register PLUS the shared built-in
              catalogue (729 MITRE entries on this installation) — while the
              dashboard mounted immediately under this header reports
              GET /dashboards/threats, which is tenant-scoped only. Labelling
              the 733 « menaces répertoriées » put that exact phrase on the page
              twice with two figures 180× apart and no way to reconcile them,
              which is how a bank stops trusting both. The register count is now
              the one that carries the dashboard's own label, and the catalogue
              is stated beside it as the remainder.
            */}
            {t("threats.subtitle")} · {ownThreatCount} {t("moduledash.metric_total_threats").toLowerCase()}
            {builtinThreatCount > 0 && (
              <span> · {builtinThreatCount} {t("threats.builtin").toLowerCase()}</span>
            )}
            {pending.length > 0 && (
              <span className="ms-2 text-amber-600 font-medium">
                · {pending.length} {t("moduledash.vocab.pending_validation").toLowerCase()}
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-purple-400" />
            {t("threats.info_text")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImportMitre}
            disabled={importing}
            title={t("threats.import_mitre_title")}
            className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-orange-600 disabled:opacity-60 transition-colors"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {importing ? t("threats.importing") : t("threats.import_mitre")}
          </button>
          <button
            onClick={handleFetchNews}
            disabled={fetching}
            title={t("threats.fetch_now_title")}
            className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-purple-700 disabled:opacity-60 transition-colors"
          >
            {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {fetching ? t("threats.fetching") : t("threats.fetch_now")}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> {t("threats.new_threat")}
          </button>
        </div>
      </div>

      {/* Notice banner */}
      {notice && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm border ${notice.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-700"}`}>
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="flex-1">{notice.msg}</span>
          <button onClick={() => setNotice(null)}><X className="w-4 h-4 opacity-50 hover:opacity-100" /></button>
        </div>
      )}

      {/*
        Objectif 3 — « Accessible depuis la page dédiée aux menaces ».
        The threat dashboard existed behind GET /dashboards/threats, but the
        only screen that ever called it was AnalyticsPage: a card in another
        navigation group does not make a dashboard accessible from the threat
        page. The LOCATION is the requirement.

        Access stays limited to the security-analysis profiles — the endpoint's
        require_roles_strict answers 403 for anyone else, which ModuleDashboard
        renders as an explicit « vue restreinte » panel rather than a blank card.
      */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={toggleDash}
          aria-expanded={dashOpen}
          aria-controls="module-dashboard-threats"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {dashOpen
            ? <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
            : <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />}
          <BarChart3 className="w-4 h-4 text-orange-600" aria-hidden="true" />
          {t("moduledash.dashboard")}
          <span className="text-xs font-normal text-gray-400">
            {dashOpen ? t("moduledash.hide") : t("moduledash.show")}
          </span>
        </button>
        {dashOpen && (
          <ModuleDashboard module="threats">
            {/* Rendered as a CHILD of the dashboard on purpose: ModuleDashboard
                only renders children once the dashboard itself loaded, so the
                trend never fires a second request behind the Elite gate or the
                security-analyst gate, and never appears next to an upsell or a
                « vue restreinte » panel. */}
            <TrendPanel
              load={() =>
                apiClient
                  .get<TrendEnvelope>("/threats/trend", { params: { months: TREND_MONTHS } })
                  .then((r) => r.data)
              }
              // « Nombre », not « Menaces répertoriées »: the series excludes the
              // shared built-in catalogue that the grid below does list.
              legendLabel={t("moduledash.trend_count")}
              footnote={(d) => {
                const n = d.series.map((p) => p.counts?.builtin_catalogue).filter((x) => typeof x === "number").pop();
                // Only when the payload actually carries it (snapshot source).
                return typeof n === "number" ? `${t("threats.builtin")}: ${n}.` : "";
              }}
            />
          </ModuleDashboard>
        )}
      </div>

      {/* The register could not be read. Say what the server said — its detail
          carries the operator's next action. */}
      {loadError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3" role="status">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-amber-900 flex-1 min-w-0">{loadError}</p>
          <button
            onClick={() => { setLoading(true); load(); }}
            className="inline-flex items-center gap-1.5 shrink-0 rounded-xl border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {t("common.retry")}
          </button>
        </div>
      )}

      {/* Threat watch — what the feeds brought in. Deliberately separate from the
          register: these are advisories, packages and news, not threat types. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowWatch((v) => !v)}
          className="w-full flex items-center gap-2 px-6 py-4 border-b border-gray-100 bg-gray-50/60 text-left"
        >
          {showWatch ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <Rss className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-gray-800">
            {t("threats.watch_title", "Threat watch")}
          </span>
          <span className="text-xs text-gray-500">
            {t("threats.watch_subtitle", "{{n}} item(s) from CISA, SANS and supply-chain feeds — read here, not filed in the register", { n: watch.filter((w) => w.status === "new").length })}
          </span>
        </button>

        {showWatch && (
          <div>
            <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50 flex-wrap">
              {["", "cve", "malicious_package", "advisory", "news"].map((k) => (
                <button
                  key={k || "all"}
                  onClick={() => setWatchKind(k)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border ${
                    watchKind === k
                      ? "bg-blue-50 border-blue-200 text-blue-700"
                      : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                >
                  {k ? String(t(`threats.watch_kind_${k}` as never, k.replace(/_/g, " "))) : t("threats.watch_all", "All")}
                </button>
              ))}
            </div>

            {watch.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                {t("threats.watch_empty", "Nothing in the watch yet. Use 'Fetch latest' to pull from the feeds.")}
              </div>
            ) : (
              <div className="divide-y divide-gray-50 max-h-[28rem] overflow-y-auto">
                {watch.map((w) => (
                  <div key={w.id} className={`px-6 py-3 flex items-start gap-3 ${w.status !== "new" ? "opacity-55" : ""}`}>
                    <span className="mt-0.5 shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold border bg-gray-50 text-gray-600 border-gray-200 whitespace-nowrap">
                      {String(t(`threats.watch_kind_${w.kind}` as never, w.kind.replace(/_/g, " ")))}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 break-words">{feedText(w, originalIds.has(w.id), ["title", "summary"]).primary}</p>
                      {w.translated && (
                        <AutoTranslatedBadge showingOriginal={originalIds.has(w.id)} onToggle={() => toggleOriginal(w.id)} />
                      )}
                      <p className="text-[11px] text-gray-400">
                        {w.source}{w.ref ? ` · ${w.ref}` : ""}
                        {w.status !== "new" && ` · ${String(t(`threats.watch_status_${w.status}` as never, w.status))}`}
                      </p>
                    </div>
                    {w.url && (
                      <a href={w.url} target="_blank" rel="noreferrer" className="text-gray-300 hover:text-blue-600 mt-0.5" title={t("threats.view_advisory")}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {w.status === "new" && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => promoteWatch(w)}
                          disabled={watchBusy === w.id}
                          title={t("threats.watch_promote_hint", "Only if this describes a genuinely new kind of threat")}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                        >
                          {watchBusy === w.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          {t("threats.watch_promote", "To register")}
                        </button>
                        <button
                          onClick={() => dismissWatch(w.id)}
                          disabled={watchBusy === w.id}
                          className="text-xs font-medium text-gray-400 hover:text-gray-600 disabled:opacity-50"
                        >
                          {t("threats.watch_dismiss", "Dismiss")}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pending approval queue */}
      {pending.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-amber-100 bg-amber-50/60">
            <Clock className="w-4 h-4 text-amber-600" />
            <h2 className="font-semibold text-amber-900 text-sm">
              {t("threats.pending_review", { count: pending.length })}
            </h2>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-amber-600 hidden sm:inline">{t("threats.pending_help")}</span>
              <button
                onClick={handleApproveAll}
                disabled={approvingAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {approvingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                {approvingAll ? t("threats.approving") : t("threats.approve_all")}
              </button>
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {pending.map((th: any) => (
              <div
                key={th.id}
                className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50/40 transition-colors cursor-pointer"
                onClick={() => setDetail(th)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {th.ref_id && <span className="font-mono text-xs text-gray-400">{th.ref_id}</span>}
                    <span className="font-medium text-sm text-gray-900">{feedText(th, originalIds.has(th.id)).primary}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${CATEGORY_BADGE[th.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                      {label(th.category || "cyber_attack")}
                    </span>
                    {th.severity && (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${SEVERITY_BADGE[th.severity] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                        {label(th.severity)}
                      </span>
                    )}
                  </div>
                  {th.translated && (
                    <div className="mt-1">
                      <AutoTranslatedBadge showingOriginal={originalIds.has(th.id)} onToggle={() => toggleOriginal(th.id)} />
                    </div>
                  )}
                  {feedText(th, originalIds.has(th.id)).secondary && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{feedText(th, originalIds.has(th.id)).secondary}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {th.typical_threat_actors?.slice(0, 3).map((a: string, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-red-50 text-red-600 border border-red-100">
                        <AlertTriangle className="w-2.5 h-2.5" />{a}
                      </span>
                    ))}
                    {th.typical_attack_vectors?.slice(0, 3).map((v: string, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-orange-50 text-orange-600 border border-orange-100">
                        <Tag className="w-2.5 h-2.5" />{v}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleApprove(th.id)}
                    disabled={actioning === th.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {actioning === th.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                    {t("threats.btn_approve")}
                  </button>
                  <button
                    onClick={() => handleReject(th.id)}
                    disabled={actioning === th.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    {actioning === th.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
                    {t("threats.btn_reject")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("threats.search_placeholder")}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("threats.all_categories")}</option>
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("threats.all_types", "All families")}</option>
            {THREAT_TYPES.map((ty) => <option key={ty} value={ty}>{String(t(`threats.type_${ty}` as never, ty))}</option>)}
          </select>
          <select
            value={probFilter}
            onChange={(e) => setProbFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("threats.all_probability", "Any likelihood")}</option>
            {PROBABILITY_LEVELS.map((lv) => <option key={lv} value={lv}>{String(t(`threats.probability_${lv}` as never, lv))}</option>)}
          </select>
          <select
            value={sevFilter}
            onChange={(e) => setSevFilter(e.target.value)}
            className="border border-gray-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("threats.all_severity", "Any severity")}</option>
            {SEVERITY_LEVELS.map((lv) => <option key={lv} value={lv}>{String(t(`threats.severity_${lv}` as never, lv))}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setOverdueOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium ${
              overdueOnly
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}
          >
            <CalendarClock className="w-4 h-4" /> {t("threats.filter_overdue", "Review overdue")}
          </button>
        </div>
      </div>

      {/* Library grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : loadError ? (
        // Distinct from "no threats": the library is unknown, not empty.
        <div className="text-center py-16 text-gray-400">
          <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">{t("common.no_data")}</p>
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">{t("threats.no_threats")}</p>
          <p className="text-xs mt-1">{t("threats.empty_help")}</p>
        </div>
      ) : (
        Object.entries(grouped).map(([category, threats]) => (
          <div key={category} className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-2">
              <Shield className="w-4 h-4" />
              {label(category)} ({threats.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {threats.map((threat: any) => (
                <div
                  key={threat.id}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
                  onClick={() => setDetail(threat)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {threat.ref_id && <span className="font-mono text-xs text-gray-400">{threat.ref_id}</span>}
                      {threat.is_builtin ? (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">{t("threats.builtin")}</span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(threat.id); }}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${CATEGORY_BADGE[threat.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                        {label(threat.category || "other")}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-400 transition-colors" />
                    </div>
                  </div>

                  <h3 className="font-semibold text-gray-900 mb-1 line-clamp-2 leading-snug">{feedText(threat, originalIds.has(threat.id)).primary}</h3>
                  {threat.translated && (
                    <div className="mb-1.5">
                      <AutoTranslatedBadge showingOriginal={originalIds.has(threat.id)} onToggle={() => toggleOriginal(threat.id)} />
                    </div>
                  )}
                  <p className="text-sm text-gray-500 mb-3 line-clamp-2">{feedText(threat, originalIds.has(threat.id)).secondary || t("threats.no_description")}</p>

                  {/* Actors + vectors/tags combined */}
                  {((threat.typical_threat_actors?.length > 0) || (threat.typical_attack_vectors?.length > 0)) && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {threat.typical_threat_actors?.slice(0, 2).map((actor: string, idx: number) => (
                        <span key={`a-${idx}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-red-50 text-red-600 border border-red-100">
                          <AlertTriangle className="w-2.5 h-2.5" />{actor}
                        </span>
                      ))}
                      {threat.typical_attack_vectors?.slice(0, 3).map((v: string, idx: number) => (
                        <span key={`v-${idx}`} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs bg-orange-50 text-orange-600 border border-orange-100">
                          <Tag className="w-2.5 h-2.5" />{v}
                        </span>
                      ))}
                      {((threat.typical_threat_actors?.length || 0) + (threat.typical_attack_vectors?.length || 0)) > 5 && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-gray-100 text-gray-500">
                          +{(threat.typical_threat_actors?.length || 0) + (threat.typical_attack_vectors?.length || 0) - 5}
                        </span>
                      )}
                    </div>
                  )}

                  {threat.mitre_ids?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {threat.mitre_ids.slice(0, 3).map((id: string, idx: number) => (
                        <span key={idx} className="inline-flex rounded-full px-2 py-0.5 text-xs font-mono bg-purple-50 text-purple-600 border border-purple-200">
                          {id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Detail modal */}
      {detail && (
        <ThreatDetailModal
          threat={detail}
          onClose={() => setDetail(null)}
          onUpdated={(raw) => {
            // Single-threat responses (profile, validate, review, adopt) are not
            // localised; keep the translation the list gave us if the English
            // text it was made from is unchanged.
            const prevItem = detail;
            const updated = prevItem?.translated && !raw.translated && prevItem.id === raw.id
              && prevItem.original_name === raw.name && prevItem.original_description === raw.description
              ? { ...raw, name: prevItem.name, description: prevItem.description, translated: true,
                  original_name: prevItem.original_name, original_description: prevItem.original_description }
              : raw;
            setDetail(updated);
            setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          }}
        />
      )}

      {/* Manual create modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("threats.new_threat")}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("threats.ref_id")}</label>
                  <input value={form.ref_id} onChange={(e) => setForm({ ...form, ref_id: e.target.value })} placeholder={t("threats.ref_id_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.name")} *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.description")}</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("common.category")}</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("threats.threat_actors")}</label>
                <input value={form.typical_threat_actors} onChange={(e) => setForm({ ...form, typical_threat_actors: e.target.value })} placeholder={t("threats.threat_actors_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("threats.mitre_ids")}</label>
                <input value={form.mitre_ids} onChange={(e) => setForm({ ...form, mitre_ids: e.target.value })} placeholder={t("threats.mitre_ids_placeholder")} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t("threats.btn_cancel")}</button>
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />} {t("threats.new_threat")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
