import { Link } from "react-router-dom";
import {
  CheckCircle, ArrowRight, Zap, Lock, BarChart2,
  FileText, Building2, ClipboardList, BookOpen, AlertTriangle,
  ChevronRight, Star, Users, Award, Shield, MessageSquare,
  TrendingUp, Activity, Send, Bot, User,
} from "lucide-react";

const FEATURES = [
  { icon: AlertTriangle, title: "Risk Management",       desc: "Interactive 5×5 heat maps, risk registers, and automated likelihood/impact scoring." },
  { icon: CheckCircle,   title: "Compliance Tracking",   desc: "Map controls to 76+ frameworks. Track implementation progress with segmented dashboards." },
  { icon: ClipboardList, title: "Audit Management",      desc: "Plan, execute, and report on internal and external audits. Track findings to closure." },
  { icon: FileText,      title: "Policy Lifecycle",      desc: "Draft, approve, publish, and collect employee attestations — all in one place." },
  { icon: Building2,     title: "Vendor Risk (TPRM)",    desc: "Onboard, tier, and continuously monitor third-party vendors with AI-powered contract review." },
  { icon: BarChart2,     title: "Executive Reporting",   desc: "Board-ready dashboards, PDF exports, and real-time compliance scores." },
  { icon: BookOpen,      title: "Framework Library",     desc: "ISO 27001, SOC 2, GDPR, PCI DSS, HIPAA, NIST CSF, NIST 800-53, CIS Controls and more." },
  { icon: Zap,           title: "AI-Powered Workflows",  desc: "Generate policies, analyze vendor contracts, and prescreen suppliers with on-premise AI — your data never leaves your infrastructure." },
];

const FRAMEWORKS = [
  "ISO 27001:2022", "SOC 2 Type II", "GDPR", "PCI DSS 4.0",
  "HIPAA", "NIST CSF 2.0", "NIST 800-53 Rev5", "CIS Controls v8",
  "NIS2 Directive", "DORA", "ISO 42001", "NIST AI RMF",
];

const TESTIMONIALS = [
  { quote: "We cut our ISO 27001 certification prep from 18 months to 6. The framework gap analysis alone is worth every cent.", name: "Sarah K.", role: "CISO, FinTech Scale-up", rating: 5 },
  { quote: "Finally a GRC tool that doesn't require a PhD to use. Our compliance team was up and running in a day.", name: "Marcus T.", role: "Head of Compliance, SaaS Co.", rating: 5 },
  { quote: "The vendor risk module saved us countless hours of spreadsheet work. Board-ready reports in one click.", name: "Priya S.", role: "VP Risk, Healthcare Platform", rating: 5 },
];

// ── Mini UI mockups ──────────────────────────────────────────────────────────

