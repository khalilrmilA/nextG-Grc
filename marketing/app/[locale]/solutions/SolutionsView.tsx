"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import PublicNav from "@/components/landing/PublicNav";
import SupportChat from "@/components/landing/SupportChat";
import Link from "next/link";
import { useI18n } from "@/i18n";
import {
  ArrowRight, CheckCircle2, TrendingUp, Clock, BarChart3, Zap,
  Building2, Heart, BarChart2, Globe, Shield, FileText,
  AlertTriangle, Users, Lock, DollarSign,
  ClipboardCheck, Search, Cpu,
} from "lucide-react";

const INDUSTRIES = [
  {
    key: "saas",
    icon: Building2,
    color: "from-blue-500 to-indigo-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
    label: "SaaS & Technology",
    headline: "Turn SOC 2 and ISO 27001 into a sales asset",
    ceoValue: "Every enterprise deal that asks for SOC 2 evidence is either closed faster or lost to a competitor who has a Trust Center ready. GRC Eye gets you certified, and keeps you there.",
    metrics: [
      { value: "3–5 weeks", label: "faster enterprise deal cycles" },
      { value: "Day 1", label: "full control library live" },
      { value: "30 sec", label: "to generate a board report" },
    ],
    points: [
      "Pre-built SOC 2 Trust Service Criteria controls: nothing to build",
      "ISO 27001:2022 gap analysis in hours instead of 6–8 weeks",
      "Live Trust Center replaces PDF attachments in sales calls",
      "AI-generated security policies tailored to your product",
      "Auditor portal cuts audit duration from 6 weeks to 5 days",
    ],
    frameworks: ["SOC 2 Type II", "ISO 27001:2022", "CIS Controls v8"],
  },
  {
    key: "health",
    icon: Heart,
    color: "from-rose-500 to-pink-600",
    bg: "bg-rose-50",
    border: "border-rose-200",
    label: "Healthcare & Life Sciences",
    headline: "HIPAA and GDPR, with a complete audit trail",
    ceoValue: "A single HIPAA breach costs an average of $10.9M. GRC Eye keeps your compliance programme continuous and your evidence always audit-ready, so you're never exposed.",
    metrics: [
      { value: "$10.9M", label: "average HIPAA breach cost (avoidable)" },
      { value: "Automated", label: "breach notification workflows" },
      { value: "100%", label: "audit trail for every control" },
    ],
    points: [
      "HIPAA Security Rule, Privacy Rule, and Breach Notification controls",
      "Breach notification workflow with timeline tracking",
      "DPA templates and data subject request management",
      "Role-based access: staff see only what they need",
      "Weekly automated compliance reports for leadership",
    ],
    frameworks: ["HIPAA", "GDPR", "ISO 27001:2022", "NIST 800-53"],
  },
  {
    key: "fintech",
    icon: BarChart2,
    color: "from-emerald-500 to-teal-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    label: "Financial Services & FinTech",
    headline: "DORA, PCI DSS, and NIS2 in one platform",
    ceoValue: "Regulatory overlap is costing FinTechs 2–3x more than it should. GRC Eye maps controls once and satisfies multiple regulators simultaneously: one team, one tool, multiple audits.",
    metrics: [
      { value: "60%", label: "reduction in duplicate compliance work" },
      { value: "5 pillars", label: "DORA coverage out of the box" },
      { value: "Jan 2025", label: "DORA enforced. Are you ready?" },
    ],
    points: [
      "DORA digital operational resilience: all 5 pillars",
      "PCI DSS 4.0 cardholder data environment controls",
      "NIS2 Directive implementation mapped and tracked",
      "Vendor risk cartography for supply chain exposure",
      "Monte Carlo risk quantification for regulator presentations",
    ],
    frameworks: ["DORA", "PCI DSS 4.0", "NIS2 Directive", "ISO 27001:2022"],
  },
  {
    key: "enterprise",
    icon: Globe,
    color: "from-violet-500 to-purple-700",
    bg: "bg-violet-50",
    border: "border-violet-200",
    label: "Enterprise",
    headline: "Multi-framework GRC that scales with complexity",
    ceoValue: "Large organisations waste millions on fragmented GRC tools, external consultants, and manual reporting. GRC Eye consolidates everything (70+ frameworks, 9 roles, unlimited business units) into one cost centre.",
    metrics: [
      { value: "40–45%", label: "lower total compliance cost" },
      { value: "70+", label: "frameworks in one platform" },
      { value: "9 roles", label: "granular access control built in" },
    ],
    points: [
      "Multi-tenant isolation for subsidiaries and business units",
      "9 built-in roles with module-level access control",
      "70+ frameworks with cross-walk mappings: no overlap duplication",
      "Webhook integrations with existing SIEM and ticketing tools",
      "Full activity log and audit trail for every user action",
    ],
    frameworks: ["ISO 27001:2022", "NIST CSF 2.0", "SOC 2", "GDPR", "NIST 800-53"],
  },
];

