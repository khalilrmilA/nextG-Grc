import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore, authSession } from "../../store/auth";
import {
  Shield, ClipboardCheck, Settings, HelpCircle,
  LogOut, Bell, ChevronRight,
} from "lucide-react";
import LanguageSwitcher from "../LanguageSwitcher";

export default function AuditorLayout() {
  const user     = useAuthStore(u => u);
  const navigate = useNavigate();
  const initials = (user?.name ?? "A").charAt(0).toUpperCase();

  const NAV = [
    { to: "/auditor/portal",   icon: ClipboardCheck, label: "My Assignments" },
    { to: "/auditor/settings", icon: Settings,       label: "Settings"       },
    { to: "/auditor/help",     icon: HelpCircle,     label: "Help"           },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col bg-slate-900 shadow-2xl flex-shrink-0">

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/60">
          <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-purple-700 rounded-xl flex items-center justify-center shadow-lg">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm text-white leading-none">GRC Platform</p>
            <p className="text-xs text-slate-400 mt-0.5">Auditor Portal</p>
          </div>
        </div>

        {/* Company badge */}
        <div className="mx-4 mt-3 px-3 py-2.5 bg-gradient-to-r from-purple-500/10 to-violet-500/10 border border-purple-500/20 rounded-xl">
          <p className="text-xs font-semibold text-purple-300">{user?.org ?? "Your Company"}</p>
          <p className="text-xs text-purple-400/70 mt-0.5">Auditor</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/auditor/portal"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-600/20"
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
        </nav>

        {/* Sign out */}
        <div className="px-3 pb-4 pt-3 border-t border-slate-700/60">
          <button
            type="button"
            onClick={() => { authSession.logout(); navigate("/login"); }}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-8 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>GRC Platform</span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            <span className="text-gray-900 font-semibold">Auditor Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button type="button" className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <Bell className="w-4 h-4" />
            </button>
            {/* Avatar */}
            <div className="flex items-center gap-2.5 pl-3 border-l border-gray-100">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white shadow-sm">
                <span className="text-sm font-bold">{initials}</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-semibold text-gray-800 leading-none">{user?.name ?? "Auditor"}</p>
                <p className="text-xs text-gray-400 mt-0.5">{user?.org} · Auditor</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
