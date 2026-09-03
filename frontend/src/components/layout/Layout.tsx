import { useState, useEffect, useRef } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuthStore, authSession, PLAN_FEATURES, getUserRoles, type PlanTier } from "../../store/auth";
import AIAssistant from "../ai/AIAssistant";
import LanguageSwitcher from "../LanguageSwitcher";
import OnboardingTour from "../onboarding/OnboardingTour";
import TrialBanner from "../TrialBanner";
import { notificationsApi } from "../../api/endpoints";
import type { AppNotification } from "../../types";
import { useAppearance } from "../../store/appearance";
import { useFramework } from "../../context/FrameworkContext";
import { useEntitlements } from "../../context/EntitlementsContext";
import {
  LayoutDashboard, AlertTriangle, CheckSquare, BookOpen,
  ClipboardList, FileText, Building2, LogOut, Shield,
  ChevronRight, Bell, Settings, HelpCircle, Lock,
  Crown, X, Trash2, Wand2, Menu,
  AlertCircle, Info, ShieldAlert, ClipboardCheck, RefreshCw,
  Eye, Users, Headphones, Map, ListTodo, Boxes, BarChart3, Gauge, Bug, Radar, Scale, Archive, Database, ScanLine, Network,
  Target, Workflow, Siren, ShieldCheck, ShieldOff, Landmark, Webhook,
} from "lucide-react";

// roles: null = visible to all authenticated non-auditor users
// tenant_admin always has access everywhere; ciso is now a regular (but broad) role
// Nav module -> the entitlement(s) its backend is gated behind.
//
// Only modules whose endpoints are ALL behind require_feature appear here.
// Listing a partly gated module would lock a page the tenant can still use
// half of, which is worse than showing it and letting the gate answer.
// Verified against the endpoint files: archiving, cve, ocr, risk_treatment,
// asset_graph and control_evaluation gate every route; governance gates all 15
// across two features.
//
// A module absent from this table is never locked.
const MODULE_FEATURES: Record<string, readonly string[]> = {
  "archiving":              ["archiving"],
  "asset-graph":            ["asset_cartography"],
  "control-effectiveness":  ["control_effectiveness"],
  "cve":                    ["cve_knowledge_base"],
  "ocr":                    ["ocr_capture"],
  "risk-treatment":         ["risk_treatment_plans"],
  // Governance is RACI plus the document repository, gated separately. It stays
  // reachable while EITHER is enabled, or turning off RACI alone would hide the
  // document repository with it.
  "governance":             ["raci_governance", "document_repository"],
};

