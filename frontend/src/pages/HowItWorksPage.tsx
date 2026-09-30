import PublicFooter from "../components/landing/PublicFooter";
import SupportChat from "../components/landing/SupportChat";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PublicNav from "../components/landing/PublicNav";
import {
  ArrowRight, Bot, FileText, MessageSquare,
  Shield, ClipboardCheck, Sparkles, Lock, Upload, Send,
  AlertTriangle, BarChart3, Users, Globe,
} from "lucide-react";

const AI_FEATURES = [
  {
    icon: MessageSquare,
    color: "from-blue-500 to-indigo-600",
    title: "Vendor AI Chat",
    desc: "Negotiate contracts with vendors inside a secure collaboration portal. AI flags risky clauses in real time.",
  },
  {
    icon: FileText,
    color: "from-violet-500 to-purple-600",
    title: "AI Contract Review",
    desc: "Upload any contract and get a structured 6-section risk analysis — liability, data protection, SLA and more.",
  },
  {
    icon: Bot,
    color: "from-emerald-500 to-teal-600",
    title: "Document Generator",
    desc: "Generate 29 audit-ready GRC documents tailored to your industry, size, country, and active frameworks.",
  },
  {
    icon: ClipboardCheck,
    color: "from-amber-500 to-orange-500",
    title: "AI Gap Analysis",
    desc: "Upload your policies and the AI maps every clause to framework controls — a 6-week manual review in hours.",
  },
  {
    icon: Shield,
    color: "from-rose-500 to-pink-600",
    title: "Vendor Prescreen",
    desc: "15-question AI questionnaire scores every vendor before onboarding, flagging specific security concerns.",
  },
  {
    icon: Sparkles,
    color: "from-cyan-500 to-blue-500",
    title: "GRC AI Assistant",
    desc: "Ask anything about your compliance programme in plain language and get instant, contextual answers.",
  },
];

const GLOBAL_AI = [
  { icon: BarChart3, color: "bg-blue-100 text-blue-700", area: "Risk Quantification", impact: "Monte Carlo simulation quantifies risk in euros — ALE, SLE, P90, P95 — so the board sees financial exposure, not heatmap colours." },
  { icon: ClipboardCheck, color: "bg-violet-100 text-violet-700", area: "Compliance Assessments", impact: "Batch AI maps all your documents to every control simultaneously. Full ISO 27001 gap analysis in hours instead of 6–8 weeks." },
  { icon: Users, color: "bg-emerald-100 text-emerald-700", area: "Vendor Prescreening", impact: "AI scores 15-question security questionnaires and assigns a risk tier before any vendor is onboarded." },
  { icon: AlertTriangle, color: "bg-amber-100 text-amber-700", area: "Regulatory Monitoring", impact: "When a regulation updates, AI maps the new requirements to your existing controls and surfaces exactly what changed." },
  { icon: FileText, color: "bg-rose-100 text-rose-700", area: "Policy Generation", impact: "29 document types generated from 4 inputs — industry, size, country, frameworks. Audit-ready, not generic templates." },
  { icon: Globe, color: "bg-cyan-100 text-cyan-700", area: "Private by Design", impact: "Every AI feature runs on Ollama inside your own servers. Zero data egress. EU AI Act aligned. Air-gap capable." },
];

