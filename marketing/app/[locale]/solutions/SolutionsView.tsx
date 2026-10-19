"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import PublicNav from "@/components/landing/PublicNav";
import SupportChat from "@/components/landing/SupportChat";
import Link from "next/link";
import { useI18n } from "@/i18n";
import {
  ArrowRight, CheckCircle2, TrendingUp, Clock, BarChart3, Zap,
  Building2, Heart, BarChart2, Globe, Shield,
  Users, Lock, DollarSign,
  ClipboardCheck, Search, Cpu,
  type LucideIcon,
} from "lucide-react";
import { SOLUTIONS_CONTENT, type IndustryKey, type StakeholderKey } from "./content";

// Visual styling only; all copy lives in ./content.ts (per locale).
const INDUSTRY_STYLES: { key: IndustryKey; icon: LucideIcon; color: string; bg: string; border: string }[] = [
  { key: "saas", icon: Building2, color: "from-blue-500 to-indigo-600", bg: "bg-blue-50", border: "border-blue-200" },
  { key: "health", icon: Heart, color: "from-rose-500 to-pink-600", bg: "bg-rose-50", border: "border-rose-200" },
  { key: "fintech", icon: BarChart2, color: "from-emerald-500 to-teal-600", bg: "bg-emerald-50", border: "border-emerald-200" },
  { key: "enterprise", icon: Globe, color: "from-violet-500 to-purple-700", bg: "bg-violet-50", border: "border-violet-200" },
];

const BENEFIT_STYLES: { icon: LucideIcon; color: string }[] = [
  { icon: DollarSign, color: "from-emerald-500 to-teal-600" },
  { icon: TrendingUp, color: "from-blue-500 to-indigo-600" },
  { icon: BarChart3, color: "from-violet-500 to-purple-600" },
  { icon: Shield, color: "from-rose-500 to-pink-600" },
];

const ROI_ICONS: LucideIcon[] = [TrendingUp, BarChart3, Clock, Shield];

const STAKEHOLDER_STYLES: {
  key: StakeholderKey; icon: LucideIcon; accent: string; border: string; bg: string; iconBg: string; textAccent: string;
}[] = [
  { key: "ciso", icon: Shield, accent: "from-violet-500 to-purple-600", border: "border-violet-200", bg: "bg-white", iconBg: "bg-violet-600", textAccent: "text-violet-700" },
  { key: "compliance", icon: ClipboardCheck, accent: "from-emerald-500 to-teal-600", border: "border-emerald-200", bg: "bg-white", iconBg: "bg-emerald-600", textAccent: "text-emerald-700" },
  { key: "sales", icon: TrendingUp, accent: "from-amber-500 to-orange-500", border: "border-amber-200", bg: "bg-white", iconBg: "bg-amber-500", textAccent: "text-amber-700" },
  { key: "engineering", icon: Cpu, accent: "from-sky-500 to-cyan-600", border: "border-sky-200", bg: "bg-white", iconBg: "bg-sky-600", textAccent: "text-sky-700" },
  { key: "auditors", icon: Search, accent: "from-rose-500 to-pink-600", border: "border-rose-200", bg: "bg-white", iconBg: "bg-rose-600", textAccent: "text-rose-700" },
];