const CEO_BENEFITS = [
  {
    icon: DollarSign,
    color: "from-emerald-500 to-teal-600",
    title: "Compliance costs 40% less",
    body: "Replace consultant fees, spreadsheet hours, and last-minute audit scrambles with a continuous automated programme. Most customers recover the platform cost within the first audit cycle.",
  },
  {
    icon: TrendingUp,
    color: "from-blue-500 to-indigo-600",
    title: "Enterprise deals close faster",
    body: "A live Trust Center answers security questionnaires before prospects ask. Customers have reported 3–5 week shorter sales cycles after publishing their compliance posture.",
  },
  {
    icon: BarChart3,
    color: "from-violet-500 to-purple-600",
    title: "Board reporting in 30 seconds",
    body: "Stop waiting two days for a compliance status update. Generate a board-ready PDF (risk exposure, compliance score, open gaps, audit findings) in a single click.",
  },
  {
    icon: Shield,
    color: "from-rose-500 to-pink-600",
    title: "Regulatory risk is visible, not buried",
    body: "When a new regulation hits (DORA, NIS2, EU AI Act), GRC Eye maps your existing controls to the new framework instantly. Your exposure is quantified before the regulator knocks.",
  },
];

const STAKEHOLDERS = [
  {
    role: "CISO",
    icon: Shield,
    accent: "from-violet-500 to-purple-600",
    border: "border-violet-200",
    bg: "bg-white",
    iconBg: "bg-violet-600",
    textAccent: "text-violet-700",
    highlight: false,
    badge: null,
    points: [
      "Full programme visibility across all frameworks",
      "AI gap analysis and remediation tracking",
      "Monte Carlo risk quantification for board presentations",
      "Webhook alerts when risk thresholds are breached",
    ],
  },
  {
    role: "Compliance Manager",
    icon: ClipboardCheck,
    accent: "from-emerald-500 to-teal-600",
    border: "border-emerald-200",
    bg: "bg-white",
    iconBg: "bg-emerald-600",
    textAccent: "text-emerald-700",
    highlight: false,
    badge: null,
    points: [
      "Evidence collection automated, not manual",
      "AI writes remediation steps so you fix faster",
      "Cross-framework evidence reuse: upload once",
      "Auditor portal replaces email back-and-forth",
    ],
  },
  {
    role: "Sales Team",
    icon: TrendingUp,
    accent: "from-amber-500 to-orange-500",
    border: "border-amber-200",
    bg: "bg-white",
    iconBg: "bg-amber-500",
    textAccent: "text-amber-700",
    highlight: false,
    badge: null,
    points: [
      "Share the Trust Center on every enterprise call",
      "Security questionnaires answered in minutes",
      "Certifications visible before the prospect asks",
    ],
  },
  {
    role: "Engineering",
    icon: Cpu,
    accent: "from-sky-500 to-cyan-600",
    border: "border-sky-200",
    bg: "bg-white",
    iconBg: "bg-sky-600",
    textAccent: "text-sky-700",
    highlight: false,
    badge: null,
    points: [
      "200+ fewer hours per audit cycle",
      "No more last-minute audit evidence requests",
      "Cloud configuration monitoring built in",
    ],
  },
  {
    role: "External Auditors",
    icon: Search,
    accent: "from-rose-500 to-pink-600",
    border: "border-rose-200",
    bg: "bg-white",
    iconBg: "bg-rose-600",
    textAccent: "text-rose-700",
    highlight: false,
    badge: null,
    points: [
      "Scoped portal: no email attachments",
      "12 months of continuous evidence, not a 6-week pack",
      "Findings logged directly in the platform",
    ],
  },
];

