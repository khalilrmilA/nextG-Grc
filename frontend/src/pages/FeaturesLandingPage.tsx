import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle, AlertTriangle, ClipboardList, FileText, Building2, BarChart2, BookOpen, Zap } from "lucide-react";

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

export default function FeaturesLandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* ── Nav ── */}
      <header className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="GRCEye" className="h-14 w-auto object-contain" />
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-gray-500">
            <Link to="/features-landing" className="hover:text-gray-900 transition-colors font-medium text-gray-900">Features</Link>
            <Link to="/blog" className="hover:text-gray-900 transition-colors">Blog</Link>
            <Link to="/news" className="hover:text-gray-900 transition-colors">News</Link>
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
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            Everything your GRC team needs
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            From risk to compliance to audit — one integrated workflow, no spreadsheets required.
          </p>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
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

      {/* ── Features Detail Section ── */}
      <section className="py-24 px-6 bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-12 text-center">Core Capabilities</h2>
          <div className="space-y-12">
            {[
              {
                title: "Multi-Framework Compliance",
                points: ["76 built-in frameworks (ISO, NIST, GDPR, NIS2, DORA, AI Act...)", "Cross-framework evidence sharing", "AI-powered gap analysis", "Real-time compliance scoring"]
              },
              {
                title: "Risk Management & Quantification",
                points: ["5×5 likelihood × impact heatmaps", "Monte Carlo quantification (10K iterations)", "Risk acceptance workflow with approval chains", "Automatic risk review deadline tracking"]
              },
              {
                title: "Third-Party Risk (TPRM)",
                points: ["Vendor registry with risk tiers", "AI prescreen questionnaire (15 questions)", "6-dimension risk cartography", "Contract expiry monitoring with alerts"]
              },
              {
                title: "AI Contract Intelligence",
                points: ["Conversational contract review", "GDPR DPA clause detection", "NIS2 & DORA ICT term analysis", "All processing local — zero data egress"]
              },
              {
                title: "Audit Management",
                points: ["Full audit lifecycle management", "Dedicated auditor portal", "Findings tracker with severity levels", "Automated PDF audit report generation"]
              },
              {
                title: "Policy Governance",
                points: ["29 AI document types", "Full version history with tracking", "Employee attestation & completion tracking", "Policies linked to framework controls"]
              },
            ].map((section, idx) => (
              <div key={idx} className="bg-white rounded-2xl p-8 border border-gray-200">
                <h3 className="text-xl font-bold text-gray-900 mb-6">{section.title}</h3>
                <ul className="space-y-3">
                  {section.points.map((point, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-extrabold mb-4">Ready to transform your GRC?</h2>
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
          <div className="text-center">
            <p className="text-xs text-slate-500">© 2026 GRCEye, Inc. All rights reserved.</p>
            <p className="text-xs text-slate-600 mt-2">Powered by <span className="font-semibold">SilentWolf</span></p>
          </div>
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