export default function SolutionsView() {
  const { lang } = useI18n();
  const c = SOLUTIONS_CONTENT[lang] ?? SOLUTIONS_CONTENT.en;
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      {/* ── Hero ── */}
      <section className="pt-20 pb-20 px-6 text-center bg-gradient-to-b from-slate-50 via-blue-50/30 to-white">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
            <Zap className="w-4 h-4" />
            {c.hero.badge}
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            {c.hero.titleLead}{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              {c.hero.titleAccent}
            </span>
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed max-w-2xl mx-auto mb-10">
            {c.hero.subtitle}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg hover:shadow-blue-500/25"
            >
              {c.hero.ctaPrimary}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
            </Link>
            <Link
              href={`/${lang}/contact`}
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:bg-gray-50 transition-colors"
            >
              {c.hero.ctaSecondary}
            </Link>
          </div>
        </div>
      </section>

      {/* ── ROI strip ── */}
      <section className="py-10 px-6 border-y border-gray-100 bg-white">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {c.roi.map(({ value, label }, i) => {
            const Icon = ROI_ICONS[i] ?? Shield;
            return (
            <div key={i} className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Icon className="w-5 h-5 text-blue-600" />
                <p className="text-3xl font-extrabold text-gray-900">{value}</p>
              </div>
              <p className="text-sm text-gray-500">{label}</p>
            </div>
            );
          })}
        </div>
      </section>

      {/* ── What CEOs actually care about ── */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {c.business.title}
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              {c.business.subtitle}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {c.business.items.map(({ title, body }, i) => {
              const { icon: Icon, color } = BENEFIT_STYLES[i % BENEFIT_STYLES.length];
              return (
              <div key={i} className="border border-gray-200 rounded-2xl p-6 hover:shadow-md transition-shadow">
                <div className={`w-11 h-11 bg-gradient-to-br ${color} rounded-xl flex items-center justify-center mb-4 shadow-sm`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{body}</p>
              </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Industry solutions ── */}
      <section className="py-20 px-6 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {c.industries.title}
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              {c.industries.subtitle}
            </p>
          </div>
          <div className="space-y-10">
            {INDUSTRY_STYLES.map((style, i) => {
              const ind = { ...style, ...c.industries.items[style.key] };
              const Icon = ind.icon;
              const isEven = i % 2 === 0;
              return (
                <div
                  key={ind.key}
                  className={`flex flex-col ${isEven ? "lg:flex-row" : "lg:flex-row-reverse"} gap-8 items-stretch`}
                >
                  {/* Start/end panel - business framing */}
                  <div className={`flex-1 rounded-2xl ${ind.bg} border ${ind.border} p-8 flex flex-col justify-between`}>
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`w-10 h-10 bg-gradient-to-br ${ind.color} rounded-xl flex items-center justify-center shadow-sm`}>
                          <Icon className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-sm font-semibold text-gray-600">{ind.label}</span>
                      </div>
                      <h3 className="text-2xl font-extrabold text-gray-900 mb-3">{ind.headline}</h3>
                      <p className="text-gray-600 text-sm leading-relaxed mb-6">{ind.ceoValue}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {ind.metrics.map(({ value, label }) => (
                        <div key={value + label} className="bg-white rounded-xl p-3 text-center border border-white/60 shadow-sm">
                          <p className="text-lg font-extrabold text-gray-900">{value}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* End/start panel - what's included */}
                  <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-8">
                    <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">{c.industries.included}</h4>
                    <ul className="space-y-3 mb-6">
                      {ind.points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-sm text-gray-700">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                          {p}
                        </li>
                      ))}
                    </ul>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.industries.frameworksLabel}</p>
                      <div className="flex flex-wrap gap-2">
                        {ind.frameworks.map((fw) => (
                          <span key={fw} className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium px-3 py-1 rounded-full">
                            {fw}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Who it serves ── */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {c.stakeholders.title}
            </h2>
            <p className="text-lg text-gray-500">
              {c.stakeholders.subtitle}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {STAKEHOLDER_STYLES.map(({ key, icon: Icon, accent, border, bg, iconBg, textAccent }) => {
              const { role, points } = c.stakeholders.items[key];
              return (
              <div
                key={key}
                className={`rounded-2xl border overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5 ${border} ${bg}`}
              >
                {/* coloured top bar */}
                <div className={`h-1 w-full bg-gradient-to-r ${accent}`} />
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="font-bold text-gray-900 text-sm">{role}</h3>
                  </div>
                  <ul className="space-y-2.5">
                    {points.map((p) => (
                      <li key={p} className="flex items-start gap-2.5 text-sm text-gray-600">
                        <CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${textAccent}`} />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── AI privacy callout ── */}
      <section className="py-16 px-6 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-3xl p-10 text-white text-center relative overflow-hidden">
            <div className="absolute top-0 left-1/4 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-xl shadow-blue-900/30">
                <Lock className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold mb-3">{c.ai.title}</h2>
              <p className="text-slate-300 leading-relaxed max-w-2xl mx-auto mb-8">
                {c.ai.body}
              </p>
              <div className="flex flex-wrap gap-3 justify-center mb-8">
                {c.ai.tags.map((tag) => (
                  <span key={tag} className="bg-white/10 border border-white/20 text-sm font-semibold px-4 py-1.5 rounded-full text-white">
                    {tag}
                  </span>
                ))}
              </div>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 bg-white text-blue-700 font-semibold px-6 py-3 rounded-xl hover:bg-blue-50 transition-colors shadow-md"
              >
                {c.ai.cta} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
            {c.cta.title}
          </h2>
          <p className="text-lg text-blue-100 mb-8">
            {c.cta.body}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center justify-center gap-2 bg-white text-blue-700 font-bold px-6 py-3.5 rounded-xl hover:bg-blue-50 transition-colors shadow-lg"
            >
              {c.cta.trial}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
            </Link>
            <Link
              href={`/${lang}/contact`}
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold px-6 py-3.5 rounded-xl transition-colors"
            >
              <Users className="w-4 h-4" />
              {c.cta.demo}
            </Link>
          </div>
        </div>
      </section>

      <SupportChat />
      <PublicFooter />
    </div>
  );
}
