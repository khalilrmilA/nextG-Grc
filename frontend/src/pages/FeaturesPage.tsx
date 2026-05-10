import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, CheckCircle, AlertTriangle, ClipboardList, FileText, Building2, BarChart2, BookOpen, Zap } from "lucide-react";
import PublicNav from "../components/landing/PublicNav";
import PublicFooter from "../components/landing/PublicFooter";

const FEATURES = [
  { icon: AlertTriangle, key: "risk" },
  { icon: CheckCircle,   key: "compliance" },
  { icon: ClipboardList, key: "audit" },
  { icon: FileText,      key: "policy" },
  { icon: Building2,     key: "vendor" },
  { icon: BarChart2,     key: "reporting" },
  { icon: BookOpen,      key: "library" },
  { icon: Zap,           key: "ai" },
] as const;

export default function FeaturesPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav links={[
        { to: "/",                 label: t("public.nav.home") },
        { to: "/features-landing", label: t("public.nav.features"), activeOn: "/features" },
        { to: "/solutions",        label: t("public.nav.solutions") },
        { to: "/customers",        label: t("public.nav.customers") },
      ]} />

      {/* ── Features ── */}
      <section className="pt-32 pb-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight mb-6">
              {t("public.landing.features_title")}
            </h1>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">{t("public.landing.features_subtitle")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map(({ icon: Icon, key }) => (
              <div key={key} className="bg-gray-50 rounded-2xl p-6 hover:bg-blue-50 hover:border-blue-100 border border-transparent transition-all group">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm mb-4 group-hover:bg-blue-600 transition-colors">
                  <Icon className="w-5 h-5 text-blue-600 group-hover:text-white transition-colors" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1.5">{t(`public.landing.feat_${key}`)}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{t(`public.landing.feat_${key}_desc`)}</p>
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
