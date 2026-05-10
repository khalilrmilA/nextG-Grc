import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Star } from "lucide-react";
import PublicNav from "../components/landing/PublicNav";
import PublicFooter from "../components/landing/PublicFooter";

const TESTIMONIALS = [
  { key: "story1", rating: 5 },
  { key: "story2", rating: 5 },
  { key: "story3", rating: 5 },
] as const;

export default function CustomersPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav links={[
        { to: "/",                 label: t("public.nav.home") },
        { to: "/features-landing", label: t("public.nav.features") },
        { to: "/solutions",        label: t("public.nav.solutions") },
        { to: "/customers",        label: t("public.nav.customers"), activeOn: "/customers" },
      ]} />

      {/* ── Testimonials ── */}
      <section className="pt-32 pb-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6">{t("public.landing.stories_title")}</h1>
            <p className="text-xl text-gray-500">{t("public.landing.stories_subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((story) => (
              <div key={story.key} className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: story.rating }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <p className="text-gray-700 text-sm leading-relaxed mb-5 italic">"{t(`public.landing.${story.key}_quote`)}"</p>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{t(`public.landing.${story.key}_name`)}</p>
                  <p className="text-xs text-gray-500">{t(`public.landing.${story.key}_role`)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-extrabold mb-4">{t("public.landing.cta_title")}</h2>
          <p className="text-blue-100 mb-8 text-lg">{t("public.landing.cta_subtitle")}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="flex items-center justify-center gap-2 bg-white text-blue-600 font-semibold px-8 py-3.5 rounded-2xl hover:bg-blue-50 transition-colors shadow-md text-base">
              {t("public.landing.cta_trial_btn")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
            <a href="mailto:sales@grceye.com" className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-semibold px-8 py-3.5 rounded-2xl hover:bg-white/20 transition-colors text-base">
              {t("public.landing.cta_sales_btn")}
            </a>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
