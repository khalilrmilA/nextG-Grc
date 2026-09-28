/**
 * VendorRiskCartography — Visual risk map for a vendor across 6 dimensions.
 * Displays: risk heatmap, overall score, dimension breakdown with likelihood x impact.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Map, Loader2, AlertTriangle, ShieldCheck, Shield, ShieldAlert, Info } from "lucide-react";
import { vendorsApi } from "@/api/endpoints";

interface RiskDimension {
  category: string;
  label: string;
  likelihood: number;
  impact: number;
  score: number;
  level: string;
  description: string;
  indicators: string[];
}

interface CartographyData {
  vendor_id: string;
  vendor_name: string;
  overall_score: number;
  overall_level: string;
  dimensions: RiskDimension[];
  generated_at: string;
}

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string; cell: string }> = {
  low: {
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
    cell: "bg-green-500",
  },
  medium: {
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    border: "border-yellow-200",
    cell: "bg-yellow-500",
  },
  high: {
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
    cell: "bg-orange-500",
  },
  critical: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    cell: "bg-red-500",
  },
};

const LEVEL_ICONS: Record<string, typeof ShieldCheck> = {
  low: ShieldCheck,
  medium: Shield,
  high: ShieldAlert,
  critical: AlertTriangle,
};

// The backend builds the 6 dimensions (label, description, indicators) in
// English. Labels/descriptions are translated by their stable `category`;
// indicators are matched against the fixed backend phrasings below, and any
// unknown indicator falls back to the raw backend text.
const INDICATOR_EXACT: Record<string, string> = {
  "✓ Data Processing Agreement signed": "dpa_signed",
  "✗ No DPA signed": "no_dpa",
  "✓ Encryption & privacy controls mentioned": "encryption_mentioned",
  "✓ Breach notification SLA defined": "breach_sla",
  "No specific indicators available": "no_indicators",
  "✓ 1 security certification identified": "one_cert",
  "✗ No certifications identified in contract": "no_certs",
  "✓ SLA uptime guarantees defined": "sla_uptime",
  "✓ 24/7 support available": "support_247",
  "✓ Vendor currently active": "vendor_active",
  "Standard operational risk": "std_operational",
  "⚠ No contract expiry date set": "no_expiry",
  "Standard financial risk": "std_financial",
  "✓ Contract reviewed and approved by CISO": "contract_approved",
  "✓ Contract under AI/CISO review": "contract_under_review",
  "✗ No contract reviewed": "no_contract_reviewed",
  "✓ Liability & indemnification clauses present": "liability_clauses",
  "⚠ AI flagged critical concerns": "ai_flagged_critical",
  "⚠ Critical risk tier - high visibility": "critical_tier",
  "⚠ High risk tier": "high_tier",
  "Standard reputational risk": "std_reputational",
};
const INDICATOR_PATTERNS: { re: RegExp; key: string }[] = [
  { re: /^✓ (\d+) security certifications identified$/, key: "n_certs" },
  { re: /^⚠ High-regulation industry: (.+)$/, key: "high_regulation" },
  { re: /^⚠ Status: (.+)$/, key: "status" },
  { re: /^⚠ Contract expires in (-?\d+) days$/, key: "expires_in" },
  { re: /^✓ Contract valid for (-?\d+) days$/, key: "valid_for" },
  { re: /^⚠ AI contract review rated (\w+)$/, key: "ai_rated_warn" },
  { re: /^✓ AI contract review rated (\w+)$/, key: "ai_rated_ok" },
  { re: /^✓ Public presence: (.+)$/, key: "public_presence" },
];

function translateIndicator(t: TFunction, raw: string): string {
  const exact = INDICATOR_EXACT[raw];
  if (exact) return t(`vendor_carto.ind.${exact}`, { defaultValue: raw });
  for (const { re, key } of INDICATOR_PATTERNS) {
    const m = raw.match(re);
    if (m) {
      let value = m[1];
      if (key === "status") value = t(`vocab.${value}`, { defaultValue: value.replaceAll("_", " ") });
      if (key === "ai_rated_warn" || key === "ai_rated_ok") value = t(`vocab.${value.toLowerCase()}`, { defaultValue: value });
      return t(`vendor_carto.ind.${key}`, { value, defaultValue: raw });
    }
  }
  return raw;
}

function getHeatmapColor(score: number): string {
  if (score >= 16) return "bg-red-500";
  if (score >= 10) return "bg-orange-500";
  if (score >= 5) return "bg-yellow-500";
  return "bg-green-500";
}



export default function VendorRiskCartography({ vendorId }: { readonly vendorId: string }) {
  const { t } = useTranslation();
  const dimLabel = (d: RiskDimension) => t(`vendor_carto.dim.${d.category}.label`, { defaultValue: d.label });
  const dimDesc = (d: RiskDimension) => t(`vendor_carto.dim.${d.category}.description`, { defaultValue: d.description });
  const levelLabel = (l: string) => t(`vocab.${l}`, { defaultValue: l });
  const [data, setData] = useState<CartographyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDim, setSelectedDim] = useState<RiskDimension | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await vendorsApi.getRiskCartography(vendorId);
        setData(result);
        if (result?.dimensions?.length) {
          setSelectedDim(result.dimensions[0]);
        }
      } catch (err) {
        console.error("Failed to load cartography:", err);
        setError(t("vendor_carto.load_error"));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [vendorId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
        <p className="text-sm text-red-600">{error || t("vendor_carto.no_data")}</p>
      </div>
    );
  }

  const overallCfg = LEVEL_COLORS[data.overall_level] || LEVEL_COLORS.medium;
  const OverallIcon = LEVEL_ICONS[data.overall_level] || Shield;

  return (
    <div className="space-y-4">
      {/* Header with Overall Score */}
      <div className={`rounded-xl border ${overallCfg.bg} ${overallCfg.border} p-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${overallCfg.cell}`}>
              <OverallIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("vendor_carto.overall_score")}</p>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${overallCfg.text}`}>{data.overall_score}</span>
                <span className="text-xs text-gray-500">/ 25</span>
                <span className={`text-xs font-semibold uppercase ${overallCfg.text}`}>{levelLabel(data.overall_level)}</span>
              </div>
            </div>
          </div>
          <Map className="w-8 h-8 text-gray-300" />
        </div>
      </div>

      {/* Risk Heatmap 5x5 Grid */}
      {selectedDim && (
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">{t("vendor_carto.heatmap")}</h4>
              <p className="text-xs text-gray-500">{t("vendor_carto.likelihood_x_impact")} - <span className="font-semibold">{dimLabel(selectedDim)}</span></p>
            </div>
          </div>
          <div className="flex gap-2">
            {/* Y-axis label */}
            <div className="flex flex-col items-center justify-center">
              <div className="writing-mode-vertical text-[10px] text-gray-500 uppercase tracking-wider" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                {t("cartography.impact_axis")} →
              </div>
            </div>
            {/* Heatmap grid */}
            <div className="flex-1">
              <div className="grid grid-cols-5 gap-1">
                {[5, 4, 3, 2, 1].map((impact) =>
                  [1, 2, 3, 4, 5].map((likelihood) => {
                    const cellScore = likelihood * impact;
                    const isCurrentCell = likelihood === selectedDim.likelihood && impact === selectedDim.impact;
                    return (
                      <div
                        key={`${likelihood}-${impact}`}
                        className={`aspect-square rounded-md flex items-center justify-center text-xs font-bold text-white transition-all ${getHeatmapColor(cellScore)} ${
                          isCurrentCell ? "ring-2 ring-gray-900 ring-offset-1 scale-110 opacity-100" : "opacity-30"
                        }`}
                        title={t("vendor_carto.cell_title", { l: likelihood, i: impact, score: cellScore })}
                      >
                        {isCurrentCell && cellScore}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex justify-between text-[10px] text-gray-500 uppercase tracking-wider mt-1">
                <span>{t("vocab.low")}</span>
                <span>{t("cartography.likelihood_axis")} →</span>
                <span>{t("vocab.high")}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-green-500"></div>
              <span className="text-[10px] text-gray-500">{t("vocab.low")} (1-4)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-yellow-500"></div>
              <span className="text-[10px] text-gray-500">{t("vocab.medium")} (5-9)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-orange-500"></div>
              <span className="text-[10px] text-gray-500">{t("vocab.high")} (10-15)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-red-500"></div>
              <span className="text-[10px] text-gray-500">{t("vocab.critical")} (16-25)</span>
            </div>
          </div>
        </div>
      )}

      {/* Dimension Cards Grid */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t("vendor_carto.dimensions")}</h4>
        <div className="grid grid-cols-2 gap-2">
          {data.dimensions.map((dim) => {
            const cfg = LEVEL_COLORS[dim.level] || LEVEL_COLORS.medium;
            const Icon = LEVEL_ICONS[dim.level] || Shield;
            const isSelected = selectedDim?.category === dim.category;
            return (
              <button
                key={dim.category}
                onClick={() => setSelectedDim(dim)}
                className={`text-start rounded-xl border p-3 transition-all ${cfg.bg} ${cfg.border} ${
                  isSelected ? "ring-2 ring-blue-500" : "hover:shadow-sm"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${cfg.text}`} />
                    <span className="text-xs font-semibold text-gray-900">{dimLabel(dim)}</span>
                  </div>
                  <span className={`text-xs font-bold ${cfg.text}`}>{dim.score}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white rounded-full overflow-hidden">
                    <div
                      className={`h-full ${cfg.cell}`}
                      style={{ width: `${(dim.score / 25) * 100}%` }}
                    ></div>
                  </div>
                  <span className={`text-[10px] font-medium uppercase ${cfg.text}`}>{levelLabel(dim.level)}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
                  <span>{t("vendor_carto.l_short")}: {dim.likelihood}</span>
                  <span>·</span>
                  <span>{t("vendor_carto.i_short")}: {dim.impact}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Dimension Details */}
      {selectedDim && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
          <div className="flex items-start gap-2 mb-2">
            <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h5 className="text-sm font-semibold text-gray-900">{dimLabel(selectedDim)}</h5>
              <p className="text-xs text-gray-600 mt-1">{dimDesc(selectedDim)}</p>
            </div>
          </div>
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{t("vendor_carto.key_indicators")}</p>
            <ul className="space-y-1">
              {selectedDim.indicators.map((indicator, i) => (
                <li key={i} className="text-xs text-gray-700">{translateIndicator(t, indicator)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
