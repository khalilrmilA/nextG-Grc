"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ChevronDown, FileText, ExternalLink } from "lucide-react";
import PublicNav from "@/components/landing/PublicNav";
import { FAQ_ITEMS } from "./faqData";

function FAQAccordion({ category, items }: { category: string; items: Array<{ q: string; a: string }> }) {
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="mb-12">
      <h3 className="text-xl font-bold text-gray-900 mb-5 pb-3 border-b border-gray-100">{category}</h3>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden hover:border-blue-200 transition-colors">
            <button
              onClick={() => setExpanded(expanded === idx ? null : idx)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
            >
              <span className="font-semibold text-gray-900 pr-4">{item.q}</span>
              <ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${expanded === idx ? "rotate-180" : ""}`} />
            </button>
            {expanded === idx && (
              <div className="px-6 py-4 bg-blue-50/50 border-t border-gray-200">
                <p className="text-gray-700 leading-relaxed text-sm">{item.a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FAQView() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      <section className="pt-16 pb-16 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed">
            Everything you need to know about GRCEye — features, modules, AI capabilities, and how it all works.
          </p>
        </div>
      </section>

      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">

          <div className="mb-12 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg shadow-blue-500/20">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white font-bold text-lg leading-tight">GRCEye Product Datasheet</p>
                <p className="text-blue-100 text-sm mt-0.5">Full feature breakdown, AI capabilities, architecture overview, and module details.</p>
              </div>
            </div>
            <a
              href="/datasheets/GRCEye_Datasheet_2026.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-white text-blue-700 font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-50 transition-colors flex-shrink-0 shadow-sm"
            >
              View Datasheet <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {FAQ_ITEMS.map((section, idx) => (
            <FAQAccordion key={idx} category={section.category} items={section.items} />
          ))}
        </div>
      </section>

      <section className="px-6 py-20 bg-gradient-to-br from-blue-50 to-indigo-50 border-t border-blue-100">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Still have questions?</h2>
          <p className="text-gray-600 mb-8 leading-relaxed">Can&apos;t find the answer you&apos;re looking for? Our support team is here to help you get started.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="mailto:support@grceye.io" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors shadow-sm">
              Email support <ArrowRight className="w-4 h-4" />
            </a>
            <Link href="/register" className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold px-8 py-3.5 rounded-xl transition-colors">
              Try it for free
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
