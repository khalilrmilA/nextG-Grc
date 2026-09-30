"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X, ChevronDown, BookOpen, FileText, Newspaper, HelpCircle, MessageSquare, History } from "lucide-react";
import LanguageSwitcher from "../LanguageSwitcher";
import { useI18n } from "../../i18n";

type SimpleLink = { kind: "link"; to: string; label: string };
type DropdownLink = {
  kind: "dropdown";
  label: string;
  items: { to: string; label: string; description: string; icon: React.ElementType }[];
};
type NavItem = SimpleLink | DropdownLink;

/**
 * Built per render from the active dictionary rather than declared as a module
 * constant. The labels used to be hardcoded English, so the site-wide nav — and
 * with it every dropdown description — stayed English on /fr and /ar. Combined
 * with the footer, that left 37% of the Arabic home page's words in Latin script
 * while its hreflang and <html lang> both claimed Arabic.
 */
function buildNavItems(t: (key: string) => string): NavItem[] {
  return [
    { kind: "link", to: "/how-it-works",     label: t("public.nav.how_it_works") },
    { kind: "link", to: "/features-landing", label: t("public.nav.features")     },
    { kind: "link", to: "/solutions",        label: t("public.nav.solutions")    },
    { kind: "link", to: "/frameworks",       label: t("public.nav.frameworks")   },
    {
      kind: "dropdown",
      label: t("public.nav.resources"),
      items: [
        { to: "/docs",      label: t("public.nav.docs"),            description: t("public.nav.docs_desc"),      icon: FileText  },
        { to: "/changelog", label: t("public.nav.changelog"),       description: t("public.nav.changelog_desc"), icon: History   },
        { to: "/blog",      label: t("public.nav.blog"),            description: t("public.nav.blog_desc"),      icon: BookOpen  },
        { to: "/news",      label: t("public.nav.regulatory_news"), description: t("public.nav.news_desc"),      icon: Newspaper },
      ],
    },
    {
      kind: "dropdown",
      label: t("public.nav.help"),
      items: [
        { to: "/faq",     label: t("public.nav.faq"),     description: t("public.nav.faq_desc"),     icon: HelpCircle    },
        { to: "/contact", label: t("public.nav.contact"), description: t("public.nav.contact_desc"), icon: MessageSquare },
      ],
    },
  ];
}

export default function PublicNav() {
  const [open, setOpen]       = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [mobileExpanded, setMobileExpanded] = useState<string | null>(null);
  const pathname = usePathname();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { t, lang } = useI18n();
  const NAV_ITEMS = buildNavItems(t);
  const withLocale = (path: string) => (path === "/login" || path === "/register" ? path : `/${lang}${path}`);

  useEffect(() => { setOpen(false); setActiveDropdown(null); }, [pathname]);

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

  // Close dropdown when clicking outside
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const isActive = (to: string) => !to.includes("#") && pathname === withLocale(to);
  const linkCls = (to: string) =>
    `px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
      isActive(to) ? "text-blue-600 bg-blue-50" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
    }`;

  return (
    <>
      <div className="h-16" aria-hidden />

      <header
        className={`fixed top-0 inset-x-0 z-50 bg-white/95 backdrop-blur-xl border-b border-gray-100 transition-all duration-300 ${
          scrolled ? "shadow-sm" : ""
        }`}
      >
        <div ref={dropdownRef} className="max-w-6xl mx-auto flex items-center justify-between px-5 sm:px-8 h-16">

          {/* Logo */}
          <Link href={withLocale("/")} className="flex items-center gap-2 flex-shrink-0">
            <img src="/logo-horizontal.png" alt="GRC Eye" className="h-9 sm:h-10 w-auto object-contain" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => {
              if (item.kind === "link") {
                return item.to.startsWith("/#") ? (
                  <a key={item.to} href={withLocale(item.to)} className={linkCls(item.to)}>{item.label}</a>
                ) : (
                  <Link key={item.to} href={withLocale(item.to)} className={linkCls(item.to)}>{item.label}</Link>
                );
              }

              // Dropdown
              const isOpen = activeDropdown === item.label;
              return (
                <div key={item.label} className="relative">
                  <button
                    onClick={() => setActiveDropdown(isOpen ? null : item.label)}
                    className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                      isOpen ? "text-blue-600 bg-blue-50" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    {item.label}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isOpen && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-white border border-gray-100 rounded-2xl shadow-xl shadow-gray-900/10 p-2 z-50">
                      {item.items.map(({ to, label, description, icon: Icon }) => (
                        <Link
                          key={to}
                          href={withLocale(to)}
                          onClick={() => setActiveDropdown(null)}
                          className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-blue-100 transition-colors">
                            <Icon className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{label}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden lg:flex items-center gap-2">
            <LanguageSwitcher compact />
            <Link
              href="/login"
              className="px-3.5 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors rounded-md hover:bg-gray-50"
            >
              {t("public.nav.sign_in")}
            </Link>
            <Link
              href="/register"
              className="group flex items-center gap-1.5 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-semibold pl-4 pr-3.5 py-2 rounded-lg transition-all shadow-sm hover:shadow-md hover:shadow-blue-500/25"
            >
              {t("public.nav.start_trial")}
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
              {t("public.nav.start_trial")}
            </Link>
            {/* /login and /register are proxy-rewritten straight to the Vite dashboard
                (see next.config.js rewrites) and intentionally never get a locale prefix. */}
            <button
              onClick={() => setOpen(true)}
              className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-700 transition-colors"
              aria-label={t("public.nav.open_menu")}
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Mobile drawer */}
      <div
        className={`fixed top-0 right-0 bottom-0 z-[70] w-80 max-w-[85vw] bg-white shadow-2xl transition-transform duration-300 lg:hidden flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <Link href={withLocale("/")} onClick={() => setOpen(false)}>
            <img src="/logo-horizontal.png" alt="GRC Eye" className="h-10 w-auto object-contain" />
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
            aria-label={t("public.nav.close_menu")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            if (item.kind === "link") {
              const cls = `flex items-center px-4 py-3 rounded-xl font-medium text-sm transition-colors ${
                isActive(item.to) ? "bg-blue-50 text-blue-600" : "text-gray-700 hover:bg-gray-50"
              }`;
              return item.to.startsWith("/#") ? (
                <a key={item.to} href={withLocale(item.to)} onClick={() => setOpen(false)} className={cls}>{item.label}</a>
              ) : (
                <Link key={item.to} href={withLocale(item.to)} onClick={() => setOpen(false)} className={cls}>{item.label}</Link>
              );
            }

            // Mobile accordion dropdown
            const expanded = mobileExpanded === item.label;
            return (
              <div key={item.label}>
                <button
                  onClick={() => setMobileExpanded(expanded ? null : item.label)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl font-medium text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {item.label}
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded && (
                  <div className="mx-2 mb-1 bg-gray-50 rounded-xl overflow-hidden">
                    {item.items.map(({ to, label, description, icon: Icon }) => (
                      <Link
                        key={to}
                        href={withLocale(to)}
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-gray-100 transition-colors border-b border-gray-100 last:border-0"
                      >
                        <Icon className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{label}</p>
                          <p className="text-xs text-gray-500">{description}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="px-4 py-5 border-t border-gray-100 space-y-2.5">
          <Link
            href="/register"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 w-full bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-4 py-3 rounded-xl transition-all shadow-sm text-sm"
          >
            Start free trial <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 w-full bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-semibold px-4 py-3 rounded-xl transition-colors text-sm"
          >
            {t("public.nav.sign_in")}
          </Link>
        </div>
      </div>
    </>
  );
}
