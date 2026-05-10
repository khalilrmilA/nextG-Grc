"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import LanguageSwitcher from "../LanguageSwitcher";

type NavLink = { to: string; label: string };

const NAV_LINKS: NavLink[] = [
  { to: "/#how-it-works", label: "How it works" },
  { to: "/features-landing", label: "Features" },
  { to: "/solutions",        label: "Solutions" },
  { to: "/#frameworks",      label: "Frameworks" },
  { to: "/blog",             label: "Blog" },
  { to: "/faq",              label: "FAQ" },
  { to: "/contact",          label: "Contact" },
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

  const isActive = (to: string) => !to.includes("#") && pathname === to;

  function NavItem({ link, mobile = false }: { link: NavLink; mobile?: boolean }) {
    const active = isActive(link.to);
    const isHash = link.to.startsWith("/#");
    const baseDesktop = `px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
      active ? "text-blue-600 bg-blue-50" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
    }`;
    const baseMobile = `flex items-center px-4 py-3 rounded-xl font-medium text-sm transition-colors ${
      active ? "bg-blue-50 text-blue-600" : "text-gray-700 hover:bg-gray-50"
    }`;
    const cls = mobile ? baseMobile : baseDesktop;

    return isHash ? (
      <a href={link.to} onClick={() => setOpen(false)} className={cls}>{link.label}</a>
    ) : (
      <Link href={link.to} onClick={() => setOpen(false)} className={cls}>{link.label}</Link>
    );
  }

  return (
    <>
      <div className="h-16" aria-hidden />

      <header
        className={`fixed top-0 inset-x-0 z-50 bg-white/95 backdrop-blur-xl border-b border-gray-100 transition-all duration-300 ${
          scrolled ? "shadow-sm" : ""
        }`}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between px-5 sm:px-8 h-16">
          {/* Logo */}
          <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2 flex-shrink-0">
            <img src="/logo-horizontal.png" alt="GRCEye — Governance, Risk & Compliance Platform" className="h-9 sm:h-10 w-auto object-contain" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-0.5">
            {NAV_LINKS.map(l => <NavItem key={l.to} link={l} />)}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden lg:flex items-center gap-2">
            <LanguageSwitcher compact />
            <Link
              href="/login"
              className="px-3.5 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors rounded-md hover:bg-gray-50"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="group flex items-center gap-1.5 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-semibold pl-4 pr-3.5 py-2 rounded-lg transition-all shadow-sm hover:shadow-md hover:shadow-blue-500/25"
            >
              Start free trial
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Mobile controls */}
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
              className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-700 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile overlay */}
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
            <img src="/logo-horizontal.png" alt="GRCEye" className="h-10 w-auto object-contain" />
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
          {NAV_LINKS.map(l => <NavItem key={l.to} link={l} mobile />)}
        </nav>

        <div className="px-4 py-5 border-t border-gray-100 space-y-2.5">
          <Link
            href="/register"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 w-full bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-4 py-3 rounded-xl transition-all shadow-sm text-sm"
          >
            Start free trial
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 w-full bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-semibold px-4 py-3 rounded-xl transition-colors text-sm"
          >
            Sign in
          </Link>
        </div>
      </div>
    </>
  );
}
