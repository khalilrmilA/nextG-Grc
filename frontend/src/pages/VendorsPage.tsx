import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Building2, Plus, Globe, AlertTriangle, Search, ShieldCheck, ShieldX, X, ChevronRight, Calendar, ExternalLink, Sparkles, Loader2, FileCheck, Map as MapIcon, Pencil, Trash2, LogOut, History, RefreshCw } from "lucide-react";
import VendorAIModal from "../components/ai/VendorAIModal";
import VendorRiskCartography from "../components/vendor/VendorRiskCartography";
import {
  PrescreenQuestions, PrescreenInsights, emptyPrescreenResponses, prescreenToRegisterScore,
  prescreenAssessmentPayload, type PrescreenResult,
} from "../components/vendor/Prescreen";
import { TIER_OPTIONS, STATUS_OPTIONS, INDUSTRY_OPTIONS, ENDED_STATUSES, industryKey } from "../components/vendor/vendorOptions";
import {
  EditVendorModal, OffboardVendorModal, DeleteVendorDialog, ReassessVendorModal,
  VendorAssessmentsTab, UploadContractPanel, VENDOR_WRITE_ROLES,
} from "../components/vendor/VendorLifecycle";
import { useAuthStore, hasAnyRole } from "@/store/auth";
import { vendorsApi, contractCollabApi } from "@/api/endpoints";
import { useColumnVisibility, type ColumnDef } from "@/components/common/useColumnVisibility";
import ColumnsMenu from "@/components/common/ColumnsMenu";

interface VendorEntry {
  id: string;
  name: string;
  industry: string | null;
  country: string | null;
  website: string | null;
  risk_tier: string;
  status: string;
  risk_score: number | null;
  has_data_processing_agreement: boolean;
  contract_expiry: string | null;
  services_provided: string | null;
  primary_contact_name?: string | null;
  primary_contact_email?: string | null;
  offboarded_at?: string | null;
  offboarding_reason?: string | null;
  description?: string | null;
  created_at?: string;
}
type Tier   = "critical" | "high" | "medium" | "low";
type Status = "active" | "under_review" | "onboarding" | "offboarding" | "inactive";

const TIER_BADGE: Record<Tier, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high:     "bg-orange-100 text-orange-700 border-orange-200",
  medium:   "bg-yellow-100 text-yellow-700 border-yellow-200",
  low:      "bg-green-100 text-green-700 border-green-200",
};
const STATUS_BADGE: Record<Status, string> = {
  active:       "bg-green-100 text-green-700",
  under_review: "bg-orange-100 text-orange-700",
  onboarding:   "bg-blue-100 text-blue-700",
  offboarding:  "bg-gray-100 text-gray-600",
  inactive:     "bg-gray-100 text-gray-400",
};

/** Display locale for dates, following the interface language. */
const dateLocale = (lang: string) => (lang.startsWith("fr") ? "fr-FR" : lang.startsWith("ar") ? "ar-u-nu-latn" : "en-US");

function riskScoreColor(score: number) {
  if (score > 20) return "text-red-600 bg-red-50";
  if (score > 12) return "text-orange-600 bg-orange-50";
  if (score > 6)  return "text-yellow-600 bg-yellow-50";
  return "text-green-600 bg-green-50";
}

/** The server's own message (translated by Accept-Language), if it sent one. */
function apiDetail(err: unknown): string | undefined {
  const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof d === "string") return d;
  return err instanceof Error ? err.message : undefined;
}

