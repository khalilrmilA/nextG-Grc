import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import SupportChat from "../components/landing/SupportChat";
import PublicNav from "../components/landing/PublicNav";
import {
  ArrowRight, CheckCircle, AlertTriangle, ClipboardList, FileText,
  Building2, BarChart2, BookOpen, Zap, Shield, ChevronRight,
  Database, Globe, Lock, Cpu, Bell, RefreshCw, Download,
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
    id: "risk",
    icon: AlertTriangle,
    color: "from-red-500 to-rose-600",
    bgLight: "bg-red-50",
    border: "border-red-100",
    badge: "text-red-700 bg-red-50",
    title: "Risk Management",
    tagline: "See, measure, and treat every risk — not just list them.",
    desc: "GRCEye's risk module is built for security teams that need to communicate risk in terms the business understands. From qualitative heatmaps to Monte Carlo financial quantification, every risk has an owner, a score, a treatment plan, and a next-review date.",
    features: [
      { icon: Activity,    label: "Risk Register",              desc: "Full CRUD with likelihood × impact scoring, severity auto-classification, owner assignment, and next-review scheduling." },
      { icon: TrendingUp,  label: "5×5 Heatmap",                desc: "Interactive visual heatmap. Click any cell to filter the register. Color-coded by severity with customisable thresholds." },
      { icon: BarChart2,   label: "Monte Carlo Quantification",  desc: "10,000-iteration simulation producing ALE, SLE, P90, and P95 values — turning qualitative scores into financial figures." },
      { icon: GitBranch,   label: "Risk Scenarios",              desc: "Model Threat → Vulnerability → Asset → Control chains. Track current and target probability/impact per scenario." },
      { icon: Database,    label: "Custom Risk Matrices",        desc: "Define your own probability and impact scales (3×3, 5×5, or any custom size) with custom labels, colors, and score mappings." },
      { icon: CheckCircle, label: "Risk Acceptance",             desc: "Formal waiver workflow with justification, approver assignment, expiration date, and compensating controls tracking." },
    ],
  },
  {
    id: "compliance",
    icon: CheckCircle,
    color: "from-blue-500 to-indigo-600",
    bgLight: "bg-blue-50",
    border: "border-blue-100",
    badge: "text-blue-700 bg-blue-50",
    title: "Compliance & Frameworks",
    tagline: "70+ frameworks. One assessment workflow. Zero duplication.",
    desc: "Run simultaneous assessments across multiple frameworks. Evidence uploaded once is reused across all mapped controls. The AI identifies gaps, estimates confidence scores, and generates remediation steps — turning weeks of manual work into a structured workflow.",
    features: [
      { icon: BookOpen,    label: "70+ Built-in Frameworks",       desc: "ISO 27001, SOC 2, GDPR, PCI DSS, HIPAA, DORA, NIS2, NIST CSF, NIST 800-53, CIS v8, AI Act, MITRE ATT&CK, and more." },
      { icon: Zap,         label: "AI Gap Analysis",              desc: "Batch AI analysis of all controls. Each control gets an implementation confidence score, gap status, and AI-generated remediation steps." },
      { icon: Link2,       label: "Cross-Framework Coverage",     desc: "See which controls satisfy requirements in multiple frameworks simultaneously — avoid duplicating assessment work." },
      { icon: Upload,      label: "Evidence Management",          desc: "Upload files, add justification, and mark auditor visibility per control. Evidence links to specific controls across all assessments." },
      { icon: Globe,       label: "Stakeholder Upload Links",     desc: "Generate secure, expiring upload links for external stakeholders to submit evidence directly — without platform access." },
      { icon: GitBranch,   label: "Custom Framework Builder",     desc: "Fork any built-in framework into an editable tenant copy. Add, edit, and delete controls. Build custom frameworks from scratch with AI suggestions." },
    ],
  },
  {
    id: "audit",
    icon: ClipboardList,
    color: "from-purple-500 to-indigo-600",
    bgLight: "bg-purple-50",
    border: "border-purple-100",
    badge: "text-purple-700 bg-purple-50",
    title: "Audit Management",
    tagline: "Plan, execute, and close audits without spreadsheets.",
    desc: "GRCEye covers the full audit lifecycle — from planning and control assignment through finding creation, remediation tracking, and final PDF report generation. External auditors get their own scoped portal so they can work without accessing the rest of the platform.",
    features: [
      { icon: ClipboardList, label: "Audit Lifecycle",           desc: "Planning → Fieldwork → Review → Closure. Internal and external audit types with lead auditor assignment and status tracking." },
      { icon: Shield,        label: "Auditor Portal",            desc: "Dedicated portal scoped to assigned assessments only. Auditors review evidence, record findings, generate reports — nothing else visible." },
      { icon: AlertTriangle, label: "Finding Management",        desc: "5 severity levels (Critical/High/Medium/Low/Info), owner assignment, due dates, and remediation status tracking per finding." },
      { icon: CheckCircle,   label: "Control Checklists",        desc: "Per-audit control checklist with Compliant / Non-Compliant / N/A status, evidence attachments, and auditor notes." },
      { icon: Download,      label: "PDF Report Generation",     desc: "One-click PDF audit report. Includes executive summary, control results, findings list, and remediation status." },
      { icon: RefreshCw,     label: "Remediation Tracking",      desc: "Track each finding through its remediation lifecycle. Assign owners, set due dates, update status as gaps are closed." },
    ],
  },
  {
    id: "policy",
    icon: FileText,
    color: "from-orange-500 to-amber-600",
    bgLight: "bg-orange-50",
    border: "border-orange-100",
    badge: "text-orange-700 bg-orange-50",
    title: "Policy & Document Management",
    tagline: "29 document types. AI-written in seconds. Formally attested.",
    desc: "Stop writing GRC documents from scratch. The AI document generator produces complete, audit-ready policies tailored to your organization's name, industry, size, country, and active compliance frameworks — then saves them as versioned policy records.",
    features: [
      { icon: Zap,         label: "AI Document Generator",      desc: "29 document types across 4 categories (Foundation, Policies, Procedures, Plans). Streams in real time. Auto-saves as a draft on completion." },
      { icon: GitBranch,   label: "Version Control",            desc: "Every policy has a full version history. Create new versions, mark current, track who authored and approved each revision." },
      { icon: Users,       label: "Employee Attestation",       desc: "Send formal acknowledgement requests to employees. Track response status. Send email reminders for overdue attestations." },
      { icon: CheckCircle, label: "Approval Workflow",          desc: "Route policies through an approval chain before publishing. Only approved policies can be sent for attestation." },
      { icon: Link2,       label: "Control Linking",            desc: "Link published policies to framework controls so they count as compliance evidence in your active assessments." },
      { icon: Download,    label: "PDF Export",                 desc: "Export any policy as a formatted PDF for sharing with auditors, customers, or board members." },
    ],
  },
  {
    id: "vendor",
    icon: Building2,
    color: "from-indigo-500 to-violet-600",
    bgLight: "bg-indigo-50",
    border: "border-indigo-100",
    badge: "text-indigo-700 bg-indigo-50",
    title: "Vendor Risk (TPRM)",
    tagline: "Full third-party risk lifecycle — from prescreen to contract approval.",
    desc: "Manage every vendor from initial assessment through contract review, CISO approval, and ongoing monitoring. The AI reviews contracts clause by clause and runs vendor prescreen questionnaires before a single meeting is scheduled.",
    features: [
      { icon: Users,       label: "Vendor Register",            desc: "Full CRUD with risk tier (Critical/High/Medium/Low), risk score, contract expiry, and owner assignment." },
      { icon: Zap,         label: "AI Prescreen",               desc: "15-question AI-analyzed prescreen questionnaire. Produces a recommendation (proceed / review / reject) before onboarding." },
      { icon: FileText,    label: "AI Contract Review",         desc: "Upload a contract. AI runs a 6-section structured analysis: risky clauses, liability gaps, SLA issues, data processing terms — streamed live." },
      { icon: CheckCircle, label: "CISO Approval Workflow",     desc: "Contracts move through Draft → AI Review → CISO Approval → Sent to Vendor. Full audit trail at each stage." },
      { icon: BarChart2,   label: "Risk Cartography",           desc: "6-dimension visual heatmap per vendor: data access, financial exposure, operational dependency, regulatory, geographic, and reputational risk." },
      { icon: RefreshCw,   label: "Real-time Collaboration",    desc: "Share a collaboration link with the vendor. Both sides exchange messages, upload documents, and track contract status in real time." },
    ],
  },
  {
    id: "ai",
    icon: Cpu,
    color: "from-sky-500 to-blue-600",
    bgLight: "bg-sky-50",
    border: "border-sky-100",
    badge: "text-sky-700 bg-sky-50",
    title: "AI Capabilities",
    tagline: "On-premise AI across every module. Zero data egress.",
    desc: "Every AI feature in GRCEye runs on Ollama inside your own infrastructure. No data is ever sent to OpenAI, Anthropic, or any third-party AI provider. This makes GRCEye suitable for the most regulated and privacy-sensitive environments.",
    features: [
      { icon: Zap,         label: "Document Generator",         desc: "Generates 29 GRC document types tailored to your organization's context. Streams output in real time." },
      { icon: FileText,    label: "Contract Review AI",         desc: "6-section structured analysis of vendor contracts — risky clauses, liability gaps, SLA issues, data processing terms, and fix suggestions." },
      { icon: CheckCircle, label: "Compliance Gap Analysis",    desc: "Batch analysis of every control in an assessment. AI assigns confidence scores and generates remediation steps per gap." },
      { icon: Building2,   label: "Vendor Prescreen AI",        desc: "Analyzes 15 prescreen responses holistically and produces a risk recommendation: proceed, review, or reject." },
      { icon: Globe,       label: "Framework AI Suggestions",   desc: "When building a custom framework, the AI suggests controls based on your industry, region, and compliance objectives." },
      { icon: Cpu,         label: "GRC Assistant Chatbot",      desc: "Context-aware chat interface for ISO 27001, SOC 2, GDPR, risk assessment, policy drafting, and audit guidance." },
    ],
  },
  {
    id: "governance",
    icon: Shield,
    color: "from-slate-600 to-slate-800",
    bgLight: "bg-slate-50",
    border: "border-slate-200",
    badge: "text-slate-700 bg-slate-100",
    title: "Governance & Operations",
    tagline: "Every tool your GRC operation needs to run smoothly.",
    desc: "Beyond the core modules, GRCEye includes incident tracking, vulnerability management, threat library, activity logging, webhooks, regulatory change tracking, and more — all inside the same platform.",
    features: [
      { icon: AlertTriangle, label: "Incident Management",      desc: "Track security incidents across 10 categories, 6 statuses. Timeline view, breach notification workflow, financial impact tracking." },
      { icon: Database,      label: "Vulnerability Tracking",   desc: "CVE-based vulnerability register with CVSS scores, severity, remediation status, and owner assignment." },
      { icon: BookOpen,      label: "Threat Library",           desc: "Preloaded threat catalog with MITRE ATT&CK IDs. Add custom threats. Link threats to risk scenarios." },
      { icon: Bell,          label: "Notifications & Alerts",   desc: "In-app notification bell. Deadline checker for expiring contracts, overdue risks, pending CISO reviews, and compliance gaps." },
      { icon: RefreshCw,     label: "Webhooks",                 desc: "20+ outbound event types. Test ping, delivery logs, and configurable endpoint management." },
      { icon: Download,      label: "CSV Export / Import",      desc: "Export risks, vendors, assets, audits, policies, and compliance data. Import with error reporting." },
    ],
  },
];

