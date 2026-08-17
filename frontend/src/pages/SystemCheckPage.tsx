import { useState, useEffect } from "react";
import { Loader2, RefreshCw, CheckCircle2, Clock, XCircle, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { systemApi } from "@/api/endpoints";

const BADGE: Record<string, { cls: string; label: string; Icon: any }> = {
  pass: { cls: "bg-green-100 text-green-700 border-green-200", label: "Pass", Icon: CheckCircle2 },
  pending: { cls: "bg-amber-100 text-amber-700 border-amber-200", label: "Pending", Icon: Clock },
  fail: { cls: "bg-red-100 text-red-700 border-red-200", label: "Fail", Icon: XCircle },
};

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  const tones: Record<string, string> = { green: "text-green-600", amber: "text-amber-600", red: "text-red-600", gray: "text-gray-900" };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className={`text-3xl font-bold ${tones[tone] || tones.gray}`}>{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  );
}

export default function SystemCheckPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function run() {
    setLoading(true); setErr("");
    try { setData(await systemApi.selfTest()); }
    catch (e: any) { setErr(e?.response?.data?.detail || t("syscheck.err", "Could not run the self-test.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const s = data?.summary || { pass: 0, pending: 0, fail: 0, total: 0 };
  const checks: any[] = data?.checks || [];
  const groups: Record<string, any[]> = {};
  for (const c of checks) (groups[c.area] ||= []).push(c);

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{t("syscheck.title", "System Check")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
              <ShieldCheck className="w-3 h-3" /> {t("syscheck.tag", "Acceptance")}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">{t("syscheck.subtitle", "Live acceptance check of the platform against the RFP criteria")}</p>
        </div>
        <button onClick={run} disabled={loading} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {t("syscheck.run", "Run check")}
        </button>
      </div>

      {err && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700 border border-red-100">{err}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile label={t("syscheck.total", "Criteria")} value={s.total} tone="gray" />
        <Tile label={t("syscheck.pass", "Pass")} value={s.pass} tone="green" />
        <Tile label={t("syscheck.pending", "Pending")} value={s.pending} tone="amber" />
        <Tile label={t("syscheck.fail", "Fail")} value={s.fail} tone={s.fail ? "red" : "gray"} />
      </div>
      {data?.ran_at && <p className="text-xs text-gray-400">{t("syscheck.ran", "Last run")}: {new Date(data.ran_at).toLocaleString()}</p>}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
      ) : (
        Object.entries(groups).map(([area, items]) => (
          <div key={area} className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">{area}</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {items.map((c: any) => {
                const b = BADGE[c.status] || BADGE.pending;
                return (
                  <div key={c.id} className="flex items-start gap-4 px-5 py-3 border-b border-gray-50 last:border-0">
                    <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${b.cls} shrink-0`}>
                      <b.Icon className="w-3 h-3" /> {b.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {c.criterion} {c.eliminatory && <span className="ml-1 text-[10px] font-bold text-purple-600">ELIM</span>}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{c.evidence}</p>
                    </div>
                    <span className="text-[10px] font-mono text-gray-300 shrink-0">{c.id}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