function RiskHeatmapMockup() {
  const cells = [
    [0,0,1,2,2],[0,1,1,2,3],[0,1,2,2,3],[1,1,2,3,3],[1,2,2,3,3],
  ];
  const colors = ["bg-green-200","bg-yellow-200","bg-orange-200","bg-red-300"];
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-400" />
        <div className="w-3 h-3 rounded-full bg-yellow-400" />
        <div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-gray-500">Risk Heatmap</span>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <span className="text-sm font-bold text-gray-800">Risk Register — Q2 2026</span>
        </div>
        <div className="grid grid-cols-5 gap-1 mb-4">
          {cells.map((row, r) => row.map((v, c) => (
            <div key={`${r}-${c}`} className={`aspect-square rounded ${colors[v]} flex items-center justify-center`}>
              {v >= 2 && <span className="text-[9px] font-bold text-white">{v === 3 ? "H" : "M"}</span>}
            </div>
          )))}
        </div>
        <div className="space-y-1.5">
          {[
            { label: "Data Breach Risk", severity: "Critical", color: "bg-red-100 text-red-700" },
            { label: "Third-Party Access", severity: "High", color: "bg-orange-100 text-orange-700" },
            { label: "Patch Management", severity: "Medium", color: "bg-yellow-100 text-yellow-700" },
          ].map(r => (
            <div key={r.label} className="flex items-center justify-between px-2 py-1.5 bg-gray-50 rounded-lg">
              <span className="text-xs text-gray-700">{r.label}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.color}`}>{r.severity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComplianceMockup() {
  const controls = [
    { id: "A.8.1", name: "Asset inventory", pct: 100, color: "bg-green-500" },
    { id: "A.9.1", name: "Access control policy", pct: 75, color: "bg-blue-500" },
    { id: "A.12.1", name: "Operational procedures", pct: 50, color: "bg-yellow-500" },
    { id: "A.18.1", name: "Legal compliance", pct: 30, color: "bg-red-400" },
  ];
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-400" />
        <div className="w-3 h-3 rounded-full bg-yellow-400" />
        <div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-gray-500">Compliance Assessment</span>
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold text-gray-800">ISO 27001:2022</p>
            <p className="text-xs text-gray-400">114 controls · 64% compliant</p>
          </div>
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3b82f6" strokeWidth="3"
                strokeDasharray="64 36" strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-blue-600">64%</span>
          </div>
        </div>
        <div className="space-y-2.5">
          {controls.map(c => (
            <div key={c.id}>
              <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                <span className="font-mono font-semibold text-gray-700">{c.id} {c.name}</span>
                <span>{c.pct}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${c.color}`} style={{ width: `${c.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AIMockup() {
  const msgs = [
    { role: "user", text: "Generate an Access Control Policy for our SaaS company." },
    { role: "ai",   text: "# Access Control Policy\n**Version 1.0 · Effective 2026-01-01**\n\n## 1. Purpose\nThis policy establishes requirements for controlling access to information assets…" },
  ];
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-400" />
        <div className="w-3 h-3 rounded-full bg-yellow-400" />
        <div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-gray-500">AI Document Generator</span>
      </div>
      <div className="p-5 space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${m.role === "ai" ? "bg-gradient-to-br from-purple-500 to-indigo-600" : "bg-gray-200"}`}>
              {m.role === "ai" ? <Bot className="w-3.5 h-3.5 text-white" /> : <User className="w-3.5 h-3.5 text-gray-600" />}
            </div>
            <div className={`rounded-xl px-3 py-2 text-xs max-w-[80%] ${m.role === "ai" ? "bg-gray-50 border border-gray-100 text-gray-700 font-mono leading-relaxed" : "bg-blue-600 text-white"}`}>
              {m.text.split("\n").map((l, j) => <div key={j}>{l || <br />}</div>)}
            </div>
          </div>
        ))}
        <div className="flex gap-2 items-center mt-2 pt-2 border-t border-gray-100">
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-[10px] text-gray-400">Ask GRCEye AI…</div>
          <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center">
            <Send className="w-3 h-3 text-white" />
          </div>
        </div>
      </div>
    </div>
  );
}