// ── Add Vendor Modal ──────────────────────────────────────────────────────────
function AddVendorModal({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: (v: VendorEntry) => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);  // 1=info, 2=questionnaire, 3=AI insights
  const [form, setForm] = useState({
    name: "", industry: "Cloud Infrastructure", country: "", tier: "medium",
    // No score until something assesses the vendor (the AI prescreen, or a score the
    // user enters when the AI is unavailable): a default made an unassessed vendor
    // look low-risk.
    status: "active", risk_score: null as number | null, dpa: false,
    contract_expiry: "", services: "", website: "", notes: "",
  });
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  // Questionnaire state
  const [responses, setResponses] = useState<Record<string, string>>(emptyPrescreenResponses);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<PrescreenResult | null>(null);
  // AI unavailable (424): retry, or onboard without a score (product decision 2026-10-18).
  const [aiDown, setAiDown] = useState(false);
  const [skipAi, setSkipAi] = useState(false);
  // Steps already saved, so a retry after a later failure resumes instead of
  // creating a second vendor / assessment / contract (follow-up C-3).
  const done = useRef<{ vendor: VendorEntry | null; assessment: boolean; contract: boolean }>(
    { vendor: null, assessment: false, contract: false });

  function handleNextFromInfo() {
    setError("");
    if (!form.name.trim())    { setError(t("vendors.name_required")); return; }
    if (!form.country.trim()) { setError(t("vendors.country_required")); return; }
    setStep(2);
  }

  async function handleAnalyze() {
    try {
      setAnalyzing(true);
      setError("");
      const result = await vendorsApi.prescreenQuestionnaire({
        vendor_name: form.name.trim(),
        vendor_industry: form.industry,
        vendor_country: form.country.trim().toUpperCase().slice(0, 2),
        responses,
      }) as PrescreenResult;
      setAiResult(result);
      setAiDown(false); setSkipAi(false);
      // Update form risk score based on AI suggestion
      setForm(f => ({ ...f, risk_score: prescreenToRegisterScore(result.initial_risk_score) }));  // 1-10 → 1-40
      setStep(3);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 424) {
        setAiDown(true);
        setError(t("r2b.vendors.ai_unavailable"));
      } else {
        setError(t("vendors_page.ai_analysis_failed", { error: apiDetail(err) ?? t("vendors_page.unknown_error") }));
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFinalSave() {
    try {
      setError("");
      setUploading(true);

      // Build description from AI insights
      let description = "";
      if (aiResult) {
        description = `## AI Prescreen Analysis\n\n**Risk Level:** ${aiResult.risk_level.toUpperCase()} (${aiResult.initial_risk_score}/10)\n\n${aiResult.summary}\n\n### Strengths\n${aiResult.strengths.map(s => `- ${s}`).join('\n')}\n\n### Concerns\n${aiResult.concerns.map(c => `- ${c}`).join('\n')}\n\n### Red Flags\n${aiResult.red_flags.map(r => `- ${r}`).join('\n')}\n\n### Recommendations\n${aiResult.recommendations.map(r => `- ${r}`).join('\n')}`;
      }

      const newVendor = done.current.vendor ?? await vendorsApi.create({
        name: form.name.trim(),
        industry: form.industry,
        country: form.country.trim().toUpperCase().slice(0, 2),
        risk_tier: form.tier,
        status: form.status,
        risk_score: form.risk_score ?? undefined,
        services_provided: form.services.trim() || undefined,
        has_data_processing_agreement: form.dpa,
        contract_expiry: form.contract_expiry || undefined,
        website: form.website.trim() || undefined,
        description: description || undefined,
      } as any) as unknown as VendorEntry;
      done.current.vendor = newVendor;

      // Keep the prescreen as the vendor's first assessment — its answers and
      // verdict used to be dropped here (only the score survived). Without the
      // AI the answers are kept unscored, to be re-run from Reassess.
      if (!done.current.assessment && (aiResult || skipAi)) {
        await vendorsApi.createAssessment(newVendor.id, aiResult
          ? prescreenAssessmentPayload(aiResult, responses, form.risk_score ?? prescreenToRegisterScore(aiResult.initial_risk_score))
          : { answers: responses, apply_score: false });
        done.current.assessment = true;
      }

      // Upload contract if provided
      if (contractFile && !done.current.contract) {
        await vendorsApi.uploadContract(newVendor.id, contractFile);
        done.current.contract = true;
      }

      onSaved(newVendor as unknown as VendorEntry);
      onClose();
    } catch (err) {
      // The vendor may already exist: say so, and Save resumes from the failed step.
      setError(done.current.vendor
        ? t("r2b.vendors.partial_save", { error: apiDetail(err) ?? "" })
        : t("vendors_page.create_failed", { error: apiDetail(err) ?? "" }));
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step === 1) {
      handleNextFromInfo();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">{t("vendors.add_vendor_modal_title")}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              {[1, 2, 3].map(s => (
                <div key={s} className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    step >= s ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
                  }`}>{s}</div>
                  {s < 3 && <div className={`w-8 h-0.5 ${step > s ? "bg-blue-600" : "bg-gray-200"}`}></div>}
                </div>
              ))}
              <span className="text-xs text-gray-500 ml-2">
                {step === 1 && t("vendors_page.step_info")}
                {step === 2 && t("vendors_page.step_questionnaire")}
                {step === 3 && t("vendors_page.step_insights")}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          {step === 1 && <>

          <div>
            <label htmlFor="v-name" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.vendor_name_label")} *</label>
            <input id="v-name" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("vendors.vendor_name_placeholder")}
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="v-industry" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.industry_label")}</label>
              <select id="v-industry" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
                {INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{t(`vendors_page.industry.${industryKey(o)}`, { defaultValue: o })}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="v-country" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.country_code")} *</label>
              <input id="v-country" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                placeholder={t("vendors.country_placeholder")} maxLength={2}
                value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value.toUpperCase() }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="v-tier" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.risk_tier_label")}</label>
              <select id="v-tier" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}>
                {TIER_OPTIONS.map(o => <option key={o} value={o}>{t(`vendors.tiers.${o}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="v-status" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.status_label")}</label>
              <select id="v-status" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(o => <option key={o} value={o}>{t(`vocab.${o}`, { defaultValue: o.replaceAll("_", " ") })}</option>)}
              </select>
            </div>
          </div>


          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="v-expiry" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.contract_expiry_label")}</label>
              <input id="v-expiry" type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.contract_expiry} onChange={e => setForm(f => ({ ...f, contract_expiry: e.target.value }))} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.dpa} onChange={e => setForm(f => ({ ...f, dpa: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600" />
                <span className="text-sm text-gray-700">{t("vendors.dpa_signed")}</span>
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="v-services" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.services_label")}</label>
            <input id="v-services" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("vendors.services_placeholder")}
              value={form.services} onChange={e => setForm(f => ({ ...f, services: e.target.value }))} />
          </div>

          <div>
            <label htmlFor="v-website" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.website_label")}</label>
            <input id="v-website" type="url" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://vendor.com"
              value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
          </div>

          <div>
            <label htmlFor="v-notes" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.notes_label")}</label>
            <textarea id="v-notes" rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t("vendors.notes_placeholder")}
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <div>
            <label htmlFor="v-contract" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("vendors.upload_contract_optional", "Upload Contract (Optional)")}</label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              onClick={() => document.getElementById("v-contract")?.click()}>
              <input id="v-contract" type="file" accept=".pdf,.docx,.xlsx,.xls,.txt" className="hidden"
                onChange={e => setContractFile(e.target.files?.[0] || null)} />
              <p className="text-sm text-gray-600">
                {contractFile ? (
                  <>✓ <strong>{contractFile.name}</strong></>
                ) : (
                  <>{t("vendors.upload_contract_hint", "Click to upload contract (PDF, DOCX, XLSX, XLS, TXT)")}</>
                )}
              </p>
              <p className="text-xs text-gray-400 mt-1">{t("vendors.upload_contract_ai_note", "AI will automatically review the contract")}</p>
            </div>
          </div>

          </>}

          {/* STEP 2: Security Questionnaire */}
          {step === 2 && <PrescreenQuestions responses={responses} onChange={setResponses} />}

          {/* STEP 3: AI Insights */}
          {step === 3 && aiResult && <PrescreenInsights result={aiResult} suggestedScore={form.risk_score ?? prescreenToRegisterScore(aiResult.initial_risk_score)} />}
          {step === 3 && !aiResult && skipAi && (
            <div className="space-y-3">
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{t("r2b.vendors.no_ai_notice")}</p>
              <div>
                <label htmlFor="v-manual-score" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t("r2b.vendors.manual_score")}</label>
                {/* Optional: left empty, the vendor is saved with NO score ("Not assessed"). */}
                <input id="v-manual-score" type="number" min={1} max={40} value={form.risk_score ?? ""}
                  placeholder={t("r2b.vendors.not_assessed")}
                  onChange={e => setForm(f => ({ ...f, risk_score: e.target.value === "" ? null : Math.max(1, Math.min(40, +e.target.value || 1)) }))}
                  className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          )}
          {step === 2 && aiDown && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleAnalyze} disabled={analyzing}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                <RefreshCw className="w-4 h-4" />{t("r2b.vendors.retry")}
              </button>
              <button type="button" onClick={() => { setSkipAi(true); setError(""); setStep(3); }} disabled={analyzing}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50">
                {t("r2b.vendors.continue_without_ai")} →
              </button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2 border-t border-gray-100 mt-4">
            {step === 1 && (
              <>
                <button type="button" onClick={onClose}
                  className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  {t("common.cancel")}
                </button>
                <button type="submit"
                  className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
                  {t("vendors.next_questionnaire", "Next: Questionnaire")} →
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <button type="button" onClick={() => setStep(1)} disabled={analyzing}
                  className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                  ← {t("common.back")}
                </button>
                <button type="button" onClick={handleAnalyze} disabled={analyzing}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {analyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("vendors_page.ai_analyzing")}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      {t("vendors.analyze_with_ai", "Analyze with AI")}
                    </>
                  )}
                </button>
              </>
            )}
            {step === 3 && (
              <>
                <button type="button" onClick={() => setStep(2)} disabled={uploading}
                  className="flex-1 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                  ← {t("common.back")}
                </button>
                <button type="button" onClick={handleFinalSave} disabled={uploading}
                  className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("common.saving")}
                    </>
                  ) : (
                    <>
                      ✓ {t("vendors_page.save_vendor")}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Vendor Detail Modal ───────────────────────────────────────────────────────
interface ContractItem {
  id: string;
  file_name: string;
  version: number;
  validation_status: string;
  review_status: string;
  ai_review: string | null;
  ciso_comments: string | null;
  created_at: string;
}

// Badge colour per contract workflow state. The LABEL is no longer baked in
// English here — it goes through t() at render time with the English text as
// the fallback, so the badge follows the interface language once the keys are
// added to en/fr/ar (see needs_integration).
const CONTRACT_STATUS_LABELS: Record<string, { key: string; fallback: string; color: string }> = {
  pending_ai: { key: "vendors.contract_status.pending_ai", fallback: "AI Analyzing", color: "bg-blue-100 text-blue-700" },
  ai_reviewed: { key: "vendors.contract_status.ai_reviewed", fallback: "Ready for CISO", color: "bg-yellow-100 text-yellow-700" },
  pending_ciso: { key: "vendors.contract_status.pending_ciso", fallback: "Pending CISO", color: "bg-orange-100 text-orange-700" },
  approved: { key: "vendors.contract_status.approved", fallback: "Approved", color: "bg-green-100 text-green-700" },
  rejected: { key: "vendors.contract_status.rejected", fallback: "Rejected", color: "bg-red-100 text-red-700" },
  sent_to_vendor: { key: "vendors.contract_status.sent_to_vendor", fallback: "Sent to Vendor", color: "bg-purple-100 text-purple-700" },
  signed: { key: "vendors.contract_status.signed", fallback: "Signed Agreement", color: "bg-emerald-100 text-emerald-800" },
};

function VendorDetailModal({ vendor, onClose, onRunAI, onChanged, onDeleted }: {
  readonly vendor: VendorEntry;
  readonly onClose: () => void;
  readonly onRunAI: () => void;
  readonly onChanged: (v: VendorEntry) => void;
  readonly onDeleted: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const tier   = vendor.risk_tier as Tier;
  const status = vendor.status as Status;
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(true);
  const [contractsKey, setContractsKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"overview" | "assessments" | "cartography">("overview");
  const [dialog, setDialog] = useState<null | "edit" | "offboard" | "delete" | "reassess">(null);
  const [assessmentsKey, setAssessmentsKey] = useState(0);
  const canWrite = hasAnyRole(useAuthStore((u) => u), VENDOR_WRITE_ROLES);
  const ended = ENDED_STATUSES.includes(status);
  const [startingCollab, setStartingCollab] = useState<string | null>(null);

  const startCollaboration = async (contractId: string) => {
    setStartingCollab(contractId);
    try {
      const collab = await contractCollabApi.create(contractId);
      onClose();
      navigate(`/vendors/collaboration/${collab.id}`);
    } finally {
      setStartingCollab(null);
    }
  };

  useEffect(() => {
    async function loadContracts() {
      try {
        setLoadingContracts(true);
        const data = await vendorsApi.listVendorContracts(vendor.id);
        setContracts(data || []);
      } catch (err) {
        console.debug("Could not load contracts:", err);
        setContracts([]);
      } finally {
        setLoadingContracts(false);
      }
    }
    loadContracts();
  }, [vendor.id, contractsKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 bg-slate-50 rounded-t-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-slate-200 rounded-xl flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 leading-snug">{vendor.name}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${TIER_BADGE[tier]}`}>{t(`vendors.tiers.${vendor.risk_tier}`, { defaultValue: vendor.risk_tier })}</span>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_BADGE[status]}`}>{t(`vocab.${vendor.status}`, { defaultValue: vendor.status.replaceAll("_", " ") })}</span>
                  <span className="flex items-center gap-1 text-xs text-gray-400"><Globe className="w-3 h-3" />{vendor.country}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {canWrite && (
                <>
                  <button onClick={() => setDialog("edit")} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg">
                    <Pencil className="w-3.5 h-3.5" /> {t("r2.common.edit")}
                  </button>
                  {vendor.status !== "inactive" && (
                    <button onClick={() => setDialog("offboard")} className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 bg-white border border-orange-200 hover:bg-orange-50 px-2.5 py-1.5 rounded-lg">
                      <LogOut className="w-3.5 h-3.5" /> {t("r2.vendors.offboard")}
                    </button>
                  )}
                  <button onClick={() => setDialog("delete")} className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 px-2.5 py-1.5 rounded-lg">
                    <Trash2 className="w-3.5 h-3.5" /> {t("r2.common.delete")}
                  </button>
                </>
              )}
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
          </div>
          {ended && vendor.offboarded_at && (
            <p className="text-xs text-gray-600 mt-3 bg-white/70 border border-gray-200 rounded-lg px-3 py-2">
              {t("r2.vendors.offboarded_on", { date: new Date(vendor.offboarded_at).toLocaleDateString(dateLocale(i18n.language)) })}
              {vendor.offboarding_reason && <> — {vendor.offboarding_reason}</>}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6 bg-white">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-3 text-sm font-medium transition-colors relative ${
              activeTab === "overview"
                ? "text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t("vendors.tab_overview", "Overview")}
            {activeTab === "overview" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
            )}
          </button>
          <button
            onClick={() => setActiveTab("assessments")}
            className={`px-4 py-3 text-sm font-medium transition-colors relative flex items-center gap-1.5 ${
              activeTab === "assessments" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            {t("r2.vendors.assessments_tab")}
            {activeTab === "assessments" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
            )}
          </button>
          <button
            onClick={() => setActiveTab("cartography")}
            className={`px-4 py-3 text-sm font-medium transition-colors relative flex items-center gap-1.5 ${
              activeTab === "cartography"
                ? "text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            {t("nav.risk_cartography", "Risk Cartography")}
            {activeTab === "cartography" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
            )}
          </button>
        </div>

        {activeTab === "assessments" ? (
          <VendorAssessmentsTab vendor={vendor} canWrite={canWrite} onReassess={() => setDialog("reassess")}
            refreshKey={assessmentsKey} locale={dateLocale(i18n.language)} />
        ) : activeTab === "cartography" ? (
          <div className="p-6">
            <VendorRiskCartography vendorId={vendor.id} />
            <button
              type="button"
              onClick={onRunAI}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-medium transition-all shadow-sm"
            >
              <Sparkles className="w-4 h-4" />
              {t("vendors.ai_risk_assessment")}
            </button>
          </div>
        ) : (
        <div className="p-6 space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              {vendor.risk_score == null
                ? <p className="text-sm font-semibold text-gray-500 bg-gray-100 rounded-lg px-2 py-1 inline-block">{t("r2b.vendors.not_assessed")}</p>
                : <p className={`text-xl font-bold ${riskScoreColor(vendor.risk_score)} rounded-lg px-2 inline-block`}>{vendor.risk_score}</p>}
              <p className="text-xs text-gray-400 mt-1">{t("vendors.risk_score_label")}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center flex flex-col items-center justify-center">
              {vendor.has_data_processing_agreement
                ? <ShieldCheck className="w-6 h-6 text-green-500" />
                : <ShieldX className="w-6 h-6 text-red-500" />
              }
              <p className="text-xs text-gray-400 mt-1">{t("vendors.col_dpa")}</p>
              <p className="text-xs font-semibold text-gray-700">{vendor.has_data_processing_agreement ? t("vendors.dpa_signed_label") : t("vendors.dpa_missing_label")}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1 flex items-center justify-center gap-1"><Calendar className="w-3 h-3" />{t("vendors.contract_label")}</p>
              <p className="text-sm font-semibold text-gray-800">{vendor.contract_expiry}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("vendors.industry_label")}</p>
            <p className="text-sm text-gray-700">{vendor.industry ? t(`vendors_page.industry.${industryKey(vendor.industry)}`, { defaultValue: vendor.industry }) : ""}</p>
          </div>

          {vendor.services_provided && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t("vendors.services_label")}</p>
              <p className="text-sm text-gray-700">{vendor.services_provided}</p>
            </div>
          )}

          {vendor.website && (
            <div className="pt-2 border-t border-gray-50">
              <a href={vendor.website} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                <ExternalLink className="w-3.5 h-3.5" />{vendor.website}
              </a>
            </div>
          )}

          {!vendor.has_data_processing_agreement && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{t("vendors.no_dpa_warning")}</p>
            </div>
          )}

          {/* Show saved AI analysis if available */}
          {(vendor as any).description && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <p className="text-xs font-semibold text-blue-700">{t("vendors.ai_risk_assessment")}</p>
              </div>
              <div className="prose prose-sm max-w-none text-gray-700 text-xs overflow-y-auto max-h-64">
                {(vendor as any).description.split('\n').map((line: string, i: number) => (
                  <div key={i} className="mb-1">{line}</div>
                ))}
              </div>
            </div>
          )}

          {/* Contracts Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                <FileCheck className="w-3 h-3" />
                {t("vendors.contracts", "Contracts")} {contracts.length > 0 && `(${contracts.length})`}
              </p>
              {canWrite && !ended && (
                <UploadContractPanel vendor={vendor} onUploaded={(newExpiry) => {
                  setContractsKey(k => k + 1);
                  if (newExpiry && newExpiry !== vendor.contract_expiry) onChanged({ ...vendor, contract_expiry: newExpiry });
                }} />
              )}
            </div>
            {loadingContracts ? (
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400 mx-auto" />
              </div>
            ) : contracts.length === 0 ? (
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">{t("vendors.no_contracts", "No contracts uploaded yet")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {contracts.map((contract) => {
                  const statusCfg = CONTRACT_STATUS_LABELS[contract.validation_status] || CONTRACT_STATUS_LABELS.pending_ai;
                  return (
                    <div key={contract.id} className="bg-white border border-gray-200 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileCheck className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{contract.file_name}</p>
                            <p className="text-xs text-gray-500">v{contract.version} · {new Date(contract.created_at).toLocaleDateString(dateLocale(i18n.language))}</p>
                          </div>
                        </div>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusCfg.color}`}>
                          {String(t(statusCfg.key as never, statusCfg.fallback))}
                        </span>
                      </div>
                      {contract.ciso_comments && (
                        <div className="mt-2 text-xs text-gray-600 bg-yellow-50 border border-yellow-100 rounded p-2">
                          <strong>{t("company_admin.roles.ciso_label")}:</strong> {contract.ciso_comments}
                        </div>
                      )}
                      {/* Start Collaboration button — available once AI has reviewed */}
                      {["ai_reviewed", "approved", "sent_to_vendor"].includes(contract.validation_status) && (
                        <button
                          onClick={() => startCollaboration(contract.id)}
                          disabled={startingCollab === contract.id}
                          className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          {startingCollab === contract.id
                            ? <><Loader2 className="w-3 h-3 animate-spin" /> {t("common.loading")}</>
                            : <><ExternalLink className="w-3 h-3" /> {t("vendors.start_collaboration", "Start Collaboration with Vendor")}</>}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onRunAI}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-medium transition-all shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            {t("vendors.ai_risk_assessment")}
          </button>
        </div>
        )}
      </div>

      {dialog === "edit" && (
        <EditVendorModal vendor={vendor} onClose={() => setDialog(null)} onSaved={(v) => onChanged({ ...vendor, ...v } as VendorEntry)} />
      )}
      {dialog === "offboard" && (
        <OffboardVendorModal vendor={vendor} onClose={() => setDialog(null)} onSaved={(v) => onChanged({ ...vendor, ...v } as VendorEntry)} />
      )}
      {dialog === "delete" && (
        <DeleteVendorDialog vendor={vendor} onClose={() => setDialog(null)} onDeleted={onDeleted} />
      )}
      {dialog === "reassess" && (
        <ReassessVendorModal vendor={vendor} onClose={() => setDialog(null)} onSaved={(score) => {
          setAssessmentsKey(k => k + 1);
          if (score != null) onChanged({ ...vendor, risk_score: score });
        }} />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function VendorsPage() {
  const { t } = useTranslation();
  const [vendors, setVendors] = useState<VendorEntry[]>([]);
  const [, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<VendorEntry | null>(null);
  const [aiVendor, setAiVendor] = useState<VendorEntry | null>(null);
  const canWrite = hasAnyRole(useAuthStore((u) => u), VENDOR_WRITE_ROLES);

  const VENDOR_COLUMNS: ColumnDef[] = [
    { key: "vendor", label: t("vendors.col_vendor"), lockable: false },
    { key: "risk_tier", label: t("vendors.col_risk_tier") },
    { key: "status", label: t("vendors.col_status") },
    { key: "risk_score", label: t("vendors.col_risk_score") },
    { key: "dpa", label: t("vendors.col_dpa") },
    { key: "contract_expiry", label: t("vendors.col_contract_expiry") },
    { key: "services", label: t("vendors.col_services") },
  ];
  const { isVisible, toggle, reset } = useColumnVisibility("vendors", VENDOR_COLUMNS);

  useEffect(() => {
    const loadVendors = async () => {
      try {
        const response = await vendorsApi.list();
        setVendors((response.items || []) as unknown as VendorEntry[]);
      } catch (err) {
        console.error("Failed to load vendors:", err);
        setVendors([]);
      } finally {
        setLoading(false);
      }
    };
    loadVendors();
  }, []);

  const filtered = vendors.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase()) ||
      (v.industry?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchTier = tierFilter === "all" || v.risk_tier === tierFilter;
    return matchSearch && matchTier;
  });

  const tierCounts = {
    critical: vendors.filter(v => v.risk_tier === "critical").length,
    high:     vendors.filter(v => v.risk_tier === "high").length,
    medium:   vendors.filter(v => v.risk_tier === "medium").length,
    low:      vendors.filter(v => v.risk_tier === "low").length,
  };
  const missingDpa = vendors.filter(v => !v.has_data_processing_agreement).length;
  // Unassessed vendors are left out of the average (they are not risk 0).
  const scoredVendors = vendors.filter(v => v.risk_score != null);
  const avgScore   = scoredVendors.length > 0 ? Math.round(scoredVendors.reduce((s, v) => s + (v.risk_score as number), 0) / scoredVendors.length) : null;

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("vendors.management_title")}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {t("vendors.subtitle", { count: vendors.length, critical: vendors.filter(v => v.risk_tier === "critical").length, missing_dpa: missingDpa })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/vendors/contract-review"
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <FileCheck className="w-4 h-4" /> {t("vendors.contract_review")}
          </Link>
          {canWrite && (
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" /> {t("vendors.new_vendor")}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: t("vendors.kpi_total"),        value: vendors.length,      sub: t("vendors.kpi_total_sub") },
          { label: t("vendors.kpi_avg_score"),     value: avgScore ?? "—",      sub: t("vendors.kpi_avg_score_sub") },
          { label: t("vendors.kpi_missing_dpa"),   value: missingDpa,          sub: t("vendors.kpi_missing_dpa_sub") },
          { label: t("vendors.kpi_under_review"),  value: vendors.filter(v => v.status === "under_review").length, sub: t("vendors.kpi_under_review_sub") },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder={t("vendors.search_placeholder")}
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex gap-2">
          {([
            { key: "all",      label: t("common.all"),           count: vendors.length,       cls: "" },
            { key: "critical", label: t("vendors.tiers.critical"), count: tierCounts.critical,  cls: "text-red-700 border-red-200 bg-red-50" },
            { key: "high",     label: t("vendors.tiers.high"),     count: tierCounts.high,      cls: "text-orange-700 border-orange-200 bg-orange-50" },
            { key: "medium",   label: t("vendors.tiers.medium"),   count: tierCounts.medium,    cls: "text-yellow-700 border-yellow-200 bg-yellow-50" },
            { key: "low",      label: t("vendors.tiers.low"),      count: tierCounts.low,       cls: "text-green-700 border-green-200 bg-green-50" },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setTierFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                tierFilter === tab.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}>
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${tierFilter === tab.key ? "bg-white/20" : "bg-gray-100 text-gray-600"}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
        <ColumnsMenu columns={VENDOR_COLUMNS} isVisible={isVisible} toggle={toggle} reset={reset} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5 first:px-6">{t("vendors.col_vendor")}</th>
              {isVisible("risk_tier") && <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">{t("vendors.col_risk_tier")}</th>}
              {isVisible("status") && <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">{t("vendors.col_status")}</th>}
              {isVisible("risk_score") && <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">{t("vendors.col_risk_score")}</th>}
              {isVisible("dpa") && <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">{t("vendors.col_dpa")}</th>}
              {isVisible("contract_expiry") && <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">{t("vendors.col_contract_expiry")}</th>}
              {isVisible("services") && <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">{t("vendors.col_services")}</th>}
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(v => (
              <tr key={v.id} onClick={() => setSelected(v)}
                className="hover:bg-gray-50 cursor-pointer transition-colors group">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-slate-200 transition-colors">
                      <Building2 className="w-4 h-4 text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">{v.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                        <span>{v.industry ? t(`vendors_page.industry.${industryKey(v.industry)}`, { defaultValue: v.industry }) : ""}</span>
                        <span className="flex items-center gap-0.5"><Globe className="w-2.5 h-2.5" />{v.country}</span>
                      </div>
                    </div>
                  </div>
                </td>
                {isVisible("risk_tier") && (
                  <td className="px-4 py-4">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${TIER_BADGE[v.risk_tier as Tier]}`}>
                      {t(`vendors.tiers.${v.risk_tier}`, { defaultValue: v.risk_tier })}
                    </span>
                  </td>
                )}
                {isVisible("status") && (
                  <td className="px-4 py-4">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_BADGE[v.status as Status]}`}>
                      {t(`vocab.${v.status}`, { defaultValue: v.status.replaceAll("_", " ") })}
                    </span>
                  </td>
                )}
                {isVisible("risk_score") && (
                  <td className="px-4 py-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {(v.risk_score ?? 0) > 20 && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                      {v.risk_score == null
                        ? <span className="text-xs font-medium px-2 py-0.5 rounded-lg bg-gray-100 text-gray-500">{t("r2b.vendors.not_assessed")}</span>
                        : <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${riskScoreColor(v.risk_score)}`}>{v.risk_score}</span>}
                    </div>
                  </td>
                )}
                {isVisible("dpa") && (
                  <td className="px-4 py-4 text-center">
                    {v.has_data_processing_agreement
                      ? <ShieldCheck className="w-4 h-4 text-green-500 mx-auto" />
                      : <ShieldX className="w-4 h-4 text-red-500 mx-auto" />
                    }
                  </td>
                )}
                {isVisible("contract_expiry") && <td className="px-4 py-4 text-xs text-gray-500">{v.contract_expiry}</td>}
                {isVisible("services") && <td className="px-4 py-4 text-xs text-gray-400 max-w-[160px] truncate">{v.services_provided}</td>}
                <td className="px-4 py-4">
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">{t("vendors.no_filter_match")}</div>
        )}
      </div>

      {showAdd && (
        <AddVendorModal
          onClose={() => setShowAdd(false)}
          onSaved={v => setVendors(prev => [v, ...prev])}
        />
      )}
      {selected && (
        <VendorDetailModal
          key={selected.id}
          vendor={selected}
          onClose={() => setSelected(null)}
          onRunAI={() => { setAiVendor(selected); setSelected(null); }}
          onChanged={(v) => {
            setSelected(v);
            setVendors(prev => prev.map(x => x.id === v.id ? v : x));
          }}
          onDeleted={() => {
            setVendors(prev => prev.filter(x => x.id !== selected.id));
            setSelected(null);
          }}
        />
      )}
      {aiVendor && (
        <VendorAIModal
          vendorId={aiVendor.id}
          vendorName={aiVendor.name}
          vendorIndustry={aiVendor.industry ?? undefined}
          vendorServices={aiVendor.services_provided ?? undefined}
          onClose={() => setAiVendor(null)}
          onApproved={(v) => {
            // The register and the detail read the new score straight away.
            const updated = { ...aiVendor, ...(v as unknown as VendorEntry) };
            setVendors(prev => prev.map(x => x.id === updated.id ? updated : x));
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}
