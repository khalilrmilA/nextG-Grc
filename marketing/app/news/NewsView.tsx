"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import { ArrowRight, Zap, Calendar } from "lucide-react";
import PublicNav from "@/components/landing/PublicNav";
import { useI18n } from "@/i18n";

const NEWS_ITEMS = [
  { id: 1, key: "n1", date: "2026-03-18", category: "Regulation",       categoryKey: "cat_regulation",       type: "update" },
  { id: 2, key: "n2", date: "2026-03-12", category: "Framework Update", categoryKey: "cat_framework_update", type: "important" },
  { id: 3, key: "n3", date: "2026-03-08", category: "Enforcement",      categoryKey: "cat_enforcement",      type: "alert" },
  { id: 4, key: "n4", date: "2026-03-01", category: "Compliance",       categoryKey: "cat_compliance",       type: "update" },
  { id: 5, key: "n5", date: "2026-02-24", category: "Framework Update", categoryKey: "cat_framework_update", type: "important" },
  { id: 6, key: "n6", date: "2026-02-18", category: "Regulation",       categoryKey: "cat_regulation",       type: "important" },
  { id: 7, key: "n7", date: "2026-02-10", category: "Guidance",         categoryKey: "cat_guidance",         type: "update" },
  { id: 8, key: "n8", date: "2026-02-03", category: "Framework Update", categoryKey: "cat_framework_update", type: "important" },
] as const;

export default function NewsView() {
  const { t, lang } = useI18n();
  const dateLocale = lang === "fr" ? "fr-FR" : lang === "ar" ? "ar" : "en-US";
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      <section className="pt-16 pb-16 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            {t("public.news.hero_title")}
          </h1>
          <p className="text-xl text-gray-500">
            {t("public.news.hero_subtitle")}
          </p>
        </div>
      </section>

      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {NEWS_ITEMS.map((item) => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-2xl p-8 hover:shadow-lg hover:border-blue-200 transition-all group cursor-pointer">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    item.type === 'alert' ? 'bg-red-500' :
                    item.type === 'important' ? 'bg-amber-500' :
                    'bg-blue-500'
                  }`} />
                  <span className={`inline-block text-xs font-bold px-3 py-1 rounded-full ${
                    item.category === 'Regulation' ? 'bg-red-50 text-red-700' :
                    item.category === 'Enforcement' ? 'bg-orange-50 text-orange-700' :
                    item.category === 'Framework Update' ? 'bg-purple-50 text-purple-700' :
                    'bg-blue-50 text-blue-700'
                  }`}>
                    {t(`public.news.${item.categoryKey}`)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Calendar className="w-4 h-4" />
                  <span>{new Date(item.date).toLocaleDateString(dateLocale)}</span>
                </div>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-600 transition-colors line-clamp-2">
                {t(`public.news.${item.key}_title`)}
              </h3>
              <p className="text-gray-600 mb-4">{t(`public.news.${item.key}_excerpt`)}</p>
              <div className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm group-hover:gap-3 transition-all">
                {t("public.news.read_more")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 py-24 bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="max-w-2xl mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-semibold text-blue-600">{t("public.blog.newsletter_title")}</span>
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">{t("public.blog.newsletter_title")}</h2>
          <p className="text-gray-600 mb-8">{t("public.blog.newsletter_subtitle")}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              placeholder={t("public.blog.email_placeholder")}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors whitespace-nowrap">
              {t("public.blog.subscribe")}
            </button>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
