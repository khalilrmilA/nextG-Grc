"use client";
import Link from "next/link";
import PublicNav from "@/components/landing/PublicNav";
import PublicFooter from "@/components/landing/PublicFooter";
import {
  ArrowRight, CheckCircle2, Clock, BarChart3, Shield,
  FileText, Users, Zap, TrendingUp, AlertTriangle,
  Building2, ChevronRight,
} from "lucide-react";

const STEPS = [
  {
    num: "01",
    icon: Shield,
    color: "from-blue-500 to-indigo-600",
    bg: "bg-blue-50",
    iconColor: "text-blue-600",
    title: "Connect your frameworks",
    subtitle: "Day 1 — 2 hours",
    description:
      "Choose from 70+ pre-loaded compliance frameworks — ISO 27001, SOC 2, NIS2, GDPR, DORA, HIPAA and more. Every control, requirement and cross-walk mapping is already in the platform. You select your frameworks; GRCEye builds the structure.",
    outcomes: [
      "Full control library ready instantly — no manual build",
      "Cross-framework overlaps identified automatically",
      "Custom frameworks supported for unique requirements",
    ],
    ceoTakeaway: "No consultants. No spreadsheets. Your compliance programme exists from day one.",
  },
  {
    num: "02",
    icon: Zap,
    color: "from-violet-500 to-purple-600",
    bg: "bg-violet-50",
    iconColor: "text-violet-600",
    title: "Run AI gap analysis",
    subtitle: "Week 1 — hours, not weeks",
    description:
      "Upload your existing policies, contracts, and procedures. The AI reads every document, maps each clause to the relevant controls, and produces a prioritised gap report — critical, high, and medium — with plain-language explanations and draft remediation steps.",
    outcomes: [
      "Gap assessment in hours instead of 6–8 weeks",
      "Every gap rated by business severity, not just technical risk",
      "Draft remediation plans ready for review immediately",
    ],
    ceoTakeaway: "Your team stops doing manual control reviews and starts fixing real problems.",
  },
  {
    num: "03",
    icon: Users,
    color: "from-emerald-500 to-teal-600",
    bg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    title: "Assign, track & remediate",
    subtitle: "Month 1 — continuous",
    description:
      "Assign each gap to the right owner directly in the platform. Automated reminders keep everyone on track. Controls are tested continuously — cloud configurations, access reviews, policy attestations — so your compliance score reflects reality, not last quarter's audit.",
    outcomes: [
      "Every control has a named owner and a due date",
      "Automated reminders replace manual chasing",
      "Live compliance score visible to the whole leadership team",
    ],
    ceoTakeaway: "Compliance becomes a managed programme, not a six-week fire drill before every audit.",
  },
  {
    num: "04",
    icon: BarChart3,
    color: "from-amber-500 to-orange-500",
    bg: "bg-amber-50",
    iconColor: "text-amber-600",
    title: "Report, share & grow",
    subtitle: "Ongoing — board to customer",
    description:
      "Generate board-ready PDF reports in 30 seconds. Publish a public Trust Center so customers and investors see your compliance posture without requesting a report. Give external auditors a scoped portal so audits take days, not weeks.",
    outcomes: [
      "5 automated report types: Executive, Risk, Compliance, Vendor, Audit",
      "Trust Center turns compliance into a sales asset",
      "Auditor portal cuts audit duration by 40–50%",
    ],
    ceoTakeaway: "Compliance stops being a cost centre and becomes a competitive advantage.",
  },
];

const TIMELINE = [
  {
    period: "Week 1",
    color: "border-blue-500 bg-blue-500",
    items: [
      "Frameworks selected and control library live",
      "First AI gap analysis complete",
      "Critical gaps identified and assigned to owners",
    ],
  },
  {
    period: "Month 1",
    color: "border-violet-500 bg-violet-500",
    items: [
      "Critical and high gaps remediated",
      "Automated control monitoring active",
      "First board compliance report generated",
    ],
  },
  {
    period: "Month 3",
    color: "border-emerald-500 bg-emerald-500",
    items: [
      "Trust Center published and shared with customers",
      "Audit cycle reduced from 6 weeks to under 5 days",
      "Second framework added with zero additional effort on shared controls",
    ],
  },
  {
    period: "Month 6",
    color: "border-amber-500 bg-amber-500",
    items: [
      "Full multi-framework programme operational",
      "Compliance cost reduced by 35–45% vs manual approach",
      "Enterprise sales cycles 3–5 weeks shorter",
    ],
  },
];