export default function HowItWorksPage() {
  const { t } = useTranslation();
  const navLinks = [
    { to: "/how-it-works", label: t("public.nav.how_it_works"), activeOn: "/how-it-works" },
    { to: "/features-landing", label: t("public.nav.features") },
    { to: "/solutions", label: t("public.nav.solutions") },
    { to: "/#frameworks", label: t("public.nav.frameworks"), hash: true },
    { to: "/blog", label: t("public.nav.blog") },
    { to: "/faq", label: t("public.nav.faq") },
    { to: "/contact", label: t("public.nav.contact") },
  ];

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav links={navLinks} />

      {/* ── Hero ── */}
      <section className="pt-20 pb-20 px-4 sm:px-6 text-center bg-gradient-to-b from-slate-50 via-blue-50/30 to-white">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
            <Bot className="w-4 h-4" />
            AI that runs inside your infrastructure — not outside it
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 leading-tight mb-6">
            How GRC Eye works —{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              powered by AI
            </span>
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed max-w-2xl mx-auto mb-10">
            From vendor negotiations to board reports, AI is embedded in every step of your GRC programme.
            Here is exactly what it does, how it works, and what you get at each stage.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-md"
            >
              Try all AI features free
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Book a live AI demo
            </Link>
          </div>
        </div>
      </section>

      {/* ── AI capabilities grid ── */}
      <section className="py-16 px-4 sm:px-6 border-y border-gray-100 bg-white">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-sm font-semibold text-gray-400 uppercase tracking-widest mb-10">
            Six AI capabilities — all running on your own servers
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {AI_FEATURES.map(({ icon: Icon, color, title, desc }) => (
              <div key={title} className="border border-gray-200 rounded-2xl p-5 hover:shadow-md transition-shadow">
                <div className={`w-10 h-10 bg-gradient-to-br ${color} rounded-xl flex items-center justify-center mb-3 shadow-sm`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-gray-900 mb-1">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Vendor Chat deep dive ── */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Vendor AI Chat</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4">Chat with your vendors inside GRC Eye</h2>
          <p className="text-gray-500 mb-10 max-w-2xl">
            Share a secure vendor portal link and negotiate contracts inside the platform. Every message, version, and clause annotation is logged automatically. No email threads.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {[
              { num: "01", title: "Invite vendor via secure link", body: "Generate an expiring, scoped link — no vendor account needed." },
              { num: "02", title: "Negotiate contracts live", body: "Annotate clauses, upload revisions, leave comments — all timestamped." },
              { num: "03", title: "AI flags risky clauses", body: "As the contract evolves, AI continuously detects liability gaps and missing GDPR clauses." },
              { num: "04", title: "CISO approval workflow", body: "One-click approval routes the final version through your CISO workflow." },
            ].map(({ num, title, body }) => (
              <div key={num} className="border border-gray-200 rounded-2xl p-5">
                <p className="text-2xl font-black text-gray-100 mb-2">{num}</p>
                <h3 className="font-bold text-gray-900 text-sm mb-1">{title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Contract Review deep dive ── */}
      <section className="py-20 px-4 sm:px-6 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-violet-700 uppercase tracking-wide">AI Contract Review</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4">Upload a contract — get a risk report in minutes</h2>
          <p className="text-gray-500 mb-10 max-w-2xl">
            The AI parses any PDF or DOCX contract and returns a structured analysis across 6 categories: Liability, Data Protection, SLA, Termination, IP &amp; Confidentiality, and Regulatory Compliance.
          </p>
          <div className="grid sm:grid-cols-2 gap-5">
            {[
              { icon: Upload, title: "Upload any contract", body: "PDF or DOCX — any size. The AI parses the full document with no character limits." },
              { icon: Bot, title: "6-section structured review", body: "Each section gets a risk rating (Critical / High / Medium / OK) and plain-English explanation." },
              { icon: AlertTriangle, title: "Clause-level flags", body: "Every risky clause is highlighted with a recommended action — not just a highlight." },
              { icon: Send, title: "CISO approval → vendor", body: "One-click approval, then the reviewed contract goes directly to the vendor portal." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-white border border-gray-200 rounded-2xl p-5 flex gap-4">
                <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-sm mb-1">{title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Document Generator deep dive ── */}
      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">AI Document Generator</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4">Generate any GRC document in seconds</h2>
          <p className="text-gray-500 mb-10 max-w-2xl">
            29 document types — policies, procedures, plans — generated from just 4 inputs: industry, company size, country, and active frameworks. Each document is tailored, not templated.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
            {[
              "Information Security Policy", "Incident Response Plan", "Business Continuity Plan",
              "Data Protection Policy (GDPR)", "Vendor Risk Management Policy", "AI Governance Policy (EU AI Act)",
              "SOC 2 Readiness Checklist", "DORA ICT Risk Policy", "ISO 27001 Statement of Applicability",
            ].map((doc, i) => (
              <div key={doc} className={`border rounded-xl px-4 py-3 text-sm font-medium ${i === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-gray-200 text-gray-600"}`}>
                {doc}
                {i === 0 && <span className="ml-2 text-xs bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded-full">Generating…</span>}
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-400 text-center">+ 20 more document types available</p>
        </div>
      </section>

      {/* ── Global AI impact ── */}
      <section className="py-20 px-4 sm:px-6 bg-[#E8F3FC]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4">AI embedded across every part of GRC Eye</h2>
            <p className="text-gray-500 max-w-2xl mx-auto">This is not a chatbot bolted on as an afterthought. AI is the execution layer of the entire platform.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {GLOBAL_AI.map(({ icon: Icon, color, area, impact }) => (
              <div key={area} className="bg-white border border-sky-100 rounded-2xl p-5 hover:shadow-md transition-shadow">
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

      {/* ── Privacy strip ── */}
      <section className="py-14 px-4 sm:px-6 bg-gradient-to-br from-slate-900 to-indigo-950 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <Lock className="w-10 h-10 text-blue-400 mx-auto mb-4" />
          <h2 className="text-2xl font-extrabold mb-3">Your data never leaves your infrastructure</h2>
          <p className="text-slate-300 mb-8 max-w-2xl mx-auto">
            Every AI feature runs on Ollama inside your own servers. No API calls to OpenAI, Anthropic, or any third party. Zero data egress. EU AI Act aligned. Air-gap capable.
          </p>
          <div className="flex flex-wrap gap-3 justify-center mb-8">
            {["Zero data egress", "On-premise LLM", "EU AI Act aligned", "Air-gap capable", "GDPR compliant by design"].map((tag) => (
              <span key={tag} className="bg-white/10 border border-white/20 text-sm font-semibold px-4 py-1.5 rounded-full text-white">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-4 sm:px-6 bg-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4">See the AI in action — free for 14 days</h2>
          <p className="text-gray-500 mb-8">Full AI access from day one. Document generation, contract review, gap analysis, and vendor chat all included.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/register"
              className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3.5 rounded-xl transition-colors shadow-lg"
            >
              Start free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center justify-center gap-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 font-semibold px-6 py-3.5 rounded-xl transition-colors"
            >
              Book a demo
            </Link>
          </div>
        </div>
      </section>

      <SupportChat />
      <PublicFooter />
    </div>
  );
}
