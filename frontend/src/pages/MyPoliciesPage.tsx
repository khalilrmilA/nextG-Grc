/**
 * My Policies — the policies the signed-in user is asked to read and accept.
 *
 * Reachable by every authenticated role (no ROUTE_ROLES entry, nav roles: null):
 * acknowledging a policy is something every employee does, while /policies
 * itself is reserved to the people who manage them.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Clock, FileText, Loader2 } from "lucide-react";
import { policiesApi, type MyPolicyAttestation } from "../api/endpoints";

const dateLocale = (lang: string) => (lang.startsWith("fr") ? "fr-FR" : lang.startsWith("ar") ? "ar-u-nu-latn" : "en-US");

export default function MyPoliciesPage() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<MyPolicyAttestation[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setFailed(false);
    try { setItems(await policiesApi.myAttestations()); }
    catch { setFailed(true); setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString(dateLocale(i18n.language)) : "");

  async function accept(a: MyPolicyAttestation) {
    setAccepting(a.id); setError("");
    try {
      const done = await policiesApi.acknowledgeAttestation(a.policy_id, a.id);
      setItems(prev => (prev ?? []).map(x => x.id === a.id
        ? { ...x, status: "acknowledged", acknowledged_at: done.acknowledged_at ?? new Date().toISOString(), overdue: false }
        : x));
      setOpen(null);
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof d === "string" ? d : t("r2.mypolicies.accept_failed"));
    } finally { setAccepting(null); }
  }

  const pending = (items ?? []).filter(a => a.status === "pending");
  const done = (items ?? []).filter(a => a.status !== "pending");

  const row = (a: MyPolicyAttestation) => {
    const isOpen = open === a.id;
    return (
      <div key={a.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <button onClick={() => setOpen(isOpen ? null : a.id)}
          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-start hover:bg-gray-50">
          <div className="flex items-start gap-3 min-w-0">
            <FileText className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {a.policy_number && <span className="font-mono text-xs text-gray-400 me-2">{a.policy_number}</span>}
                {a.policy_title}
              </p>
              <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-gray-500">
                {a.version_number != null && <span>{t("r2.mypolicies.version", { n: a.version_number })}</span>}
                {a.status === "pending" && a.due_date && <span>· {t("r2.mypolicies.due", { date: fmt(a.due_date) })}</span>}
                {a.status === "acknowledged" && <span>· {t("r2.mypolicies.acknowledged_on", { date: fmt(a.acknowledged_at) })}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {a.status === "acknowledged" ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-700">
                <CheckCircle className="w-3 h-3" />{t("r2.mypolicies.acknowledged")}
              </span>
            ) : a.overdue ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
                <AlertTriangle className="w-3 h-3" />{t("r2.mypolicies.overdue")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-orange-100 text-orange-700">
                <Clock className="w-3 h-3" />{t("r2.mypolicies.pending")}
              </span>
            )}
            {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400 rtl:rotate-180" />}
          </div>
        </button>
        {isOpen && (
          <div className="px-5 pb-5 border-t border-gray-100 space-y-4">
            {a.current_version_number != null && a.version_number != null && a.current_version_number > a.version_number && (
              <p className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t("r2.mypolicies.newer_version", { n: a.current_version_number })}
              </p>
            )}
            <pre className="mt-4 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-[50vh] overflow-y-auto bg-gray-50 rounded-xl p-4">
              {a.content || t("r2.mypolicies.no_content")}
            </pre>
            {a.status === "pending" && (
              <div className="flex justify-end">
                <button onClick={() => accept(a)} disabled={accepting === a.id}
                  className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium">
                  {accepting === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {t("r2.mypolicies.accept")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("r2.mypolicies.title")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("r2.mypolicies.subtitle")}</p>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {items === null ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
      ) : failed ? (
        <p className="text-sm text-red-600">{t("r2.mypolicies.load_failed")}</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">{t("r2.mypolicies.pending")} ({pending.length})</h2>
            {pending.length === 0
              ? <p className="text-sm text-gray-400 bg-white border border-gray-100 rounded-2xl px-5 py-6 text-center">{t("r2.mypolicies.empty")}</p>
              : pending.map(row)}
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">{t("r2.mypolicies.acknowledged")} ({done.length})</h2>
            {done.length === 0
              ? <p className="text-sm text-gray-400">{t("r2.mypolicies.none_done")}</p>
              : done.map(row)}
          </section>
        </>
      )}
    </div>
  );
}
