/**
 * Shared responsive navigation bar used on all public/landing pages.
 * On mobile: shows a hamburger that opens a full-screen drawer.
 */
import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Menu, X } from "lucide-react";
import LanguageSwitcher from "../LanguageSwitcher";

interface NavLink {
  to: string;
  label: string;
  hash?: boolean; // true if it's an anchor on the page (href, not Link)
  activeOn?: string; // path that makes this item "active"
}

interface PublicNavProps {
  links: NavLink[];
}

export default function PublicNav({ links }: PublicNavProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close drawer on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-50 bg-[#f0f9ff]/90 backdrop-blur border-b border-sky-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" onClick={() => setOpen(false)}>
            <img src="/logo-horizontal.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-10 sm:h-12 w-auto object-contain" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm text-gray-500">
            {links.map(l =>
              l.hash ? (
                <a key={l.label} href={l.to} className="hover:text-blue-600 transition-colors">{l.label}</a>
              ) : (
                <Link
                  key={l.label}
                  to={l.to}
                  className={`transition-colors ${location.pathname === (l.activeOn ?? l.to) ? "text-blue-600 font-semibold" : "hover:text-blue-600"}`}
                >
                  {l.label}
                </Link>
              )
            )}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            <LanguageSwitcher compact />
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">{t("public.nav.sign_in")}</Link>
            <Link to="/register" className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-sm hover:-translate-y-0.5 hover:shadow-md">
              {t("public.nav.start_trial")} <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
            </Link>
          </div>

          {/* Mobile: Lang + Sign in + Hamburger */}
          <div className="flex md:hidden items-center gap-1">
            <LanguageSwitcher compact />
            <Link to="/login" className="text-sm text-gray-600 font-medium px-2 py-1.5">{t("public.nav.sign_in")}</Link>
            <button
              onClick={() => setOpen(true)}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-sky-200 text-gray-700 shadow-sm"
              aria-label={t("public.nav.open_menu")}
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div className={`fixed top-0 left-0 bottom-0 z-[70] w-72 bg-white shadow-2xl transition-transform duration-300 md:hidden flex flex-col ${open ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <img src="/logo-horizontal.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-10 w-auto object-contain" />
          <button
            onClick={() => setOpen(false)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 text-gray-600"
            aria-label={t("public.nav.close_menu")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer links */}
        <nav className="flex-1 px-4 py-5 space-y-1 overflow-y-auto">
          {links.map(l =>
            l.hash ? (
              <a
                key={l.label}
                href={l.to}
                onClick={() => setOpen(false)}
                className="flex items-center px-4 py-3 rounded-xl text-gray-700 hover:bg-blue-50 hover:text-blue-700 font-medium text-sm transition-colors"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.label}
                to={l.to}
                className={`flex items-center px-4 py-3 rounded-xl font-medium text-sm transition-colors ${
                  location.pathname === (l.activeOn ?? l.to)
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                }`}
              >
                {l.label}
              </Link>
            )
          )}
        </nav>

        {/* Drawer CTA */}
        <div className="px-4 py-5 border-t border-gray-100 space-y-3">
          <Link
            to="/register"
            className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors shadow-sm text-sm"
            onClick={() => setOpen(false)}
          >
            {t("public.nav.start_trial")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
          </Link>
          <Link
            to="/login"
            className="flex items-center justify-center gap-2 w-full bg-gray-50 border border-gray-200 text-gray-700 font-semibold px-4 py-3 rounded-xl transition-colors text-sm"
            onClick={() => setOpen(false)}
          >
            {t("public.nav.sign_in")}
          </Link>
        </div>
      </div>
    </>
  );
}