const ALL_CAPS = [
  "Activity Log — full audit trail of every user action",
  "Trust Center — public-facing compliance page for customers",
  "Regulatory Change Tracking — monitor deadlines affecting your frameworks",
  "Applied Controls — track cost, effort, progress %, and ETA",
  "Security Exceptions — formal waivers with approval workflow",
  "Risk Quantification — Monte Carlo ALE/SLE/P90/P95",
  "Multi-tenant isolation — each org's data is fully separated",
  "9 built-in roles — granular module-level access control",
  "JWT auth + refresh tokens + API token management",
  "Weekly automated PDF reports — 5 report types",
  "Webhook delivery logs — full observability",
  "3 languages — English, French, Arabic (full RTL)",
];

export default function FeaturesLandingPage() {
  const [active, setActive] = useState("risk");
  const mod = MODULES.find(m => m.id === active)!;

  return (
    <div className="min-h-screen bg-[#f0f9ff] text-gray-900">

      {/* Nav */}
      <PublicNav links={[
        { to: "/", label: "Home" },
        { to: "/solutions", label: "Solutions" },
        { to: "/features-landing", label: "Features", activeOn: "/features-landing" },
        { to: "/faq", label: "FAQ" },
      ]} />

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 text-center overflow-hidden bg-gradient-to-b from-sky-100 via-[#f0f9ff] to-[#f0f9ff]">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute top-10 -right-10 w-80 h-80 bg-indigo-200/20 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/70 border border-sky-200 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 shadow-sm animate-fade-in-up">
            <Zap className="w-3.5 h-3.5" /> 38 pages · 190 API routes · 29 AI document types · 70+ frameworks
          </div>
          <h1 className="animate-fade-in-up animation-delay-200 text-5xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            Every feature,{" "}
            <span className="gradient-text-animated">explained.</span>
          </h1>
          <p className="animate-fade-in-up animation-delay-400 text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            GRCEye is not a one-screen dashboard. It's a full GRC operating system — seven specialized modules working as one integrated platform.
          </p>
          <div className="animate-fade-in-up animation-delay-600 flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-500/25 hover:-translate-y-0.5">
              Try it free <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/solutions" className="flex items-center justify-center gap-2 bg-white border border-sky-200 text-gray-700 hover:bg-sky-50 font-semibold px-8 py-3.5 rounded-2xl transition-all hover:-translate-y-0.5">
              See solutions by industry <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Platform stats */}
      <section className="py-12 px-6 bg-white border-y border-sky-100">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "38",     label: "Platform pages" },
            { value: "76+",    label: "Compliance frameworks" },
            { value: "3,500+", label: "Pre-mapped controls" },
            { value: "29",     label: "AI document types" },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 80}>
              <p className="text-3xl font-extrabold text-blue-600 mb-1">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Module explorer */}
      <section className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Explore every module</h2>
              <p className="text-gray-500 max-w-xl mx-auto">Select a module to see all its features in detail.</p>
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
                  {m.title}
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
                  <div className={`inline-flex text-xs font-semibold px-3 py-1 rounded-full mb-4 ${mod.badge}`}>{mod.title}</div>
                  <h3 className="text-xl font-extrabold text-gray-900 mb-2">{mod.tagline}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed">{mod.desc}</p>
                  <Link to="/register" className="mt-6 inline-flex items-center gap-1.5 text-blue-600 font-semibold text-sm hover:gap-2.5 transition-all">
                    Try this module free <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </Reveal>
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {mod.features.map((f, i) => (
                <Reveal key={f.label} delay={i * 60}>
                  <div className="bg-white rounded-2xl p-5 border border-sky-100 card-hover h-full">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-8 h-8 bg-gradient-to-br ${mod.color} rounded-lg flex items-center justify-center flex-shrink-0`}>
                        <f.icon className="w-4 h-4 text-white" />
                      </div>
                      <p className="font-semibold text-gray-900 text-sm">{f.label}</p>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Everything else */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Everything else included</h2>
              <p className="text-gray-500 max-w-xl mx-auto">Beyond the core modules, GRCEye includes a complete suite of supporting capabilities.</p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ALL_CAPS.map(cap => (
                <div key={cap} className="flex items-start gap-3 bg-[#f0f9ff] rounded-xl p-4 border border-sky-100">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-700">{cap}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* GRCEye vs manual */}
      <section className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-4xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">GRCEye vs. doing it manually</h2>
              <p className="text-gray-500 max-w-xl mx-auto">See what changes when you replace spreadsheets and email with a purpose-built platform.</p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="bg-white rounded-2xl border border-sky-100 overflow-hidden shadow-sm">
              <div className="grid grid-cols-3 bg-sky-50 border-b border-sky-100 px-6 py-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Task</p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide text-center">Manual / Spreadsheet</p>
                <p className="text-xs font-bold text-blue-600 uppercase tracking-wide text-center">With GRCEye</p>
              </div>
              {[
                ["Framework gap assessment",    "2–8 weeks of manual control review",    "Hours — AI analyses all controls at once"],
                ["Policy creation",             "Days of writing + legal review",         "Seconds — AI generates complete document"],
                ["Vendor contract review",      "Manual clause-by-clause reading",        "Minutes — AI flags risky clauses instantly"],
                ["Cross-framework mapping",     "Spreadsheet with 500+ rows",             "Automatic — controls mapped across all frameworks"],
                ["Compliance evidence tracking","Email chains + shared folders",           "Structured per-control evidence with auditor access"],
                ["Audit management",            "Word docs + email back-and-forth",        "Dedicated auditor portal with checklist + PDF report"],
                ["Risk quantification",         "Qualitative high/medium/low only",       "Monte Carlo simulation: ALE, SLE, P90, P95"],
                ["Board reporting",             "Manual slides assembled monthly",         "Automated weekly PDF reports — 5 report types"],
              ].map(([task, manual, grc], i) => (
                <div key={task} className={`grid grid-cols-3 px-6 py-4 border-b border-sky-50 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-sky-50/30"}`}>
                  <p className="text-sm font-semibold text-gray-800 pr-4">{task}</p>
                  <p className="text-sm text-gray-400 text-center px-2">{manual}</p>
                  <p className="text-sm text-blue-700 font-medium text-center px-2">{grc}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center relative overflow-hidden">
        <div className="absolute top-0 left-1/4 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none animate-blob" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-indigo-400/20 rounded-full blur-3xl pointer-events-none animate-blob animation-delay-2000" />
        <Reveal>
          <div className="relative max-w-2xl mx-auto">
            <h2 className="text-3xl font-extrabold mb-4">Ready to replace your GRC spreadsheets?</h2>
            <p className="text-blue-100 mb-8 text-lg">14-day free trial. Full access to all 7 modules. No credit card required.</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/register" className="flex items-center justify-center gap-2 bg-white text-blue-600 font-semibold px-8 py-3.5 rounded-2xl hover:bg-blue-50 transition-all shadow-md hover:-translate-y-0.5">
                Start free trial <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/solutions" className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-semibold px-8 py-3.5 rounded-2xl hover:bg-white/20 transition-all hover:-translate-y-0.5">
                See solutions by industry
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <SupportChat />

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <img src="/logo.png" alt="GRCEye" className="h-12 w-auto object-contain bg-white rounded-xl p-1.5" />
          <p className="text-xs text-slate-600">© 2026 GRCEye, Inc. All rights reserved. · Powered by <span className="text-slate-500 font-semibold">SilentWolf</span></p>
          <div className="flex gap-5 text-sm">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="mailto:sales@grceye.io" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
