/**
 * ComplianceJourneyMap — horizontal SVG milestone timeline.
 * Shows the 5 phases from Gap Analysis → Certification.
 * Phase completion is derived from the framework summary data.
 */

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
  const milestones: Milestone[] = [
    {
      label: "Gap Analysis",
      sublabel: `${complianceScore}% score`,
      done: phaseDone(complianceScore, 1),
      active: !phaseDone(complianceScore, 50),
    },
    {
      label: "Remediation",
      sublabel: openActions === 0 ? "All resolved" : `${openActions} open`,
      done: openActions === 0 && complianceScore >= 50,
      active: complianceScore >= 50 && openActions > 0,
    },
    {
      label: "Documentation",
      sublabel: `${docCompleteness}% complete`,
      done: phaseDone(docCompleteness, 90),
      active: openActions === 0 && !phaseDone(docCompleteness, 90),
    },
    {
      label: "Blocker Resolution",
      sublabel: openBlockers === 0 ? "Cleared" : `${openBlockers} remaining`,
      done: openBlockers === 0 && phaseDone(docCompleteness, 90),
      active: phaseDone(docCompleteness, 90) && openBlockers > 0,
    },
    {
      label: "Certification Ready",
      sublabel: `${certReadiness}% readiness`,
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
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Compliance Journey</h3>
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
                {/* Outer ring for active */}
                {m.active && (
                  <circle cx={cx} cy={midY} r={19} fill="none" stroke="#93c5fd" strokeWidth={3} />
                )}
                {/* Circle */}
                <circle cx={cx} cy={midY} r={14} fill={fill} />
                {/* Check or number */}
                {m.done ? (
                  <text x={cx} y={midY + 5} textAnchor="middle" fontSize={14} fill="white" fontWeight="bold">
                    ✓
                  </text>
                ) : (
                  <text x={cx} y={midY + 5} textAnchor="middle" fontSize={12} fill="white" fontWeight="bold">
                    {i + 1}
                  </text>
                )}
                {/* Label */}
                <text x={cx} y={midY + 30} textAnchor="middle" fontSize={10} fill={textColor} fontWeight="600">
                  {m.label}
                </text>
                {/* Sublabel */}
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
          { color: "bg-green-500", label: "Complete" },
          { color: "bg-blue-500",  label: "In progress" },
          { color: "bg-gray-200",  label: "Pending" },
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
