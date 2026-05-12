import { useTranslation } from "react-i18next";

interface Milestone {
  label: string;
  sublabel: string;
  done: boolean;
  active: boolean;
}

interface Props {
  readonly complianceScore: number;
  readonly docCompleteness: number;  // 0–100
  readonly openBlockers: number;
  readonly openActions: number;
  readonly certReadiness: number;    // 0–100
}

function phaseDone(score: number, threshold: number) {
  return score >= threshold;
}

export default function ComplianceJourneyMap({
  complianceScore,
  docCompleteness,
  openBlockers,
  openActions,
  certReadiness,
}: Props) {
  const { t } = useTranslation();

  const milestones: Milestone[] = [
    {
      label: t("compliance.journey_gap_analysis"),
      sublabel: t("compliance.journey_score", { pct: complianceScore }),
      done: phaseDone(complianceScore, 1),
      active: !phaseDone(complianceScore, 50),
    },
    {
      label: t("compliance.journey_remediation"),
      sublabel: openActions === 0
        ? t("compliance.journey_all_resolved")
        : t("compliance.journey_open", { count: openActions }),
      done: openActions === 0 && complianceScore >= 50,
      active: complianceScore >= 50 && openActions > 0,
    },
    {
      label: t("compliance.journey_documentation"),
      sublabel: t("compliance.journey_pct_complete", { pct: docCompleteness }),
      done: phaseDone(docCompleteness, 90),
      active: openActions === 0 && !phaseDone(docCompleteness, 90),
    },
    {
      label: t("compliance.journey_blocker_resolution"),
      sublabel: openBlockers === 0
        ? t("compliance.journey_cleared")
        : t("compliance.journey_remaining", { count: openBlockers }),
      done: openBlockers === 0 && phaseDone(docCompleteness, 90),
      active: phaseDone(docCompleteness, 90) && openBlockers > 0,
    },
    {
      label: t("compliance.journey_cert_ready"),
      sublabel: t("compliance.journey_readiness", { pct: certReadiness }),
      done: phaseDone(certReadiness, 80),
      active: openBlockers === 0 && !phaseDone(certReadiness, 80),
    },
  ];

  const W = 600;
  const H = 110;
  const padX = 50;
  const midY = 52;
  const step = (W - padX * 2) / (milestones.length - 1);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{t("compliance.journey_title")}</h3>
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[500px]"
          style={{ height: H }}
        >
          {/* Connecting lines */}
          {milestones.map((m, i) => {
            if (i === 0) return null;
            const x1 = padX + (i - 1) * step + 16;
            const x2 = padX + i * step - 16;
            const done = milestones[i - 1].done && m.done;
            return (
              <line
                key={`line-${i}`}
                x1={x1} y1={midY} x2={x2} y2={midY}
                stroke={done ? "#22c55e" : milestones[i - 1].done ? "#93c5fd" : "#e5e7eb"}
                strokeWidth={3}
                strokeDasharray={done ? undefined : "6 3"}
              />
            );
          })}

          {/* Milestone nodes */}
          {milestones.map((m, i) => {
            const cx = padX + i * step;
            const fill = m.done ? "#22c55e" : m.active ? "#3b82f6" : "#e5e7eb";
            const textColor = m.done ? "#15803d" : m.active ? "#1d4ed8" : "#9ca3af";

            return (
              <g key={`milestone-${i}`}>
                {m.active && (
                  <circle cx={cx} cy={midY} r={19} fill="none" stroke="#93c5fd" strokeWidth={3} />
                )}
                <circle cx={cx} cy={midY} r={14} fill={fill} />
                {m.done ? (
                  <text x={cx} y={midY + 5} textAnchor="middle" fontSize={14} fill="white" fontWeight="bold">
                    ✓
                  </text>
                ) : (
                  <text x={cx} y={midY + 5} textAnchor="middle" fontSize={12} fill="white" fontWeight="bold">
                    {i + 1}
                  </text>
                )}
                <text x={cx} y={midY + 30} textAnchor="middle" fontSize={10} fill={textColor} fontWeight="600">
                  {m.label}
                </text>
                <text x={cx} y={midY + 42} textAnchor="middle" fontSize={9} fill="#9ca3af">
                  {m.sublabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 justify-center">
        {[
          { color: "bg-green-500", label: t("compliance.journey_legend_complete") },
          { color: "bg-blue-500",  label: t("compliance.journey_legend_in_progress") },
          { color: "bg-gray-200",  label: t("compliance.journey_legend_pending") },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-full ${color}`} />
            <span className="text-xs text-gray-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
