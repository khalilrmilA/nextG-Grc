"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import PublicNav from "@/components/landing/PublicNav";
import { useI18n } from "@/i18n";
import { CHANGELOG_ENTRIES, type ChangelogTheme } from "./entries";
import { ArrowRight, Rocket } from "lucide-react";

const THEME_STYLES: Record<ChangelogTheme, { pill: string; dot: string }> = {
  platform:    { pill: "bg-slate-50 text-slate-700",   dot: "bg-slate-400" },
  ai:          { pill: "bg-purple-50 text-purple-700", dot: "bg-purple-500" },
  compliance:  { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  tprm:        { pill: "bg-teal-50 text-teal-700",     dot: "bg-teal-500" },
  security:    { pill: "bg-rose-50 text-rose-700",     dot: "bg-rose-500" },
  risk:        { pill: "bg-blue-50 text-blue-700",     dot: "bg-blue-500" },
  governance:  { pill: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-500" },
  enterprise:  { pill: "bg-amber-50 text-amber-700",   dot: "bg-amber-500" },
};

export default function ChangelogView() {
  const { t, lang } = useI18n();
  const dateLocale = lang === "fr" ? "fr-FR" : lang === "ar" ? "ar" : "en-US";

  // Newest first; grouped by month so the page reads as a timeline, not a flat list.
  const newestFirst = [...CHANGELOG_ENTRIES].reverse();
  const groups: { monthKey: string; items: typeof newestFirst }[] = [];
  for (const entry of newestFirst) {
    const monthKey = entry.date.slice(0, 7); // "2026-09"
    const group = groups[groups.length - 1];
    if (group && group.monthKey === monthKey) group.items.push(entry);
    else groups.push({ monthKey, items: [entry] });
  }

  const firstDate = CHANGELOG_ENTRIES[0]?.date;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      <section className="pt-16 pb-16 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-semibold">
            <Rocket className="w-4 h-4" />
            {t("public.changelog.badge", { count: CHANGELOG_ENTRIES.length })}
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            {t("public.changelog.hero_title")}
          </h1>
          <p className="text-xl text-gray-500">
            {t("public.changelog.hero_subtitle")}
          </p>
        </div>
      </section>

      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="relative ps-9 mb-10">
            <span className="absolute -start-[2.35rem] top-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 ring-4 ring-white" />
            </span>
            <p className="text-sm font-bold text-emerald-700">{t("public.changelog.today")}</p>
            <p className="text-sm text-gray-500">{t("public.changelog.today_desc")}</p>
          </div>

          {groups.map((group) => {
            const [y, m] = group.monthKey.split("-").map(Number);
            const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(dateLocale, {
              month: "long", year: "numeric", timeZone: "UTC",
            });
            return (
              <div key={group.monthKey} className="mb-14">
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-6 ps-9">
                  {monthLabel}
                </h2>
                <div className="relative ps-9 space-y-8 border-s-2 border-gray-100">
                  {group.items.map((item) => {
                    const style = THEME_STYLES[item.theme];
                    return (
                      <div key={item.id} className="relative">
                        <span className={`absolute -start-[2.35rem] top-1.5 w-3.5 h-3.5 rounded-full ring-4 ring-white ${style.dot}`} />
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <time className="text-sm text-gray-400" dateTime={item.date}>
                            {new Date(item.date).toLocaleDateString(dateLocale, { day: "numeric", month: "short", timeZone: "UTC" })}
                          </time>
                          <span className={`inline-block text-xs font-bold px-2.5 py-0.5 rounded-full ${style.pill}`}>
                            {t(`public.changelog.theme_${item.theme}`)}
                          </span>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1.5">
                          {t(`public.changelog.${item.key}_title`)}
                        </h3>
                        <p className="text-gray-600 leading-relaxed">
                          {t(`public.changelog.${item.key}_desc`)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {firstDate && (
            <p className="text-center text-sm text-gray-400 pt-4 border-t border-gray-100">
              {t("public.changelog.since", {
                date: new Date(firstDate).toLocaleDateString(dateLocale, { month: "long", year: "numeric", timeZone: "UTC" }),
              })}
            </p>
          )}
        </div>
      </section>

      <section className="px-6 py-24 bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">{t("public.changelog.cta_title")}</h2>
          <p className="text-gray-600 mb-8">{t("public.changelog.cta_subtitle")}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="/register"
              className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              {t("public.changelog.cta_trial")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </a>
            <a
              href="/docs"
              className="inline-flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-700 font-semibold px-6 py-3 rounded-lg border border-gray-200 transition-colors"
            >
              {t("public.changelog.cta_docs")}
            </a>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
