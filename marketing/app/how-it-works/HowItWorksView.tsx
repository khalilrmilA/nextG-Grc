"use client";
import Link from "next/link";
import PublicNav from "@/components/landing/PublicNav";
import PublicFooter from "@/components/landing/PublicFooter";
import {
  ArrowRight, CheckCircle2, Zap, MessageSquare, FileText,
  Shield, BarChart3, Users, Lock, Eye, Star, ChevronRight,
  Bot, Upload, ClipboardCheck, Building2, Sparkles, Globe,
  AlertTriangle, TrendingUp, Clock, Send,
} from "lucide-react";

/* ─── AI capability cards shown in the overview grid ─── */
const AI_CAPABILITIES = [
  {
    icon: MessageSquare,
    color: "from-blue-500 to-indigo-600",
    title: "Vendor AI Chat",
    desc: "Communicate with vendors and exchange contract drafts inside the platform — no email, no attachments.",
  },
  {
    icon: FileText,
    color: "from-violet-500 to-purple-600",
    title: "Contract Review",
    desc: "Upload any contract and the AI returns a structured 6-section analysis with risk flags in minutes.",
  },
  {
    icon: Bot,
    color: "from-emerald-500 to-teal-600",
    title: "Document Generator",
    desc: "Generate any of 29 GRC document types — policies, procedures, plans — fully tailored to your org.",
  },
  {
    icon: ClipboardCheck,
    color: "from-amber-500 to-orange-500",
    title: "Gap Analysis",
    desc: "The AI reads your existing policies and maps every clause to the relevant framework controls automatically.",
  },
  {
    icon: Shield,
    color: "from-rose-500 to-pink-600",
    title: "Vendor Prescreen",
    desc: "Before onboarding any vendor, the AI runs a 15-question risk questionnaire and scores the response.",
  },
  {
    icon: Sparkles,
    color: "from-cyan-500 to-blue-500",
    title: "GRC Assistant",
    desc: "Ask anything about your compliance programme in plain language and get instant, contextual answers.",
  },
];

/* ─── Step-by-step flows for each AI feature ─── */
const VENDOR_CHAT_STEPS = [
  {
    num: "01",
    title: "Invite vendor to a collaboration session",
    body: "From any vendor record, click Share and GRCEye generates a secure, expiring link. The vendor gets access to a scoped portal — no platform account needed.",
    badge: "Vendor portal",
  },
  {
    num: "02",
    title: "Negotiate contracts inside the platform",
    body: "Both sides can annotate clauses, leave comments, and upload revised versions. Every exchange is timestamped and logged. No email threads, no version confusion.",
    badge: "Live collaboration",
  },
  {
    num: "03",
    title: "AI flags risky clauses in real time",
    body: "As the contract evolves, the AI continuously flags liability gaps, missing SLA definitions, ambiguous data-handling clauses, and GDPR conflicts — before you sign.",
    badge: "AI risk detection",
  },
  {
    num: "04",
    title: "CISO approves. Status updates automatically.",
    body: "When the final version is agreed, the vendor submission triggers the CISO approval workflow. One click to approve. The contract status updates everywhere in GRCEye.",
    badge: "Approval workflow",
  },
];

const CONTRACT_REVIEW_STEPS = [
  {
    label: "Upload",
    icon: Upload,
    body: "Drag any PDF or DOCX contract into GRCEye. The AI parses the full document instantly — no character limits, no manual copy-paste.",
  },
  {
    label: "AI analyses",
    icon: Bot,
    body: "The AI reads every clause and produces a structured report across 6 categories: Liability, Data Protection, SLA, Termination, IP & Confidentiality, and Regulatory Compliance.",
  },
  {
    label: "Review flags",
    icon: Eye,
    body: "Each flagged clause is explained in plain English with the risk level (Critical / High / Medium) and a recommended action — not just a highlight.",
  },
  {
    label: "CISO approves",
    icon: CheckCircle2,
    body: "The structured review is sent to the CISO for a single approve/reject decision. No back-and-forth. No interpreting raw legal text.",
  },
  {
    label: "Sent to vendor",
    icon: Send,
    body: "Once approved, the contract is shared back to the vendor directly through their collaboration portal. Full chain of custody — no email attachments.",
  },
];

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

