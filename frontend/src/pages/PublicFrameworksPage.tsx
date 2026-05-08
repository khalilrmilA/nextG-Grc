import { Link } from "react-router-dom";
import { ArrowRight, Lock, Award, Users } from "lucide-react";

const FRAMEWORKS = [
  "ISO 27001:2022", "SOC 2 Type II", "GDPR", "PCI DSS 4.0",
  "HIPAA", "NIST CSF 2.0", "NIST 800-53 Rev5", "CIS Controls v8",
  "NIS2 Directive", "DORA", "ISO 42001", "NIST AI RMF",
];

export default function PublicFrameworksPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* ── Nav ── */}
      <header className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="GRCEye" className="h-14 w-auto object-contain" />
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-500">
            <Link to="/features" className="hover:text-gray-900 transition-colors">Features</Link>
            <Link to="/frameworks" className="hover:text-gray-900 transition-colors font-medium text-gray-900">Frameworks</Link>
            <Link to="/customers" className="hover:text-gray-900 transition-colors">Customers</Link>
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

      {/* ── Frameworks ── */}
      <section className="pt-32 pb-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6">Built for every framework</h1>
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto">Pre-loaded with controls, crosswalk mappings, and evidence requirements for 76 global frameworks.</p>
          <div className="flex flex-wrap justify-center gap-3 mb-16">
            {FRAMEWORKS.map(fw => (
              <span key={fw} className="bg-gray-100 border border-gray-300 text-gray-900 text-sm font-medium px-4 py-2 rounded-xl">
                {fw}
              </span>
            ))}
            <span className="bg-blue-600/20 border border-blue-500/30 text-blue-700 text-sm font-medium px-4 py-2 rounded-xl">
              + 64 more frameworks
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {[
              { icon: Lock,   label: "ISO/IEC certified controls",   value: "ISO 27001 · ISO 27002 · ISO 42001" },
              { icon: Award,  label: "Regulatory frameworks",        value: "GDPR · HIPAA · PCI DSS · DORA" },
              { icon: Users,  label: "Industry standards",           value: "SOC 2 · CIS · NIST · CSA CCM" },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-2xl p-6 text-left border border-gray-200">
                <s.icon className="w-5 h-5 text-blue-600 mb-3" />
                <p className="text-xs text-gray-600 mb-2">{s.label}</p>
                <p className="text-sm font-semibold text-gray-900">{s.value}</p>
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
