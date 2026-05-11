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
import {
  LayoutDashboard, AlertTriangle, CheckSquare, BookOpen,
  ClipboardList, FileText, Building2, LogOut, Shield,
  ChevronRight, Bell, Settings, HelpCircle, Lock,
  Crown, X, Trash2, Wand2, Menu,
  AlertCircle, Info, ShieldAlert, ClipboardCheck, RefreshCw,
  Eye,
} from "lucide-react";

// roles: null = visible to all authenticated non-auditor users
// tenant_admin always has access everywhere; ciso is now a regular (but broad) role
const NAV_GROUPS = [
  {
    label: "Core",
    items: [
      { to: "/dashboard",  icon: LayoutDashboard, label: "Dashboard",     module: "dashboard",  roles: null },
      { to: "/risks",      icon: AlertTriangle,   label: "Risk Register", module: "risks",      roles: ["tenant_admin","ciso","risk_manager","compliance_manager","control_owner","viewer"] },
      { to: "/compliance", icon: CheckSquare,     label: "Compliance",    module: "compliance", roles: ["tenant_admin","ciso","risk_manager","compliance_manager","policy_manager","control_owner","viewer"] },
      { to: "/frameworks", icon: BookOpen,        label: "Frameworks",    module: "frameworks", roles: ["tenant_admin","ciso","compliance_manager","policy_manager","viewer"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/audits",           icon: ClipboardList,  label: "Audits",             module: "audits",           roles: ["tenant_admin","ciso","compliance_manager","viewer"] },
      { to: "/policies",         icon: FileText,       label: "Policies",           module: "policies",         roles: ["tenant_admin","ciso","compliance_manager","policy_manager","viewer"] },
      { to: "/policy-generator", icon: Wand2,          label: "Doc Generator",      module: "policy-generator", roles: ["tenant_admin","ciso","policy_manager","viewer"] },
      { to: "/vendors",          icon: Building2,      label: "3rd Parties (TPRM)", module: "vendors",          roles: ["tenant_admin","ciso","vendor_manager","viewer"] },
      { to: "/reports",          icon: ClipboardCheck, label: "Reports",            module: "reports",          roles: null },
    ],
  },
];

const AUDITOR_NAV = [
  { to: "/auditor/portal", icon: ClipboardCheck, label: "My Assignments" },
];

const PAGE_LABELS: Record<string, string> = {
  dashboard:  "Dashboard",
  risks:      "Risk Register",
  "risk-scenarios": "Risk Scenarios",
  "risk-quantification": "Risk Quantification",
  compliance: "Compliance",
  frameworks: "Frameworks",
  audits:     "Audits",
  policies:          "Policies",
  "policy-generator": "Doc Generator",
  vendors:           "3rd Parties",
  reports:    "Reports",
  incidents:  "Incidents",
  vulnerabilities: "Vulnerabilities",
  threats:    "Threat Library",
  "applied-controls": "Applied Controls",
  "security-exceptions": "Exceptions & Waivers",
  regulatory: "Regulatory Updates",
  "trust-center": "Trust Center",
  "activity-log": "Activity Log",
  webhooks:   "Webhooks",
  settings:   "Settings",
  help:       "Help & Support",
};

function roleIcon(role: string) {
  if (role === "super_admin") return { Icon: Crown,         color: "from-yellow-500 to-orange-500" };
  if (role === "ciso")       return { Icon: Crown,         color: "from-yellow-500 to-orange-500" };
  return                             { Icon: Shield,         color: "from-blue-500 to-blue-600"    };
}

function planBadgeStyle(plan: PlanTier) {
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
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Try to fetch real notifications; fall back to demo data on error
  const { data, isError } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list({ limit: 20 }),
    retry: false,
    refetchInterval: 30_000, // poll every 30s for new alerts
  });

  const notifications: AppNotification[] = isError || !data ? DEMO_NOTIFICATIONS : data.items;
  const unreadCount = isError || !data
    ? DEMO_NOTIFICATIONS.filter(n => n.status === "unread").length
    : data.unread_count;

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
        onClick={() => setOpen(v => !v)}
        className="relative w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-[calc(100vw-2rem)] sm:w-96 max-w-[24rem] bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
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
  const { t } = useTranslation();
  const segment  = location.pathname.split("/")[1] || "dashboard";
  const pageLabel = t(`nav.${segment}` as never, PAGE_LABELS[segment] ?? segment);
  const [appearance] = useAppearance();
  const sc = sidebarTextClasses(appearance.sidebarStyle);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showDemoToast, setShowDemoToast] = useState(false);

  // Sync plan from subscription API on mount (corrects stale localStorage sessions)
  useEffect(() => {
    if (!user) return;
    import("../../api/endpoints").then(({ subscriptionsApi }) => {
      subscriptionsApi.get().then((sub) => {
        const isTrialing = sub.status === "trialing";
        const newPlan = isTrialing ? "free_trial" : (sub.tier as import("../../store/auth").PlanTier);
        if (newPlan !== user.plan) {
          authSession.patchUser({ plan: newPlan, daysRemaining: isTrialing ? user.daysRemaining : undefined });
        }
      }).catch(() => {/* ignore — best effort */});
    });
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
  const plan        = user?.plan ?? "free_trial";
  const isAdmin     = user?.role === "tenant_admin";
  const isSuperAdmin = user?.role === "super_admin";
  const isUser      = user?.role !== "auditor" && user?.role !== "super_admin";

  const badge = (isSuperAdmin || isAdmin) ? planBadgeStyle("enterprise") : planBadgeStyle(plan);
  const { Icon: RoleIcon, color: roleColor } = roleIcon(user?.role ?? "viewer");
  const initials = (user?.name ?? "U").charAt(0).toUpperCase();
  // Role label: super_admin → "Admin", everyone else → their company name
  const planLabel = isSuperAdmin ? "Admin" : (user?.org ?? PLAN_FEATURES[plan].label);
  function resolvePlanSub() {
    if (isSuperAdmin) return "Platform Owner";
    if (isAdmin) return "Account Owner";
    if (plan === "free_trial") return `${user?.daysRemaining ?? 14} days remaining`;
    return PLAN_FEATURES[plan].label;
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
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 flex flex-col shadow-2xl flex-shrink-0 transition-all duration-300
        md:relative md:translate-x-0 md:z-auto
        ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}
        ${sidebarClasses(appearance.sidebarStyle)}
      `}>
        {/* Logo + mobile close */}
        <div className={`flex items-center justify-between px-4 py-4 border-b ${sc.divider}`}>
          <img src="/logo-vertical.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-16 w-auto object-contain" />
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
                  const locked = false; // reserved for subscription-based module gating
                  if (locked) {
                    return (
                      <button
                        key={to}
                        type="button"
                        onClick={() => navigate("/settings")}
                        title={`Upgrade to access ${label}`}
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
                          <span className="flex-1">{t(`nav.${module}` as never, label)}</span>
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
          {[
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
            onClick={() => { authSession.logout(); navigate("/login"); }}
            className={`flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium transition-all ${sc.logout}`}
          >
            <LogOut className="w-4 h-4" />
            {t("nav.sign_out")}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
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
            <div className="flex items-center gap-2.5 pl-3 border-l border-gray-100">
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
                  {isSuperAdmin ? "Platform Admin" : isAdmin ? `${user?.org} · Owner` : user?.role === "viewer" ? "Demo · Read-only" : user?.org ?? ""}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Demo mode banner for viewer role */}
        {user?.role === "viewer" && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm flex-shrink-0">
            <Eye className="w-4 h-4 flex-shrink-0 text-amber-600" />
            <span className="font-medium">Demo Mode</span>
            <span className="text-amber-700">— You are viewing read-only demo data. All create, edit, and delete actions are disabled.</span>
            <a href="/register" className="ml-auto flex-shrink-0 px-3 py-1 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors">
              Get full access
            </a>
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

      {/* Demo-block toast — appears when viewer tries to write */}
      {showDemoToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-2xl">
          <Eye className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span>Demo accounts are read-only.{" "}
            <a href="/register" className="underline text-amber-400 hover:text-white">Sign up</a>
            {" "}to use this feature.
          </span>
          <button type="button" onClick={() => setShowDemoToast(false)} className="ml-1 text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
