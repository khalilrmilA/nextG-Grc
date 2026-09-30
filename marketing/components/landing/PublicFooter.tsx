"use client";
import Link from "next/link";
import { useI18n } from "../../i18n";

export default function PublicFooter() {
  const { t, lang } = useI18n();
  const to = (path: string) => `/${lang}${path}`;
  return (
    <footer className="bg-slate-950 text-slate-400 py-16 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
          <div className="md:col-span-2">
            <img src="/logowhite.png" alt="GRC Eye" className="h-10 w-auto object-contain mb-4" />
            <p className="text-sm text-slate-500 leading-relaxed max-w-sm">
              {t("public.footer.tagline")}
            </p>
            <div className="flex gap-3 mt-5">
              {[
                { label: t("public.footer.badge_iso"),          color: "bg-blue-500/10 text-blue-400 border-blue-500/20"      },
                { label: t("public.footer.badge_local_ai"),    color: "bg-green-500/10 text-green-400 border-green-500/20"   },
                { label: t("public.footer.badge_zero_egress"), color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
              ].map(b => (
                <span key={b.label} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${b.color}`}>{b.label}</span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-4">{t("public.footer.platform")}</p>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: t("public.nav.features"),  to: "/features-landing" },
                { label: t("public.nav.solutions"), to: "/solutions"         },
                { label: t("public.nav.faq"),       to: "/faq"               },
                { label: t("public.nav.blog"),      to: "/blog"              },
                { label: t("public.nav.news"),      to: "/news"              },
              ].map(l => (
                <li key={l.label}>
                  <Link href={to(l.to)} className="hover:text-white transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-4">{t("public.footer.company")}</p>
            <ul className="space-y-2.5 text-sm">
              <li><Link href={to("/about")} className="hover:text-white transition-colors">{t("public.footer.about")}</Link></li>
              <li><Link href={to("/privacy")} className="hover:text-white transition-colors">{t("public.footer.privacy")}</Link></li>
              <li><Link href={to("/terms")} className="hover:text-white transition-colors">{t("public.footer.terms")}</Link></li>
              <li><Link href={to("/security")} className="hover:text-white transition-colors">{t("public.footer.security")}</Link></li>
              <li><Link href={to("/contact")} className="hover:text-white transition-colors">{t("public.footer.contact")}</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <p>{t("public.footer.copyright").replace("{{year}}", String(new Date().getFullYear()))}</p>
          <p>
            {t("public.footer.powered_by")}{" "}
            <a
              href="https://silentwolf.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-500 hover:text-slate-300 transition-colors"
            >
              SilentWolf
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
