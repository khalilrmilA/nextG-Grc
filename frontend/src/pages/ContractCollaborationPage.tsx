/**
 * ContractCollaborationPage — internal CISO/admin view.
 * Split-pane: left = editable contract text, right = AI suggestions / chat / action plan tabs.
 *
 * Action Plan: CISO views vendor progress (read-only checkboxes), can finalize the plan
 *              with real calendar deadlines, and can add custom issues beyond the AI list.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Copy, CheckCircle2, Send, RefreshCw,
  AlertTriangle, AlertCircle, Info, ChevronDown,
  MessageSquare, Lightbulb, ClipboardList, Loader2,
  ExternalLink, Check, X, Plus, CalendarDays, Lock, FileSignature,
} from "lucide-react";
import { contractCollabApi, type CollabData, type CollabMessage } from "@/api/endpoints";
import { readSseStream, makeThinkFilter } from "@/lib/sse";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AISuggestion {
  id: number | string;
  clause: string;
  severity: "critical" | "high" | "medium" | "low";
  issue: string;
  fix: string;
  status: "open" | "accepted" | "rejected";
  custom?: boolean;
}

interface ActionItem {
  id: number | string;
  priority: "critical" | "high" | "medium" | "low";
  action: string;
  responsible: string;
  deadline: string;
  done: boolean;
  custom?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function parseSuggestionsAndPlan(raw: string): { suggestions: AISuggestion[]; plan: ActionItem[] } {
  const empty = { suggestions: [], plan: [] };
  try {
    const sugMatch  = raw.match(/--- SUGGESTIONS ---\s*([\s\S]*?)(?=--- ACTION_PLAN ---|$)/);
    const planMatch = raw.match(/--- ACTION_PLAN ---\s*([\s\S]*?)$/);
    const suggestions: AISuggestion[] = sugMatch  ? JSON.parse(sugMatch[1].trim())  : [];
    const plan: ActionItem[]          = planMatch ? JSON.parse(planMatch[1].trim()) : [];
    return { suggestions, plan };
  } catch {
    return empty;
  }
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    // YYYY-MM-DD strings parse as UTC midnight, which shifts the day in negative-offset timezones.
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso;
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return iso; // Return raw string if not a real date
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

// ── Finalize Plan Modal ───────────────────────────────────────────────────────

interface FinalizePlanModalProps {
  plan: ActionItem[];
  onClose: () => void;
  onSave: (deadlines: { id: string; deadline: string }[]) => Promise<void>;
}

function FinalizePlanModal({ plan, onClose, onSave }: FinalizePlanModalProps) {
  const [dates, setDates] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const item of plan) {
      // Pre-fill with existing date if it already looks like YYYY-MM-DD, else empty
      const d = String(item.deadline || "");
      init[String(item.id)] = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
    }
    return init;
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const deadlines = Object.entries(dates)
      .filter(([, v]) => v)
      .map(([id, deadline]) => ({ id, deadline }));
    setSaving(true);
    try {
      await onSave(deadlines);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">Finalize Action Plan Deadlines</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="px-5 py-3 text-sm text-gray-500 border-b bg-gray-50">
          Set a real calendar deadline for each action item. The vendor will see these dates
          and CISO will be notified 10 days before any unfinished item is due.
        </p>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {plan.map(item => (
            <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3 bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{item.action}</p>
                <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-full ${SEV_COLOR[item.priority]}`}>
                  {item.priority}
                </span>
              </div>
              <input
                type="date"
                className="text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={dates[String(item.id)] || ""}
                onChange={e => setDates(prev => ({ ...prev, [String(item.id)]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
            {saving ? "Saving…" : "Finalize Plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Custom Issue Form ─────────────────────────────────────────────────────

interface AddIssueFormProps {
  onAdd: (issue: Omit<AISuggestion, "id" | "status" | "custom">) => void;
}

function AddIssueForm({ onAdd }: AddIssueFormProps) {
  const [open, setOpen] = useState(false);
  const [clause, setClause]     = useState("");
  const [severity, setSeverity] = useState<AISuggestion["severity"]>("medium");
  const [issue, setIssue]       = useState("");
  const [fix, setFix]           = useState("");

  const handleAdd = () => {
    if (!clause.trim() || !issue.trim() || !fix.trim()) return;
    onAdd({ clause: clause.trim(), severity, issue: issue.trim(), fix: fix.trim() });
    setClause(""); setIssue(""); setFix(""); setSeverity("medium");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 w-full py-2 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border border-dashed border-blue-300 justify-center mt-1">
        <Plus className="w-3.5 h-3.5" /> Add Custom Issue
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-3 bg-blue-50 border-blue-200 space-y-2 mt-1">
      <p className="text-xs font-semibold text-blue-800">New Custom Issue</p>
      <div className="flex gap-2">
        <input
          placeholder="Clause / Section"
          className="flex-1 text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={clause}
          onChange={e => setClause(e.target.value)}
        />
        <select
          className="text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={severity}
          onChange={e => setSeverity(e.target.value as AISuggestion["severity"])}>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <textarea
        placeholder="Describe the issue…"
        rows={2}
        className="w-full text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
        value={issue}
        onChange={e => setIssue(e.target.value)}
      />
      <textarea
        placeholder="Recommended fix…"
        rows={2}
        className="w-full text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
        value={fix}
        onChange={e => setFix(e.target.value)}
      />
      <div className="flex gap-2 justify-end">
        <button onClick={() => setOpen(false)}
          className="text-xs px-2.5 py-1 text-gray-600 border rounded hover:bg-gray-50">
          Cancel
        </button>
        <button onClick={handleAdd}
          className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
          Add Issue
        </button>
      </div>
    </div>
  );
}

// ── Add Custom Plan Item Form ─────────────────────────────────────────────────

interface AddPlanItemFormProps {
  onAdd: (item: Omit<ActionItem, "id" | "done" | "custom">) => void;
}

function AddPlanItemForm({ onAdd }: AddPlanItemFormProps) {
  const [open, setOpen]           = useState(false);
  const [action, setAction]       = useState("");
  const [responsible, setResp]    = useState("");
  const [priority, setPriority]   = useState<ActionItem["priority"]>("medium");
  const [deadline, setDeadline]   = useState("");

  const handleAdd = () => {
    if (!action.trim()) return;
    onAdd({ action: action.trim(), responsible: responsible.trim() || "Vendor", priority, deadline });
    setAction(""); setResp(""); setPriority("medium"); setDeadline("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 w-full py-2 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border border-dashed border-blue-300 justify-center mt-1">
        <Plus className="w-3.5 h-3.5" /> Add Custom Plan Item
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-3 bg-blue-50 border-blue-200 space-y-2 mt-1">
      <p className="text-xs font-semibold text-blue-800">New Plan Item</p>
      <textarea
        placeholder="Action to complete…"
        rows={2}
        className="w-full text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
        value={action}
        onChange={e => setAction(e.target.value)}
      />
      <div className="flex gap-2">
        <input
          placeholder="Responsible party"
          className="flex-1 text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={responsible}
          onChange={e => setResp(e.target.value)}
        />
        <select
          className="text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={priority}
          onChange={e => setPriority(e.target.value as ActionItem["priority"])}>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          type="date"
          className="text-xs border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={deadline}
          onChange={e => setDeadline(e.target.value)}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setOpen(false)}
          className="text-xs px-2.5 py-1 text-gray-600 border rounded hover:bg-gray-50">
          Cancel
        </button>
        <button onClick={handleAdd} disabled={!action.trim()}
          className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40">
          Add Item
        </button>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ContractCollaborationPage() {
  const { collabId } = useParams<{ collabId: string }>();
  const navigate = useNavigate();

  const [collab, setCollab]       = useState<CollabData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<"suggestions" | "chat" | "plan" | "agreement">("suggestions");

  // Digital signing
  const [sigName, setSigName]   = useState("");
  const [signing, setSigning]   = useState(false);

  // Contract text
  const [contractText, setContractText] = useState("");
  const [textDirty, setTextDirty]       = useState(false);
  const [saving, setSaving]             = useState(false);

  // AI generation
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [actionPlan, setActionPlan]   = useState<ActionItem[]>([]);
  const [aiStreaming, setAiStreaming]  = useState(false);
  const [aiRaw, setAiRaw]             = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Chat
  const [messages, setMessages]   = useState<CollabMessage[]>([]);
  const [newMsg, setNewMsg]       = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Share link
  const [copied, setCopied] = useState(false);

  // Finalize plan modal
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);

  // ── Load collab ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!collabId) return;
    try {
      const data = await contractCollabApi.get(collabId);
      setCollab(data);
      setContractText(data.contract_text || "");
      if (data.ai_suggestions) {
        try { setSuggestions(JSON.parse(data.ai_suggestions)); } catch { /* */ }
      }
      if (data.action_plan) {
        try { setActionPlan(JSON.parse(data.action_plan)); } catch { /* */ }
      }
    } catch { /* handled below */ }
    finally { setLoading(false); }
  }, [collabId]);

  const loadMessages = useCallback(async () => {
    if (!collabId) return;
    try {
      const msgs = await contractCollabApi.getMessages(collabId);
      setMessages(msgs);
    } catch { /* silent */ }
  }, [collabId]);

  useEffect(() => { load(); loadMessages(); }, [load, loadMessages]);

  // Poll collab + messages every 4 seconds (picks up vendor checkbox changes)
  useEffect(() => {
    const interval = setInterval(async () => {
      loadMessages();
      if (!collabId) return;
      try {
        const data = await contractCollabApi.get(collabId);
        setCollab(data);
        if (data.action_plan) {
          try { setActionPlan(JSON.parse(data.action_plan)); } catch { /* */ }
        }
      } catch { /* silent */ }
    }, 4000);
    return () => clearInterval(interval);
  }, [collabId, loadMessages]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── AI generation ──────────────────────────────────────────────────────────

  const generateAnalysis = async () => {
    if (!collab || aiStreaming) return;
    setAiStreaming(true);
    setAiRaw("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const filter = makeThinkFilter();
    let accumulated = "";

    try {
      const stored = localStorage.getItem("grc_user_v2");
      const token  = stored ? (JSON.parse(stored)?.accessToken ?? "") : "";
      const resp = await fetch("/api/v1/ai/stream-contract-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          contract_text: contractText,
          ai_review: collab.ai_review ?? undefined,
          vendor_name: collab.vendor_name,
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      await readSseStream(
        resp,
        (t) => { const f = filter(t); accumulated += f; setAiRaw(accumulated); },
        () => {
          const parsed = parseSuggestionsAndPlan(accumulated);
          // Preserve existing custom issues
          const custom = suggestions.filter(s => s.custom);
          setSuggestions([...parsed.suggestions, ...custom]);
          setActionPlan(parsed.plan);

          if (collabId && parsed.suggestions.length > 0) {
            contractCollabApi.updateContent(collabId, {
              ai_suggestions: JSON.stringify([...parsed.suggestions, ...custom]),
              action_plan: JSON.stringify(parsed.plan),
            }).catch(() => {/* silent */});
          }
          setAiStreaming(false);
        },
      );
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError") setAiStreaming(false);
    }
  };

  // ── Save contract text ─────────────────────────────────────────────────────

  const saveText = async () => {
    if (!collabId || !textDirty) return;
    setSaving(true);
    try {
      await contractCollabApi.updateContent(collabId, { contract_text: contractText });
      setTextDirty(false);
    } finally { setSaving(false); }
  };

  // ── Chat ───────────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!collabId || !newMsg.trim()) return;
    setSendingMsg(true);
    try {
      await contractCollabApi.sendMessage(collabId, { message: newMsg.trim() });
      setNewMsg("");
      await loadMessages();
    } finally { setSendingMsg(false); }
  };

  // ── Agreement ──────────────────────────────────────────────────────────────

  const markAgreed = async () => {
    if (!collabId) return;
    const updated = await contractCollabApi.agree(collabId);
    setCollab(updated);
  };

  // ── Share link ─────────────────────────────────────────────────────────────

  const shareUrl = collab
    ? `${window.location.origin}/vendor-collab/${collab.share_token}`
    : "";

  const copyShare = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Suggestion helpers ─────────────────────────────────────────────────────

  const updateSuggStatus = async (id: number | string, status: "accepted" | "rejected") => {
    const updated = suggestions.map(s => s.id === id ? { ...s, status } : s);
    setSuggestions(updated);
    if (collabId) {
      await contractCollabApi.updateContent(collabId, { ai_suggestions: JSON.stringify(updated) });
    }
  };

  const addCustomIssue = async (partial: Omit<AISuggestion, "id" | "status" | "custom">) => {
    const newId = `custom_${Date.now()}`;
    const newIssue: AISuggestion = { ...partial, id: newId, status: "open", custom: true };
    const updated = [...suggestions, newIssue];
    setSuggestions(updated);
    if (collabId) {
      await contractCollabApi.updateContent(collabId, { ai_suggestions: JSON.stringify(updated) });
    }
  };

  // ── Add custom plan item ──────────────────────────────────────────────────

  const addCustomPlanItem = async (partial: Omit<ActionItem, "id" | "done" | "custom">) => {
    const newItem: ActionItem = {
      ...partial,
      id: `custom_${Date.now()}`,
      done: false,
    };
    const updated = [...actionPlan, newItem];
    setActionPlan(updated);
    if (collabId) {
      await contractCollabApi.updateContent(collabId, { action_plan: JSON.stringify(updated) });
    }
  };

  // ── Finalize plan ──────────────────────────────────────────────────────────

  const handleFinalizePlan = async (deadlines: { id: string; deadline: string }[]) => {
    if (!collabId) return;
    const updated = await contractCollabApi.finalizePlan(collabId, deadlines);
    setCollab(updated);
    if (updated.action_plan) {
      try { setActionPlan(JSON.parse(updated.action_plan)); } catch { /* */ }
    }
  };

  // ── Sign agreement ─────────────────────────────────────────────────────────

  const handleSign = async () => {
    if (!collabId || !sigName.trim()) return;
    setSigning(true);
    try {
      const updated = await contractCollabApi.sign(collabId, sigName.trim());
      setCollab(updated);
    } finally {
      setSigning(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!collab) {
    return (
      <div className="p-8 text-center text-gray-500">
        Collaboration not found.
        <button onClick={() => navigate("/vendors")} className="ml-2 text-blue-600 underline">
          Back to vendors
        </button>
      </div>
    );
  }

  const isAgreed      = collab.status === "agreed";
  const donePlan      = actionPlan.filter(a => a.done).length;
  const isFinalized   = !!collab.plan_finalized_at;
  const bothSigned    = !!(collab.ciso_signed_at && collab.vendor_signed_at);

  return (
    <>
      {showFinalizeModal && (
        <FinalizePlanModal
          plan={actionPlan}
          onClose={() => setShowFinalizeModal(false)}
          onSave={handleFinalizePlan}
        />
      )}

      <div className="flex flex-col h-screen bg-gray-50">

        {/* ── Top bar ── */}
        <div className="bg-white border-b px-6 py-3 flex items-center gap-4 shrink-0">
          <button onClick={() => navigate("/vendors")}
            className="text-gray-500 hover:text-gray-800 flex items-center gap-1 text-sm">
            <ArrowLeft className="w-4 h-4" /> Vendors
          </button>
          <div className="flex-1">
            <h1 className="font-semibold text-gray-900 text-sm leading-tight">
              Contract Collaboration — <span className="text-blue-700">{collab.vendor_name}</span>
            </h1>
            <p className="text-xs text-gray-500 truncate max-w-xs">{collab.contract_id}</p>
          </div>

          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
            isAgreed ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
          }`}>
            {isAgreed ? "✓ Agreed" : "In Negotiation"}
          </span>

          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className={`flex items-center gap-1 ${collab.agreed_by_internal ? "text-green-600" : ""}`}>
              {collab.agreed_by_internal ? <Check className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Your side
            </span>
            <span className={`flex items-center gap-1 ${collab.agreed_by_vendor ? "text-green-600" : ""}`}>
              {collab.agreed_by_vendor ? <Check className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Vendor
            </span>
          </div>

          <div className="flex items-center gap-1 bg-gray-100 rounded px-2 py-1 text-xs text-gray-600 max-w-48 truncate">
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span className="truncate">{shareUrl}</span>
          </div>
          <button onClick={copyShare}
            className="flex items-center gap-1 text-xs bg-blue-600 text-white px-2.5 py-1.5 rounded hover:bg-blue-700">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy Link"}
          </button>

          {!isAgreed && (
            <button onClick={markAgreed}
              className="flex items-center gap-1 text-xs bg-green-600 text-white px-2.5 py-1.5 rounded hover:bg-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" /> Mark Agreed
            </button>
          )}
        </div>

        {/* ── Body: left = contract, right = tabs ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* LEFT — editable contract */}
          <div className="flex flex-col w-[55%] border-r bg-white">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Working Contract Draft
              </span>
              <button
                onClick={saveText}
                disabled={!textDirty || saving}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
            <textarea
              className="flex-1 p-4 font-mono text-xs resize-none focus:outline-none text-gray-800 leading-relaxed"
              value={contractText}
              onChange={e => { setContractText(e.target.value); setTextDirty(true); }}
              placeholder="Contract text will appear here…"
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
                  {tab === "suggestions" && <Lightbulb className="w-3.5 h-3.5" />}
                  {tab === "chat"        && <MessageSquare className="w-3.5 h-3.5" />}
                  {tab === "plan"        && <ClipboardList className="w-3.5 h-3.5" />}
                  {tab === "agreement"   && <FileSignature className="w-3.5 h-3.5" />}
                  {tab === "suggestions" && `Issues (${suggestions.length})`}
                  {tab === "chat"        && `Chat (${messages.length})`}
                  {tab === "plan"        && `Plan (${donePlan}/${actionPlan.length})`}
                  {tab === "agreement"   && (bothSigned ? "Signed ✓" : "Sign")}
                </button>
              ))}
            </div>

            {/* ── Suggestions tab ── */}
            {activeTab === "suggestions" && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="px-4 py-2 border-b bg-gray-50 flex items-center justify-between">
                  <span className="text-xs text-gray-500">AI-identified issues + your own</span>
                  <button
                    onClick={generateAnalysis}
                    disabled={aiStreaming}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                    {aiStreaming
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Analysing…</>
                      : <><RefreshCw className="w-3 h-3" /> {suggestions.length ? "Re-analyse" : "Generate Analysis"}</>}
                  </button>
                </div>

                {aiStreaming && (
                  <div className="px-4 py-3 bg-purple-50 border-b text-xs text-purple-700 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {aiRaw || "Analysing contract…"}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {suggestions.length === 0 && !aiStreaming && (
                    <div className="text-center py-8 text-gray-400 text-sm">
                      <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      Click "Generate Analysis" or add a custom issue below
                    </div>
                  )}
                  {suggestions.map(s => (
                    <div key={s.id} className={`rounded-lg border p-3 ${SEV_COLOR[s.severity]} ${
                      s.status === "rejected" ? "opacity-40" : ""
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          {SEV_ICON(s.severity)}
                          <span className="uppercase">{s.severity}</span>
                          <span className="font-normal text-gray-600">— {s.clause}</span>
                          {s.custom && (
                            <span className="text-[10px] bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded-full font-semibold">
                              Custom
                            </span>
                          )}
                        </div>
                        {s.status === "open" && (
                          <div className="flex gap-1">
                            <button onClick={() => updateSuggStatus(s.id, "accepted")}
                              className="p-0.5 rounded hover:bg-green-200" title="Accept">
                              <Check className="w-3.5 h-3.5 text-green-700" />
                            </button>
                            <button onClick={() => updateSuggStatus(s.id, "rejected")}
                              className="p-0.5 rounded hover:bg-red-200" title="Dismiss">
                              <X className="w-3.5 h-3.5 text-red-700" />
                            </button>
                          </div>
                        )}
                        {s.status !== "open" && (
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                            s.status === "accepted" ? "bg-green-200 text-green-800" : "bg-gray-200 text-gray-500"
                          }`}>{s.status}</span>
                        )}
                      </div>
                      <p className="text-xs mb-1.5 text-gray-700">{s.issue}</p>
                      <div className="bg-white/60 rounded p-2 text-xs text-gray-800 font-mono leading-relaxed">
                        <span className="text-gray-400 text-[10px] uppercase font-semibold mr-1">Fix:</span>
                        {s.fix}
                      </div>
                    </div>
                  ))}

                  {/* Add custom issue form */}
                  <AddIssueForm onAdd={addCustomIssue} />
                </div>
              </div>
            )}

            {/* ── Chat tab ── */}
            {activeTab === "chat" && (
              <div className="flex flex-col flex-1 overflow-hidden bg-white">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.length === 0 && (
                    <div className="text-center py-8 text-gray-400 text-sm">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No messages yet. Start the conversation.
                    </div>
                  )}
                  {messages.map(m => (
                    <div key={m.id}
                      className={`flex flex-col ${m.sender_type === "internal" ? "items-end" : "items-start"}`}>
                      <span className="text-[10px] text-gray-400 mb-0.5 px-1">{m.sender_name}</span>
                      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                        m.sender_type === "internal"
                          ? "bg-blue-600 text-white rounded-br-sm"
                          : "bg-gray-100 text-gray-800 rounded-bl-sm"
                      }`}>
                        {m.message}
                      </div>
                      <span className="text-[10px] text-gray-300 mt-0.5 px-1">
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                <div className="border-t p-3 flex gap-2">
                  <input
                    className="flex-1 text-sm border rounded-full px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder={isAgreed ? "Agreement finalised" : "Type a message…"}
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

            {/* ── Action Plan tab (CISO = read-only view of vendor progress) ── */}
            {activeTab === "plan" && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="px-4 py-2 border-b bg-gray-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      Vendor progress · {donePlan}/{actionPlan.length} done
                    </span>
                    {isFinalized && (
                      <span className="flex items-center gap-1 text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full font-semibold">
                        <Lock className="w-2.5 h-2.5" /> Plan locked {fmtDate(collab.plan_finalized_at ?? undefined)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {actionPlan.length === 0 && (
                      <button
                        onClick={generateAnalysis}
                        disabled={aiStreaming}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                        <RefreshCw className="w-3 h-3" /> Generate Plan
                      </button>
                    )}
                    {actionPlan.length > 0 && (
                      <button
                        onClick={() => setShowFinalizeModal(true)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">
                        <CalendarDays className="w-3 h-3" />
                        {isFinalized ? "Update Dates" : "Set Deadlines"}
                      </button>
                    )}
                  </div>
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

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {actionPlan.length === 0 && (
                    <div className="text-center py-12 text-gray-400 text-sm">
                      <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      Generate the analysis first to create the action plan
                    </div>
                  )}
                  {actionPlan.map(a => (
                    <div key={a.id}
                      className={`flex items-start gap-3 rounded-lg border p-3 ${
                        a.done ? "opacity-60" : ""
                      } ${a.priority === "critical" ? "border-red-200 bg-red-50"
                        : a.priority === "high"     ? "border-orange-200 bg-orange-50"
                        : a.priority === "medium"   ? "border-yellow-100 bg-yellow-50"
                        : "border-gray-200 bg-gray-50"
                      }`}>
                      {/* Read-only checkbox — shows vendor's status */}
                      <div className={`mt-0.5 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${
                        a.done ? "bg-green-500 border-green-500" : "border-gray-300 bg-white"
                      }`}>
                        {a.done && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium ${a.done ? "line-through text-gray-400" : "text-gray-800"}`}>
                          {a.action}
                        </p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-full ${SEV_COLOR[a.priority]}`}>
                            {a.priority}
                          </span>
                          <span className="text-[10px] text-gray-500">👤 {a.responsible}</span>
                          {a.deadline && (
                            <span className={`text-[10px] font-medium flex items-center gap-0.5 ${
                              isFinalized ? "text-blue-700" : "text-gray-400"
                            }`}>
                              <CalendarDays className="w-2.5 h-2.5" />
                              {isFinalized ? fmtDate(String(a.deadline)) : String(a.deadline)}
                            </span>
                          )}
                          {String(a.id).startsWith("custom_") && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">
                              Custom
                            </span>
                          )}
                        </div>
                      </div>
                      {a.done && (
                        <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                          Done ✓
                        </span>
                      )}
                    </div>
                  ))}

                  {/* Add custom plan item */}
                  <AddPlanItemForm onAdd={addCustomPlanItem} />
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
                    Fully Executed — both parties have signed. A contract record has been created.
                  </div>
                )}

                {/* Signature status row */}
                <div className="flex items-center gap-4 px-4 py-2 border-b bg-gray-50 text-xs shrink-0">
                  <div className={`flex items-center gap-1.5 ${collab.ciso_signed_at ? "text-green-700" : "text-gray-400"}`}>
                    {collab.ciso_signed_at
                      ? <><Check className="w-3.5 h-3.5" /> You signed as <strong>{collab.ciso_signature}</strong></>
                      : <><X className="w-3.5 h-3.5" /> Awaiting your signature</>
                    }
                  </div>
                  <span className="text-gray-300">|</span>
                  <div className={`flex items-center gap-1.5 ${collab.vendor_signed_at ? "text-green-700" : "text-amber-600"}`}>
                    {collab.vendor_signed_at
                      ? <><Check className="w-3.5 h-3.5" /> Vendor signed as <strong>{collab.vendor_signature}</strong></>
                      : <><Loader2 className="w-3.5 h-3.5" /> Awaiting vendor signature</>
                    }
                  </div>
                </div>

                {/* CISO sign panel */}
                {!collab.ciso_signed_at && (
                  <div className="px-4 py-3 border-b bg-blue-50 shrink-0">
                    <p className="text-xs font-semibold text-blue-900 mb-2">Sign this agreement</p>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 text-sm border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        placeholder="Type your full name to sign…"
                        value={sigName}
                        onChange={e => setSigName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSign()}
                      />
                      <button
                        onClick={handleSign}
                        disabled={!sigName.trim() || signing}
                        className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40">
                        {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
                        {signing ? "Signing…" : "Sign Agreement"}
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
                      Agreement document will appear here once both parties agree.
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}
