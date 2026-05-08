import { Link } from "react-router-dom";
import {
  CheckCircle, ArrowRight, Zap, Lock, BarChart2,
  FileText, Building2, ClipboardList, BookOpen, AlertTriangle,
  ChevronRight, Star, Users, Award,
} from "lucide-react";

const FEATURES = [
  { icon: AlertTriangle, title: "Risk Management",        desc: "Interactive 5×5 heat maps, risk registers, and automated likelihood/impact scoring." },
  { icon: CheckCircle,   title: "Compliance Tracking",    desc: "Map controls to 76+ frameworks. Track implementation progress with segmented dashboards." },
  { icon: ClipboardList, title: "Audit Management",       desc: "Plan, execute, and report on internal and external audits. Track findings to closure." },
  { icon: FileText,      title: "Policy Lifecycle",       desc: "Draft, approve, publish, and collect employee attestations — all in one place." },
  { icon: Building2,     title: "Vendor Risk (TPRM)",     desc: "Onboard, tier, and continuously monitor third-party vendors with AI-powered contract review." },
  { icon: BarChart2,     title: "Executive Reporting",    desc: "Board-ready dashboards, PDF exports, and real-time compliance scores." },
  { icon: BookOpen,      title: "Framework Library",      desc: "ISO 27001, SOC 2, GDPR, PCI DSS, HIPAA, NIST CSF, NIST 800-53, CIS Controls and more." },
  { icon: Zap,           title: "AI-Powered Workflows",   desc: "Generate policies, analyze vendor contracts, and prescreen suppliers with on-premise AI — your data never leaves your infrastructure." },
];

const FRAMEWORKS = [
  "ISO 27001:2022", "SOC 2 Type II", "GDPR", "PCI DSS 4.0",
  "HIPAA", "NIST CSF 2.0", "NIST 800-53 Rev5", "CIS Controls v8",
  "NIS2 Directive", "DORA", "ISO 42001", "NIST AI RMF",
];

