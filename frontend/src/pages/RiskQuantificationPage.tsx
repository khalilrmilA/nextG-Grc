import { useState, useEffect } from "react";
import {
  Loader2,
  Calculator,
  DollarSign,
  TrendingDown,
  ShieldCheck,
  BarChart3,
  Play,
  Target,
} from "lucide-react";
import { riskQuantApi, risksApi } from "@/api/endpoints";

function fmtDollar(value: number | null | undefined): string {
  if (value == null) return "$0";
  return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function RiskQuantificationPage() {
  const [risks, setRisks] = useState<any[]>([]);
  const [loadingRisks, setLoadingRisks] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);

  const [form, setForm] = useState({
    risk_id: "",
    annual_loss_min: 10000,
    annual_loss_max: 500000,
    annual_loss_most_likely: 100000,
    probability_percent: 50,
    control_effectiveness: 60,
  });

  useEffect(() => {
    loadRisks();
  }, []);

  async function loadRisks() {
    try {
      const data = await risksApi.list();
      const items = Array.isArray(data) ? data : data.items || [];
      setRisks(items);
      if (items.length > 0 && !form.risk_id) {
        setForm((prev) => ({ ...prev, risk_id: items[0].id }));
      }
    } catch {
      setRisks([]);
    } finally {
      setLoadingRisks(false);
    }
  }

  async function handleRun() {
    if (!form.risk_id) {
      setError("Please select a risk");
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const data = await riskQuantApi.quantify({
        risk_id: form.risk_id,
        annual_loss_min: form.annual_loss_min,
        annual_loss_max: form.annual_loss_max,
        annual_loss_most_likely: form.annual_loss_most_likely,
        probability_percent: form.probability_percent,
        control_effectiveness: form.control_effectiveness,
      });
      setResult(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Simulation failed");
    } finally {
      setRunning(false);
    }
  }

  const distribution = result?.distribution || [];
  const maxCount = Math.max(...distribution.map((b: any) => b.count || 0), 1);

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Risk Quantification</h1>
        <p className="text-sm text-gray-500 mt-1">
          Monte Carlo simulation for quantitative risk analysis (FAIR model)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Configuration */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50 text-blue-600">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Simulation Parameters</h2>
              <p className="text-xs text-gray-500">Configure inputs for the Monte Carlo simulation</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>
          )}

          <div className="space-y-5">
            {/* Risk Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Risk</label>
              {loadingRisks ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading risks...
                </div>
              ) : (
                <select
                  value={form.risk_id}
                  onChange={(e) => setForm({ ...form, risk_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select a risk --</option>
                  {risks.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.title || r.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Annual Loss Inputs */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Min Loss ($)
                </label>
                <input
                  type="number"
                  value={form.annual_loss_min}
                  onChange={(e) =>
                    setForm({ ...form, annual_loss_min: Number(e.target.value) })
                  }
                  min={0}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Most Likely ($)
                </label>
                <input
                  type="number"
                  value={form.annual_loss_most_likely}
                  onChange={(e) =>
                    setForm({ ...form, annual_loss_most_likely: Number(e.target.value) })
                  }
                  min={0}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Loss ($)
                </label>
                <input
                  type="number"
                  value={form.annual_loss_max}
                  onChange={(e) =>
                    setForm({ ...form, annual_loss_max: Number(e.target.value) })
                  }
                  min={0}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Probability Slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Probability</label>
                <span className="text-sm font-semibold text-blue-600">
                  {form.probability_percent}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={form.probability_percent}
                onChange={(e) =>
                  setForm({ ...form, probability_percent: Number(e.target.value) })
                }
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Control Effectiveness Slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Control Effectiveness</label>
                <span className="text-sm font-semibold text-green-600">
                  {form.control_effectiveness}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={form.control_effectiveness}
                onChange={(e) =>
                  setForm({ ...form, control_effectiveness: Number(e.target.value) })
                }
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Run Button */}
            <button
              onClick={handleRun}
              disabled={running || !form.risk_id}
              className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {running ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {running ? "Running Simulation..." : "Run Simulation"}
            </button>
          </div>
        </div>

        {/* Right: Results */}
        <div className="space-y-6">
          {result ? (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    label: "Annualized Loss Expectancy",
                    value: fmtDollar(result.ale),
                    icon: DollarSign,
                    color: "text-red-600 bg-red-50",
                  },
                  {
                    label: "Single Loss Expectancy",
                    value: fmtDollar(result.sle),
                    icon: Target,
                    color: "text-orange-600 bg-orange-50",
                  },
                  {
                    label: "Residual ALE",
                    value: fmtDollar(result.residual_ale),
                    icon: ShieldCheck,
                    color: "text-green-600 bg-green-50",
                  },
                  {
                    label: "Risk Reduction",
                    value: fmtDollar(result.risk_reduction),
                    icon: TrendingDown,
                    color: "text-blue-600 bg-blue-50",
                  },
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center ${kpi.color}`}
                      >
                        <kpi.icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xl font-bold text-gray-900">{kpi.value}</p>
                        <p className="text-xs text-gray-500">{kpi.label}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Percentiles */}
              {(result.p90 != null || result.p95 != null) && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Percentile Values</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {result.p90 != null && (
                      <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                        <p className="text-xs text-amber-600 font-medium">P90</p>
                        <p className="text-lg font-bold text-gray-900">{fmtDollar(result.p90)}</p>
                        <p className="text-xs text-gray-500">90% of losses below this</p>
                      </div>
                    )}
                    {result.p95 != null && (
                      <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                        <p className="text-xs text-red-600 font-medium">P95</p>
                        <p className="text-lg font-bold text-gray-900">{fmtDollar(result.p95)}</p>
                        <p className="text-xs text-gray-500">95% of losses below this</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Distribution Chart */}
              {distribution.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-blue-600" />
                      <h3 className="text-sm font-semibold text-gray-900">
                        Loss Distribution
                      </h3>
                    </div>
                    <span className="text-xs text-gray-400">
                      {result.simulations?.toLocaleString() || "10,000"} simulations
                    </span>
                  </div>
                  <div className="space-y-2">
                    {distribution.map((bucket: any, i: number) => {
                      const pct = bucket.percentage ?? ((bucket.count / (result.simulations || 10000)) * 100);
                      const barWidth = Math.max((bucket.count / maxCount) * 100, 1);
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs text-gray-500 w-32 text-right flex-shrink-0 truncate">
                            {fmtDollar(bucket.range_min ?? bucket.min)}-
                            {fmtDollar(bucket.range_max ?? bucket.max)}
                          </span>
                          <div className="flex-1 h-6 bg-gray-100 rounded-lg overflow-hidden relative">
                            <div
                              className="h-full bg-blue-500 rounded-lg transition-all duration-300"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-600 w-12 text-right flex-shrink-0">
                            {bucket.count}
                          </span>
                          <span className="text-xs text-gray-400 w-14 text-right flex-shrink-0">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
              <BarChart3 className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-400">
                Configure parameters and run the simulation to see results
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Uses Monte Carlo method with 10,000 iterations
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
