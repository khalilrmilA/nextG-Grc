"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";

interface NavLink {
  to: string;
  label: string;
  hash?: boolean;
  activeOn?: string;
}

interface PublicNavProps {
  links: NavLink[];
}

export default function PublicNav({ links }: PublicNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-50 bg-[#f0f9ff]/90 backdrop-blur border-b border-sky-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" onClick={() => setOpen(false)}>
            <img src="/logo.png" alt="GRCEye" className="h-12 sm:h-14 w-auto object-contain" />
          </Link>

          <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm text-gray-500">
            {links.map(l =>
              l.hash ? (
                <a key={l.label} href={l.to} className="hover:text-blue-600 transition-colors">{l.label}</a>
              ) : (
                <Link
                  key={l.label}
                  href={l.to}
                  className={`transition-colors ${pathname === (l.activeOn ?? l.to) ? "text-blue-600 font-semibold" : "hover:text-blue-600"}`}
                >
                  {l.label}
                </Link>
              )
            )}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Sign in</Link>
            <Link href="/register" className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-sm hover:-translate-y-0.5 hover:shadow-md">
              Start free trial <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="flex md:hidden items-center gap-2">
            <Link href="/login" className="text-sm text-gray-600 font-medium px-3 py-1.5">Sign in</Link>
            <button
              onClick={() => setOpen(true)}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-sky-200 text-gray-700 shadow-sm"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className={`fixed top-0 left-0 bottom-0 z-[70] w-72 bg-white shadow-2xl transition-transform duration-300 md:hidden flex flex-col ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <img src="/logo.png" alt="GRCEye" className="h-12 w-auto object-contain" />
          <button
            onClick={() => setOpen(false)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 text-gray-600"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
                href={l.to}
                className={`flex items-center px-4 py-3 rounded-xl font-medium text-sm transition-colors ${
                  pathname === (l.activeOn ?? l.to)
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                }`}
              >
                {l.label}
              </Link>
            )
          )}
        </nav>

        <div className="px-4 py-5 border-t border-gray-100 space-y-3">
          <Link
            href="/register"
            className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors shadow-sm text-sm"
            onClick={() => setOpen(false)}
          >
            Start free trial <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 w-full bg-gray-50 border border-gray-200 text-gray-700 font-semibold px-4 py-3 rounded-xl transition-colors text-sm"
            onClick={() => setOpen(false)}
          >
            Sign in
          </Link>
        </div>
      </div>
    </>
  );
}