function VendorChatMockup() {
  const messages = [
    { from: "Vendor (Acme IT)", text: "We've uploaded our SOC 2 report and updated our data processing addendum.", side: "left", color: "bg-blue-50 border-blue-100 text-blue-900" },
    { from: "Your Team", text: "Received. AI review flagged 3 clauses in section 4 — liability cap seems below our threshold.", side: "right", color: "bg-indigo-600 text-white" },
    { from: "Vendor (Acme IT)", text: "Understood. We can revise clause 4.2. Our legal team will send a redline by EOD.", side: "left", color: "bg-blue-50 border-blue-100 text-blue-900" },
    { from: "Your Team", text: "Perfect. CISO review scheduled for Friday. Contract status updated to 'Under Review'.", side: "right", color: "bg-indigo-600 text-white" },
  ];
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-xs font-semibold text-gray-500">Vendor Collaboration</span>
        </div>
        <span className="text-[10px] bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block" /> Live
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-bold text-gray-800">Acme IT Services — Contract Review Thread</span>
        </div>
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-0.5 ${m.side === "right" ? "items-end" : "items-start"}`}>
            <span className="text-[9px] text-gray-400 px-1">{m.from}</span>
            <div className={`rounded-xl px-3 py-2 text-[11px] max-w-[85%] border ${m.color}`}>
              {m.text}
            </div>
          </div>
        ))}
        <div className="flex gap-2 items-center pt-2 border-t border-gray-100">
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-[10px] text-gray-400">Reply to vendor…</div>
          <div className="w-6 h-6 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Send className="w-3 h-3 text-white" />
          </div>
        </div>
      </div>
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
          <nav className="hidden md:flex items-center gap-8 text-sm text-gray-500">
            <a href="#features" className="hover:text-gray-900 transition-colors">Features</a>
            <a href="#screenshots" className="hover:text-gray-900 transition-colors">Modules</a>
            <a href="#frameworks" className="hover:text-gray-900 transition-colors">Frameworks</a>
            <Link to="/faq" className="hover:text-gray-900 transition-colors">FAQ</Link>
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

      {/* ── Module Screenshots ── */}
      <section id="screenshots" className="py-24 px-6 bg-slate-50 border-y border-gray-100">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3">See it in action</h2>
            <p className="text-gray-500 max-w-xl mx-auto">Every module built for real GRC workflows — not just dashboards.</p>
          </div>

          {/* Row 1: Risk + Compliance */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 text-red-600 text-xs font-semibold bg-red-50 px-3 py-1.5 rounded-full mb-4">
                <AlertTriangle className="w-3.5 h-3.5" /> Risk Management
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Visualize risk at a glance</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Interactive 5×5 heatmaps, risk registers with severity scoring, Monte Carlo simulations, and full treatment plans. Know where your biggest exposures are — instantly.</p>
              <ul className="space-y-2">
                {["Risk register with owner + next-review tracking","Monte Carlo quantification (ALE, SLE, P90/P95)","Custom risk matrices (3×3, 5×5, or custom)","Risk scenarios: Threat → Vuln → Asset → Control"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </div>
            <RiskHeatmapMockup />
          </div>

          {/* Row 2: Compliance (reversed) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-16 items-center">
            <div className="order-2 md:order-1">
              <ComplianceMockup />
            </div>
            <div className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 text-blue-600 text-xs font-semibold bg-blue-50 px-3 py-1.5 rounded-full mb-4">
                <CheckCircle className="w-3.5 h-3.5" /> Compliance Tracking
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">76 frameworks, one dashboard</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Run assessments across any combination of frameworks simultaneously. Evidence uploaded once applies across all mapped controls — no double work.</p>
              <ul className="space-y-2">
                {["76 built-in frameworks with pre-mapped controls","Cross-framework evidence propagation","Gap analysis with AI-generated remediation steps","Auditor portal with scoped access"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Row 3: AI + Vendor chat */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-2 text-purple-600 text-xs font-semibold bg-purple-50 px-3 py-1.5 rounded-full mb-4">
                <Zap className="w-3.5 h-3.5" /> AI Assistant
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">On-premise AI that works for you</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Generate complete GRC documents, analyze compliance gaps, prescreen vendors, and get instant answers — all powered by AI running inside your infrastructure. Your data never leaves.</p>
              <ul className="space-y-2">
                {["29 document types generated in seconds","AI contract clause detection & fix suggestions","Vendor prescreen questionnaire analysis","Real-time streaming responses"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </div>
            <AIMockup />
          </div>
        </div>
      </section>

      {/* ── Vendor Real-time Collaboration ── */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div className="order-2 md:order-1">
              <VendorChatMockup />
            </div>
            <div className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 text-indigo-600 text-xs font-semibold bg-indigo-50 px-3 py-1.5 rounded-full mb-4">
                <MessageSquare className="w-3.5 h-3.5" /> Real-time Vendor Collaboration
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Close vendor contracts faster</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Real-time collaboration threads between your team and vendors — share contracts, track revisions, route for CISO approval, and communicate findings without leaving the platform.</p>
              <ul className="space-y-2">
                {["Secure vendor collaboration portal","AI contract review with inline fix suggestions","CISO approval workflow with audit trail","Live status tracking: Draft → Review → Approved"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Live Stats ── */}
      <section className="py-16 px-6 bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { icon: Shield,      value: "76+",    label: "Compliance frameworks" },
              { icon: Activity,    value: "3,500+", label: "Pre-mapped controls" },
              { icon: TrendingUp,  value: "60%",    label: "Faster audit prep" },
              { icon: Users,       value: "9",      label: "Role-based access levels" },
            ].map(s => (
              <div key={s.label}>
                <s.icon className="w-7 h-7 mx-auto mb-3 text-blue-200" />
                <p className="text-4xl font-extrabold mb-1">{s.value}</p>
                <p className="text-sm text-blue-200">{s.label}</p>
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
              { icon: Lock,   label: "ISO/IEC certified controls",  value: "ISO 27001 · ISO 27002 · ISO 42001" },
              { icon: Award,  label: "Regulatory frameworks",       value: "GDPR · HIPAA · PCI DSS · DORA" },
              { icon: Users,  label: "Industry standards",          value: "SOC 2 · CIS · NIST · CSA CCM" },
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

      {/* ── Testimonials ── */}
      <section className="py-24 px-6 bg-white">
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

      {/* ── Resources ── */}
      <section className="py-24 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-12">Learn More</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Link to="/features-landing" className="group bg-white rounded-2xl p-8 border border-gray-200 hover:border-blue-600 hover:shadow-lg transition-all">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">Features</h3>
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
              </div>
              <p className="text-gray-600 text-sm">Explore all GRC capabilities from risk management to compliance to audit operations.</p>
              <div className="mt-6 pt-6 border-t border-gray-200">
                <span className="text-blue-600 font-semibold text-xs">Browse features →</span>
              </div>
            </Link>

            <Link to="/blog" className="group bg-white rounded-2xl p-8 border border-gray-200 hover:border-blue-600 hover:shadow-lg transition-all">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">Blog</h3>
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
              </div>
              <p className="text-gray-600 text-sm">Insights on compliance strategy, risk management, and best practices from experts.</p>
              <div className="mt-6 pt-6 border-t border-gray-200">
                <span className="text-blue-600 font-semibold text-xs">Read articles →</span>
              </div>
            </Link>

            <Link to="/news" className="group bg-white rounded-2xl p-8 border border-gray-200 hover:border-blue-600 hover:shadow-lg transition-all">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">News</h3>
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
              </div>
              <p className="text-gray-600 text-sm">Latest regulatory updates and framework news affecting your compliance obligations.</p>
              <div className="mt-6 pt-6 border-t border-gray-200">
                <span className="text-blue-600 font-semibold text-xs">Read news →</span>
              </div>
            </Link>

            <Link to="/faq" className="group bg-white rounded-2xl p-8 border border-gray-200 hover:border-blue-600 hover:shadow-lg transition-all">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">FAQ</h3>
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
              </div>
              <p className="text-gray-600 text-sm">Common questions about GRCEye features, deployment, and getting started.</p>
              <div className="mt-6 pt-6 border-t border-gray-200">
                <span className="text-blue-600 font-semibold text-xs">View FAQ →</span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-extrabold mb-4">Start your GRC journey today</h2>
          <p className="text-blue-100 mb-8 text-lg">14-day free trial. No credit card. Full access to all features.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="flex items-center justify-center gap-2 bg-white text-blue-600 font-semibold px-8 py-3.5 rounded-2xl hover:bg-blue-50 transition-colors shadow-md text-base">
              Start free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="mailto:sales@grceye.io" className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-semibold px-8 py-3.5 rounded-2xl hover:bg-white/20 transition-colors text-base">
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
          <div className="text-center">
            <p className="text-xs text-slate-500">© 2026 GRCEye, Inc. All rights reserved.</p>
            <p className="text-xs text-slate-600 mt-2">Powered by <span className="font-semibold">SilentWolf</span></p>
          </div>
          <div className="flex gap-5 text-sm">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Security</a>
            <a href="mailto:sales@grceye.io" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
