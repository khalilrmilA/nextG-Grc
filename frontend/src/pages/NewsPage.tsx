import { Link } from "react-router-dom";
import { ArrowRight, Zap, Calendar } from "lucide-react";

const NEWS_ITEMS = [
  {
    id: 1,
    title: "EU AI Act Enforcement Timeline Extended — What It Means for Your Controls",
    excerpt: "The enforcement date for high-risk AI systems has been pushed to Q4 2026. We break down the implications for AI governance frameworks and what compliance teams need to do now.",
    date: "2026-03-18",
    category: "Regulation",
    type: "update"
  },
  {
    id: 2,
    title: "NIST CSF 2.0 Now Includes Governance Function — Framework Update",
    excerpt: "NIST released the final version of the Cybersecurity Framework 2.0 with a new 'Govern' function at the core. GRCEye now includes the updated controls and cross-walks.",
    date: "2026-03-12",
    category: "Framework Update",
    type: "important"
  },
  {
    id: 3,
    title: "GDPR Fines Hit €1.2B in Q1 2026 — Enforcement Accelerates",
    excerpt: "The first quarter of 2026 saw record GDPR penalties. Analysis shows DPA and consent management failures are the top reasons. Ensure your contracts are audit-ready.",
    date: "2026-03-08",
    category: "Enforcement",
    type: "alert"
  },
  {
    id: 4,
    title: "NIS2 Directive: 90% of EU Financial Entities Now Comply",
    excerpt: "New compliance statistics show broad adoption of NIS2 controls across the EU financial sector. We've updated our NIS2 control templates with the latest requirement mappings.",
    date: "2026-03-01",
    category: "Compliance",
    type: "update"
  },
  {
    id: 5,
    title: "ISO 27001:2022 Revision — New Annex A Controls Added",
    excerpt: "ISO released clarifications on 12 new Annex A controls in response to the 2022 revision. GRCEye's ISO 27001 framework now reflects these additions with evidence templates.",
    date: "2026-02-24",
    category: "Framework Update",
    type: "important"
  },
  {
    id: 6,
    title: "DORA Q2 2026: ICT Third-Party Monitoring Requirements",
    excerpt: "The Digital Operational Resilience Act now requires quarterly monitoring reports for all critical ICT service providers. We've added DORA-specific vendor assessment templates.",
    date: "2026-02-18",
    category: "Regulation",
    type: "important"
  },
  {
    id: 7,
    title: "SOC 2 Type II Audit Report Timing — New Guidance Released",
    excerpt: "The AICPA clarified timing requirements for SOC 2 Type II reports. Reports must cover at least 6 months. See our updated SOC 2 framework guidance.",
    date: "2026-02-10",
    category: "Guidance",
    type: "update"
  },
  {
    id: 8,
    title: "CIS Controls v9 Released — Major Update to Control Set",
    excerpt: "The Center for Internet Security released CIS Controls v9 with restructured controls and new cloud security focus. GRCEye's CIS framework is now updated.",
    date: "2026-02-03",
    category: "Framework Update",
    type: "important"
  },
];

export default function NewsPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* ── Nav ── */}
      <header className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="GRCEye" className="h-14 w-auto object-contain" />
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-gray-500">
            <Link to="/features-landing" className="hover:text-gray-900 transition-colors">Features</Link>
            <Link to="/blog" className="hover:text-gray-900 transition-colors">Blog</Link>
            <Link to="/news" className="hover:text-gray-900 transition-colors font-medium text-gray-900">News</Link>
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
      <section className="pt-32 pb-16 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            Framework & Regulatory News
          </h1>
          <p className="text-xl text-gray-500">
            Stay updated on the latest compliance updates, regulatory changes, and framework releases.
          </p>
        </div>
      </section>

      {/* ── News Feed ── */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {NEWS_ITEMS.map((item) => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-2xl p-8 hover:shadow-lg hover:border-blue-200 transition-all group cursor-pointer">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    item.type === 'alert' ? 'bg-red-500' :
                    item.type === 'important' ? 'bg-amber-500' :
                    'bg-blue-500'
                  }`} />
                  <span className={`inline-block text-xs font-bold px-3 py-1 rounded-full ${
                    item.category === 'Regulation' ? 'bg-red-50 text-red-700' :
                    item.category === 'Enforcement' ? 'bg-orange-50 text-orange-700' :
                    item.category === 'Framework Update' ? 'bg-purple-50 text-purple-700' :
                    'bg-blue-50 text-blue-700'
                  }`}>
                    {item.category}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Calendar className="w-4 h-4" />
                  <span>{new Date(item.date).toLocaleDateString()}</span>
                </div>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-blue-600 transition-colors line-clamp-2">
                {item.title}
              </h3>
              <p className="text-gray-600 mb-4">{item.excerpt}</p>
              <div className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm group-hover:gap-3 transition-all">
                Read more <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Newsletter CTA ── */}
      <section className="px-6 py-24 bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="max-w-2xl mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-semibold text-blue-600">Stay Informed</span>
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Get Regulatory Updates</h2>
          <p className="text-gray-600 mb-8">Subscribe to get notified about framework changes, regulatory updates, and compliance deadlines.</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              placeholder="your@email.com"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors whitespace-nowrap">
              Subscribe
            </button>
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
