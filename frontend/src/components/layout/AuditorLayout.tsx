import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuthStore, authSession } from "../../store/auth";
import {
  ClipboardCheck, Settings, HelpCircle,
  LogOut, Bell, ChevronRight,
} from "lucide-react";
import LanguageSwitcher from "../LanguageSwitcher";
import { useTranslation } from "react-i18next";

export default function AuditorLayout() {
  // The three auditor pages are fully translated; this chrome around them was not,
  // so a Tunisian bank's auditor saw an English sidebar on a French screen.
  const { t } = useTranslation();
  const user = useAuthStore(u => u);
  const navigate = useNavigate();
  const initials = (user?.name ?? "A").charAt(0).toUpperCase();

  const NAV = [
    { to: "/auditor/portal",   icon: ClipboardCheck, label: t("auditor_portal.my_assignments") },
    { to: "/auditor/settings", icon: Settings,       label: t("settings.title")               },
    { to: "/auditor/help",     icon: HelpCircle,     label: t("help.title")                   },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col bg-slate-900 shadow-2xl flex-shrink-0">

        {/* Logo */}
        <div className="flex flex-col items-center px-4 py-4 border-b border-slate-700/60">
          <img src="/logo-vertical.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-24 w-auto object-contain bg-white/95 rounded-xl p-2" />
        </div>

        {/* Company badge */}
        <div className="mx-4 mt-3 px-3 py-2.5 bg-gradient-to-r from-purple-500/10 to-violet-500/10 border border-purple-500/20 rounded-xl">
          <p className="text-xs font-semibold text-purple-300">{user?.org ?? t("auditor_portal.your_company")}</p>
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
            {t("nav.sign_out")}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-8 py-3.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>{t("auditor_portal.platform")}</span>
            <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            <span className="text-gray-900 font-semibold">{t("auditor_portal.title")}</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button type="button" className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
              <Bell className="w-4 h-4" />
            </button>
            {/* Avatar */}
            <div className="flex items-center gap-2.5 pl-3 rtl:pl-0 rtl:pr-3 border-l rtl:border-l-0 rtl:border-r border-gray-100">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white shadow-sm">
                <span className="text-sm font-bold">{initials}</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-semibold text-gray-800 leading-none">{user?.name ?? t("roles.auditor")}</p>
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
