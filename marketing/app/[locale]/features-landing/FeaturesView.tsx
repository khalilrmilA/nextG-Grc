"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SupportChat from "@/components/landing/SupportChat";
import PublicNav from "@/components/landing/PublicNav";
import { useI18n } from "@/i18n";
import {
  ArrowRight, CheckCircle, AlertTriangle, ClipboardList, FileText,
  Building2, BarChart2, BookOpen, Zap, Shield, ChevronRight,
  Database, Globe, Cpu, Bell, RefreshCw, Download,
  Users, Activity, TrendingUp, GitBranch, Upload, Link2,
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

const MODULES = [
  {
    id: "risk", k: "risk",
    icon: AlertTriangle, color: "from-red-500 to-rose-600", bgLight: "bg-red-50", border: "border-red-100", badge: "text-red-700 bg-red-50",
    features: [
      { icon: Activity,    fk: "f1" },
      { icon: TrendingUp,  fk: "f2" },
      { icon: BarChart2,   fk: "f3" },
      { icon: GitBranch,   fk: "f4" },
      { icon: Database,    fk: "f5" },
      { icon: CheckCircle, fk: "f6" },
    ],
  },
  {
    id: "compliance", k: "compliance",
    icon: CheckCircle, color: "from-blue-500 to-indigo-600", bgLight: "bg-blue-50", border: "border-blue-100", badge: "text-blue-700 bg-blue-50",
    features: [
      { icon: BookOpen,  fk: "f1" },
      { icon: Zap,       fk: "f2" },
      { icon: Link2,     fk: "f3" },
      { icon: Upload,    fk: "f4" },
      { icon: Globe,     fk: "f5" },
      { icon: GitBranch, fk: "f6" },
    ],
  },
  {
    id: "audit", k: "audit",
    icon: ClipboardList, color: "from-purple-500 to-indigo-600", bgLight: "bg-purple-50", border: "border-purple-100", badge: "text-purple-700 bg-purple-50",
    features: [
      { icon: ClipboardList, fk: "f1" },
      { icon: Shield,        fk: "f2" },
      { icon: AlertTriangle, fk: "f3" },
      { icon: CheckCircle,   fk: "f4" },
      { icon: Download,      fk: "f5" },
      { icon: RefreshCw,     fk: "f6" },
    ],
  },
  {
    id: "policy", k: "policy",
    icon: FileText, color: "from-orange-500 to-amber-600", bgLight: "bg-orange-50", border: "border-orange-100", badge: "text-orange-700 bg-orange-50",
    features: [
      { icon: Zap,         fk: "f1" },
      { icon: GitBranch,   fk: "f2" },
      { icon: Users,       fk: "f3" },
      { icon: CheckCircle, fk: "f4" },
      { icon: Link2,       fk: "f5" },
      { icon: Download,    fk: "f6" },
    ],
  },
  {
    id: "vendor", k: "vendor",
    icon: Building2, color: "from-indigo-500 to-violet-600", bgLight: "bg-indigo-50", border: "border-indigo-100", badge: "text-indigo-700 bg-indigo-50",
    features: [
      { icon: Users,       fk: "f1" },
      { icon: Zap,         fk: "f2" },
      { icon: FileText,    fk: "f3" },
      { icon: CheckCircle, fk: "f4" },
      { icon: BarChart2,   fk: "f5" },
      { icon: RefreshCw,   fk: "f6" },
    ],
  },
  {
    id: "ai", k: "ai",
    icon: Cpu, color: "from-sky-500 to-blue-600", bgLight: "bg-sky-50", border: "border-sky-100", badge: "text-sky-700 bg-sky-50",
    features: [
      { icon: Zap,         fk: "f1" },
      { icon: FileText,    fk: "f2" },
      { icon: CheckCircle, fk: "f3" },
      { icon: Building2,   fk: "f4" },
      { icon: Globe,       fk: "f5" },
      { icon: Cpu,         fk: "f6" },
    ],
  },
  {
    id: "governance", k: "gov",
    icon: Shield, color: "from-slate-600 to-slate-800", bgLight: "bg-slate-50", border: "border-slate-200", badge: "text-slate-700 bg-slate-100",
    features: [
      { icon: AlertTriangle, fk: "f1" },
      { icon: Database,      fk: "f2" },
      { icon: BookOpen,      fk: "f3" },
      { icon: Bell,          fk: "f4" },
      { icon: RefreshCw,     fk: "f5" },
      { icon: Download,      fk: "f6" },
    ],
  },
] as const;

export default function FeaturesView() {
  const { t, lang } = useI18n();
  const [active, setActive] = useState("risk");
  const mod = MODULES.find(m => m.id === active)!;

  return (
    <div className="min-h-screen bg-[#f0f9ff] text-gray-900">
      <PublicNav />

      <section className="relative pt-16 pb-20 px-6 text-center overflow-hidden bg-gradient-to-b from-sky-100 via-[#f0f9ff] to-[#f0f9ff]">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute top-10 -right-10 w-80 h-80 bg-indigo-200/20 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/70 border border-sky-200 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 shadow-sm animate-fade-in-up">
            <Zap className="w-3.5 h-3.5" /> {t("public.features_page.hero_badge")}
          </div>
          <h1 className="animate-fade-in-up animation-delay-200 text-5xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            {t("public.features_page.hero_title_pre")}{" "}
            <span className="gradient-text-animated">{t("public.features_page.hero_title_em")}</span>
          </h1>
          <p className="animate-fade-in-up animation-delay-400 text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            {t("public.features_page.hero_subtitle")}
          </p>
          <div className="animate-fade-in-up animation-delay-600 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-500/25 hover:-translate-y-0.5">
              {t("public.features_page.try_free")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
            <Link href={`/${lang}/solutions`} className="flex items-center justify-center gap-2 bg-white border border-sky-200 text-gray-700 hover:bg-sky-50 font-semibold px-8 py-3.5 rounded-2xl transition-all hover:-translate-y-0.5">
              {t("public.features_page.see_solutions")} <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </section>

      <section className="py-12 px-6 bg-white border-y border-sky-100">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "38",     label: t("public.features_page.stat_pages") },
            { value: "70+",    label: t("public.features_page.stat_frameworks") },
            { value: "3,500+", label: t("public.features_page.stat_controls") },
            { value: "29",     label: t("public.features_page.stat_ai") },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 80}>
              <p className="text-3xl font-extrabold text-blue-600 mb-1">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">{t("public.features_page.explore_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.features_page.explore_subtitle")}</p>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="flex flex-wrap gap-2 justify-center mb-12">
              {MODULES.map(m => (
                <button
                  key={m.id}
                  onClick={() => setActive(m.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-all border ${
                    active === m.id
                      ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20 -translate-y-0.5"
                      : "bg-white border-sky-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:-translate-y-0.5"
                  }`}
                >
                  <m.icon className="w-4 h-4" />
                  {t(`public.fp.m_${m.k}_title`)}
                </button>
              ))}
            </div>
          </Reveal>

          <div key={mod.id} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
              <Reveal>
                <div className={`rounded-2xl p-7 border ${mod.border} ${mod.bgLight} h-full`}>
                  <div className={`w-14 h-14 bg-gradient-to-br ${mod.color} rounded-2xl flex items-center justify-center mb-5 shadow-lg`}>
                    <mod.icon className="w-7 h-7 text-white" />
                  </div>
                  <div className={`inline-flex text-xs font-semibold px-3 py-1 rounded-full mb-4 ${mod.badge}`}>{t(`public.fp.m_${mod.k}_title`)}</div>
                  <h3 className="text-xl font-extrabold text-gray-900 mb-2">{t(`public.fp.m_${mod.k}_tagline`)}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{t(`public.fp.m_${mod.k}_desc`)}</p>
                  <Link href="/register" className="mt-6 inline-flex items-center gap-1.5 text-blue-600 font-semibold text-sm hover:gap-2.5 transition-all">
                    {t("public.features_page.try_module")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                  </Link>
                </div>
              </Reveal>
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {mod.features.map((f, i) => (
                <Reveal key={f.fk} delay={i * 60}>
                  <div className="bg-white rounded-2xl p-5 border border-sky-100 card-hover h-full">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-8 h-8 bg-gradient-to-br ${mod.color} rounded-lg flex items-center justify-center flex-shrink-0`}>
                        <f.icon className="w-4 h-4 text-white" />
                      </div>
                      <p className="font-semibold text-gray-900 text-sm">{t(`public.fp.m_${mod.k}_${f.fk}`)}</p>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{t(`public.fp.m_${mod.k}_${f.fk}d`)}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">{t("public.features_page.else_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.features_page.else_subtitle")}</p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                <div key={n} className="flex items-start gap-3 bg-[#f0f9ff] rounded-xl p-4 border border-sky-100">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-700">{t(`public.fp.cap${n}`)}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-4xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">{t("public.features_page.vs_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.features_page.vs_subtitle")}</p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="bg-white rounded-2xl border border-sky-100 overflow-hidden shadow-sm">
              <div className="grid grid-cols-3 bg-sky-50 border-b border-sky-100 px-6 py-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">{t("public.features_page.vs_col_task")}</p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide text-center">{t("public.features_page.vs_col_manual")}</p>
                <p className="text-xs font-bold text-blue-600 uppercase tracking-wide text-center">{t("public.features_page.vs_col_grc")}</p>
              </div>
              {[1,2,3,4,5,6,7,8].map((n, i) => (
                <div key={n} className={`grid grid-cols-3 px-6 py-4 border-b border-sky-50 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-sky-50/30"}`}>
                  <p className="text-sm font-semibold text-gray-800 pr-4">{t(`public.fp.cmp${n}_task`)}</p>
                  <p className="text-sm text-gray-400 text-center px-2">{t(`public.fp.cmp${n}_manual`)}</p>
                  <p className="text-sm text-blue-700 font-medium text-center px-2">{t(`public.fp.cmp${n}_grc`)}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="py-20 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center relative overflow-hidden">
        <div className="absolute top-0 left-1/4 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none animate-blob" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-indigo-400/20 rounded-full blur-3xl pointer-events-none animate-blob animation-delay-2000" />
        <Reveal>
          <div className="relative max-w-2xl mx-auto">
            <h2 className="text-3xl font-extrabold mb-4">{t("public.features_page.cta_title")}</h2>
            <p className="text-blue-100 mb-8 text-lg">{t("public.features_page.cta_subtitle")}</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/register" className="flex items-center justify-center gap-2 bg-white text-blue-600 font-semibold px-8 py-3.5 rounded-2xl hover:bg-blue-50 transition-all shadow-md hover:-translate-y-0.5">
                {t("public.nav.start_trial")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </Link>
              <Link href={`/${lang}/solutions`} className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-semibold px-8 py-3.5 rounded-2xl hover:bg-white/20 transition-all hover:-translate-y-0.5">
                {t("public.features_page.see_solutions")}
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <SupportChat />
      <PublicFooter />
    </div>
  );
}
