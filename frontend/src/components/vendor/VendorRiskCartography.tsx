/**
 * VendorRiskCartography — Visual risk map for a vendor across 6 dimensions.
 * Displays: risk heatmap, overall score, dimension breakdown with likelihood x impact.
 */
import { useState, useEffect } from "react";
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

function getHeatmapColor(score: number): string {
  if (score >= 16) return "bg-red-500";
  if (score >= 10) return "bg-orange-500";
  if (score >= 5) return "bg-yellow-500";
  return "bg-green-500";
}



export default function VendorRiskCartography({ vendorId }: { readonly vendorId: string }) {
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
        setError("Failed to load risk cartography");
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
        <p className="text-sm text-red-600">{error || "No cartography data"}</p>
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
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Overall Risk Score</p>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-bold ${overallCfg.text}`}>{data.overall_score}</span>
                <span className="text-xs text-gray-500">/ 25</span>
                <span className={`text-xs font-semibold uppercase ${overallCfg.text}`}>{data.overall_level}</span>
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
              <h4 className="text-sm font-semibold text-gray-900">Risk Heatmap</h4>
              <p className="text-xs text-gray-500">Likelihood × Impact - <span className="font-semibold">{selectedDim.label}</span></p>
            </div>
          </div>
          <div className="flex gap-2">
            {/* Y-axis label */}
            <div className="flex flex-col items-center justify-center">
              <div className="writing-mode-vertical text-[10px] text-gray-500 uppercase tracking-wider" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                Impact →
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
                        title={`L:${likelihood} × I:${impact} = ${cellScore}`}
                      >
                        {isCurrentCell && cellScore}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex justify-between text-[10px] text-gray-500 uppercase tracking-wider mt-1">
                <span>Low</span>
                <span>Likelihood →</span>
                <span>High</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-green-500"></div>
              <span className="text-[10px] text-gray-500">Low (1-4)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-yellow-500"></div>
              <span className="text-[10px] text-gray-500">Medium (5-9)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-orange-500"></div>
              <span className="text-[10px] text-gray-500">High (10-15)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-red-500"></div>
              <span className="text-[10px] text-gray-500">Critical (16-25)</span>
            </div>
          </div>
        </div>
      )}

      {/* Dimension Cards Grid */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Risk Dimensions (Click to Explore)</h4>
        <div className="grid grid-cols-2 gap-2">
          {data.dimensions.map((dim) => {
            const cfg = LEVEL_COLORS[dim.level] || LEVEL_COLORS.medium;
            const Icon = LEVEL_ICONS[dim.level] || Shield;
            const isSelected = selectedDim?.category === dim.category;
            return (
              <button
                key={dim.category}
                onClick={() => setSelectedDim(dim)}
                className={`text-left rounded-xl border p-3 transition-all ${cfg.bg} ${cfg.border} ${
                  isSelected ? "ring-2 ring-blue-500" : "hover:shadow-sm"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${cfg.text}`} />
                    <span className="text-xs font-semibold text-gray-900">{dim.label}</span>
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
                  <span className={`text-[10px] font-medium uppercase ${cfg.text}`}>{dim.level}</span>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
                  <span>L: {dim.likelihood}</span>
                  <span>·</span>
                  <span>I: {dim.impact}</span>
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
              <h5 className="text-sm font-semibold text-gray-900">{selectedDim.label}</h5>
              <p className="text-xs text-gray-600 mt-1">{selectedDim.description}</p>
            </div>
          </div>
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Key Indicators</p>
            <ul className="space-y-1">
              {selectedDim.indicators.map((indicator, i) => (
                <li key={i} className="text-xs text-gray-700">{indicator}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
