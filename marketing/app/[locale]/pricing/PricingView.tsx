"use client";
import Link from "next/link";
import { Fragment } from "react";
import PublicFooter from "@/components/landing/PublicFooter";
import PublicNav from "@/components/landing/PublicNav";
import SupportChat from "@/components/landing/SupportChat";
import { useI18n } from "@/i18n";
import {
  ArrowRight, Check, CheckCircle, ChevronDown, Cpu, GraduationCap, Server, Sparkles, Tag,
} from "lucide-react";
import { PLAN_ORDER, PRICING_CONTENT, TABLE, type Cell, type PricingCopy } from "./content";

const OPTION_ICONS = [Server, Cpu, GraduationCap];

function CellView({ cell, copy, highlight }: { cell: Cell; copy: PricingCopy; highlight: boolean }) {
  if (cell === true) {
    return (
      <>
        <Check className={`w-5 h-5 mx-auto ${highlight ? "text-blue-600" : "text-emerald-600"}`} aria-hidden />
        <span className="sr-only">{copy.table.included}</span>
      </>
    );
  }
  if (cell === false) {
    return (
      <>
        <span className="text-gray-300 text-lg leading-none" aria-hidden>–</span>
        <span className="sr-only">{copy.table.notIncluded}</span>
      </>
    );
  }
  return <span className="text-sm font-semibold text-gray-800">{copy.table.text[cell]}</span>;
}

