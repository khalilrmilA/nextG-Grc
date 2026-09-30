import PublicFooter from "../components/landing/PublicFooter";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SupportChat from "../components/landing/SupportChat";
import PublicNav from "../components/landing/PublicNav";
import SEO from "../components/seo/SEO";
import {
  ArrowRight, CheckCircle, Shield, AlertTriangle, ClipboardList,
  FileText, Building2, Users, Globe, Heart, Cpu, Lock,
  BarChart2, ChevronRight, Star,
} from "lucide-react";

function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, inView } = useInView();
  return (
    <div ref={ref} className={className} style={{
      opacity: inView ? 1 : 0,
      transform: inView ? "none" : "translateY(24px)",
      transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
    }}>
      {children}
    </div>
  );
}

const INDUSTRIES = [
  {
    icon: Building2,
    color: "from-blue-500 to-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-100",
    badge: "text-blue-700 bg-blue-50",
    key: "saas",
    frameworks: ["SOC 2 Type II", "ISO 27001:2022", "CIS Controls v8"],
  },
  {
    icon: Heart,
    color: "from-rose-500 to-pink-600",
    bg: "bg-rose-50",
    border: "border-rose-100",
    badge: "text-rose-700 bg-rose-50",
    key: "health",
    frameworks: ["HIPAA", "GDPR", "ISO 27001:2022", "NIST 800-53"],
  },
  {
    icon: BarChart2,
    color: "from-emerald-500 to-teal-600",
    bg: "bg-emerald-50",
    border: "border-emerald-100",
    badge: "text-emerald-700 bg-emerald-50",
    key: "fin",
    frameworks: ["DORA", "PCI DSS 4.0", "NIS2 Directive", "ISO 27001:2022"],
  },
  {
    icon: Globe,
    color: "from-violet-500 to-purple-700",
    bg: "bg-violet-50",
    border: "border-violet-100",
    badge: "text-violet-700 bg-violet-50",
    key: "ent",
    frameworks: ["ISO 27001:2022", "NIST CSF 2.0", "SOC 2", "GDPR", "NIST 800-53"],
  },
] as const;

const ROLES = [
  { icon: Shield,        color: "from-blue-600 to-indigo-700",   key: "ciso" },
  { icon: AlertTriangle, color: "from-red-500 to-rose-600",      key: "risk" },
  { icon: CheckCircle,   color: "from-green-500 to-emerald-600", key: "comp" },
  { icon: ClipboardList, color: "from-purple-500 to-indigo-600", key: "auditor" },
  { icon: FileText,      color: "from-orange-500 to-amber-600",  key: "policy" },
] as const;

const USE_CASES = [
  { icon: "🏆", key: "iso",    color: "border-blue-200 bg-blue-50/50" },
  { icon: "✅", key: "soc",    color: "border-green-200 bg-green-50/50" },
  { icon: "🔒", key: "gdpr",   color: "border-purple-200 bg-purple-50/50" },
  { icon: "🏦", key: "dora",   color: "border-emerald-200 bg-emerald-50/50" },
  { icon: "🛡️", key: "vendor", color: "border-orange-200 bg-orange-50/50" },
  { icon: "📋", key: "audit",  color: "border-red-200 bg-red-50/50" },
] as const;

