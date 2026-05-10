import PublicFooter from "../components/landing/PublicFooter";
import { Calendar, ArrowUpRight, Zap, Brain, BarChart3, Activity, Building2, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import PublicNav from "../components/landing/PublicNav";
import SEO from "../components/seo/SEO";

const BLOG_POSTS = [
  { id: 1, key: "p1", date: "2026-05-08", category: "GRC Automation",        slug: "grc-automation-2026-cost-of-manual-compliance" },
  { id: 2, key: "p2", date: "2026-05-05", category: "AI & Automation",       slug: "ai-powered-grc-automation-iso27001-soc2-nis2" },
  { id: 3, key: "p3", date: "2026-05-02", category: "Risk Management",       slug: "automated-risk-management-monte-carlo-quantification" },
  { id: 4, key: "p4", date: "2026-04-28", category: "Compliance Automation", slug: "continuous-compliance-monitoring-vs-annual-audits" },
  { id: 5, key: "p5", date: "2026-04-22", category: "Vendor Risk",           slug: "vendor-risk-management-automation-ai-contract-review" },
  { id: 6, key: "p6", date: "2026-04-15", category: "Compliance Automation", slug: "cross-framework-compliance-iso-nist-soc2-gdpr-dora" },
] as const;

const CATEGORIES = ["All", "GRC Automation", "AI & Automation", "Compliance Automation", "Risk Management", "Vendor Risk"];

const CATEGORY_STYLES: Record<string, { gradient: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }> = {
  "GRC Automation":         { gradient: "from-blue-600 via-indigo-600 to-violet-700",   icon: Zap },
  "AI & Automation":        { gradient: "from-violet-600 via-purple-600 to-fuchsia-700", icon: Brain },
  "Risk Management":        { gradient: "from-rose-600 via-red-600 to-orange-600",       icon: BarChart3 },
  "Compliance Automation":  { gradient: "from-emerald-600 via-teal-600 to-cyan-700",     icon: Activity },
  "Vendor Risk":            { gradient: "from-amber-500 via-orange-600 to-red-600",      icon: Building2 },
  "Frameworks":             { gradient: "from-slate-700 via-slate-800 to-gray-900",      icon: Layers },
};


const CATEGORY_KEYS: Record<string, string> = {
  "All": "public.blog.cat_all",
  "GRC Automation": "public.blog.cat_grc_automation",
  "AI & Automation": "public.blog.cat_ai_automation",
  "Compliance Automation": "public.blog.cat_compliance_automation",
  "Risk Management": "public.blog.cat_risk_management",
  "Vendor Risk": "public.blog.cat_vendor_risk",
};

export default function BlogPage() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === "fr" ? "fr-FR" : i18n.language === "ar" ? "ar" : "en-US";
  const localizeCat = (cat: string) => CATEGORY_KEYS[cat] ? t(CATEGORY_KEYS[cat]) : cat;

  const blogJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": "GRCEye Blog — GRC Automation Insights",
    "description": t("public.blog.seo_desc"),
    "url": "https://grceye.com/blog",
    "publisher": {
      "@type": "Organization",
      "name": "GRCEye",
      "logo": { "@type": "ImageObject", "url": "https://grceye.com/logo.png" },
    },
    "blogPost": BLOG_POSTS.map((p) => ({
      "@type": "BlogPosting",
      "headline": t(`public.blog.${p.key}_title`),
      "description": t(`public.blog.${p.key}_excerpt`),
      "datePublished": p.date,
      "author": { "@type": "Organization", "name": t("public.blog.author") },
      "url": `https://grceye.com/blog/${p.slug}`,
      "articleSection": localizeCat(p.category),
    })),
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <SEO
        title={t("public.blog.seo_title")}
        titleOverride
        description={t("public.blog.seo_desc")}
        path="/blog"
        keywords="GRC automation, AI compliance software, automated risk management, continuous compliance monitoring, vendor risk automation, ISO 27001 automation, SOC 2 automation, NIS2 compliance software, GRC platform, compliance automation tools, AI GRC, automated audit, risk quantification software, TPRM automation, GRC SaaS"
        jsonLd={blogJsonLd}
      />
      {/* ── Nav ── */}
      <PublicNav links={[
        { to: "/features-landing", label: t("public.nav.features") },
        { to: "/blog", label: t("public.nav.blog"), activeOn: "/blog" },
        { to: "/news", label: t("public.nav.news") },
        { to: "/faq", label: t("public.nav.faq") },
      ]} />

      {/* ── Hero ── */}
      <section className="pt-32 pb-16 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            {t("public.blog.hero_title")}
          </h1>
          <p className="text-xl text-gray-500">
            {t("public.blog.hero_subtitle")}
          </p>
        </div>
      </section>

      {/* ── Featured Post ── */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-3xl p-12 cursor-pointer hover:shadow-xl transition-shadow">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-block bg-blue-400 text-blue-900 text-xs font-bold px-3 py-1 rounded-full">{t("public.blog.featured")}</span>
              <span className="text-sm opacity-90">{t("public.blog.featured_read")}</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t("public.blog.p1_title")}</h2>
            <p className="text-lg opacity-90 mb-6">{t("public.blog.p1_excerpt")}</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-semibold">{t("public.blog.author")}</p>
                  <p className="text-sm opacity-75">{new Date("2026-05-08").toLocaleDateString(dateLocale, { month: "long", day: "numeric", year: "numeric" })}</p>
                </div>
              </div>
              <ArrowUpRight className="w-6 h-6 rtl:scale-x-[-1]" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Category Filter ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button key={cat} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                cat === "All"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}>
                {localizeCat(cat)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Blog Grid ── */}
      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {BLOG_POSTS.map((post) => {
              const style = CATEGORY_STYLES[post.category] ?? CATEGORY_STYLES["GRC Automation"];
              const Icon = style.icon;
              return (
                <article
                  key={post.id}
                  className="group cursor-pointer rounded-2xl bg-white border border-gray-200 hover:border-blue-300 hover:shadow-xl transition-all overflow-hidden flex flex-col"
                >
                  <div className={`relative h-48 bg-gradient-to-br ${style.gradient} flex items-center justify-center overflow-hidden`}>
                    <div className="absolute inset-0 opacity-20" style={{
                      backgroundImage: "radial-gradient(circle at 20% 80%, rgba(255,255,255,0.4) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.3) 0%, transparent 50%)",
                    }} />
                    <Icon className="relative w-16 h-16 text-white/90 group-hover:scale-110 transition-transform duration-300" strokeWidth={1.5} />
                    <div className="absolute top-4 left-4 rtl:left-auto rtl:right-4">
                      <span className="inline-block bg-white/95 backdrop-blur-sm text-gray-900 text-xs font-semibold px-3 py-1 rounded-full shadow-sm">
                        {localizeCat(post.category)}
                      </span>
                    </div>
                  </div>
                  <div className="p-6 flex flex-col flex-1">
                    <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-600 transition-colors line-clamp-2 leading-snug">
                      {t(`public.blog.${post.key}_title`)}
                    </h3>
                    <p className="text-gray-600 text-sm mb-6 line-clamp-3 leading-relaxed flex-1">{t(`public.blog.${post.key}_excerpt`)}</p>
                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                          GE
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-gray-900 leading-tight">{t("public.blog.author")}</span>
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                            <Calendar className="w-3 h-3" />
                            <span>{new Date(post.date).toLocaleDateString(dateLocale, { month: "short", day: "numeric", year: "numeric" })}</span>
                            <span aria-hidden>·</span>
                            <span>{t(`public.blog.${post.key}_read`)}</span>
                          </div>
                        </div>
                      </div>
                      <ArrowUpRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all rtl:scale-x-[-1]" />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Newsletter CTA ── */}
      <section className="px-6 py-24 bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">{t("public.blog.newsletter_title")}</h2>
          <p className="text-gray-600 mb-8">{t("public.blog.newsletter_subtitle")}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              placeholder={t("public.blog.email_placeholder")}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors">
              {t("public.blog.subscribe")}
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <PublicFooter />
    </div>
  );
}
