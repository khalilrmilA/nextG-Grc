"use client";
import Link from "next/link";
import PublicNav from "@/components/landing/PublicNav";
import PublicFooter from "@/components/landing/PublicFooter";
import { useI18n } from "@/i18n";
import {
  ArrowRight, CheckCircle2, Zap, MessageSquare, FileText,
  Shield, BarChart3, Users, Lock, Eye, Star, ChevronRight,
  Bot, Upload, ClipboardCheck, Building2, Sparkles, Globe,
  AlertTriangle, TrendingUp, Clock, Send,
} from "lucide-react";

const DOC_TYPES = [
  "Information Security Policy",
  "Risk Management Policy",
  "Incident Response Plan",
  "Business Continuity Plan",
  "Data Protection Policy (GDPR)",
  "Vendor Risk Management Policy",
  "Access Control Policy",
  "Patch Management Procedure",
  "Acceptable Use Policy",
  "Disaster Recovery Plan",
  "AI Governance Policy (EU AI Act)",
  "SOC 2 Readiness Checklist",
  "ISO 27001 Statement of Applicability",
  "DORA ICT Risk Policy",
  "NIS2 Security Baseline",
];

const CROSSWALK_STATIC = [
  { control: "Access Control Policy", fw1: "A.8.3", fw2: "CC6.1", fw3: "Art. 32", fw4: "PR.AC-1" },
  { control: "Encryption at Rest", fw1: "A.8.24", fw2: "CC6.7", fw3: "Art. 32(1)(a)", fw4: "PR.DS-1" },
  { control: "Incident Response Plan", fw1: "A.5.26", fw2: "CC7.3", fw3: "Art. 33", fw4: "RS.RP-1" },
  { control: "Vulnerability Management", fw1: "A.8.8", fw2: "CC7.1", fw3: "Rec. 2017/1584", fw4: "DE.CM-8" },
];