export default function SolutionsPage() {
  const { t } = useTranslation();
  const [activeIndustry, setActiveIndustry] = useState(0);
  const ind = INDUSTRIES[activeIndustry];

  return (
    <div className="min-h-screen bg-[#E8F3FC] text-gray-900">
      <SEO
        title="Solutions"
        description="GRC Eye for SaaS, FinTech, Healthcare and Enterprise. Role-based workflows for CISOs, risk managers, compliance officers, auditors and policy managers."
        path="/solutions"
        keywords="GRC for SaaS, GRC for FinTech, GRC for Healthcare, CISO software, compliance manager tools, risk manager platform"
      />

      {/* Nav */}
      <PublicNav links={[
        { to: "/",                 label: t("public.nav.home") },
        { to: "/solutions",        label: t("public.nav.solutions"), activeOn: "/solutions" },
        { to: "/features-landing", label: t("public.nav.features") },
        { to: "/faq",              label: t("public.nav.faq") },
      ]} />

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 text-center overflow-hidden bg-gradient-to-b from-sky-100 via-[#E8F3FC] to-[#E8F3FC]">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute top-10 -right-10 w-80 h-80 bg-sky-200/25 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/70 border border-sky-200 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 shadow-sm animate-fade-in-up">
            <Users className="w-3.5 h-3.5" /> {t("public.solutions_page.hero_badge")}
          </div>
          <h1 className="animate-fade-in-up animation-delay-200 text-5xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            {t("public.solutions_page.hero_title_pre")}{" "}
            <span className="gradient-text-animated">SaaS · FinTech · Healthcare</span>
          </h1>
          <p className="animate-fade-in-up animation-delay-400 text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            {t("public.solutions_page.hero_subtitle")}
          </p>
          <div className="animate-fade-in-up animation-delay-600 flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-500/25 hover:-translate-y-0.5 hover:shadow-blue-500/40">
              {t("public.solutions_page.try_free")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
            <Link to="/faq" className="flex items-center justify-center gap-2 bg-white border border-sky-200 text-gray-700 hover:bg-sky-50 font-semibold px-8 py-3.5 rounded-2xl transition-all hover:-translate-y-0.5">
              {t("public.faq.hero_title")} <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </section>

      {/* Industry tabs */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">{t("public.solutions_page.industry_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.solutions_page.industry_subtitle")}</p>
            </div>
          </Reveal>

          {/* Industry selector */}
          <Reveal delay={100}>
            <div className="flex flex-wrap gap-3 justify-center mb-12">
              {INDUSTRIES.map((industry, i) => (
                <button
                  key={industry.key}
                  onClick={() => setActiveIndustry(i)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all border ${
                    activeIndustry === i
                      ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20 -translate-y-0.5"
                      : "bg-white border-sky-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:-translate-y-0.5"
                  }`}
                >
                  <industry.icon className="w-4 h-4" />
                  {t(`public.ind.${industry.key}_title`)}
                </button>
              ))}
            </div>
          </Reveal>

          {/* Industry content */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            <Reveal key={ind.key} delay={50}>
              <div className={`rounded-2xl p-8 border ${ind.border} ${ind.bg}`}>
                <div className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mb-5 ${ind.badge}`}>
                  <ind.icon className="w-3.5 h-3.5" /> {t(`public.ind.${ind.key}_title`)}
                </div>
                <h3 className="text-2xl font-extrabold text-gray-900 mb-3">{t(`public.ind.${ind.key}_headline`)}</h3>
                <p className="text-gray-600 leading-relaxed mb-6">{t(`public.ind.${ind.key}_desc`)}</p>
                <ul className="space-y-2.5 mb-8">
                  {[t(`public.ind.${ind.key}_p1`), t(`public.ind.${ind.key}_p2`), t(`public.ind.${ind.key}_p3`), t(`public.ind.${ind.key}_p4`), t(`public.ind.${ind.key}_p5`)].map(p => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-gray-700">
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{p}
                    </li>
                  ))}
                </ul>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t("public.solutions_page.frameworks_label")}</p>
                  <div className="flex flex-wrap gap-2">
                    {ind.frameworks.map(fw => (
                      <span key={fw} className="bg-white border border-sky-200 text-gray-700 text-xs font-medium px-3 py-1 rounded-full">{fw}</span>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>

            <div className="space-y-4">
              <Reveal delay={150}>
                <div className="bg-white rounded-2xl p-6 border border-sky-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 bg-gradient-to-br ${ind.color} rounded-xl flex items-center justify-center flex-shrink-0`}>
                      <ind.icon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{t("public.solutions_page.workflow_title")} {t(`public.ind.${ind.key}_title`)}</p>
                      <p className="text-xs text-gray-400">{t("public.solutions_page.workflow_subtitle")}</p>
                    </div>
                  </div>
                  <ol className="space-y-3">
                    {[
                      t("public.solutions_page.workflow_s1"),
                      t("public.solutions_page.workflow_s2"),
                      t("public.solutions_page.workflow_s3"),
                      t("public.solutions_page.workflow_s4"),
                      t("public.solutions_page.workflow_s5"),
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                        <p className="text-sm text-gray-600">{step}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              </Reveal>

              <Reveal delay={200}>
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white">
                  <Star className="w-6 h-6 text-yellow-300 mb-3 fill-yellow-300" />
                  <p className="text-sm leading-relaxed italic mb-4">
                    "GRC Eye cut our ISO 27001 certification prep from 18 months to 6. The AI gap analysis alone identified 34 control gaps we had missed in our manual review."
                  </p>
                  <div>
                    <p className="font-semibold text-sm">Sarah K.</p>
                    <p className="text-blue-200 text-xs">CISO, FinTech Scale-up</p>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="py-24 px-6 bg-[#E8F3FC]">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">{t("public.solutions_page.use_cases_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.solutions_page.use_cases_subtitle")}</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {USE_CASES.map((uc, i) => (
              <Reveal key={uc.key} delay={i * 80}>
                <div className={`rounded-2xl p-6 border ${uc.color} card-hover h-full`}>
                  <span className="text-3xl mb-4 block">{uc.icon}</span>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">{t(`public.uc.${uc.key}_title`)}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">{t(`public.uc.${uc.key}_desc`)}</p>
                  <p className="text-xs font-semibold text-gray-400 border-t border-gray-200 pt-3">{t(`public.uc.${uc.key}_time`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Role-based section */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">{t("public.solutions_page.role_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.solutions_page.role_subtitle")}</p>
            </div>
          </Reveal>
          <div className="space-y-6">
            {ROLES.map((role, i) => (
              <Reveal key={role.key} delay={i * 60}>
                <div className="bg-[#E8F3FC] border border-sky-100 rounded-2xl p-7 grid grid-cols-1 md:grid-cols-3 gap-6 items-start card-hover">
                  <div className="md:col-span-1">
                    <div className={`w-12 h-12 bg-gradient-to-br ${role.color} rounded-2xl flex items-center justify-center mb-4 shadow-md`}>
                      <role.icon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="text-xl font-extrabold text-gray-900 mb-1">{t(`public.sol_role.${role.key}_title`)}</h3>
                    <p className="text-sm text-gray-500">{t(`public.sol_role.${role.key}_subtitle`)}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-gray-600 text-sm leading-relaxed mb-4">{t(`public.sol_role.${role.key}_desc`)}</p>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                      {[t(`public.sol_role.${role.key}_p1`), t(`public.sol_role.${role.key}_p2`), t(`public.sol_role.${role.key}_p3`), t(`public.sol_role.${role.key}_p4`), t(`public.sol_role.${role.key}_p5`)].map(p => (
                        <li key={p} className="flex items-start gap-2 text-xs text-gray-600">
                          <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />{p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* AI section */}
      <section className="py-24 px-6 bg-[#E8F3FC]">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-3xl p-10 md:p-14 text-white text-center relative overflow-hidden">
              <div className="absolute top-0 left-1/4 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-900/30">
                  <Cpu className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-3xl font-extrabold mb-4">{t("public.solutions_page.ai_title")}</h2>
                <p className="text-slate-300 text-lg leading-relaxed max-w-2xl mx-auto mb-8">
                  {t("public.solutions_page.ai_desc")}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto mb-10">
                  {[
                    { icon: Lock,   label: t("public.solutions_page.ai_zero_egress") },
                    { icon: Cpu,    label: t("public.solutions_page.ai_on_premise") },
                    { icon: Shield, label: t("public.solutions_page.ai_eu_aligned") },
                    { icon: Globe,  label: t("public.solutions_page.ai_air_gap") },
                  ].map(item => (
                    <div key={item.label} className="bg-white/10 rounded-xl p-4 flex flex-col items-center gap-2">
                      <item.icon className="w-5 h-5 text-blue-300" />
                      <p className="text-xs font-semibold text-slate-200 text-center">{item.label}</p>
                    </div>
                  ))}
                </div>
                <Link to="/register" className="inline-flex items-center gap-2 bg-white text-blue-700 font-semibold px-8 py-3.5 rounded-2xl hover:bg-blue-50 transition-all shadow-md hover:-translate-y-0.5 hover:shadow-lg">
                  {t("public.solutions_page.ai_cta")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 bg-white">
        <Reveal>
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-4">{t("public.solutions_page.cta_title")}</h2>
            <p className="text-gray-500 mb-8 text-lg">{t("public.solutions_page.cta_subtitle")}</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/register" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-500/20 hover:-translate-y-0.5 hover:shadow-blue-500/40">
                {t("public.nav.start_trial")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </Link>
              <Link to="/faq" className="flex items-center justify-center gap-2 bg-[#E8F3FC] border border-sky-200 text-gray-700 hover:bg-sky-100 font-semibold px-8 py-3.5 rounded-2xl transition-all hover:-translate-y-0.5">
                {t("public.faq.hero_title")} <ChevronRight className="w-4 h-4 rtl:rotate-180" />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <SupportChat />

      {/* Footer */}
      <PublicFooter />
    </div>
  );
}