const PLANS = [
  {
    name: "Starter",
    price: "$500",
    period: "/month",
    billed: "billed annually (~$6,000/yr)",
    badge: null,
    color: "border-gray-200",
    btnColor: "bg-white text-blue-600 border-2 border-blue-600 hover:bg-blue-50",
    features: [
      "Up to 3 compliance frameworks",
      "10 admin users",
      "Risk register (up to 200 risks)",
      "Policy management",
      "Basic audit management",
      "Email + chat support",
      "1 year data retention",
    ],
    notIncluded: ["Custom frameworks", "AI policy generation", "Vendor TPRM", "PDF reporting", "SLA guarantee"],
  },
  {
    name: "Professional",
    price: "$2,500",
    period: "/month",
    billed: "billed annually (~$30,000/yr)",
    badge: "Most Popular",
    color: "border-blue-600 ring-2 ring-blue-600/20",
    btnColor: "bg-blue-600 text-white hover:bg-blue-700",
    features: [
      "Up to 10 compliance frameworks",
      "50 admin users",
      "Unlimited risk register",
      "Advanced TPRM (vendor questionnaires + AI prescreening)",
      "AI-assisted policy & document drafting",
      "AI contract review (6-section analysis)",
      "Priority support + CSM",
      "3 year data retention",
      "Custom reporting & PDF export",
    ],
    notIncluded: ["Custom framework builder", "White-label", "Dedicated infrastructure"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    billed: "starting at ~$80,000/yr",
    badge: null,
    color: "border-slate-700",
    btnColor: "bg-slate-900 text-white hover:bg-slate-700",
    features: [
      "Unlimited frameworks",
      "Unlimited users",
      "Custom framework builder",
      "White-label & custom branding",
      "On-premise / self-hosted option",
      "Dedicated Customer Success Manager",
      "99.9% SLA guarantee",
      "7 year data retention",
      "Custom AI configuration (Ollama model selection)",
      "24/7 phone support",
    ],
    notIncluded: [],
  },
];

const TESTIMONIALS = [
  { quote: "We cut our ISO 27001 certification prep from 18 months to 6. The framework gap analysis alone is worth every cent.", name: "Sarah K.", role: "CISO, FinTech Scale-up", rating: 5 },
  { quote: "Finally a GRC tool that doesn't require a PhD to use. Our compliance team was up and running in a day.", name: "Marcus T.", role: "Head of Compliance, SaaS Co.", rating: 5 },
  { quote: "The vendor risk module saved us countless hours of spreadsheet work. Board-ready reports in one click.", name: "Priya S.", role: "VP Risk, Healthcare Platform", rating: 5 },
];

function PricingCard({ plan }: { readonly plan: typeof PLANS[0] }) {
  return (
    <div className={`relative bg-white rounded-3xl border p-8 flex flex-col ${plan.color}`}>
      {plan.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="bg-blue-600 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-sm">
            {plan.badge}
          </span>
        </div>
      )}
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-900 mb-1">{plan.name}</h3>
        <div className="flex items-end gap-1">
          <span className="text-4xl font-extrabold text-gray-900">{plan.price}</span>
          <span className="text-gray-500 mb-1 text-sm">{plan.period}</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">{plan.billed}</p>
      </div>

      <Link
        to="/register"
        className={`w-full py-2.5 rounded-xl text-sm font-semibold text-center transition-colors mb-8 ${plan.btnColor}`}
      >
        {plan.name === "Enterprise" ? "Contact Sales" : "Start Free Trial"}
      </Link>

      <ul className="space-y-3 flex-1">
        {plan.features.map(f => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
        {plan.notIncluded.map(f => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-400">
            <span className="w-4 h-4 flex-shrink-0 mt-0.5 text-center text-gray-300 font-bold leading-4">✕</span>
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* ── Nav ── */}
      <header className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="GRCEye" className="h-14 w-auto object-contain" />
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-500">
            <a href="#features" className="hover:text-gray-900 transition-colors">Features</a>
            <a href="#frameworks" className="hover:text-gray-900 transition-colors">Frameworks</a>
            <a href="#pricing" className="hover:text-gray-900 transition-colors">Pricing</a>
            <a href="#testimonials" className="hover:text-gray-900 transition-colors">Customers</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">
              Sign in
            </Link>
            <Link to="/register" className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shadow-sm">
              Start free trial <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="pt-32 pb-20 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6">
            <Zap className="w-3.5 h-3.5" />
            Now supporting 76 compliance frameworks
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            Enterprise GRC,{" "}
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              simplified.
            </span>
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            One platform for risk management, compliance tracking, audit workflows,
            policy governance, and vendor risk — built for modern security teams.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-2xl transition-colors shadow-lg shadow-blue-500/25 text-base">
              Start 14-day free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/login" className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold px-8 py-3.5 rounded-2xl transition-colors text-base">
              Sign in to dashboard <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="mt-4 text-xs text-gray-400">No credit card required · 14-day free trial · Cancel anytime</p>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-3 gap-6 max-w-lg mx-auto">
            {[
              { label: "Frameworks supported", value: "76+" },
              { label: "Controls mapped",       value: "3,500+" },
              { label: "Avg. audit prep saved", value: "60%" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-3xl font-extrabold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Everything your GRC team needs</h2>
            <p className="text-gray-500 max-w-xl mx-auto">From risk to compliance to audit — one integrated workflow, no spreadsheets required.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-gray-50 rounded-2xl p-6 hover:bg-blue-50 hover:border-blue-100 border border-transparent transition-all group">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm mb-4 group-hover:bg-blue-600 transition-colors">
                  <Icon className="w-5 h-5 text-blue-600 group-hover:text-white transition-colors" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1.5">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Frameworks ── */}
      <section id="frameworks" className="py-24 px-6 bg-slate-900">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-white mb-3">Built for every framework</h2>
          <p className="text-slate-400 mb-12 max-w-xl mx-auto">Pre-loaded with controls, crosswalk mappings, and evidence requirements for 76 global frameworks.</p>
          <div className="flex flex-wrap justify-center gap-3">
            {FRAMEWORKS.map(fw => (
              <span key={fw} className="bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium px-4 py-2 rounded-xl hover:bg-slate-700 hover:text-white transition-colors cursor-default">
                {fw}
              </span>
            ))}
            <span className="bg-blue-600/20 border border-blue-500/30 text-blue-400 text-sm font-medium px-4 py-2 rounded-xl">
              + 64 more frameworks
            </span>
          </div>
          <div className="mt-12 grid grid-cols-3 gap-6 max-w-2xl mx-auto">
            {[
              { icon: Lock,   label: "ISO/IEC certified controls",   value: "ISO 27001 · ISO 27002 · ISO 42001" },
              { icon: Award,  label: "Regulatory frameworks",        value: "GDPR · HIPAA · PCI DSS · DORA" },
              { icon: Users,  label: "Industry standards",           value: "SOC 2 · CIS · NIST · CSA CCM" },
            ].map(s => (
              <div key={s.label} className="bg-slate-800 rounded-2xl p-5 text-left border border-slate-700">
                <s.icon className="w-5 h-5 text-blue-400 mb-3" />
                <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                <p className="text-sm font-semibold text-white leading-snug">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Simple, transparent pricing</h2>
            <p className="text-gray-500">All plans include a 14-day free trial. No credit card required.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            {PLANS.map(plan => (
              <PricingCard key={plan.name} plan={plan} />
            ))}
          </div>
          <p className="text-center text-sm text-gray-400 mt-8">
            All prices in USD. Annual billing only for listed rates. Monthly billing available at +20%.{" "}
            <a href="mailto:sales@grcplatform.io" className="text-blue-600 hover:underline">Contact sales</a> for volume discounts.
          </p>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section id="testimonials" className="py-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Trusted by security teams</h2>
            <p className="text-gray-500">From fast-growing startups to regulated enterprises.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <p className="text-gray-700 text-sm leading-relaxed mb-5 italic">"{t.quote}"</p>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-500">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-extrabold mb-4">Start your GRC journey today</h2>
          <p className="text-blue-100 mb-8 text-lg">14-day free trial. No credit card. Full access to all Professional features.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="flex items-center justify-center gap-2 bg-white text-blue-600 font-semibold px-8 py-3.5 rounded-2xl hover:bg-blue-50 transition-colors shadow-md text-base">
              Start free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="mailto:sales@grcplatform.io" className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-semibold px-8 py-3.5 rounded-2xl hover:bg-white/20 transition-colors text-base">
              Talk to sales
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="GRCEye" className="h-12 w-auto object-contain bg-white rounded-lg p-1.5" />
          </div>
          <p className="text-xs text-slate-500">© 2026 GRCEye, Inc. All rights reserved.</p>
          <div className="flex gap-5 text-sm">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Security</a>
            <a href="mailto:sales@grcplatform.io" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