const AI_GLOBAL_IMPACTS = [
  {
    icon: BarChart3,
    color: "bg-blue-100 text-blue-700",
    area: "Risk Management",
    impact: "Monte Carlo simulation runs 10,000 iterations in seconds. AI quantifies risk in euros (ALE, SLE, P90, P95) so the board sees financial exposure, not just a red square on a heatmap.",
  },
  {
    icon: ClipboardCheck,
    color: "bg-violet-100 text-violet-700",
    area: "Compliance Assessments",
    impact: "Batch AI assessment maps all your uploaded documents to every control in a framework simultaneously. A full ISO 27001 gap analysis that used to take 6–8 weeks now takes hours.",
  },
  {
    icon: Users,
    color: "bg-emerald-100 text-emerald-700",
    area: "Vendor Prescreening",
    impact: "Before any vendor is onboarded, the AI asks 15 targeted security questions, scores the answers, calculates a risk tier, and flags specific concerns for the security team to review.",
  },
  {
    icon: AlertTriangle,
    color: "bg-amber-100 text-amber-700",
    area: "Regulatory Monitoring",
    impact: "When a new regulation or framework update is published, the AI analyses its requirements, maps them to your existing controls, and surfaces the delta so your team knows exactly what changed.",
  },
  {
    icon: FileText,
    color: "bg-rose-100 text-rose-700",
    area: "Policy Generation",
    impact: "29 document types generated from a 4-field context form — industry, company size, country, active frameworks. The AI tailors every sentence. Output is audit-ready, not a generic template.",
  },
  {
    icon: Globe,
    color: "bg-cyan-100 text-cyan-700",
    area: "Your Infrastructure",
    impact: "Every AI feature — chat, document gen, contract review, gap analysis — runs on Ollama inside your own servers. Zero data egress. Suitable for air-gapped and EU-only environments.",
  },
];