const NAV_GROUPS = [
  {
    label: "Core",
    items: [
      { to: "/dashboard",  icon: LayoutDashboard, label: "Dashboard",     module: "dashboard",  roles: null },
      { to: "/assets",     icon: Boxes,           label: "Assets",        module: "assets",     roles: null },
      { to: "/asset-graph", icon: Network,     label: "Asset Cartography", module: "asset-graph", roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/analytics",  icon: BarChart3,       label: "Analytics",     module: "analytics",  roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/risk-treatment", icon: ShieldAlert, label: "Risk Treatment", module: "risk-treatment", roles: ["tenant_admin","ciso","risk_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/control-effectiveness", icon: Gauge, label: "Control Effectiveness", module: "control-effectiveness", roles: ["tenant_admin","ciso","risk_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/risk-cartography", icon: Map,           label: "Risk Cartography", module: "risk-cartography", roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/risks",          icon: Target,          label: "Risk Register",  module: "risks",          roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/risk-scenarios", icon: Workflow,        label: "Risk Scenarios", module: "risk-scenarios", roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/compliance", icon: CheckSquare,     label: "Compliance",    module: "compliance", roles: ["tenant_admin","ciso","risk_manager","compliance_manager","policy_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/action-plan", icon: ListTodo,       label: "Action Plan",   module: "action-plan", roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/framework",  icon: BookOpen,        label: "Frameworks",    module: "frameworks", roles: ["tenant_admin","ciso","compliance_manager","policy_manager","viewer","executive"] },
    ],
  },
  {
    label: "Security",
    items: [
      { to: "/incidents",       icon: Siren,     label: "Incidents",          module: "incidents",         roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/vulnerabilities", icon: Bug,      label: "Vulnerabilities",   module: "vulnerabilities", roles: null },
      { to: "/cve",             icon: Database,  label: "CVE Knowledge Base", module: "cve",            roles: null },
      { to: "/threats",         icon: Radar,    label: "Threat Library",    module: "threats",         roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/applied-controls",    icon: ShieldCheck, label: "Applied Controls",     module: "applied-controls",    roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
      { to: "/security-exceptions", icon: ShieldOff,   label: "Exceptions & Waivers", module: "security-exceptions", roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","business_owner","security_analyst","viewer","executive"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/audits",           icon: ClipboardList,  label: "Audits",             module: "audits",           roles: ["tenant_admin","ciso","compliance_manager","viewer","executive"] },
      { to: "/policies",         icon: FileText,       label: "Policies",           module: "policies",         roles: ["tenant_admin","ciso","compliance_manager","policy_manager","viewer","executive"] },
      { to: "/policy-generator", icon: Wand2,          label: "Doc Generator",      module: "policy-generator", roles: ["tenant_admin","ciso","policy_manager","viewer","executive"] },
      { to: "/ocr",              icon: ScanLine,       label: "Document Capture",   module: "ocr",              roles: null },
      { to: "/vendors",          icon: Building2,      label: "3rd Parties (TPRM)", module: "vendors",          roles: ["tenant_admin","ciso","vendor_manager","viewer","executive"] },
      { to: "/reports",          icon: ClipboardCheck, label: "Reports",            module: "reports",          roles: null },
      { to: "/support",          icon: Headphones,     label: "Support",            module: "support",          roles: null },
    ],
  },
  {
    label: "Governance",
    items: [
      { to: "/governance", icon: Scale,   label: "Governance", module: "governance", roles: ["tenant_admin","ciso","compliance_manager","policy_manager","viewer","executive"] },
      { to: "/archiving",  icon: Archive, label: "Archiving",  module: "archiving",  roles: ["tenant_admin","ciso","compliance_manager","viewer","executive"] },
      { to: "/system-check", icon: ClipboardCheck, label: "System Check", module: "system-check", roles: ["tenant_admin"] },
      { to: "/regulatory",          icon: Landmark,   label: "Regulatory Updates",  module: "regulatory",          roles: ["tenant_admin","ciso","compliance_manager","policy_manager","viewer","executive"] },
      { to: "/webhooks",            icon: Webhook,     label: "Webhooks",            module: "webhooks",            roles: ["tenant_admin"] },
    ],
  },
];

const AUDITOR_NAV = [
  { to: "/auditor/portal", icon: ClipboardCheck, label: "My Assignments" },
];

const PAGE_LABELS: Record<string, string> = {
  dashboard:  "Dashboard",
  assets:     "Assets",
  analytics:  "Analytics",
  "risk-treatment": "Risk Treatment",
  "control-effectiveness": "Control Effectiveness",
  governance:  "Governance",
  archiving:   "Archiving",
  cve:         "CVE Knowledge Base",
  "mfa-setup": "Two-Factor (MFA)",
  risks:      "Risk Register",
  "risk-cartography": "Risk Cartography",
  "action-plan": "Action Plan",
  "risk-scenarios": "Risk Scenarios",
  compliance: "Compliance",
  frameworks: "Frameworks",
  audits:     "Audits",
  policies:          "Policies",
  "policy-generator": "Doc Generator",
  ocr:               "Document Capture",
  vendors:           "3rd Parties",
  reports:    "Reports",
  incidents:  "Incidents",
  vulnerabilities: "Vulnerabilities",
  threats:    "Threat Library",
  "applied-controls": "Applied Controls",
  "security-exceptions": "Exceptions & Waivers",
  regulatory: "Regulatory Updates",
  "activity-log": "Activity Log",
  webhooks:   "Webhooks",
  settings:   "Settings",
  help:       "Help & Support",
  support:    "Support",
};

function roleIcon(role: string) {
  if (role === "super_admin") return { Icon: Crown,         color: "from-yellow-500 to-orange-500" };
  if (role === "ciso")       return { Icon: Crown,         color: "from-yellow-500 to-orange-500" };
  return                             { Icon: Shield,         color: "from-blue-500 to-blue-600"    };
}

function planBadgeStyle(plan: PlanTier) {
  if (plan === "elite")        return { bg: "from-yellow-500/10 to-orange-500/10", border: "border-yellow-500/30", text: "text-yellow-400", sub: "text-yellow-300/70" };
  if (plan === "enterprise")   return { bg: "from-yellow-500/10 to-orange-500/10", border: "border-yellow-500/20", text: "text-yellow-400", sub: "text-yellow-300/70" };
  if (plan === "professional") return { bg: "from-blue-500/10 to-indigo-500/10",  border: "border-blue-500/20",   text: "text-blue-400",   sub: "text-blue-300/70"   };
  if (plan === "starter")      return { bg: "from-purple-500/10 to-blue-500/10",  border: "border-purple-500/20", text: "text-purple-400", sub: "text-purple-300/70" };
  return                              { bg: "from-blue-500/10 to-indigo-500/10",  border: "border-blue-500/20",   text: "text-blue-400",   sub: "text-slate-400"     };
}

// Map notification type → icon + colour
function notifStyle(type: string) {
  if (type.startsWith("risk"))        return { Icon: AlertTriangle,  bg: "bg-red-50",    icon: "text-red-500"    };
  if (type.startsWith("audit"))       return { Icon: ClipboardCheck, bg: "bg-blue-50",   icon: "text-blue-500"   };
  if (type.startsWith("policy"))      return { Icon: FileText,       bg: "bg-orange-50", icon: "text-orange-500" };
  if (type.startsWith("vendor"))      return { Icon: Building2,      bg: "bg-purple-50", icon: "text-purple-500" };
  if (type.startsWith("compliance"))  return { Icon: ShieldAlert,    bg: "bg-yellow-50", icon: "text-yellow-600" };
  return                                     { Icon: Info,           bg: "bg-gray-50",   icon: "text-gray-500"   };
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Demo notifications shown when backend is unavailable ─────────────────────
const DEMO_NOTIFICATIONS: AppNotification[] = [
  {
    id: "d1", type: "risk_new", status: "unread",
    title: "New critical risk: Unpatched production servers",
    message: "A new critical severity risk has been added to the risk register.",
    data: { link: "/risks" }, created_at: new Date(Date.now() - 12 * 60000).toISOString(),
  },
  {
    id: "d2", type: "compliance_score_drop", status: "unread",
    title: "Compliance score dropped 7% — ISO 27001",
    message: "Your compliance score for ISO 27001 dropped from 79% to 72%.",
    data: { link: "/compliance" }, created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: "d3", type: "policy_review_due", status: "unread",
    title: "Policy review due: Information Security Policy",
    message: "This policy is due for review on March 10, 2026.",
    data: { link: "/policies" }, created_at: new Date(Date.now() - 5 * 3600000).toISOString(),
  },
  {
    id: "d4", type: "audit_assigned", status: "read",
    title: "Audit assigned: Q1 SOC 2 Audit",
    message: "You have been assigned as lead auditor for Q1 SOC 2 Audit.",
    data: { link: "/audits" }, created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
  },
  {
    id: "d5", type: "vendor_alert", status: "read",
    title: "Vendor risk alert: CloudProvider Inc.",
    message: "CloudProvider Inc. risk tier changed to HIGH.",
    data: { link: "/vendors" }, created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

// ── NotificationBell component ────────────────────────────────────────────────
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState<{ title: string; content: string; ticketId: string }[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Real-time support ticket reply notifications (SSE — works through any WAF/proxy)
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const token = localStorage.getItem("access_token") || sessionStorage.getItem("access_token") || "";
    if (!token) return;
    const apiBase = import.meta.env.VITE_API_URL ?? `${window.location.origin}/api/v1`;
    const es = new EventSource(`${apiBase}/support/tickets/notify/stream?token=${encodeURIComponent(token)}`);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "message" && data.is_support) {
          setSupportUnread(prev => [...prev, {
            title: data.ticket_title as string,
            content: data.content as string,
            ticketId: data.ticket_id as string,
          }]);
          // Beep
          try {
            const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            gain.gain.setValueAtTime(0.25, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
          } catch { /* ignore */ }
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("Support replied to your ticket", {
              body: `"${data.ticket_title}" — ${data.content}`,
              icon: "/favicon.ico",
            });
          }
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => {};
    return () => { es.close(); };
  }, []);

  // Try to fetch real notifications; fall back to demo data on error
  const { data, isError } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list({ limit: 20 }),
    retry: false,
    refetchInterval: 30_000,
  });

  const notifications: AppNotification[] = isError || !data ? DEMO_NOTIFICATIONS : data.items;
  const backendUnread = isError || !data
    ? DEMO_NOTIFICATIONS.filter(n => n.status === "unread").length
    : data.unread_count;
  const unreadCount = backendUnread + supportUnread.length;

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const deleteNotif = useMutation({
    mutationFn: (id: string) => notificationsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const checkDeadlines = useMutation({
    mutationFn: () => notificationsApi.checkDeadlines(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleNotifClick(n: AppNotification) {
    if (n.status === "unread" && !isError) markRead.mutate(n.id);
    setOpen(false);
    if (n.data?.link) navigate(n.data.link as string);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); if (!open && supportUnread.length > 0) setSupportUnread([]); }}
        className="relative w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        aria-label="Notifications"
      >
        <Bell className={`w-4 h-4 ${supportUnread.length > 0 ? "animate-bounce text-red-500" : ""}`} />
        {supportUnread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 rtl:right-auto rtl:-left-0.5 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 rtl:right-auto rtl:-left-0.5 min-w-[16px] h-4 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 rtl:right-auto rtl:left-0 top-10 w-[calc(100vw-2rem)] sm:w-96 max-w-[24rem] bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-gray-500" />
              <h3 className="font-semibold text-gray-900 text-sm">{t("nav.notifications")}</h3>
              {unreadCount > 0 && (
                <span className="text-xs font-semibold px-1.5 py-0.5 bg-red-50 text-red-600 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => checkDeadlines.mutate()}
                disabled={checkDeadlines.isPending}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                title="Check deadlines now"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkDeadlines.isPending ? "animate-spin" : ""}`} />
              </button>
              {unreadCount > 0 && !isError && (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  {t("nav.mark_all_read")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Support reply notifications (real-time) */}
          {supportUnread.length > 0 && (
            <div className="divide-y divide-blue-50">
              {supportUnread.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setSupportUnread([]); setOpen(false); navigate("/support"); }}
                  className="w-full flex items-start gap-3 px-4 py-3 bg-blue-50 hover:bg-blue-100 text-left transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bell className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-blue-700">Support replied to your ticket</p>
                    <p className="text-xs font-semibold text-gray-800 mt-0.5 truncate">"{s.title}"</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{s.content}</p>
                  </div>
                  <span className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-1.5" />
                </button>
              ))}
            </div>
          )}

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <Bell className="w-5 h-5 text-gray-300" />
                </div>
                <p className="text-sm font-medium text-gray-500">{t("nav.no_notifications")}</p>
                <p className="text-xs text-gray-400 mt-1">{t("nav.all_caught_up")}</p>
              </div>
            ) : (
              notifications.map(n => {
                const { Icon, bg, icon } = notifStyle(n.type);
                const isUnread = n.status === "unread";
                return (
                  <div
                    key={n.id}
                    className={`group flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors ${
                      isUnread ? "bg-blue-50/40 hover:bg-blue-50" : "hover:bg-gray-50"
                    }`}
                    onClick={() => handleNotifClick(n)}
                  >
                    <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${bg} flex items-center justify-center mt-0.5`}>
                      <Icon className={`w-4 h-4 ${icon}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-snug ${isUnread ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}>
                          {n.title}
                        </p>
                        {isUnread && (
                          <span className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-1.5" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    {!isError && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); deleteNotif.mutate(n.id); }}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-red-500 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between">
            {isError && (
              <span className="text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {t("nav.demo_data")}
              </span>
            )}
            {!isError && <span />}
            <button
              type="button"
              onClick={() => { setOpen(false); navigate("/settings?tab=notifications"); }}
              className="text-xs text-gray-500 hover:text-blue-600 font-medium transition-colors flex items-center gap-1"
            >
              <Settings className="w-3 h-3" /> {t("nav.manage_preferences")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Sidebar style helpers
function sidebarClasses(style: string) {
  if (style === "light")   return "bg-white border-r border-gray-200";
  if (style === "branded") return "bg-gradient-to-b from-blue-700 to-indigo-800";
  return "bg-slate-900"; // dark (default)
}
function sidebarTextClasses(style: string) {
  if (style === "light") return {
    logo: "text-gray-900", sub: "text-gray-500",
    navLabel: "text-gray-400", navItem: "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
    navActive: "bg-blue-600 text-white shadow-lg shadow-blue-600/20",
    navIcon: "text-gray-400", navIconActive: "text-white",
    divider: "border-gray-200", bottomItem: "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
    logout: "text-gray-600 hover:bg-red-50 hover:text-red-500",
  };
  if (style === "branded") return {
    logo: "text-white", sub: "text-blue-200",
    navLabel: "text-blue-300", navItem: "text-blue-100 hover:bg-white/10 hover:text-white",
    navActive: "bg-white/20 text-white shadow-lg shadow-black/20",
    navIcon: "text-blue-200", navIconActive: "text-white",
    divider: "border-white/10", bottomItem: "text-blue-100 hover:bg-white/10 hover:text-white",
    logout: "text-blue-100 hover:bg-red-500/20 hover:text-red-200",
  };
  // dark default
  return {
    logo: "text-white", sub: "text-slate-400",
    navLabel: "text-slate-500", navItem: "text-slate-400 hover:bg-slate-800 hover:text-white",
    navActive: "bg-blue-600 text-white shadow-lg shadow-blue-600/20",
    navIcon: "text-slate-400", navIconActive: "text-white",
    divider: "border-slate-700/60", bottomItem: "text-slate-400 hover:bg-slate-800 hover:text-white",
    logout: "text-slate-400 hover:bg-red-500/10 hover:text-red-400",
  };
}

// ── Main Layout ───────────────────────────────────────────────────────────────
export default function Layout() {
  const user = useAuthStore((u) => u);
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const qc = useQueryClient();
  const segment  = location.pathname.split("/")[1] || "dashboard";
  const pageLabel = t(`nav.${segment.replace(/-/g, "_")}` as never, PAGE_LABELS[segment] ?? segment);
  const [appearance] = useAppearance();
  const sc = sidebarTextClasses(appearance.sidebarStyle);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showDemoToast, setShowDemoToast] = useState(false);
  const [licenseDays, setLicenseDays] = useState<number | null>(null);

  // Refresh profile + roles from server on every app load.
  // This ensures role changes made by the admin take effect on the user's
  // next page visit without requiring a manual logout.
  useEffect(() => {
    if (!user) return;
    import("../../api/endpoints").then(({ authApi }) => {
      authApi.getProfile().then((profile) => {
        const current = authSession.getUser();
        if (!current) return;
        authSession.login({
          ...current,
          role: profile.role as import("../../store/auth").UserRole,
          roles: profile.roles ?? [],
          org: profile.tenant_name || current.org,
          name: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || current.name,
          tenant_id: profile.tenant_id,
          primary_framework_id: profile.primary_framework_id,
          selected_framework_ids: profile.selected_framework_ids,
          org_size: profile.org_size,
          primary_assessment_id: profile.primary_assessment_id,
          accessible_modules: profile.accessible_modules,
        });
      }).catch(() => {/* ignore — token may have expired, login flow handles it */});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync plan from subscription API on mount (corrects stale localStorage sessions)
  useEffect(() => {
    if (!user) return;
    import("../../api/endpoints").then(({ subscriptionsApi }) => {
      subscriptionsApi.get().then((sub) => {
        const isTrialing = sub.status === "trialing";
        const newPlan = isTrialing ? "free_trial" : (sub.tier as import("../../store/auth").PlanTier);
        // Calculate real days remaining from trial_ends_at
        let daysRemaining: number | undefined = undefined;
        if (isTrialing && sub.trial_ends_at) {
          const msLeft = new Date(sub.trial_ends_at).getTime() - Date.now();
          daysRemaining = Math.max(0, Math.ceil(msLeft / 86_400_000));
        }
        authSession.patchUser({ plan: newPlan, daysRemaining });
      }).catch(() => {/* ignore — best effort */});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // License expiry warning (self-hosted licensed builds only) — best effort,
  // silently ignore any error (older backends have no /license endpoint).
  useEffect(() => {
    if (!user) return;
    import("../../api/license").then(({ licenseApi }) => {
      licenseApi.getStatus().then((s) => {
        if (s.enforcement && s.status === "valid" && s.days_remaining !== null && s.days_remaining <= 30) {
          setLicenseDays(s.days_remaining);
        }
      }).catch(() => {/* ignore — license service unavailable */});
    }).catch(() => {/* ignore */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for demo-block events fired by the API client interceptor
  useEffect(() => {
    function onDemoBlock() {
      setShowDemoToast(true);
      setTimeout(() => setShowDemoToast(false), 4000);
    }
    window.addEventListener("demo-block", onDemoBlock);
    return () => window.removeEventListener("demo-block", onDemoBlock);
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => { setMobileSidebarOpen(false); }, [location.pathname]);

  // Lock body scroll when mobile sidebar open
  useEffect(() => {
    document.body.style.overflow = mobileSidebarOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileSidebarOpen]);

  const { primaryFramework } = useFramework();
  const { hasAnyFeature } = useEntitlements();
  const plan        = user?.plan ?? "free_trial";
  const isAdmin     = user?.role === "tenant_admin";
  const isSuperAdmin = user?.role === "super_admin";
  const isUser      = user?.role !== "auditor" && user?.role !== "super_admin";

  const badge = (isSuperAdmin || isAdmin) ? planBadgeStyle("enterprise") : planBadgeStyle(plan);
  const { Icon: RoleIcon, color: roleColor } = roleIcon(user?.role ?? "viewer");
  const initials = (user?.name ?? "U").charAt(0).toUpperCase();
  // Role label: super_admin → "Admin", everyone else → their company name
  const planLabel = isSuperAdmin ? t("roles.admin") : (user?.org ?? PLAN_FEATURES[plan]?.label ?? "Elite Pack");
  function resolvePlanSub() {
    if (isSuperAdmin) return t("nav.platform_owner");
    if (isAdmin) return t("nav.account_owner");
    if (plan === "free_trial") return `${user?.daysRemaining ?? 14} days remaining`;
    return PLAN_FEATURES[plan]?.label ?? "Elite Pack";
  }
  const planSub = resolvePlanSub();

  return (
    <div className="flex h-screen bg-gray-50">
      {/* ── Mobile sidebar backdrop ── */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        style={isRTL ? { right: 0, left: "auto" } : { left: 0, right: "auto" }}
        className={`
          fixed inset-y-0 z-50 w-64 flex flex-col shadow-2xl flex-shrink-0 transition-all duration-300
          md:relative md:translate-x-0 md:z-auto
          ${mobileSidebarOpen ? "translate-x-0" : isRTL ? "translate-x-full" : "-translate-x-full"}
          ${sidebarClasses(appearance.sidebarStyle)}
        `}
      >
        {/* Logo + mobile close */}
        <div className={`flex items-center justify-between px-4 py-4 border-b ${sc.divider}`}>
          <img src="/logowhite.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-20 w-auto object-contain" />
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Plan / role badge */}
        <div className={`mx-4 mt-3 px-3 py-2.5 bg-gradient-to-r ${badge.bg} border ${badge.border} rounded-xl`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-xs font-semibold ${badge.text}`}>{planLabel}</p>
              <p className={`text-xs mt-0.5 ${badge.sub}`}>{planSub}</p>
            </div>
            {(isSuperAdmin || isAdmin) && <Crown className="w-4 h-4 text-yellow-400" />}
            {isUser && <Shield className="w-4 h-4 text-blue-400" />}
          </div>
          {plan === "free_trial" && !isAdmin && (
            <div className="mt-2 h-1 bg-black/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full"
                style={{ width: `${Math.round(((user?.daysRemaining ?? 14) / 14) * 100)}%` }}
              />
            </div>
          )}
          {plan !== "free_trial" && plan !== "enterprise" && !isAdmin && (
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className={`mt-2 w-full text-xs font-medium ${badge.text} hover:opacity-80 text-left`}
            >
              Upgrade →
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {/* Auditor-only section */}
          {user?.role === "auditor" && (
            <div>
              <p className={`text-xs font-semibold uppercase tracking-widest px-3 mb-2 ${sc.navLabel}`}>
                {t("nav.audit_portal")}
              </p>
              <div className="space-y-0.5">
                {AUDITOR_NAV.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        isActive ? sc.navActive : sc.navItem
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? sc.navIconActive : sc.navIcon}`} />
                        <span className="flex-1">{label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )}

          {/* Standard nav groups — hidden for auditor role */}
          {user?.role !== "auditor" && NAV_GROUPS.map(group => (
            <div key={group.label}>
              <p className={`text-xs font-semibold uppercase tracking-widest px-3 mb-2 ${sc.navLabel}`}>
                {t(`nav.${group.label.toLowerCase()}` as never, group.label)}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ to, icon: Icon, label, module, roles }) => {
                  const userRoles = getUserRoles(user);
                  if (roles && !userRoles.some(r => roles.includes(r))) return null;
                  // Was hardwired false with this branch unreachable. The tenant's
                  // real entitlements now decide it.
                  const gatedBy = MODULE_FEATURES[module];
                  const locked = gatedBy ? !hasAnyFeature(gatedBy) : false;
                  if (locked) {
                    return (
                      <button
                        key={to}
                        type="button"
                        onClick={() => navigate("/settings")}
                        title={`${label} is not enabled for your organisation`}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium w-full transition-all group opacity-50 ${sc.navItem}`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="flex-1 text-left">{t(`nav.${module}` as never, label)}</span>
                        <Lock className="w-3 h-3 group-hover:text-blue-400 transition-colors" />
                      </button>
                    );
                  }
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isActive ? sc.navActive : sc.navItem
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? sc.navIconActive : sc.navIcon}`} />
                          <span className="flex-1">{t(`nav.${module.replace(/-/g, "_")}` as never, label)}</span>
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>


        {/* Bottom actions */}
        <div className={`px-3 pb-4 pt-3 border-t ${sc.divider} space-y-0.5`}>
          {/* Team Management — tenant_admin only */}
          {user?.role === "tenant_admin" && (
            <NavLink
              to="/company-admin"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium transition-all ${
                  isActive ? sc.navActive : sc.bottomItem
                }`
              }
            >
              <Users className="w-4 h-4" />
              {t("nav.team_management")}
            </NavLink>
          )}
          {[
            { to: "/documentation", icon: BookOpen, label: t("nav.documentation", "Documentation") },
            { to: "/settings", icon: Settings,   label: t("nav.settings") },
            { to: "/help",     icon: HelpCircle, label: t("nav.help")     },
          ].map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium transition-all ${
                  isActive ? sc.navActive : sc.bottomItem
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => { authSession.logout(); qc.clear(); navigate("/login"); }}
            className={`flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium transition-all ${sc.logout}`}
          >
            <LogOut className="w-4 h-4" />
            {t("nav.sign_out")}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* License expiry warning (licensed self-hosted builds only) */}
        {licenseDays !== null && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-medium flex-shrink-0">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-amber-600" />
            {t("license.banner", { days: licenseDays })}
          </div>
        )}

        {/* Trial banner */}
        <TrialBanner />

        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-4 sm:px-8 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 text-sm">
            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-gray-400">GRCEye</span>
              <ChevronRight className="hidden sm:inline w-3.5 h-3.5 text-gray-300" />
              <span className="text-gray-900 font-semibold">{pageLabel}</span>
            </div>
            {primaryFramework && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-xs font-semibold text-blue-700">
                <Shield className="w-3 h-3" />
                {primaryFramework.short_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Language switcher */}
            <LanguageSwitcher />
            {/* Live notification bell */}
            <NotificationBell />
            {/* Avatar */}
            <div className="flex items-center gap-2.5 pl-3 rtl:pl-0 rtl:pr-3 border-l rtl:border-l-0 rtl:border-r border-gray-100">
              <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${roleColor} flex items-center justify-center text-white shadow-sm`}>
                {user ? (
                  <span className="text-sm font-bold">{initials}</span>
                ) : (
                  <RoleIcon className="w-4 h-4" />
                )}
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-semibold text-gray-800 leading-none">{user?.name ?? "User"}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isSuperAdmin ? "Platform Admin" : isAdmin ? `${user?.org} · Owner` : user?.role === "viewer" ? `${user?.org ?? ""} · Read-only` : user?.org ?? ""}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Read-only banner for viewer role */}
        {user?.role === "viewer" && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm flex-shrink-0">
            <Eye className="w-4 h-4 flex-shrink-0 text-amber-600" />
            <span className="font-medium">{t("nav.read_only_access")}</span>
            <span className="text-amber-700">— {t("nav.read_only_message")}</span>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 overflow-auto overflow-x-hidden">
          <Outlet />
        </div>
      </main>

      {/* AI Assistant floating button — hidden for demo viewers */}
      {user?.role !== "viewer" && <AIAssistant />}

      {/* Onboarding tour — shown for first 3 visits */}
      <OnboardingTour />

      {/* Read-only toast — appears when viewer tries to write */}
      {showDemoToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rtl:left-auto rtl:right-1/2 rtl:translate-x-1/2 z-[200] flex items-center gap-3 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-2xl">
          <Eye className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span>{t("nav.read_only_toast")}</span>
          <button type="button" onClick={() => setShowDemoToast(false)} className="ml-1 text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