export default function PricingView() {
  const { lang } = useI18n();
  const c = PRICING_CONTENT[lang] ?? PRICING_CONTENT.en;
  const contactHref = `/${lang}/contact`;
  const frameworksHref = `/${lang}/frameworks`;

  return (
    <div className="min-h-screen bg-[#E8F3FC] text-gray-900">
      <PublicNav />

      {/* Hero */}
      <section className="relative pt-16 pb-12 px-6 text-center overflow-hidden bg-gradient-to-b from-sky-100 via-[#E8F3FC] to-[#E8F3FC]">
        <div className="absolute -top-20 -start-20 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute top-10 -end-10 w-80 h-80 bg-indigo-200/20 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/70 border border-sky-200 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 shadow-sm animate-fade-in-up">
            <Tag className="w-3.5 h-3.5" /> {c.hero.badge}
          </div>
          <h1 className="animate-fade-in-up animation-delay-200 text-4xl sm:text-5xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            {c.hero.title}
          </h1>
          <p className="animate-fade-in-up animation-delay-400 text-lg text-gray-600 leading-relaxed">
            {c.hero.intro}
          </p>
        </div>
      </section>

      {/* Plan cards */}
      <section className="px-6 pb-20" aria-label={c.hero.badge}>
        <div className="max-w-6xl mx-auto grid gap-6 lg:grid-cols-3 items-stretch">
          {PLAN_ORDER.map((id) => {
            const plan = c.plans[id];
            const popular = id === "enterprise";
            return (
              <div
                key={id}
                className={`relative flex flex-col bg-white rounded-2xl p-7 shadow-sm ${
                  popular ? "border-2 border-blue-600 shadow-xl shadow-blue-500/10 lg:-translate-y-2" : "border border-sky-100"
                }`}
              >
                {popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow whitespace-nowrap">
                    <Sparkles className="w-3.5 h-3.5" aria-hidden /> {c.popular}
                  </span>
                )}
                <h2 className="text-2xl font-extrabold text-gray-900">{plan.name}</h2>
                <p className="mt-1 text-sm text-gray-500 min-h-[2.5rem]">{plan.tagline}</p>
                <p className="mt-5 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                  {c.priceLabel}
                </p>
                <Link
                  href={contactHref}
                  className={`mt-5 flex items-center justify-center gap-2 font-semibold px-6 py-3 rounded-2xl transition-all hover:-translate-y-0.5 ${
                    popular
                      ? "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/25"
                      : "bg-white border border-sky-200 text-gray-800 hover:bg-sky-50"
                  }`}
                >
                  {plan.cta} <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden />
                </Link>
                <ul className="mt-7 space-y-3 text-sm text-gray-700">
                  {plan.bullets.map((b, i) => (
                    <li key={b} className="flex items-start gap-2.5">
                      <CheckCircle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${popular ? "text-blue-600" : "text-emerald-600"}`} aria-hidden />
                      <span className={i === 0 && id !== "growth" ? "font-semibold text-gray-900" : ""}>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* Comparison table */}
      <section className="px-6 pb-20" id="compare">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">{c.table.title}</h2>
            <p className="text-gray-500">{c.table.subtitle}</p>
          </div>
          <p className="lg:hidden text-xs text-gray-500 text-center mb-3">{c.table.scrollHint}</p>
          {/* Horizontal scroll on small screens; on lg the wrapper does not clip, so the
              header can stick to the page under the fixed nav (h-16). */}
          <div className="bg-white rounded-2xl border border-sky-100 shadow-sm overflow-x-auto lg:overflow-visible">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 lg:top-16 start-0 z-20 bg-sky-50 border-b border-sky-100 px-5 py-4 text-start text-xs font-bold text-gray-500 uppercase tracking-wide rounded-ss-2xl w-[44%]">
                    {c.table.featureCol}
                  </th>
                  {PLAN_ORDER.map((id, i) => (
                    <th
                      key={id}
                      scope="col"
                      className={`sticky top-0 lg:top-16 z-10 border-b border-sky-100 px-3 py-4 text-center ${
                        id === "enterprise" ? "bg-blue-50" : "bg-sky-50"
                      } ${i === PLAN_ORDER.length - 1 ? "rounded-se-2xl" : ""}`}
                    >
                      <span className={`block text-base font-extrabold ${id === "enterprise" ? "text-blue-700" : "text-gray-900"}`}>
                        {c.plans[id].name}
                      </span>
                      {id === "enterprise" && (
                        <span className="block text-[10px] font-bold uppercase tracking-wide text-blue-600 mt-0.5">{c.popular}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TABLE.map((cat) => (
                  <Fragment key={cat.id}>
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={4}
                        className="bg-gray-50 border-b border-sky-100 px-5 py-2.5 text-start text-xs font-bold text-blue-700 uppercase tracking-wider"
                      >
                        <span className="sticky start-5 inline-block">{c.table.categories[cat.id]}</span>
                      </th>
                    </tr>
                    {cat.rows.map((row) => (
                      <tr key={row.id} className="group">
                        <th
                          scope="row"
                          className="sticky start-0 z-[5] bg-white group-hover:bg-sky-50/60 border-b border-sky-50 px-5 py-3 text-start font-medium text-gray-800"
                        >
                          {c.table.rows[row.id]}
                        </th>
                        {row.cells.map((cell, i) => (
                          <td
                            key={i}
                            className={`border-b border-sky-50 px-3 py-3 text-center ${
                              PLAN_ORDER[i] === "enterprise" ? "bg-blue-50/40" : "group-hover:bg-sky-50/60"
                            }`}
                          >
                            <CellView cell={cell} copy={c} highlight={PLAN_ORDER[i] === "enterprise"} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr>
                  <td className="px-5 py-5" />
                  {PLAN_ORDER.map((id) => (
                    <td key={id} className="px-3 py-5 text-center">
                      <Link
                        href={contactHref}
                        className={`inline-flex items-center justify-center font-semibold text-xs px-4 py-2 rounded-2xl transition-all whitespace-nowrap ${
                          id === "enterprise"
                            ? "bg-blue-600 hover:bg-blue-700 text-white"
                            : "bg-white border border-sky-200 text-gray-800 hover:bg-sky-50"
                        }`}
                      >
                        {c.plans[id].cta}
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-5 text-xs text-gray-500 leading-relaxed max-w-4xl">{c.footnote}</p>
        </div>
      </section>

      {/* Options */}
      <section className="px-6 pb-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">{c.options.title}</h2>
            <p className="text-gray-500">{c.options.subtitle}</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {c.options.items.map((o, i) => {
              const Icon = OPTION_ICONS[i] ?? Server;
              return (
                <div key={o.title} className="bg-white rounded-2xl border border-sky-100 p-7 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-5">
                    <Icon className="w-5 h-5 text-white" aria-hidden />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{o.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{o.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Demo block */}
      <section className="py-20 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white relative overflow-hidden">
        <div className="absolute top-0 start-1/4 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none animate-blob" />
        <div className="absolute bottom-0 end-1/4 w-64 h-64 bg-indigo-400/20 rounded-full blur-3xl pointer-events-none animate-blob animation-delay-2000" />
        <div className="relative max-w-5xl mx-auto grid gap-10 md:grid-cols-2 items-center">
          <div className="text-center md:text-start">
            <h2 className="text-3xl font-extrabold mb-4">{c.demo.title}</h2>
            <p className="text-blue-100 text-lg leading-relaxed">{c.demo.body}</p>
          </div>
          <div>
            <ul className="space-y-3 mb-8">
              {c.demo.bullets.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0 text-blue-200" aria-hidden />
                  <span className="font-medium">{b}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href={contactHref} className="flex items-center justify-center gap-2 bg-white text-blue-600 font-semibold px-8 py-3.5 rounded-2xl hover:bg-blue-50 transition-all shadow-md hover:-translate-y-0.5">
                {c.demo.primary} <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden />
              </Link>
              <Link href={frameworksHref} className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-semibold px-8 py-3.5 rounded-2xl hover:bg-white/20 transition-all hover:-translate-y-0.5">
                {c.demo.secondary}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing FAQ */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-8 text-center">{c.faq.title}</h2>
          <div className="space-y-3">
            {c.faq.items.map((item) => (
              <details key={item.q} className="group bg-white rounded-2xl border border-sky-100 shadow-sm">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none px-6 py-4 font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
                  <span className="text-start">{item.q}</span>
                  <ChevronDown className="w-5 h-5 flex-shrink-0 text-gray-400 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="px-6 pb-5 text-sm text-gray-600 leading-relaxed">
                  <p>{item.a}</p>
                  {item.trial && (
                    <Link href="/register" className="mt-3 inline-flex items-center gap-1.5 text-blue-600 font-semibold hover:gap-2.5 transition-all">
                      {c.faq.trialLink} <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden />
                    </Link>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <SupportChat />
      <PublicFooter />
    </div>
  );
}
