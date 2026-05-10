import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Lock, Award, Users } from "lucide-react";
import PublicNav from "../components/landing/PublicNav";
import PublicFooter from "../components/landing/PublicFooter";

const FRAMEWORKS = [
  "ISO 27001:2022", "SOC 2 Type II", "GDPR", "PCI DSS 4.0",
  "HIPAA", "NIST CSF 2.0", "NIST 800-53 Rev5", "CIS Controls v8",
  "NIS2 Directive", "DORA", "ISO 42001", "NIST AI RMF",
];

export default function PublicFrameworksPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav links={[
        { to: "/",                 label: t("public.nav.home") },
        { to: "/features-landing", label: t("public.nav.features") },
        { to: "/solutions",        label: t("public.nav.solutions") },
        { to: "/customers",        label: t("public.nav.customers") },
      ]} />

      {/* ── Frameworks ── */}
      <section className="pt-32 pb-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6">{t("public.landing.framework_title")}</h1>
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto">{t("public.landing.fw_subtitle")}</p>
          <div className="flex flex-wrap justify-center gap-3 mb-16">
            {FRAMEWORKS.map(fw => (
              <span key={fw} className="bg-gray-100 border border-gray-300 text-gray-900 text-sm font-medium px-4 py-2 rounded-xl">
                {fw}
              </span>
            ))}
            <span className="bg-blue-600/20 border border-blue-500/30 text-blue-700 text-sm font-medium px-4 py-2 rounded-xl">
              {t("public.landing.more_frameworks")}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {[
              { icon: Lock,  label: t("public.landing.iso_certified_controls"),  value: "ISO 27001 · ISO 27002 · ISO 42001" },
              { icon: Award, label: t("public.landing.regulatory_frameworks"),    value: "GDPR · HIPAA · PCI DSS · DORA" },
              { icon: Users, label: t("public.landing.industry_standards"),       value: "SOC 2 · CIS · NIST · CSA CCM" },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-2xl p-6 text-left rtl:text-right border border-gray-200">
                <s.icon className="w-5 h-5 text-blue-600 mb-3" />
                <p className="text-xs text-gray-600 mb-2">{s.label}</p>
                <p className="text-sm font-semibold text-gray-900">{s.value}</p>
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