const ROI_METRICS = [
  { value: "Day 1", label: "Live compliance programme", icon: Zap },
  { value: "40%", label: "Reduction in compliance costs", icon: TrendingUp },
  { value: "5 days", label: "Average audit duration (vs 6 weeks)", icon: Clock },
  { value: "3–5 wks", label: "Faster enterprise sales cycles", icon: BarChart3 },
];

const VS_ROWS = [
  { task: "Framework setup", manual: "4–8 weeks, external consultant", grceye: "Day 1, self-service" },
  { task: "Gap assessment", manual: "6–8 weeks of manual review", grceye: "Hours — AI analyses all controls" },
  { task: "Board reporting", manual: "2 days of manual PowerPoint", grceye: "30 seconds, automated PDF" },
  { task: "Audit preparation", manual: "6-week scramble, 200+ hours", grceye: "Ongoing — audit is always ready" },
  { task: "Second framework", manual: "Restart from scratch", grceye: "Days — shared controls reused" },
  { task: "Customer trust proof", manual: "Outdated PDF on request", grceye: "Live Trust Center, real-time" },
];

export default function HowItWorksView() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      {/* ── Hero ── */}
      <section className="pt-20 pb-20 px-6 text-center bg-gradient-to-b from-slate-50 via-blue-50/30 to-white">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
            <Zap className="w-4 h-4" />
            Built for CEOs and CISOs
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            From spreadsheets to<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              board-ready GRC
            </span>{" "}
            in 30 days
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed max-w-2xl mx-auto mb-10">
            GRCEye replaces the manual compliance cycle — evidence collection, audit scrambles, outdated reports —
            with a continuous, automated programme your entire leadership team can see and trust.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg hover:shadow-blue-500/25"
            >
              Start free — no credit card
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/contact"
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
          {ROI_METRICS.map(({ value, label, icon: Icon }) => (
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

      {/* ── The problem ── */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              Why manual GRC is a business problem, not just an IT one
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              Before GRCEye, most compliance programmes share the same three problems — regardless of company size or industry.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: AlertTriangle,
                color: "text-red-500",
                bg: "bg-red-50",
                title: "It's invisible to leadership",
                body: "Compliance lives in spreadsheets and shared drives. The board asks for a status update and the compliance manager spends two days assembling a PowerPoint from five different sources — that is already out of date.",
              },
              {
                icon: Clock,
                color: "text-amber-500",
                bg: "bg-amber-50",
                title: "It consumes the wrong people",
                body: "58% of compliance team hours are spent collecting evidence — not analyzing risk or improving controls. Engineering teams are pulled from product work to answer audit questions. Everyone is reactive.",
              },
              {
                icon: Building2,
                color: "text-violet-500",
                bg: "bg-violet-50",
                title: "It stalls revenue",
                body: "Enterprise deals slow down or die at the security questionnaire stage. Customers ask for ISO 27001 or SOC 2 evidence. Producing it takes weeks. By then, the competitor who had a Trust Center ready has closed the deal.",
              },
            ].map(({ icon: Icon, color, bg, title, body }) => (
              <div key={title} className="border border-gray-200 rounded-2xl p-6">
                <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-4`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4 Steps ── */}
      <section className="py-20 px-6 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              Four steps. Thirty days. A compliance programme that runs itself.
            </h2>
            <p className="text-lg text-gray-500 max-w-xl mx-auto">
              No consultants. No multi-month implementation projects. No spreadsheets.
            </p>
          </div>

          <div className="space-y-12">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              const isEven = i % 2 === 0;
              return (
                <div
                  key={step.num}
                  className={`flex flex-col ${isEven ? "md:flex-row" : "md:flex-row-reverse"} gap-10 items-center`}
                >
                  {/* Visual side */}
                  <div className="w-full md:w-2/5 flex-shrink-0">
                    <div className={`rounded-2xl bg-gradient-to-br ${step.color} p-8 text-white shadow-lg`}>
                      <div className="text-6xl font-black opacity-20 mb-2">{step.num}</div>
                      <Icon className="w-10 h-10 mb-4 opacity-90" />
                      <h3 className="text-2xl font-extrabold mb-1">{step.title}</h3>
                      <p className="text-sm opacity-75 font-medium">{step.subtitle}</p>
                    </div>
                  </div>

                  {/* Content side */}
                  <div className="w-full md:w-3/5">
                    <p className="text-gray-600 leading-relaxed mb-5">{step.description}</p>
                    <ul className="space-y-2 mb-6">
                      {step.outcomes.map((o) => (
                        <li key={o} className="flex items-start gap-2 text-sm text-gray-700">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                          {o}
                        </li>
                      ))}
                    </ul>
                    <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                      <p className="text-sm font-semibold text-blue-800">
                        <span className="text-blue-500 font-bold">CEO takeaway: </span>
                        {step.ceoTakeaway}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Timeline ── */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              What you get and when
            </h2>
            <p className="text-lg text-gray-500">
              Most customers see measurable business impact before the end of month one.
            </p>
          </div>
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-200 hidden md:block" />
            <div className="space-y-8">
              {TIMELINE.map(({ period, color, items }) => (
                <div key={period} className="flex gap-6 items-start">
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full border-2 ${color} flex items-center justify-center z-10`}>
                    <span className="text-white text-xs font-bold">{period.split(" ")[0][0]}{period.split(" ")[1] ?? ""}</span>
                  </div>
                  <div className="flex-1 bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                    <p className="text-sm font-bold text-gray-900 mb-3">{period}</p>
                    <ul className="space-y-1.5">
                      {items.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                          <ChevronRight className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── VS table ── */}
      <section className="py-20 px-6 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              GRCEye vs. the manual approach
            </h2>
            <p className="text-lg text-gray-500">Every row is a real cost or risk you can eliminate.</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-6 py-4 text-gray-500 font-semibold w-1/3">Task</th>
                  <th className="text-left px-6 py-4 text-gray-500 font-semibold w-1/3">Manual / Spreadsheets</th>
                  <th className="text-left px-6 py-4 text-blue-700 font-semibold w-1/3 bg-blue-50/50">GRCEye</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {VS_ROWS.map(({ task, manual, grceye }) => (
                  <tr key={task} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-gray-800">{task}</td>
                    <td className="px-6 py-4 text-gray-500">{manual}</td>
                    <td className="px-6 py-4 text-emerald-700 font-medium bg-blue-50/30">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        {grceye}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Built for every stakeholder</h2>
            <p className="text-lg text-gray-500">One platform, one source of truth — for the whole leadership team.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                role: "CEO / Board",
                icon: "👔",
                points: [
                  "Live compliance score without asking the CISO",
                  "Risk exposure in euros, not heatmap colours",
                  "Audit-ready proof for investors and regulators",
                ],
              },
              {
                role: "CISO",
                icon: "🛡️",
                points: [
                  "Full programme visibility across all frameworks",
                  "AI gap analysis and remediation tracking",
                  "Monte Carlo risk quantification for board presentations",
                ],
              },
              {
                role: "Compliance Manager",
                icon: "📋",
                points: [
                  "Evidence collection automated, not manual",
                  "Control owners notified automatically",
                  "Auditor portal replaces email back-and-forth",
                ],
              },
              {
                role: "Sales Team",
                icon: "📈",
                points: [
                  "Live Trust Center to share with prospects",
                  "Security questionnaires answered in minutes",
                  "Certifications visible before the prospect asks",
                ],
              },
              {
                role: "Engineering",
                icon: "⚙️",
                points: [
                  "200+ fewer hours per audit cycle",
                  "No more last-minute audit evidence requests",
                  "Cloud configuration monitoring built in",
                ],
              },
              {
                role: "External Auditors",
                icon: "🔍",
                points: [
                  "Scoped portal — no email attachments",
                  "12 months of continuous evidence, not a 6-week pack",
                  "Findings logged directly in the platform",
                ],
              },
            ].map(({ role, icon, points }) => (
              <div key={role} className="border border-gray-200 rounded-2xl p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{icon}</span>
                  <h3 className="font-bold text-gray-900">{role}</h3>
                </div>
                <ul className="space-y-1.5">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm text-gray-600">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
            Ready to see it in your organisation?
          </h2>
          <p className="text-lg text-blue-100 mb-8">
            Start a free 14-day trial or book a 30-minute live demo with our team.
            No credit card. No commitment. No consultants.
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
              <FileText className="w-4 h-4" />
              Book a demo
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
