/**
 * VendorCollaborationPage — public vendor portal accessed via share-token link.
 * Matches the internal CISO layout exactly: split-pane contract + tabs.
 * No login required. Real-time via 4-second polling.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import {
  Send, Check, CheckCircle2, Loader2, MessageSquare,
  ClipboardList, AlertTriangle, Info, AlertCircle,
  Building2, Copy, ExternalLink, CalendarDays, Lock, FileSignature, X,
} from "lucide-react";
import { contractCollabApi, type CollabData, type CollabMessage } from "@/api/endpoints";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AISuggestion {
  id: number;
  clause: string;
  severity: "critical" | "high" | "medium" | "low";
  issue: string;
  fix: string;
  status: "open" | "accepted" | "rejected";
}

interface ActionItem {
  id: number | string;
  priority: "critical" | "high" | "medium" | "low";
  action: string;
  responsible: string;
  deadline: string;
  done: boolean;
}

/** Display locale for dates/times, following the interface language. */
const uiLocale = () => {
  const l = i18next.language || "en";
  return l.startsWith("fr") ? "fr-FR" : l.startsWith("ar") ? "ar-u-nu-latn" : "en-US";
};

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    // YYYY-MM-DD strings parse as UTC midnight, which shifts the day in negative-offset timezones.
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso;
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return iso; // Return raw string if not a real date
    return d.toLocaleDateString(uiLocale(), { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

const SEV_COLOR: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high:     "bg-orange-100 text-orange-800 border-orange-300",
  medium:   "bg-yellow-100 text-yellow-800 border-yellow-300",
  low:      "bg-blue-100 text-blue-800 border-blue-300",
};

const SEV_ICON = (s: string) => {
  if (s === "critical") return <AlertTriangle className="w-3.5 h-3.5" />;
  if (s === "high")     return <AlertCircle className="w-3.5 h-3.5" />;
  return <Info className="w-3.5 h-3.5" />;
};

// ── Join Screen ────────────────────────────────────────────────────────────────

function JoinScreen({
  collab,
  onJoin,
}: {
  readonly collab: CollabData;
  readonly onJoin: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      {/* Public page (vendors arrive via share link, no app shell): own language picker */}
      <div className="fixed top-4 end-4 z-40"><LanguageSwitcher compact /></div>
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 max-w-md w-full">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-base">{t("vendor_collab.portal_title")}</h1>
            <p className="text-xs text-gray-500">{t("vendor_collab.portal_subtitle")}</p>
          </div>
        </div>

        {/* Info card */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm text-gray-700">
          {t("vendor_collab.invited")}{" "}
          <strong className="text-blue-700">{collab.vendor_name}</strong>.
          {collab.status === "agreed" && (
            <p className="mt-2 text-green-700 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> {t("vendor_collab.already_agreed")}
            </p>
          )}
        </div>

        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {t("vendor_collab.your_name")}
        </label>
        <input
          className="w-full border border-gray-300 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-4"
          placeholder={t("vendor_collab.name_placeholder")}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && name.trim() && onJoin(name.trim())}
          autoFocus
        />
        <button
          onClick={() => name.trim() && onJoin(name.trim())}
          disabled={!name.trim()}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors text-sm">
          {t("vendor_collab.enter_room")} <span className="inline-block rtl:rotate-180">→</span>
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function VendorCollaborationPage() {
  const { t } = useTranslation();
  const { shareToken } = useParams<{ shareToken: string }>();

  const [collab, setCollab]   = useState<CollabData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [vendorName, setVendorName] = useState("");
  const [hasJoined, setHasJoined]   = useState(false);

  const [activeTab, setActiveTab] = useState<"suggestions" | "chat" | "plan" | "agreement">("suggestions");

  // Digital signing
  const [sigName, setSigName]   = useState("");
  const [signing, setSigning]   = useState(false);

  // Contract draft
  const [contractText, setContractText] = useState("");
  const [textDirty, setTextDirty]       = useState(false);
  const [saving, setSaving]             = useState(false);

  // AI data
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [actionPlan, setActionPlan]   = useState<ActionItem[]>([]);

  // Prevent polling from overwriting action plan while a checkbox save is in flight
  const pendingPlanUpdate = useRef(false);

  // Chat
  const [messages, setMessages]   = useState<CollabMessage[]>([]);
  const [newMsg, setNewMsg]       = useState("");
  const [sendingMsg, setSending]  = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Share copy feedback
  const [copied, setCopied] = useState(false);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadCollab = useCallback(async () => {
    if (!shareToken) return;
    try {
      const data = await contractCollabApi.vendorGet(shareToken);
      setCollab(data);
      setContractText(prev => prev || data.contract_text || "");
      if (data.ai_suggestions) {
        try { setSuggestions(JSON.parse(data.ai_suggestions)); } catch { /* */ }
      }
      if (data.action_plan && !pendingPlanUpdate.current) {
        try { setActionPlan(JSON.parse(data.action_plan)); } catch { /* */ }
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || t("vendor_collab.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [shareToken]);

  const loadMessages = useCallback(async () => {
    if (!shareToken) return;
    try {
      const msgs = await contractCollabApi.vendorGetMessages(shareToken);
      setMessages(msgs);
    } catch { /* silent */ }
  }, [shareToken]);

  useEffect(() => { loadCollab(); loadMessages(); }, [loadCollab, loadMessages]);

  // Poll every 4 seconds
  useEffect(() => {
    const interval = setInterval(() => { loadCollab(); loadMessages(); }, 4000);
    return () => clearInterval(interval);
  }, [loadCollab, loadMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const saveText = async () => {
    if (!shareToken || !textDirty) return;
    setSaving(true);
    try {
      await contractCollabApi.vendorUpdateContent(shareToken, { contract_text: contractText });
      setTextDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const sendMessage = async () => {
    if (!shareToken || !newMsg.trim()) return;
    setSending(true);
    try {
      await contractCollabApi.vendorSendMessage(shareToken, {
        message: newMsg.trim(),
        sender_name: vendorName || "Vendor",
      });
      setNewMsg("");
      await loadMessages();
    } finally {
      setSending(false);
    }
  };

  const togglePlanItem = async (itemId: number | string, done: boolean) => {
    if (!shareToken) return;
    // Block polling from overwriting the optimistic state until the save completes
    pendingPlanUpdate.current = true;
    // Optimistic update
    setActionPlan(prev => prev.map(a => String(a.id) === String(itemId) ? { ...a, done } : a));
    try {
      const updated = await contractCollabApi.vendorUpdateActionItem(shareToken, String(itemId), done);
      // Apply the authoritative server state once save succeeds
      if (updated?.action_plan) {
        try { setActionPlan(JSON.parse(updated.action_plan)); } catch { /* */ }
      }
    } catch {
      // Revert on failure
      setActionPlan(prev => prev.map(a => String(a.id) === String(itemId) ? { ...a, done: !done } : a));
    } finally {
      pendingPlanUpdate.current = false;
    }
  };

  const markAgreed = async () => {
    if (!shareToken) return;
    const updated = await contractCollabApi.vendorAgree(shareToken);
    setCollab(updated);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVendorSign = async () => {
    if (!shareToken || !sigName.trim()) return;
    setSigning(true);
    try {
      const updated = await contractCollabApi.vendorSign(shareToken, sigName.trim());
      setCollab(updated);
    } finally {
      setSigning(false);
    }
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="fixed top-4 end-4 z-40"><LanguageSwitcher compact /></div>
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !collab) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 gap-3 text-center p-8">
        <div className="fixed top-4 end-4 z-40"><LanguageSwitcher compact /></div>
        <AlertTriangle className="w-10 h-10 text-red-400" />
        <p className="text-gray-700 font-medium">{t("vendor_collab.not_found")}</p>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  if (!hasJoined) {
    return <JoinScreen collab={collab} onJoin={name => { setVendorName(name); setHasJoined(true); }} />;
  }

  const isAgreed   = collab.status === "agreed";
  const donePlan   = actionPlan.filter(a => a.done).length;
  const bothSigned = !!(collab.ciso_signed_at && collab.vendor_signed_at);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* ── Top bar — identical structure to internal page ── */}
      <div className="bg-white border-b px-6 py-3 flex items-center gap-4 shrink-0">
        <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="font-semibold text-gray-900 text-sm">
            {t("vendor_collab.negotiation_title")} — <span className="text-blue-700">{collab.vendor_name}</span>
          </h1>
          <p className="text-xs text-gray-500">
            {t("vendor_collab.joined_as")} <strong>{vendorName}</strong>
          </p>
        </div>

        {/* Status */}
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
          isAgreed ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
        }`}>
          {isAgreed ? `✓ ${t("contract_collab.agreed")}` : t("contract_collab.in_negotiation")}
        </span>

        {/* Agreement indicators */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className={`flex items-center gap-1 ${collab.agreed_by_internal ? "text-green-600" : ""}`}>
            {collab.agreed_by_internal ? <Check className="w-3.5 h-3.5" /> : "○"} {t("vendor_collab.client")}
          </span>
          <span className={`flex items-center gap-1 ${collab.agreed_by_vendor ? "text-green-600" : ""}`}>
            {collab.agreed_by_vendor ? <Check className="w-3.5 h-3.5" /> : "○"} {t("vendor_collab.you")}
          </span>
        </div>

        {/* Share this link */}
        <div className="hidden md:flex items-center gap-1 bg-gray-100 rounded px-2 py-1 text-xs text-gray-600 max-w-40 truncate">
          <ExternalLink className="w-3 h-3 shrink-0" />
          <span className="truncate">{window.location.href}</span>
        </div>
        <button onClick={copyLink}
          className="flex items-center gap-1 text-xs bg-gray-200 text-gray-700 px-2.5 py-1.5 rounded hover:bg-gray-300">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? t("contract_collab.copied") : t("contract_collab.copy_link")}
        </button>

        <LanguageSwitcher compact />

        {!isAgreed && (
          <button onClick={markAgreed}
            className="flex items-center gap-1.5 text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> {t("vendor_collab.i_agree")}
          </button>
        )}
      </div>

      {/* ── Body: same split-pane as internal page ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT — editable contract draft */}
        <div className="flex flex-col w-[55%] border-r bg-white">
          <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              {t("contract_collab.working_draft")}
            </span>
            <button
              onClick={saveText}
              disabled={!textDirty || saving || isAgreed}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700">
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              {saving ? t("common.saving") : t("contract_collab.save_changes")}
            </button>
          </div>
          <textarea
            className="flex-1 p-4 font-mono text-xs resize-none focus:outline-none text-gray-800 leading-relaxed bg-white"
            value={contractText}
            onChange={e => { setContractText(e.target.value); setTextDirty(true); }}
            placeholder={t("contract_collab.text_placeholder")}
            readOnly={isAgreed}
          />
        </div>

        {/* RIGHT — tabs */}
        <div className="flex flex-col w-[45%]">

          {/* Tab bar */}
          <div className="flex border-b bg-white shrink-0">
            {(["suggestions", "chat", "plan", ...(isAgreed ? ["agreement"] : [])] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as typeof activeTab)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-blue-600 text-blue-700 bg-white"
                    : "border-transparent text-gray-500 hover:text-gray-700 bg-gray-50"
                }`}>
                {tab === "suggestions" && <AlertTriangle className="w-3.5 h-3.5" />}
                {tab === "chat"        && <MessageSquare className="w-3.5 h-3.5" />}
                {tab === "plan"        && <ClipboardList className="w-3.5 h-3.5" />}
                {tab === "agreement"   && <FileSignature className="w-3.5 h-3.5" />}
                {tab === "suggestions" && t("contract_collab.tab_issues", { count: suggestions.length })}
                {tab === "chat"        && t("contract_collab.tab_chat", { count: messages.length })}
                {tab === "plan"        && t("vendor_collab.tab_action_plan", { done: donePlan, total: actionPlan.length })}
                {tab === "agreement"   && (bothSigned ? `${t("contract_collab.signed")} ✓` : t("contract_collab.sign"))}
              </button>
            ))}
          </div>

          {/* ── Suggestions tab ── */}
          {activeTab === "suggestions" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
              {suggestions.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>{t("vendor_collab.no_issues")}</p>
                  <p className="text-xs mt-1">{t("vendor_collab.no_issues_hint")}</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-1">
                    {t("vendor_collab.issues_intro")}
                  </p>
                  {suggestions.map(s => (
                    <div key={s.id}
                      className={`rounded-lg border p-3 ${SEV_COLOR[s.severity]} ${
                        s.status === "rejected" ? "opacity-40" : ""
                      }`}>
                      <div className="flex items-center gap-1.5 text-xs font-semibold mb-1">
                        {SEV_ICON(s.severity)}
                        <span className="uppercase">{t(`vocab.${s.severity}`, { defaultValue: s.severity })}</span>
                        <span className="font-normal text-gray-600">— {s.clause}</span>
                        {s.status !== "open" && (
                          <span className={`ms-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                            s.status === "accepted" ? "bg-green-200 text-green-800" : "bg-gray-200 text-gray-500"
                          }`}>{t(`vocab.${s.status}`, { defaultValue: s.status })}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-700 mb-1.5">{s.issue}</p>
                      <div className="bg-white/70 rounded p-2 text-xs text-gray-800 font-mono leading-relaxed">
                        <span className="text-gray-400 text-[10px] uppercase font-semibold me-1">
                          {t("vendor_collab.suggested_fix")}
                        </span>
                        {s.fix}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── Chat tab ── */}
          {activeTab === "chat" && (
            <div className="flex flex-col flex-1 overflow-hidden bg-white">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    {t("contract_collab.no_messages")}
                  </div>
                )}
                {messages.map(m => (
                  <div key={m.id}
                    className={`flex flex-col ${m.sender_type === "vendor" ? "items-end" : "items-start"}`}>
                    <span className="text-[10px] text-gray-400 mb-0.5 px-1">{m.sender_name}</span>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                      m.sender_type === "vendor"
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}>
                      {m.message}
                    </div>
                    <span className="text-[10px] text-gray-300 mt-0.5 px-1">
                      {new Date(m.created_at).toLocaleTimeString(uiLocale(), { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="border-t p-3 flex gap-2 bg-white">
                <input
                  className="flex-1 text-sm border rounded-full px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder={isAgreed ? t("contract_collab.agreement_finalised") : t("contract_collab.type_message")}
                  value={newMsg}
                  disabled={isAgreed}
                  onChange={e => setNewMsg(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                />
                <button
                  onClick={sendMessage}
                  disabled={!newMsg.trim() || sendingMsg || isAgreed}
                  className="p-2 rounded-full bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700">
                  {sendingMsg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* ── Action plan tab ── */}
          {activeTab === "plan" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="px-4 py-2 border-b bg-gray-50 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {t("vendor_collab.your_items", { done: donePlan, total: actionPlan.length })}
                </span>
                {collab.plan_finalized_at && (
                  <span className="flex items-center gap-1 text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full font-semibold">
                    <Lock className="w-2.5 h-2.5" /> {t("vendor_collab.deadlines_set")}
                  </span>
                )}
              </div>

              {/* Progress bar */}
              {actionPlan.length > 0 && (
                <div className="px-4 py-2 border-b bg-white">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                      <div
                        className="bg-green-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${actionPlan.length ? (donePlan / actionPlan.length) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-500 shrink-0">
                      {actionPlan.length ? Math.round((donePlan / actionPlan.length) * 100) : 0}%
                    </span>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
                {actionPlan.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>{t("vendor_collab.no_plan")}</p>
                    <p className="text-xs mt-1">{t("vendor_collab.no_plan_hint")}</p>
                  </div>
                ) : (
                  <>
                    {actionPlan.map(a => (
                      <div key={a.id}
                        className={`flex items-start gap-3 rounded-lg border p-3 transition-opacity ${a.done ? "opacity-60" : ""} ${
                          a.priority === "critical" ? "border-red-200 bg-red-50"
                          : a.priority === "high"   ? "border-orange-200 bg-orange-50"
                          : a.priority === "medium" ? "border-yellow-100 bg-yellow-50"
                          : "border-gray-200 bg-white"
                        }`}>
                        {/* Interactive checkbox — vendor marks items done */}
                        <button
                          onClick={() => !isAgreed && togglePlanItem(a.id, !a.done)}
                          disabled={isAgreed}
                          className={`mt-0.5 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                            a.done
                              ? "bg-green-500 border-green-500"
                              : "border-gray-400 hover:border-blue-500 bg-white"
                          } ${isAgreed ? "cursor-default" : "cursor-pointer"}`}>
                          {a.done && <Check className="w-2.5 h-2.5 text-white" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium ${a.done ? "line-through text-gray-400" : "text-gray-800"}`}>
                            {a.action}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-full ${SEV_COLOR[a.priority]}`}>
                              {t(`vocab.${a.priority}`, { defaultValue: a.priority })}
                            </span>
                            <span className="text-[10px] text-gray-500">👤 {a.responsible}</span>
                            {a.deadline && (
                              <span className={`text-[10px] flex items-center gap-0.5 font-medium ${
                                collab.plan_finalized_at ? "text-blue-700" : "text-gray-400"
                              }`}>
                                <CalendarDays className="w-2.5 h-2.5" />
                                {collab.plan_finalized_at ? fmtDate(String(a.deadline)) : String(a.deadline)}
                              </span>
                            )}
                          </div>
                        </div>
                        {a.done && (
                          <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                            {t("contract_collab.done")} ✓
                          </span>
                        )}
                      </div>
                    ))}
                    {!isAgreed && (
                      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                        {t("vendor_collab.plan_hint_before")} <strong>«{t("vendor_collab.i_agree")}»</strong> {t("vendor_collab.plan_hint_after")}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Agreement tab ── */}
          {activeTab === "agreement" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Fully executed banner */}
              {bothSigned && (
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-b border-emerald-200 text-xs font-semibold text-emerald-800 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                  {t("vendor_collab.fully_executed")}
                </div>
              )}

              {/* Signature status row */}
              <div className="flex items-center gap-4 px-4 py-2 border-b bg-gray-50 text-xs shrink-0">
                <div className={`flex items-center gap-1.5 ${collab.ciso_signed_at ? "text-green-700" : "text-amber-600"}`}>
                  {collab.ciso_signed_at
                    ? <><Check className="w-3.5 h-3.5" /> {t("vendor_collab.client_signed_as")} <strong>{collab.ciso_signature}</strong></>
                    : <><Loader2 className="w-3.5 h-3.5" /> {t("vendor_collab.awaiting_client_signature")}</>
                  }
                </div>
                <span className="text-gray-300">|</span>
                <div className={`flex items-center gap-1.5 ${collab.vendor_signed_at ? "text-green-700" : "text-gray-400"}`}>
                  {collab.vendor_signed_at
                    ? <><Check className="w-3.5 h-3.5" /> {t("contract_collab.you_signed_as")} <strong>{collab.vendor_signature}</strong></>
                    : <><X className="w-3.5 h-3.5" /> {t("contract_collab.awaiting_your_signature")}</>
                  }
                </div>
              </div>

              {/* Vendor sign panel */}
              {!collab.vendor_signed_at && (
                <div className="px-4 py-3 border-b bg-blue-50 shrink-0">
                  <p className="text-xs font-semibold text-blue-900 mb-2">{t("contract_collab.sign_this")}</p>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder={t("contract_collab.sign_placeholder")}
                      value={sigName}
                      onChange={e => setSigName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleVendorSign()}
                    />
                    <button
                      onClick={handleVendorSign}
                      disabled={!sigName.trim() || signing}
                      className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40">
                      {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
                      {signing ? t("contract_collab.signing") : t("contract_collab.sign_agreement")}
                    </button>
                  </div>
                </div>
              )}

              {/* Agreement document preview */}
              <div className="flex-1 overflow-y-auto p-4">
                {collab.agreement_document ? (
                  <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 border rounded-lg p-4">
                    {collab.agreement_document}
                  </pre>
                ) : (
                  <div className="text-center py-12 text-gray-400 text-sm">
                    <FileSignature className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    {t("contract_collab.agreement_empty")}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