export default function HowItWorksView() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      {/* ── Hero ── */}
      <section className="pt-20 pb-20 px-6 text-center bg-gradient-to-b from-slate-50 via-blue-50/30 to-white">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
            <Bot className="w-4 h-4" />
            AI that runs inside your infrastructure — not outside it
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            How GRCEye works —{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              powered by AI
            </span>
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed max-w-2xl mx-auto mb-10">
            From vendor negotiations to board reports, AI is embedded in every step of your GRC programme.
            Here is exactly what it does, how it works, and what you get at each stage.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg hover:shadow-blue-500/25"
            >
              Try all AI features free
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Book a live AI demo
            </Link>
          </div>
        </div>
      </section>

      {/* ── AI capability overview grid ── */}
      <section className="py-16 px-6 border-y border-gray-100 bg-white">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-sm font-semibold text-gray-400 uppercase tracking-widest mb-10">
            Six AI capabilities — all running on your own servers
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
            <span className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Feature 01</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            Chat with your vendors — inside GRCEye
          </h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">
            Vendor negotiations, contract exchanges, and approval workflows happen entirely inside the platform.
            No email threads. No lost attachments. Every message and version is logged automatically.
          </p>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Steps */}
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

            {/* Visual mock */}
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
              {/* Chat messages */}
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
                <input
                  readOnly
                  placeholder="Add a comment or upload a new version…"
                  className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-xs text-white/60 placeholder-white/30 outline-none cursor-default"
                />
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
            <span className="text-sm font-semibold text-violet-700 uppercase tracking-wide">Feature 02</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            AI contract review — from upload to approval in minutes
          </h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">
            Upload any vendor contract and the AI produces a structured, 6-section risk analysis —
            flagging every problematic clause with its risk level and a plain-English explanation.
            No legal team required for initial screening.
          </p>

          {/* Pipeline steps */}
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

          {/* Output mockup */}
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
                {
                  section: "Data Protection",
                  status: "Critical",
                  statusColor: "bg-red-100 text-red-700",
                  finding: "Section 4.2: No DPA reference. GDPR Art. 28 requires a Data Processing Agreement for all processors handling EU personal data.",
                  action: "Request DPA addendum before signing.",
                },
                {
                  section: "Liability",
                  status: "High",
                  statusColor: "bg-amber-100 text-amber-700",
                  finding: "Section 8.1: Liability cap of €50K is disproportionate to contract value (€420K/year). Recommended minimum: €420K (1× annual value).",
                  action: "Negotiate cap to at least 1× annual contract value.",
                },
                {
                  section: "SLA & Uptime",
                  status: "OK",
                  statusColor: "bg-emerald-100 text-emerald-700",
                  finding: "Section 6: 99.9% uptime SLA with 4-hour RTO and defined credit mechanism. Meets your DORA ICT continuity requirements.",
                  action: "No action required.",
                },
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
            <span className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Feature 03</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            Generate any GRC document in seconds
          </h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">
            Stop writing policies from scratch. The AI generates complete, audit-ready documents tailored to
            your organisation&apos;s industry, size, country, and active compliance frameworks — not a generic template.
          </p>

          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* How it works */}
            <div className="space-y-5">
              {[
                {
                  step: "1",
                  color: "bg-emerald-50 text-emerald-700 border-emerald-200",
                  title: "Choose your document type",
                  body: "29 types across four categories: Foundation (security policies, risk policy), Security (incident response, access control, patch management), Procedures (GDPR, vendor risk), and Plans (BCP, DR, DORA ICT).",
                },
                {
                  step: "2",
                  color: "bg-emerald-50 text-emerald-700 border-emerald-200",
                  title: "Set your organisation context",
                  body: "Four inputs: industry, company size, country, and active frameworks. That is all. The AI reads this context and writes a document specific to your regulatory environment — not a US startup template if you are a European FinTech.",
                },
                {
                  step: "3",
                  color: "bg-emerald-50 text-emerald-700 border-emerald-200",
                  title: "AI streams output in real time",
                  body: "Watch the document write itself — character by character — so you can stop generation early if you want to redirect. A full 3,000-word policy typically takes under 30 seconds.",
                },
                {
                  step: "4",
                  color: "bg-emerald-50 text-emerald-700 border-emerald-200",
                  title: "Save as Draft or Approve & Publish",
                  body: "One click to save as a versioned Policy record. The approval workflow routes it to the right reviewer. Once approved, send attestation requests to every employee — and track who has acknowledged it.",
                },
              ].map(({ step, color, title, body }) => (
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

            {/* Document type list */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
                <Bot className="w-4 h-4 text-emerald-400" />
                <p className="text-sm font-semibold text-white">AI Document Generator</p>
                <span className="ml-auto text-xs text-emerald-400 font-semibold">29 types available</span>
              </div>
              <div className="space-y-1.5 mb-4">
                {DOC_TYPES.map((doc, i) => (
                  <div
                    key={doc}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                      i === 0
                        ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold"
                        : "text-white/60 hover:bg-white/5"
                    }`}
                  >
                    <FileText className={`w-3 h-3 flex-shrink-0 ${i === 0 ? "text-emerald-400" : "text-white/30"}`} />
                    {doc}
                    {i === 0 && (
                      <span className="ml-auto text-xs bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded-full">Generating…</span>
                    )}
                  </div>
                ))}
              </div>
              {/* Streaming text preview */}
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
            <span className="text-sm font-semibold text-amber-700 uppercase tracking-wide">Feature 04</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            AI gap analysis — 6 weeks of manual review in a few hours
          </h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">
            Upload your existing policies and procedures. The AI reads every document, maps each clause to the
            relevant framework controls, and produces a prioritised gap report — with plain-language explanations
            and draft remediation steps.
          </p>

          <div className="grid lg:grid-cols-3 gap-6 mb-12">
            {[
              {
                icon: Upload,
                color: "from-amber-500 to-orange-500",
                title: "Upload once, cover all frameworks",
                body: "Evidence uploaded against one control automatically satisfies all mapped controls across every active framework. Upload your Access Control Policy once and GRCEye marks it against ISO 27001, SOC 2, and GDPR simultaneously.",
              },
              {
                icon: Bot,
                color: "from-amber-500 to-orange-500",
                title: "AI reads and classifies",
                body: "Each document is processed by the AI against the full control set. It reads clause-by-clause, identifies relevant controls, and assigns a confidence score to each mapping — so you know which mappings to review first.",
              },
              {
                icon: AlertTriangle,
                color: "from-amber-500 to-orange-500",
                title: "Gaps prioritised by severity",
                body: "Missing controls are rated Critical, High, or Medium with AI-generated remediation steps. The report is ready in hours — not the 6–8 weeks a manual assessment would take.",
              },
            ].map(({ icon: Icon, color, title, body }) => (
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
                {
                  id: "A.8.8",
                  title: "Management of technical vulnerabilities",
                  severity: "Critical",
                  severityColor: "bg-red-100 text-red-700",
                  gap: "No formal vulnerability management programme documented. CVE tracking is informal.",
                  fix: "Implement a vulnerability management policy and register all CVEs in the platform.",
                },
                {
                  id: "A.5.23",
                  title: "Information security for cloud services",
                  severity: "High",
                  severityColor: "bg-amber-100 text-amber-700",
                  gap: "Cloud provider SLAs are not reviewed against security requirements annually.",
                  fix: "Add annual cloud provider review to vendor management programme.",
                },
                {
                  id: "A.6.3",
                  title: "Information security awareness and training",
                  severity: "Medium",
                  severityColor: "bg-blue-100 text-blue-700",
                  gap: "Training records exist but are not formally tracked against the full employee population.",
                  fix: "Use the Policy Attestation module to record and track annual training completion.",
                },
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
            <span className="text-sm font-semibold text-rose-700 uppercase tracking-wide">Feature 05</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            AI vendor prescreening — before you sign anything
          </h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">
            Before onboarding any third-party vendor, the AI runs a 15-question security questionnaire,
            analyses the responses, calculates a risk score and tier, and flags specific concerns —
            so your security team reviews risk-ranked vendors, not raw questionnaire answers.
          </p>

          <div className="grid sm:grid-cols-3 gap-6 mb-12">
            {[
              {
                icon: ClipboardCheck,
                title: "15 targeted questions",
                body: "Covering data handling, access controls, incident response capability, certifications held (ISO/SOC 2), sub-processor disclosure, and GDPR/DORA alignment.",
              },
              {
                icon: BarChart3,
                title: "AI-scored response",
                body: "Each answer is assessed for completeness, consistency, and red flags. The AI assigns a 0–100 risk score and maps the vendor to a tier: Critical, High, Medium, or Low.",
              },
              {
                icon: AlertTriangle,
                title: "Specific risk flags surfaced",
                body: "Rather than a single score, the AI identifies which specific areas are concerning — e.g., 'No documented incident response plan' — so reviewers know exactly where to dig.",
              },
            ].map(({ icon: Icon, title, body }) => (
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
            <span className="text-sm font-semibold text-cyan-700 uppercase tracking-wide">Feature 06</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            Ask the GRC AI assistant anything
          </h2>
          <p className="text-lg text-gray-500 mb-14 max-w-2xl">
            The built-in GRC assistant answers questions about your compliance programme, frameworks, and risk
            posture in plain language — instantly. No Googling regulation text, no waiting for a consultant.
          </p>

          <div className="grid lg:grid-cols-2 gap-10 items-start">
            <div className="space-y-4">
              {[
                {
                  q: "What's the difference between ISO 27001 and NIS2 for my FinTech?",
                  a: "ISO 27001 is a voluntary certification you pursue to demonstrate ISMS maturity to customers and partners. NIS2 is an EU legal obligation enforced by national authorities — non-compliance carries fines up to €10M or 2% of global turnover. For a FinTech, you likely need both: ISO 27001 to win enterprise deals, NIS2 to operate legally within the EU.",
                },
                {
                  q: "How many ISO 27001 controls do we currently have evidence for?",
                  a: "Based on your active assessment, you have evidence uploaded for 67 of 93 Annex A controls (72%). 8 controls are marked Critical-gap with no evidence. Would you like me to list the open critical controls?",
                },
                {
                  q: "What does DORA require for third-party ICT risk?",
                  a: "Under DORA Article 28, you must: (1) maintain a register of all ICT third-party providers, (2) classify them by criticality, (3) include mandatory contractual clauses on audit rights and exit strategies, and (4) conduct at minimum annual risk assessments of critical providers. GRCEye's vendor module covers all four requirements.",
                },
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
                    Hello! I can answer questions about your compliance programme, frameworks, risks, vendor status,
                    and any GRC topics. What would you like to know?
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
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Common question types</p>
                <div className="flex flex-wrap gap-2">
                  {["Framework differences", "Control status", "Gap counts", "Vendor risk tiers", "Regulation deadlines", "Policy review dates", "Audit findings", "Risk scores"].map((tag) => (
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
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              AI embedded across every part of GRCEye
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              This is not a chatbot bolted on as an afterthought. AI is the execution layer of the entire platform.
            </p>
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
                <span className="text-sm font-semibold text-blue-300 uppercase tracking-wide">On-premise AI</span>
              </div>
              <h2 className="text-3xl font-extrabold mb-4">
                Your data never leaves your infrastructure
              </h2>
              <p className="text-slate-300 leading-relaxed mb-6">
                Every AI feature in GRCEye runs on Ollama — an open-source local LLM runtime — deployed inside your
                own servers or private cloud. No API calls to OpenAI, Anthropic, or any third party.
                Your contracts, policies, vendor responses, and compliance data stay where they belong: with you.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {["Zero data egress", "On-premise LLM", "EU AI Act aligned", "Air-gap capable", "GDPR compliant by design", "No vendor lock-in"].map((tag) => (
                  <div key={tag} className="flex items-center gap-2 text-sm text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    {tag}
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              {[
                { metric: "0 bytes", label: "Sent to external AI providers" },
                { metric: "100%", label: "Runs on your infrastructure" },
                { metric: "EU AI Act", label: "Article 9–12 aligned governance" },
              ].map(({ metric, label }) => (
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
          {[
            {
              quote: "The AI contract review caught a missing DPA clause that our legal team had missed in three rounds of manual review. That one flag alone justified the platform cost for the year.",
              name: "Thomas R.",
              role: "CISO, Series C FinTech — Frankfurt",
            },
            {
              quote: "We generated all 29 GRC documents in an afternoon. Tailored to our industry, our frameworks, our country. That would have been weeks of consulting fees with our previous approach.",
              name: "Amira K.",
              role: "Head of Compliance, SaaS Scaleup — Paris",
            },
          ].map(({ quote, name, role }) => (
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
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
            See the AI in action — in your browser, in 2 minutes
          </h2>
          <p className="text-lg text-blue-100 mb-8">
            Start a free 14-day trial. No credit card. No setup. Full AI access from day one —
            document generation, contract review, gap analysis, and vendor chat all included.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center justify-center gap-2 bg-white text-blue-700 font-bold px-6 py-3.5 rounded-xl hover:bg-blue-50 transition-colors shadow-lg"
            >
              Start free trial
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold px-6 py-3.5 rounded-xl transition-colors"
            >
              <TrendingUp className="w-4 h-4" />
              Book a live demo
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
