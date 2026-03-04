import { Check } from "lucide-react";
import type { Framework } from "@/types";

interface Props {
  framework: Framework;
  selected: boolean;
  isPrimary: boolean;
  onSelectPrimary: () => void;
  onToggleSecondary: () => void;
  recommendedFor?: string[];   // e.g. ["technology", "GB"]
  userIndustry?: string;
  userCountry?: string;
}

function isRecommended(fw: Framework, industry?: string, country?: string): boolean {
  if (industry && fw.applicable_industries?.includes(industry)) return true;
  if (country && fw.applicable_regions?.includes(country)) return true;
  return false;
}

export default function FrameworkSelectionCard({
  framework, selected, isPrimary, onSelectPrimary, onToggleSecondary,
  userIndustry, userCountry,
}: Props) {
  const recommended = isRecommended(framework, userIndustry, userCountry);

  const colorMap: Record<string, string> = {
    "ISO 27001": "blue",
    "SOC 2": "purple",
    "NIST CSF": "green",
    "GDPR": "indigo",
    "HIPAA": "rose",
    "PCI DSS": "orange",
    "NIST 800-53": "teal",
    "CIS Controls": "cyan",
  };
  const color = Object.entries(colorMap).find(([k]) => framework.short_name.includes(k))?.[1] ?? "slate";

  const bgMap: Record<string, string> = {
    blue: "bg-blue-50 border-blue-200", purple: "bg-purple-50 border-purple-200",
    green: "bg-green-50 border-green-200", indigo: "bg-indigo-50 border-indigo-200",
    rose: "bg-rose-50 border-rose-200", orange: "bg-orange-50 border-orange-200",
    teal: "bg-teal-50 border-teal-200", cyan: "bg-cyan-50 border-cyan-200",
    slate: "bg-slate-50 border-slate-200",
  };
  const badgeMap: Record<string, string> = {
    blue: "bg-blue-100 text-blue-800", purple: "bg-purple-100 text-purple-800",
    green: "bg-green-100 text-green-800", indigo: "bg-indigo-100 text-indigo-800",
    rose: "bg-rose-100 text-rose-800", orange: "bg-orange-100 text-orange-800",
    teal: "bg-teal-100 text-teal-800", cyan: "bg-cyan-100 text-cyan-800",
    slate: "bg-slate-100 text-slate-800",
  };

  return (
    <div className={`relative rounded-xl border-2 p-4 cursor-pointer transition-all ${
      isPrimary
        ? `border-blue-500 bg-blue-50 shadow-md`
        : selected
        ? `border-slate-400 ${bgMap[color]}`
        : `border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm`
    }`}>
      {/* Recommended badge */}
      {recommended && (
        <span className="absolute -top-2.5 left-3 text-xs font-semibold bg-amber-400 text-amber-900 px-2 py-0.5 rounded-full">
          Recommended
        </span>
      )}

      {/* Primary radio */}
      <div className="flex items-start justify-between mb-2">
        <button
          type="button"
          onClick={onSelectPrimary}
          className="flex items-center gap-2 text-left flex-1"
        >
          <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
            isPrimary ? "border-blue-500 bg-blue-500" : "border-gray-300"
          }`}>
            {isPrimary && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
          </div>
          <span className="font-semibold text-gray-900 text-sm leading-tight">{framework.name}</span>
        </button>

        {/* Secondary checkbox */}
        {!isPrimary && (
          <button
            type="button"
            onClick={onToggleSecondary}
            className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
              selected ? "bg-slate-600 border-slate-600" : "border-gray-300 hover:border-slate-400"
            }`}
          >
            {selected && <Check className="w-3 h-3 text-white" />}
          </button>
        )}
      </div>

      {/* Short name badge + control count */}
      <div className="flex items-center gap-2 mb-2 ml-6">
        <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${badgeMap[color]}`}>
          {framework.short_name}
        </span>
        <span className="text-xs text-gray-400">{framework.control_count} controls</span>
      </div>

      {/* Description */}
      {framework.description && (
        <p className="text-xs text-gray-500 ml-6 line-clamp-2">{framework.description}</p>
      )}

      {/* Primary label */}
      {isPrimary && (
        <div className="ml-6 mt-2">
          <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
            Primary Framework
          </span>
        </div>
      )}
    </div>
  );
}