export default function SolutionsView() {
  const { lang } = useI18n();
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      {/* ── Hero ── */}
      <section className="pt-20 pb-20 px-6 text-center bg-gradient-to-b from-slate-50 via-blue-50/30 to-white">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
            <Zap className="w-4 h-4" />
            SaaS · FinTech · Healthcare · Enterprise
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            Compliance that{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              pays for itself
            </span>
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed max-w-2xl mx-auto mb-10">
            GRC Eye replaces compliance consultants, audit scrambles, and manual reporting with an automated programme
            that cuts costs, accelerates enterprise deals, and gives your board a live view of risk.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg hover:shadow-blue-500/25"
            >
              Start free, no credit card
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={`/${lang}/contact`}
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Book a demo
            </Link>
          </div>
        </div>
      </section>

      {/* ── ROI strip ── */}
      <section className="py-10 px-6 border-y border-gray-100 bg-white">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: "40%", label: "Reduction in compliance costs", icon: TrendingUp },
            { value: "3–5 wks", label: "Faster enterprise sales cycles", icon: BarChart3 },
            { value: "5 days", label: "Average audit duration (vs 6 weeks)", icon: Clock },
            { value: "70+", label: "Frameworks covered out of the box", icon: Shield },
          ].map(({ value, label, icon: Icon }) => (
            <div key={label} className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Icon className="w-5 h-5 text-blue-600" />
                <p className="text-3xl font-extrabold text-gray-900">{value}</p>
              </div>
              <p className="text-sm text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── What CEOs actually care about ── */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              The business case, in four lines
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              GRC is not an IT cost. It is a revenue driver, a risk buffer, and a board-confidence tool, when it is automated.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {CEO_BENEFITS.map(({ icon: Icon, color, title, body }) => (
              <div key={title} className="border border-gray-200 rounded-2xl p-6 hover:shadow-md transition-shadow">
                <div className={`w-11 h-11 bg-gradient-to-br ${color} rounded-xl flex items-center justify-center mb-4 shadow-sm`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Industry solutions ── */}
      <section className="py-20 px-6 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              Built for your industry
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              Pre-loaded frameworks, control mappings, and risk templates for every regulated sector.
            </p>
          </div>
          <div className="space-y-10">
            {INDUSTRIES.map((ind, i) => {
              const Icon = ind.icon;
              const isEven = i % 2 === 0;
              return (
                <div
                  key={ind.key}
                  className={`flex flex-col ${isEven ? "lg:flex-row" : "lg:flex-row-reverse"} gap-8 items-stretch`}
                >
                  {/* Left/right panel - business framing */}
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
                        <div key={label} className="bg-white rounded-xl p-3 text-center border border-white/60 shadow-sm">
                          <p className="text-lg font-extrabold text-gray-900">{value}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right/left panel - what's included */}
                  <div className="flex-1 bg-white border border-gray-200 rounded-2xl p-8">
                    <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">What&apos;s included</h4>
                    <ul className="space-y-3 mb-6">
                      {ind.points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-sm text-gray-700">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                          {p}
                        </li>
                      ))}
                    </ul>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Frameworks</p>
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
              One platform: every stakeholder gets what they need
            </h2>
            <p className="text-lg text-gray-500">
              GRC Eye is built so the CEO has a live dashboard, the CISO has a full programme, and the auditor never needs to send an email.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {STAKEHOLDERS.map(({ role, icon: Icon, accent, border, bg, iconBg, textAccent, highlight, badge, points }) => (
              <div
                key={role}
                className={`rounded-2xl border overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5 ${border} ${bg} ${highlight ? "ring-1 ring-blue-300 shadow-md" : ""}`}
              >
                {/* coloured top bar */}
                <div className={`h-1 w-full bg-gradient-to-r ${accent}`} />
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <h3 className="font-bold text-gray-900 text-sm">{role}</h3>
                    {badge && (
                      <span className={`ml-auto text-xs font-semibold bg-gradient-to-r ${accent} text-white px-2.5 py-0.5 rounded-full`}>
                        {badge}
                      </span>
                    )}
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
            ))}
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
              <h2 className="text-2xl sm:text-3xl font-extrabold mb-3">AI that never leaves your infrastructure</h2>
              <p className="text-slate-300 leading-relaxed max-w-2xl mx-auto mb-8">
                Every AI feature in GRC Eye (document generation, contract review, gap analysis, vendor prescreening)
                runs on your own servers. No data is sent to OpenAI, Anthropic, or any external provider.
                This makes GRC Eye suitable for the most sensitive regulated environments, including EU-only data processing.
              </p>
              <div className="flex flex-wrap gap-3 justify-center mb-8">
                {["Zero data egress", "On-premise LLM", "EU AI Act aligned", "Air-gap capable"].map((tag) => (
                  <span key={tag} className="bg-white/10 border border-white/20 text-sm font-semibold px-4 py-1.5 rounded-full text-white">
                    {tag}
                  </span>
                ))}
              </div>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 bg-white text-blue-700 font-semibold px-6 py-3 rounded-xl hover:bg-blue-50 transition-colors shadow-md"
              >
                Try it free <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

{/* ── CTA ── */}
      <section className="py-20 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
            Ready to make compliance a competitive advantage?
          </h2>
          <p className="text-lg text-blue-100 mb-8">
            Start a free 14-day trial or book a 30-minute demo with our team.
            Full platform access. No credit card. No consultants.
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
              href={`/${lang}/contact`}
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold px-6 py-3.5 rounded-xl transition-colors"
            >
              <Users className="w-4 h-4" />
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
