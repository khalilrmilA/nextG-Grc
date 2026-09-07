import { useState, useEffect } from "react";
import {
  Plus, Search, X, Loader2, Filter, Shield, Trash2, Tag,
  Sparkles, Download, ThumbsUp, ThumbsDown, Clock, CheckCircle2, RefreshCw,
  AlertTriangle, ExternalLink, CheckCheck, ChevronRight, ChevronDown, Pencil, Lock, Rss,
  BadgeCheck, CalendarClock, CopyPlus, History,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { threatsApi, assetsApi, vulnerabilitiesApi } from "@/api/endpoints";
import { MultiSelect, type MultiSelectOption } from "@/components/common/MultiSelect";

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

function fmt(s: string) {
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [profileError, setProfileError] = useState("");
  const [saving, setSaving] = useState(false);
  const [assetOptions, setAssetOptions] = useState<MultiSelectOption[]>([]);
  const [vulnOptions, setVulnOptions] = useState<MultiSelectOption[]>([]);
  const [busy, setBusy] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);

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
                {fmt(threat.category || "other")}
              </span>
              {threat.severity && (
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${SEVERITY_BADGE[threat.severity] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                  {fmt(threat.severity)}
                </span>
              )}
              {threat.is_builtin && (
                <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                  {t("threats.builtin")}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{threat.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0 mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Description */}
          {threat.description && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t("common.description")}</h3>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{threat.description}</p>
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
                            {h.created_at ? new Date(h.created_at).toLocaleString() : ""}
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

export default function ThreatLibraryPage() {
  const { t } = useTranslation();
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
  const [error, setError]           = useState("");
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
    } catch {
      setItems([]);
      setPending([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [catFilter, typeFilter, probFilter, sevFilter, overdueOnly]);

  async function loadWatch() {
    try {
      const d = await threatsApi.watch(watchKind ? { kind: watchKind } : undefined);
      setWatch(Array.isArray(d) ? d : []);
    } catch { setWatch([]); }
  }
  useEffect(() => { loadWatch(); /* eslint-disable-next-line */ }, [watchKind]);

  async function dismissWatch(id: string) {
    setWatchBusy(id);
    try { await threatsApi.dismissWatch(id); await loadWatch(); }
    catch {} finally { setWatchBusy(""); }
  }
  async function promoteWatch(item: any) {
    setWatchBusy(item.id);
    try {
      await threatsApi.promoteWatch(item.id, { name: item.title, category: "cyber_attack" });
      await loadWatch(); await load();
      setNotice({ msg: `"${String(item.title).slice(0, 60)}" proposed for the register — it is pending validation.`, ok: true });
    } catch (e: any) {
      setNotice({ msg: e?.response?.data?.detail || "Could not promote this item.", ok: false });
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
    if (!confirm(`Approve all ${pending.length} pending threats and add them to your library?`)) return;
    setApprovingAll(true);
    setNotice(null);
    try {
      await Promise.all(pending.map((th) => threatsApi.approve(th.id)));
      setNotice({ msg: `Approved ${pending.length} threat${pending.length > 1 ? "s" : ""} — added to library.`, ok: true });
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
      setError(err?.response?.data?.detail || "Failed to create threat");
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
           i.ref_id?.toLowerCase().includes(search.toLowerCase()),
  );

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
            {t("threats.subtitle")} · {items.length} in library
            {pending.length > 0 && <span className="ml-2 text-amber-600 font-medium">· {pending.length} pending review</span>}
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
                      <p className="text-sm text-gray-800 break-words">{w.title}</p>
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
                    <span className="font-medium text-sm text-gray-900">{th.name}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${CATEGORY_BADGE[th.category] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                      {fmt(th.category || "cyber_attack")}
                    </span>
                    {th.severity && (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border ${SEVERITY_BADGE[th.severity] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                        {fmt(th.severity)}
                      </span>
                    )}
                  </div>
                  {th.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{th.description}</p>
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
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{fmt(c)}</option>)}
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
              {fmt(category)} ({threats.length})
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
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">Built-in</span>
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
                        {fmt(threat.category || "other")}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-blue-400 transition-colors" />
                    </div>
                  </div>

                  <h3 className="font-semibold text-gray-900 mb-1 line-clamp-2 leading-snug">{threat.name}</h3>
                  <p className="text-sm text-gray-500 mb-3 line-clamp-2">{threat.description || t("threats.no_description")}</p>

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
                          +{(threat.typical_threat_actors?.length || 0) + (threat.typical_attack_vectors?.length || 0) - 5} more
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
          onUpdated={(updated) => {
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
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{fmt(c)}</option>)}
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
