import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/auth";
import AIAssistant from "../ai/AIAssistant";
import {
  LayoutDashboard, AlertTriangle, CheckSquare, BookOpen,
  ClipboardList, FileText, Building2, LogOut, Shield,
  ChevronRight, Bell, Settings, HelpCircle, Zap,
} from "lucide-react";

const NAV_GROUPS = [
  {
    label: "Core",
    items: [
      { to: "/dashboard",  icon: LayoutDashboard, label: "Dashboard"     },
      { to: "/risks",      icon: AlertTriangle,   label: "Risk Register" },
      { to: "/compliance", icon: CheckSquare,     label: "Compliance"    },
      { to: "/frameworks", icon: BookOpen,        label: "Frameworks"    },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/audits",   icon: ClipboardList, label: "Audits"          },
      { to: "/policies", icon: FileText,      label: "Policies"        },
      { to: "/vendors",  icon: Building2,     label: "Vendors (TPRM)"  },
    ],
  },
];

const PAGE_LABELS: Record<string, string> = {
  dashboard:  "Dashboard",
  risks:      "Risk Register",
  compliance: "Compliance",
  frameworks: "Frameworks",
  audits:     "Audits",
  policies:   "Policies",
  vendors:    "Vendors",
};

export default function Layout() {
  const logout   = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const segment  = location.pathname.split("/")[1] || "dashboard";
  const pageLabel = PAGE_LABELS[segment] ?? segment;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* ── Sidebar ── */}
      <aside className="w-64 bg-slate-900 flex flex-col shadow-2xl flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/60">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-none tracking-tight">GRC Platform</p>
            <p className="text-slate-400 text-xs mt-0.5">Security & Compliance</p>
          </div>
        </div>

        {/* Trial badge */}
        <div className="mx-4 mt-3 px-3 py-2.5 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-500/20 rounded-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-400 text-xs font-semibold">Starter Trial</p>
              <p className="text-slate-400 text-xs mt-0.5">14 days remaining</p>
            </div>
            <Zap className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full" style={{ width: "53%" }} />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest px-3 mb-2">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        isActive
                          ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                          : "text-slate-400 hover:bg-slate-800 hover:text-white"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-white" : "text-slate-400"}`} />
                        <span className="flex-1">{label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="px-3 pb-4 pt-3 border-t border-slate-700/60 space-y-0.5">
          <button className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-all">
            <Settings className="w-4 h-4" />
            Settings
          </button>
          <button className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-all">
            <HelpCircle className="w-4 h-4" />
            Help & Support
          </button>
          <button
            onClick={() => { logout(); navigate("/login"); }}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-8 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">GRC Platform</span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            <span className="text-gray-900 font-semibold">{pageLabel}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Notification bell */}
            <button className="relative w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
            </button>
            {/* Avatar */}
            <div className="flex items-center gap-2.5 pl-3 border-l border-gray-100">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-sm font-bold shadow-sm">
                A
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-semibold text-gray-800 leading-none">Admin</p>
                <p className="text-xs text-gray-400 mt-0.5">Acme Corp</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>

      {/* AI Assistant floating button */}
      <AIAssistant />
    </div>
  );
}
