"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import LanguageSwitcher from "../LanguageSwitcher";

type NavLink = { to: string; label: string; hash?: boolean };

const NAV_LINKS: NavLink[] = [
  { to: "#how-it-works", label: "How it works", hash: true },
  { to: "/features-landing", label: "Features" },
  { to: "/solutions",        label: "Solutions" },
  { to: "#frameworks",       label: "Frameworks", hash: true },
  { to: "/faq",              label: "FAQ" },
];

export default function PublicNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 8); }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (to: string) => pathname === to;

  return (
    <>
      {/* Top spacing so content doesn't hide behind the floating nav */}
      <div className="h-20" aria-hidden />

      <header
        className={`fixed top-3 sm:top-4 inset-x-0 z-50 px-3 sm:px-6 transition-all duration-300 ${
          scrolled ? "scale-[0.99]" : ""
        }`}
      >
        <div
          className={`max-w-6xl mx-auto bg-white/90 backdrop-blur-xl border border-gray-200/70 rounded-2xl flex items-center justify-between px-3 sm:px-5 h-14 transition-all duration-300 ${
            scrolled ? "shadow-lg shadow-blue-900/5" : "shadow-md shadow-blue-900/[0.03]"
          }`}
        >
          {/* Logo */}
          <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2 flex-shrink-0">
            <img src="/logo-horizontal.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-9 sm:h-10 w-auto object-contain" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map(l =>
              l.hash ? (
                <a
                  key={l.to}
                  href={l.to}
                  className="relative px-3.5 py-2 text-sm font-medium rounded-lg transition-all text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.to}
                  href={l.to}
                  className={`relative px-3.5 py-2 text-sm font-medium rounded-lg transition-all ${
                    isActive(l.to)
                      ? "text-blue-700 bg-blue-50"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  {l.label}
                </Link>
              )
            )}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden lg:flex items-center gap-1.5">
            <LanguageSwitcher compact />
            <Link
              href="/login"
              className="px-3.5 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors rounded-lg hover:bg-gray-50"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="group flex items-center gap-1.5 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-semibold pl-4 pr-3.5 py-2 rounded-lg transition-all shadow-sm hover:shadow-md hover:shadow-blue-500/30"
            >
              Start free trial
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Mobile (hamburger) */}
          <div className="flex lg:hidden items-center gap-2">
            <LanguageSwitcher compact />
            <Link
              href="/register"
              className="hidden sm:inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm"
            >
              Start trial
            </Link>
            <button
              onClick={() => setOpen(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        className={`fixed top-0 right-0 bottom-0 z-[70] w-80 max-w-[85vw] bg-white shadow-2xl transition-transform duration-300 lg:hidden flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <Link href="/" onClick={() => setOpen(false)}>
            <img src="/logo-horizontal.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-10 w-auto object-contain" />
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_LINKS.map(l =>
            l.hash ? (
              <a
                key={l.to}
                href={l.to}
                onClick={() => setOpen(false)}
                className="flex items-center px-4 py-3 rounded-xl font-medium text-sm transition-colors text-gray-700 hover:bg-gray-50"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.to}
                href={l.to}
                onClick={() => setOpen(false)}
                className={`flex items-center px-4 py-3 rounded-xl font-medium text-sm transition-colors ${
                  isActive(l.to)
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {l.label}
              </Link>
            )
          )}
        </nav>

        <div className="px-4 py-5 border-t border-gray-100 space-y-2.5">
          <Link
            href="/register"
            className="flex items-center justify-center gap-2 w-full bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-4 py-3 rounded-xl transition-all shadow-sm text-sm"
            onClick={() => setOpen(false)}
          >
            Start free trial
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 w-full bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-semibold px-4 py-3 rounded-xl transition-colors text-sm"
            onClick={() => setOpen(false)}
          >
            Sign in
          </Link>
        </div>
      </div>
    </>
  );
}
