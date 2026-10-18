import { useTranslation } from "react-i18next";
import { ShieldCheck, Sparkles } from "lucide-react";

// ── Prescreen Questionnaire Definition ──────────────────────────────────────
// Shared by the new-vendor wizard and the Reassess flow on an existing vendor.
// The English question text is what gets sent to the AI (it keys the responses),
// so it stays here as data; the on-screen label goes through t() by id.
interface QuestionGroup {
  category: string;
  icon: string;
  questions: { id: string; text: string }[];
}

export const PRESCREEN_QUESTIONS: QuestionGroup[] = [
  {
    category: "security",
    icon: "shield",
    questions: [
      { id: "iso27001", text: "Is the 3rd party ISO 27001 certified?" },
      { id: "soc2", text: "Does the 3rd party hold SOC 2 Type II certification?" },
      { id: "encryption", text: "Is data encrypted at rest and in transit (AES-256, TLS 1.3)?" },
      { id: "pentest", text: "Does the 3rd party conduct annual penetration testing?" },
      { id: "mfa", text: "Is multi-factor authentication enforced for all admin access?" },
    ],
  },
  {
    category: "compliance",
    icon: "check",
    questions: [
      { id: "gdpr", text: "Is the 3rd party GDPR compliant?" },
      { id: "dpa", text: "Will a Data Processing Agreement (DPA) be signed?" },
      { id: "irp", text: "Does the 3rd party have a documented incident response plan?" },
      { id: "subprocessors", text: "Will sub-processor changes be notified in advance?" },
      { id: "right_to_audit", text: "Does the contract include a 'right to audit' clause?" },
    ],
  },
  {
    category: "operations",
    icon: "settings",
    questions: [
      { id: "sla", text: "Does the 3rd party guarantee 99.9%+ uptime SLA?" },
      { id: "support", text: "Is 24/7 support available?" },
      { id: "drp", text: "Is the disaster recovery plan tested annually?" },
      { id: "backup", text: "Are data backup procedures documented and tested?" },
      { id: "change_mgmt", text: "Is there a documented change management process?" },
    ],
  },
];

export interface PrescreenResult {
  initial_risk_score: number;
  risk_level: string;
  summary: string;
  strengths: string[];
  concerns: string[];
  red_flags: string[];
  recommendations: string[];
  questionnaire_responses: Record<string, string>;
}

/** Every question answered "na" — the starting state of a questionnaire. */
export function emptyPrescreenResponses(): Record<string, string> {
  const init: Record<string, string> = {};
  PRESCREEN_QUESTIONS.forEach(g => g.questions.forEach(q => { init[q.text] = "na"; }));
  return init;
}

/** The prescreen score on the register's 1–40 scale (the wizard's convention). */
export const prescreenToRegisterScore = (aiScore: number) => Math.round(aiScore * 4);

/** The body POST /vendors/{id}/assessments keeps for a prescreen run. */
export function prescreenAssessmentPayload(result: PrescreenResult, responses: Record<string, string>, appliedScore: number) {
  return {
    answers: responses,
    initial_risk_score: result.initial_risk_score,
    risk_level: result.risk_level,
    summary: result.summary,
    strengths: result.strengths,
    concerns: result.concerns,
    red_flags: result.red_flags,
    recommendations: result.recommendations,
    apply_score: true,
    applied_risk_score: appliedScore,
  };
}

export function PrescreenQuestions({ responses, onChange }: {
  readonly responses: Record<string, string>;
  readonly onChange: (next: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
        <p className="text-xs text-blue-900">
          <Sparkles className="w-3 h-3 inline mr-1" />
          {t("vendors_page.questionnaire_intro")}
        </p>
      </div>

      {PRESCREEN_QUESTIONS.map((group) => (
        <div key={group.category}>
          <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            {t(`vendors_page.prescreen_category.${group.category}`)}
          </h3>
          <div className="space-y-2">
            {group.questions.map(({ id, text: q }) => (
              <div key={q} className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm text-gray-800 mb-2">{t(`vendors_page.prescreen.${id}`, { defaultValue: q })}</p>
                <div className="flex gap-2">
                  {["yes", "no", "na"].map((option) => (
                    <label key={option} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border cursor-pointer transition-colors text-xs font-medium ${
                      responses[q] === option
                        ? option === "yes" ? "bg-green-100 border-green-300 text-green-700"
                        : option === "no" ? "bg-red-100 border-red-300 text-red-700"
                        : "bg-gray-200 border-gray-300 text-gray-700"
                        : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}>
                      <input
                        type="radio"
                        name={q}
                        value={option}
                        checked={responses[q] === option}
                        onChange={() => onChange({ ...responses, [q]: option })}
                        className="sr-only"
                      />
                      {option === "yes" ? `✓ ${t("common.yes")}` : option === "no" ? `✗ ${t("common.no")}` : t("dashboard.na")}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PrescreenInsights({ result, suggestedScore }: {
  readonly result: PrescreenResult;
  readonly suggestedScore?: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${
        result.risk_level === "critical" ? "bg-red-50 border-red-200" :
        result.risk_level === "high" ? "bg-orange-50 border-orange-200" :
        result.risk_level === "medium" ? "bg-yellow-50 border-yellow-200" :
        "bg-green-50 border-green-200"
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gray-600" />
            <h3 className="text-sm font-bold text-gray-900">{t("vendors.ai_risk_assessment")}</h3>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{result.initial_risk_score.toFixed(1)}<span className="text-xs text-gray-500">/10</span></div>
            <div className="text-xs uppercase font-semibold">{String(t(`vendors.tiers.${result.risk_level}` as never, result.risk_level))}</div>
          </div>
        </div>
        <p className="text-xs text-gray-700">{result.summary}</p>
      </div>

      <InsightList items={result.strengths} title={`✓ ${t("vendors_page.strengths")}`} titleCls="text-green-700" itemCls="bg-green-50" />
      <InsightList items={result.concerns} title={`⚠ ${t("vendors_page.concerns")}`} titleCls="text-yellow-700" itemCls="bg-yellow-50" />
      <InsightList items={result.red_flags} title={`🚩 ${t("vendors_page.red_flags")}`} titleCls="text-red-700" itemCls="bg-red-50" />
      <InsightList items={result.recommendations} title={`💡 ${t("vendors_page.recommendations")}`} titleCls="text-blue-700" itemCls="bg-blue-50" />

      {suggestedScore != null && (
        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
          <strong>{t("vendors.suggested_risk_score", "Suggested Risk Score")}:</strong> {suggestedScore}/40
        </div>
      )}
    </div>
  );
}

export function InsightList({ items, title, titleCls, itemCls }: {
  readonly items?: string[]; readonly title: string; readonly titleCls: string; readonly itemCls: string;
}) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className={`text-xs font-bold uppercase mb-1.5 ${titleCls}`}>{title}</h4>
      <ul className="space-y-1">
        {items.map((s, i) => (
          <li key={i} className={`text-xs text-gray-700 rounded px-2 py-1.5 ${itemCls}`}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