export default function HowItWorksView() {
  const { t } = useI18n();

  const AI_CAPABILITIES = [
    { icon: MessageSquare, color: "from-blue-500 to-indigo-600",  title: t("public.hiw.cap1_title"), desc: t("public.hiw.cap1_desc") },
    { icon: FileText,      color: "from-violet-500 to-purple-600", title: t("public.hiw.cap2_title"), desc: t("public.hiw.cap2_desc") },
    { icon: Bot,           color: "from-emerald-500 to-teal-600", title: t("public.hiw.cap3_title"), desc: t("public.hiw.cap3_desc") },
    { icon: ClipboardCheck,color: "from-amber-500 to-orange-500", title: t("public.hiw.cap4_title"), desc: t("public.hiw.cap4_desc") },
    { icon: Shield,        color: "from-rose-500 to-pink-600",    title: t("public.hiw.cap5_title"), desc: t("public.hiw.cap5_desc") },
    { icon: Sparkles,      color: "from-cyan-500 to-blue-500",    title: t("public.hiw.cap6_title"), desc: t("public.hiw.cap6_desc") },
  ];

  const VENDOR_CHAT_STEPS = [
    { num: "01", title: t("public.hiw.f01_s1_title"), body: t("public.hiw.f01_s1_body"), badge: t("public.hiw.f01_s1_badge") },
    { num: "02", title: t("public.hiw.f01_s2_title"), body: t("public.hiw.f01_s2_body"), badge: t("public.hiw.f01_s2_badge") },
    { num: "03", title: t("public.hiw.f01_s3_title"), body: t("public.hiw.f01_s3_body"), badge: t("public.hiw.f01_s3_badge") },
    { num: "04", title: t("public.hiw.f01_s4_title"), body: t("public.hiw.f01_s4_body"), badge: t("public.hiw.f01_s4_badge") },
  ];

  const CONTRACT_REVIEW_STEPS = [
    { label: t("public.hiw.f02_step1_label"), icon: Upload,       body: t("public.hiw.f02_step1_body") },
    { label: t("public.hiw.f02_step2_label"), icon: Bot,          body: t("public.hiw.f02_step2_body") },
    { label: t("public.hiw.f02_step3_label"), icon: Eye,          body: t("public.hiw.f02_step3_body") },
    { label: t("public.hiw.f02_step4_label"), icon: CheckCircle2, body: t("public.hiw.f02_step4_body") },
    { label: t("public.hiw.f02_step5_label"), icon: Send,         body: t("public.hiw.f02_step5_body") },
  ];

  const DOC_GEN_STEPS = [
    { step: "1", color: "bg-emerald-50 text-emerald-700 border-emerald-200", title: t("public.hiw.f03_s1_title"), body: t("public.hiw.f03_s1_body") },
    { step: "2", color: "bg-emerald-50 text-emerald-700 border-emerald-200", title: t("public.hiw.f03_s2_title"), body: t("public.hiw.f03_s2_body") },
    { step: "3", color: "bg-emerald-50 text-emerald-700 border-emerald-200", title: t("public.hiw.f03_s3_title"), body: t("public.hiw.f03_s3_body") },
    { step: "4", color: "bg-emerald-50 text-emerald-700 border-emerald-200", title: t("public.hiw.f03_s4_title"), body: t("public.hiw.f03_s4_body") },
  ];

  const GAP_CARDS = [
    { icon: Upload,        color: "from-amber-500 to-orange-500", title: t("public.hiw.f04_c1_title"), body: t("public.hiw.f04_c1_body") },
    { icon: Bot,           color: "from-amber-500 to-orange-500", title: t("public.hiw.f04_c2_title"), body: t("public.hiw.f04_c2_body") },
    { icon: AlertTriangle, color: "from-amber-500 to-orange-500", title: t("public.hiw.f04_c3_title"), body: t("public.hiw.f04_c3_body") },
  ];

  const PRESCREEN_CARDS = [
    { icon: ClipboardCheck, title: t("public.hiw.f05_c1_title"), body: t("public.hiw.f05_c1_body") },
    { icon: BarChart3,      title: t("public.hiw.f05_c2_title"), body: t("public.hiw.f05_c2_body") },
    { icon: AlertTriangle,  title: t("public.hiw.f05_c3_title"), body: t("public.hiw.f05_c3_body") },
  ];

  const AI_GLOBAL_IMPACTS = [
    { icon: BarChart3,      color: "bg-blue-100 text-blue-700",    area: t("public.hiw.gi1_area"), impact: t("public.hiw.gi1_impact") },
    { icon: ClipboardCheck, color: "bg-violet-100 text-violet-700", area: t("public.hiw.gi2_area"), impact: t("public.hiw.gi2_impact") },
    { icon: Users,          color: "bg-emerald-100 text-emerald-700", area: t("public.hiw.gi3_area"), impact: t("public.hiw.gi3_impact") },
    { icon: AlertTriangle,  color: "bg-amber-100 text-amber-700",  area: t("public.hiw.gi4_area"), impact: t("public.hiw.gi4_impact") },
    { icon: FileText,       color: "bg-rose-100 text-rose-700",    area: t("public.hiw.gi5_area"), impact: t("public.hiw.gi5_impact") },
    { icon: Globe,          color: "bg-cyan-100 text-cyan-700",    area: t("public.hiw.gi6_area"), impact: t("public.hiw.gi6_impact") },
  ];

  const PRIVACY_TAGS = [
    t("public.hiw.priv_t1"), t("public.hiw.priv_t2"), t("public.hiw.priv_t3"),
    t("public.hiw.priv_t4"), t("public.hiw.priv_t5"), t("public.hiw.priv_t6"),
  ];

  const PRIVACY_METRICS = [
    { metric: t("public.hiw.priv_m1_metric"), label: t("public.hiw.priv_m1_label") },
    { metric: t("public.hiw.priv_m2_metric"), label: t("public.hiw.priv_m2_label") },
    { metric: t("public.hiw.priv_m3_metric"), label: t("public.hiw.priv_m3_label") },
  ];

  const TESTIMONIALS = [
    { quote: t("public.hiw.t1_quote"), name: t("public.hiw.t1_name"), role: t("public.hiw.t1_role") },
    { quote: t("public.hiw.t2_quote"), name: t("public.hiw.t2_name"), role: t("public.hiw.t2_role") },
  ];

  const F06_TAGS = [
    t("public.hiw.f06_tag1"), t("public.hiw.f06_tag2"), t("public.hiw.f06_tag3"), t("public.hiw.f06_tag4"),
    t("public.hiw.f06_tag5"), t("public.hiw.f06_tag6"), t("public.hiw.f06_tag7"), t("public.hiw.f06_tag8"),
  ];

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      {/* ── Hero ── */}
      <section className="pt-20 pb-20 px-6 text-center bg-gradient-to-b from-slate-50 via-blue-50/30 to-white">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
            <Bot className="w-4 h-4" />
            {t("public.hiw.hero_badge")}
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            {t("public.hiw.hero_title_1")}{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              {t("public.hiw.hero_title_2")}
            </span>
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed max-w-2xl mx-auto mb-10">
            {t("public.hiw.hero_subtitle")}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg hover:shadow-blue-500/25"
            >
              {t("public.hiw.hero_cta_trial")}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:bg-gray-50 transition-colors"
            >
              {t("public.hiw.hero_cta_demo")}
            </Link>
          </div>
        </div>
      </section>

      {/* ── AI capability overview grid ── */}
      <section className="py-16 px-6 border-y border-gray-100 bg-white">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-sm font-semibold text-gray-400 uppercase tracking-widest mb-10">
            {t("public.hiw.caps_label")}
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {AI_CAPABILITIES.map(({ icon: Icon, color, title, desc }) => (
              <div key={title} className="border border-gray-200 rounded-2xl p-5 hover:shadow-md transition-shadow group">
                <div className={`w-10 h-10 bg-gradient-to-br ${color} rounded-xl flex items-center justify-center mb-3 shadow-sm group-hover:scale-105 transition-transform`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-gray-900 mb-1">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FEATURE 1: VENDOR AI CHAT
      ═══════════════════════════════════════════════ */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-blue-700 uppercase tracking-wide">{t("public.hiw.f01_label")}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t("public.hiw.f01_title")}</h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">{t("public.hiw.f01_subtitle")}</p>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <div className="space-y-6">
              {VENDOR_CHAT_STEPS.map(({ num, title, body, badge }) => (
                <div key={num} className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-center text-blue-700 font-bold text-sm">
                    {num}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
                      <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-0.5 rounded-full">{badge}</span>
                    </div>
                    <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Visual mock — intentionally kept in English as UI demo */}
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-white text-xs font-semibold">Vendor Collaboration Portal</p>
                  <p className="text-blue-300 text-xs">Acme Cloud Services · Contract v3</p>
                </div>
                <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 font-semibold px-2 py-0.5 rounded-full">Active</span>
              </div>
              <div className="space-y-3 mb-4">
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">Y</div>
                  <div className="bg-white/10 rounded-xl rounded-tl-none px-3 py-2 text-xs text-white/80 max-w-[80%]">
                    Section 4.2 — data retention clause needs updating to 90 days per our GDPR DPA.
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <div className="bg-blue-600/80 rounded-xl rounded-tr-none px-3 py-2 text-xs text-white max-w-[80%]">
                    Updated. Also revised the liability cap in 8.1 — please review.
                  </div>
                  <div className="w-6 h-6 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">V</div>
                </div>
                <div className="bg-amber-500/15 border border-amber-500/30 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span className="text-xs font-semibold text-amber-300">AI flag detected</span>
                  </div>
                  <p className="text-xs text-amber-200/80">Section 8.1: Liability cap of €50K is below threshold for a Critical-tier vendor. Suggest €250K minimum.</p>
                </div>
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">Y</div>
                  <div className="bg-white/10 rounded-xl rounded-tl-none px-3 py-2 text-xs text-white/80 max-w-[80%]">
                    Agreed — updating to €500K. Uploading v4 now.
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <input readOnly placeholder="Add a comment or upload a new version…" className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-xs text-white/60 placeholder-white/30 outline-none cursor-default" />
                <button className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Send className="w-3.5 h-3.5 text-white" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FEATURE 2: CONTRACT REVIEW
      ═══════════════════════════════════════════════ */}
      <section className="py-24 px-6 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-sm">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-violet-700 uppercase tracking-wide">{t("public.hiw.f02_label")}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t("public.hiw.f02_title")}</h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">{t("public.hiw.f02_subtitle")}</p>

          <div className="grid sm:grid-cols-5 gap-2 mb-14">
            {CONTRACT_REVIEW_STEPS.map(({ label, icon: Icon, body }, i) => (
              <div key={label} className="flex flex-col items-center text-center">
                <div className="relative w-full flex items-center justify-center mb-3">
                  {i < CONTRACT_REVIEW_STEPS.length - 1 && (
                    <div className="absolute left-1/2 top-5 w-full h-px bg-gray-200 hidden sm:block" />
                  )}
                  <div className="w-10 h-10 bg-white border-2 border-violet-200 rounded-full flex items-center justify-center z-10 shadow-sm">
                    <Icon className="w-4 h-4 text-violet-600" />
                  </div>
                </div>
                <p className="text-xs font-bold text-gray-900 mb-1">{label}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* Output mockup — intentionally in English as UI demo */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-violet-50/50">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-violet-600" />
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Acme_Cloud_MSA_v4.pdf</p>
                  <p className="text-xs text-gray-500">AI review complete · 47 pages analysed</p>
                </div>
              </div>
              <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-3 py-1 rounded-full">3 flags</span>
            </div>
            <div className="p-6 space-y-4">
              {[
                { section: "Data Protection", status: "Critical", statusColor: "bg-red-100 text-red-700", finding: "Section 4.2: No DPA reference. GDPR Art. 28 requires a Data Processing Agreement for all processors handling EU personal data.", action: "Request DPA addendum before signing." },
                { section: "Liability", status: "High", statusColor: "bg-amber-100 text-amber-700", finding: "Section 8.1: Liability cap of €50K is disproportionate to contract value (€420K/year). Recommended minimum: €420K (1× annual value).", action: "Negotiate cap to at least 1× annual contract value." },
                { section: "SLA & Uptime", status: "OK", statusColor: "bg-emerald-100 text-emerald-700", finding: "Section 6: 99.9% uptime SLA with 4-hour RTO and defined credit mechanism. Meets your DORA ICT continuity requirements.", action: "No action required." },
              ].map(({ section, status, statusColor, finding, action }) => (
                <div key={section} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold text-gray-900">{section}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor}`}>{status}</span>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">{finding}</p>
                  <p className="text-xs font-semibold text-blue-700">→ {action}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FEATURE 3: DOCUMENT GENERATOR
      ═══════════════════════════════════════════════ */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-sm">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">{t("public.hiw.f03_label")}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t("public.hiw.f03_title")}</h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">{t("public.hiw.f03_subtitle")}</p>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <div className="space-y-5">
              {DOC_GEN_STEPS.map(({ step, color, title, body }) => (
                <div key={step} className="flex gap-4">
                  <div className={`flex-shrink-0 w-9 h-9 border rounded-xl flex items-center justify-center font-bold text-sm ${color}`}>
                    {step}
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm mb-1">{title}</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
                <Bot className="w-4 h-4 text-emerald-400" />
                <p className="text-sm font-semibold text-white">AI Document Generator</p>
                <span className="ml-auto text-xs text-emerald-400 font-semibold">29 types available</span>
              </div>
              <div className="space-y-1.5 mb-4">
                {DOC_TYPES.map((doc, i) => (
                  <div key={doc} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${i === 0 ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold" : "text-white/60 hover:bg-white/5"}`}>
                    <FileText className={`w-3 h-3 flex-shrink-0 ${i === 0 ? "text-emerald-400" : "text-white/30"}`} />
                    {doc}
                    {i === 0 && <span className="ml-auto text-xs bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded-full">Generating…</span>}
                  </div>
                ))}
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-xs text-emerald-400 font-semibold mb-2">Live output preview</p>
                <p className="text-xs text-white/70 leading-relaxed">
                  <span className="text-white">1. Purpose and Scope</span>
                  <br />
                  This Information Security Policy establishes the security requirements for all information assets owned or managed by [Company]. It applies to all employees, contractors, and third-party vendors with access to company systems…
                  <span className="inline-block w-1.5 h-3.5 bg-emerald-400 ml-0.5 animate-pulse" />
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FEATURE 4: AI GAP ANALYSIS
      ═══════════════════════════════════════════════ */}
      <section className="py-24 px-6 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center shadow-sm">
              <ClipboardCheck className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-amber-700 uppercase tracking-wide">{t("public.hiw.f04_label")}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t("public.hiw.f04_title")}</h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">{t("public.hiw.f04_subtitle")}</p>

          <div className="grid lg:grid-cols-3 gap-6 mb-12">
            {GAP_CARDS.map(({ icon: Icon, color, title, body }) => (
              <div key={title} className="bg-white border border-gray-200 rounded-2xl p-6">
                <div className={`w-10 h-10 bg-gradient-to-br ${color} rounded-xl flex items-center justify-center mb-4 shadow-sm`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-gray-900 mb-2 text-sm">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* Gap report mockup */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="font-semibold text-gray-900">ISO 27001:2022 — Gap Analysis Report</p>
              <div className="flex gap-3 text-xs font-semibold">
                <span className="text-red-600">4 Critical</span>
                <span className="text-amber-600">12 High</span>
                <span className="text-blue-600">23 Medium</span>
                <span className="text-emerald-600">57 OK</span>
              </div>
            </div>
            <div className="p-6 space-y-3">
              {[
                { id: "A.8.8", title: "Management of technical vulnerabilities", severity: "Critical", severityColor: "bg-red-100 text-red-700", gap: "No formal vulnerability management programme documented. CVE tracking is informal.", fix: "Implement a vulnerability management policy and register all CVEs in the platform." },
                { id: "A.5.23", title: "Information security for cloud services", severity: "High", severityColor: "bg-amber-100 text-amber-700", gap: "Cloud provider SLAs are not reviewed against security requirements annually.", fix: "Add annual cloud provider review to vendor management programme." },
                { id: "A.6.3", title: "Information security awareness and training", severity: "Medium", severityColor: "bg-blue-100 text-blue-700", gap: "Training records exist but are not formally tracked against the full employee population.", fix: "Use the Policy Attestation module to record and track annual training completion." },
              ].map(({ id, title, severity, severityColor, gap, fix }) => (
                <div key={id} className="border border-gray-100 rounded-xl p-4 flex gap-4">
                  <div className="w-16 text-center">
                    <p className="text-xs font-mono font-bold text-gray-400 mb-1">{id}</p>
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${severityColor}`}>{severity}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-gray-900 mb-1">{title}</p>
                    <p className="text-xs text-gray-500 mb-1.5">{gap}</p>
                    <p className="text-xs text-blue-700 font-semibold">→ AI suggestion: {fix}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FEATURE 5: VENDOR PRESCREEN
      ═══════════════════════════════════════════════ */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-gradient-to-br from-rose-500 to-pink-600 rounded-xl flex items-center justify-center shadow-sm">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-rose-700 uppercase tracking-wide">{t("public.hiw.f05_label")}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t("public.hiw.f05_title")}</h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">{t("public.hiw.f05_subtitle")}</p>

          <div className="grid sm:grid-cols-3 gap-6 mb-12">
            {PRESCREEN_CARDS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="border border-gray-200 rounded-2xl p-5">
                <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5 text-rose-600" />
                </div>
                <h3 className="font-bold text-gray-900 mb-2 text-sm">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          FEATURE 6: GRC AI ASSISTANT
      ═══════════════════════════════════════════════ */}
      <section className="py-24 px-6 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center shadow-sm">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-cyan-700 uppercase tracking-wide">{t("public.hiw.f06_label")}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t("public.hiw.f06_title")}</h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">{t("public.hiw.f06_subtitle")}</p>

          <div className="grid lg:grid-cols-2 gap-10 items-start">
            {/* Q&A examples — kept in English as demo content */}
            <div className="space-y-4">
              {[
                { q: "What's the difference between ISO 27001 and NIS2 for my FinTech?", a: "ISO 27001 is a voluntary certification you pursue to demonstrate ISMS maturity to customers and partners. NIS2 is an EU legal obligation enforced by national authorities — non-compliance carries fines up to €10M or 2% of global turnover. For a FinTech, you likely need both: ISO 27001 to win enterprise deals, NIS2 to operate legally within the EU." },
                { q: "How many ISO 27001 controls do we currently have evidence for?", a: "Based on your active assessment, you have evidence uploaded for 67 of 93 Annex A controls (72%). 8 controls are marked Critical-gap with no evidence. Would you like me to list the open critical controls?" },
                { q: "What does DORA require for third-party ICT risk?", a: "Under DORA Article 28, you must: (1) maintain a register of all ICT third-party providers, (2) classify them by criticality, (3) include mandatory contractual clauses on audit rights and exit strategies, and (4) conduct at minimum annual risk assessments of critical providers. GRCEye's vendor module covers all four requirements." },
              ].map(({ q, a }) => (
                <div key={q} className="border border-gray-200 rounded-2xl p-5 bg-white">
                  <div className="flex items-start gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-blue-700 text-xs font-bold">Q</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{q}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-3 h-3 text-white" />
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">{a}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-5">
              <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <p className="text-sm font-semibold text-white">GRC AI Assistant</p>
                  <span className="ml-auto w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                </div>
                <div className="space-y-3 mb-4">
                  <div className="bg-white/10 rounded-xl p-3 text-xs text-white/80 leading-relaxed">
                    Hello! I can answer questions about your compliance programme, frameworks, risks, vendor status, and any GRC topics. What would you like to know?
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 bg-white/10 rounded-xl p-3 text-xs text-white/60">
                      What&apos;s our current compliance score across all frameworks?
                    </div>
                  </div>
                  <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 text-xs text-white/80 leading-relaxed">
                    <span className="text-cyan-300 font-semibold">Across your 3 active frameworks:</span><br />
                    ISO 27001: 72% · SOC 2: 84% · GDPR: 61%<br />
                    Your lowest area is GDPR — 8 critical gaps remain open. The most pressing is Article 30 (Records of Processing Activities). Assign it?
                  </div>
                </div>
                <div className="flex gap-2">
                  <input readOnly placeholder="Ask about your GRC programme…" className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-xs text-white/50 placeholder-white/30 outline-none cursor-default" />
                  <button className="w-8 h-8 bg-cyan-600 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Send className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              </div>

              <div className="border border-gray-200 rounded-2xl p-5 bg-white">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t("public.hiw.f06_tags_label")}</p>
                <div className="flex flex-wrap gap-2">
                  {F06_TAGS.map((tag) => (
                    <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-medium">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How AI helps globally ── */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t("public.hiw.ga_title")}</h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">{t("public.hiw.ga_subtitle")}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {AI_GLOBAL_IMPACTS.map(({ icon: Icon, color, area, impact }) => (
              <div key={area} className="border border-gray-200 rounded-2xl p-5 hover:shadow-md transition-shadow">
                <div className={`w-9 h-9 ${color} rounded-xl flex items-center justify-center mb-3`}>
                  <Icon className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-gray-900 mb-2 text-sm">{area}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{impact}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Privacy & trust ── */}
      <section className="py-16 px-6 bg-gradient-to-br from-slate-900 to-indigo-950 text-white">
        <div className="max-w-4xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Lock className="w-5 h-5 text-blue-400" />
                <span className="text-sm font-semibold text-blue-300 uppercase tracking-wide">{t("public.hiw.priv_badge")}</span>
              </div>
              <h2 className="text-3xl font-extrabold mb-4">{t("public.hiw.priv_title")}</h2>
              <p className="text-slate-300 leading-relaxed mb-6">{t("public.hiw.priv_subtitle")}</p>
              <div className="grid grid-cols-2 gap-3">
                {PRIVACY_TAGS.map((tag) => (
                  <div key={tag} className="flex items-center gap-2 text-sm text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    {tag}
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              {PRIVACY_METRICS.map(({ metric, label }) => (
                <div key={label} className="bg-white/10 border border-white/20 rounded-2xl px-6 py-4 flex items-center gap-4">
                  <p className="text-3xl font-extrabold text-white">{metric}</p>
                  <p className="text-sm text-slate-300">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Social proof ── */}
      <section className="py-16 px-6 bg-white">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 gap-6">
          {TESTIMONIALS.map(({ quote, name, role }) => (
            <div key={name} className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white">
              <Star className="w-5 h-5 text-yellow-300 mb-3 fill-yellow-300" />
              <p className="text-sm leading-relaxed italic mb-4 text-blue-100">&quot;{quote}&quot;</p>
              <div>
                <p className="font-semibold text-sm">{name}</p>
                <p className="text-blue-300 text-xs">{role}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">{t("public.hiw.cta_title")}</h2>
          <p className="text-lg text-blue-100 mb-8">{t("public.hiw.cta_subtitle")}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center justify-center gap-2 bg-white text-blue-700 font-bold px-6 py-3.5 rounded-xl hover:bg-blue-50 transition-colors shadow-lg"
            >
              {t("public.hiw.cta_trial")}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold px-6 py-3.5 rounded-xl transition-colors"
            >
              <TrendingUp className="w-4 h-4" />
              {t("public.hiw.cta_demo")}
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
