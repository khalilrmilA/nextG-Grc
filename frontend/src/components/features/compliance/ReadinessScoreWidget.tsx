/**
 * ReadinessScoreWidget — SVG arc gauge showing certification readiness (0–100).
 * Score = compliance × 0.5 + doc_completeness × 0.3 + blocker_resolution × 0.2
 */

interface Props {
  readonly score: number;           // 0–100
  readonly label?: string;
  readonly compliancePct: number;
  readonly docPct: number;
  readonly blockerPct: number;      // 0–100 where 100 = no blockers
}

function scoreColor(s: number): string {
  if (s >= 80) return "#22c55e";
  if (s >= 60) return "#eab308";
  if (s >= 40) return "#f97316";
  return "#ef4444";
}

function scoreLabel(s: number): string {
  if (s >= 80) return "Ready";
  if (s >= 60) return "Near Ready";
  if (s >= 40) return "In Progress";
  return "Early Stage";
}

export default function ReadinessScoreWidget({
  score,
  label = "Certification Readiness",
  compliancePct,
  docPct,
  blockerPct,
}: Props) {
  const CX = 100;
  const CY = 90;
  const R = 70;
  const color = scoreColor(score);

  const breakdown = [
    { label: "Compliance score",    pct: compliancePct, weight: "50%", color: "#3b82f6" },
    { label: "Documentation",       pct: docPct,        weight: "30%", color: "#8b5cf6" },
    { label: "Blockers resolved",   pct: blockerPct,    weight: "20%", color: "#22c55e" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{label}</h3>

      <div className="flex items-center gap-6">
        {/* Arc gauge */}
        <div className="flex-shrink-0">
          <svg viewBox="0 0 200 100" width={180} height={100}>
            {/* Background arc */}
            <path
              d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
              fill="none"
              stroke="#f3f4f6"
              strokeWidth={14}
              strokeLinecap="round"
            />
            {/* Value arc */}
            {score > 0 && (
              <path
                d={`M ${CX - R} ${CY} A ${R} ${R} 0 ${score >= 50 ? 1 : 0} 1 ${
                  CX + Math.cos(Math.PI - (score / 100) * Math.PI) * R
                } ${CY - Math.sin((score / 100) * Math.PI) * R}`}
                fill="none"
                stroke={color}
                strokeWidth={14}
                strokeLinecap="round"
              />
            )}
            {/* Score text */}
            <text x={CX} y={CY - 6} textAnchor="middle" fontSize={28} fontWeight="800" fill={color}>
              {score}
            </text>
            <text x={CX} y={CY + 10} textAnchor="middle" fontSize={10} fill="#9ca3af">
              / 100
            </text>
            {/* Status label */}
            <text x={CX} y={CY + 24} textAnchor="middle" fontSize={11} fontWeight="600" fill={color}>
              {scoreLabel(score)}
            </text>
          </svg>
        </div>

        {/* Breakdown */}
        <div className="flex-1 space-y-3">
          {breakdown.map(({ label: bl, pct, weight, color: bc }) => (
            <div key={bl}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-600">{bl}</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">{weight}</span>
                  <span className="font-semibold text-gray-800">{pct}%</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, backgroundColor: bc }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Milestones */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { threshold: 40, label: "Audit Ready",  reached: score >= 40 },
          { threshold: 60, label: "Pre-Cert",     reached: score >= 60 },
          { threshold: 80, label: "Cert Ready",   reached: score >= 80 },
        ].map(({ threshold, label: ml, reached }) => (
          <div
            key={threshold}
            className={`rounded-lg px-2 py-1.5 border text-xs font-medium ${
              reached
                ? "bg-green-50 border-green-200 text-green-700"
                : "bg-gray-50 border-gray-100 text-gray-400"
            }`}
          >
            {reached ? "✓ " : ""}{ml}
          </div>
        ))}
      </div>
    </div>
  );
}
