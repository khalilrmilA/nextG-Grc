import PublicFooter from "../components/landing/PublicFooter";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronDown, FileText, ExternalLink } from "lucide-react";
import PublicNav from "../components/landing/PublicNav";
import SEO from "../components/seo/SEO";

const FAQ_CATEGORY_KEYS: Record<string, string> = {
  "Getting Started":            "public.faq.cat_getting_started",
  "Risk Management":            "public.faq.cat_risk",
  "Compliance & Frameworks":    "public.faq.cat_compliance",
  "Audit Management":           "public.faq.cat_audit",
  "Policy & Document Management": "public.faq.cat_policy",
  "Vendor Risk (TPRM)":         "public.faq.cat_vendor",
  "AI Capabilities":            "public.faq.cat_ai",
  "Security & Platform":        "public.faq.cat_security",
  "Reporting & Integrations":   "public.faq.cat_reporting",
};

const FAQ_ITEMS = [
  { category: "Getting Started",              ids: ["gs1", "gs2", "gs3", "gs4"] },
  { category: "Risk Management",              ids: ["rm1", "rm2", "rm3", "rm4"] },
  { category: "Compliance & Frameworks",      ids: ["cf1", "cf2", "cf3", "cf4", "cf5"] },
  { category: "Audit Management",             ids: ["au1", "au2", "au3", "au4"] },
  { category: "Policy & Document Management", ids: ["pol1", "pol2", "pol3", "pol4"] },
  { category: "Vendor Risk (TPRM)",           ids: ["vr1", "vr2", "vr3", "vr4"] },
  { category: "AI Capabilities",              ids: ["ai1", "ai2", "ai3", "ai4", "ai5", "ai6", "ai7", "ai8", "ai9"] },
  { category: "Security & Platform",          ids: ["sec1", "sec2"] },
  { category: "Reporting & Integrations",     ids: ["rep1", "rep2", "rep3", "rep4"] },
] as const;

function FAQAccordion({ category, ids }: { category: string; ids: readonly string[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<number | null>(0);
  const localizedCategory = FAQ_CATEGORY_KEYS[category] ? t(FAQ_CATEGORY_KEYS[category]) : category;

  return (
    <div className="mb-12">
      <h3 className="text-xl font-bold text-gray-900 mb-5 pb-3 border-b border-gray-100">{localizedCategory}</h3>
      <div className="space-y-3">
        {ids.map((id, idx) => (
          <div key={id} className="border border-gray-200 rounded-xl overflow-hidden hover:border-blue-200 transition-colors">
            <button
              onClick={() => setExpanded(expanded === idx ? null : idx)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left rtl:text-right"
            >
              <span className="font-semibold text-gray-900 pr-4 rtl:pr-0 rtl:pl-4">{t(`public.faq_q.${id}_q`)}</span>
              <ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${expanded === idx ? "rotate-180" : ""}`} />
            </button>
            {expanded === idx && (
              <div className="px-6 py-4 bg-blue-50/50 border-t border-gray-200">
                <p className="text-gray-700 leading-relaxed text-sm">{t(`public.faq_q.${id}_a`)}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FAQPage() {
  const { t } = useTranslation();
  // Build Schema.org FAQPage JSON-LD from the FAQ_ITEMS data (uses current locale)
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": FAQ_ITEMS.flatMap(cat =>
      cat.ids.map(id => ({
        "@type": "Question",
        "name": t(`public.faq_q.${id}_q`),
        "acceptedAnswer": {
          "@type": "Answer",
          "text": t(`public.faq_q.${id}_a`),
        },
      }))
    ),
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <SEO
        title={t("public.faq.hero_title")}
        description="Answers to common questions about GRCEye — pricing, security, integrations, frameworks, AI features and the auditor portal."
        path="/faq"
        keywords="GRCEye FAQ, GRC platform pricing, GRC security, compliance software questions"
        jsonLd={faqJsonLd}
      />
      {/* ── Nav ── */}
      <PublicNav links={[
        { to: "/features-landing", label: t("public.nav.features") },
        { to: "/solutions",        label: t("public.nav.solutions") },
        { to: "/faq",              label: t("public.nav.faq"), activeOn: "/faq" },
        { to: "/blog",             label: t("public.nav.blog") },
      ]} />

      {/* ── Hero ── */}
      <section className="pt-32 pb-16 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            {t("public.faq.hero_title")}
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed">
            {t("public.faq.hero_subtitle")}
          </p>
        </div>
      </section>

      {/* ── FAQ Content ── */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">

          {/* Datasheet banner */}
          <div className="mb-12 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg shadow-blue-500/20">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white font-bold text-lg leading-tight">{t("public.faq.datasheet_title")}</p>
                <p className="text-blue-100 text-sm mt-0.5">{t("public.faq.datasheet_subtitle")}</p>
              </div>
            </div>
            <a
              href="/GRCEye_Datasheet_2026.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-white text-blue-700 font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-50 transition-colors flex-shrink-0 shadow-sm"
            >
              {t("public.faq.view_datasheet")} <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {FAQ_ITEMS.map((section, idx) => (
            <FAQAccordion key={idx} category={section.category} ids={section.ids} />
          ))}
        </div>
      </section>

      {/* ── Contact CTA ── */}
      <section className="px-6 py-20 bg-gradient-to-br from-blue-50 to-indigo-50 border-t border-blue-100">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">{t("public.faq.still_questions")}</h2>
          <p className="text-gray-600 mb-8 leading-relaxed">{t("public.faq.still_subtitle")}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="mailto:support@grceye.com" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors shadow-sm">
              {t("public.faq.contact_us")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </a>
            <Link to="/register" className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold px-8 py-3.5 rounded-xl transition-colors">
              {t("public.nav.start_trial")}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <PublicFooter />
    </div>
  );
}
