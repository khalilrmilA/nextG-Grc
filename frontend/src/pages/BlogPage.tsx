import { Link } from "react-router-dom";
import { ArrowRight, Calendar, User, ArrowUpRight } from "lucide-react";

const BLOG_POSTS = [
  {
    id: 1,
    title: "How to Prepare for NIS2 Compliance in 2025",
    excerpt: "NIS2 enforcement begins this year. We break down the timeline, key requirements, and how to map your existing ISO 27001 controls to NIS2 obligations without duplicating effort.",
    date: "2026-03-15",
    author: "Sarah Chen",
    category: "Compliance",
    readTime: "8 min read"
  },
  {
    id: 2,
    title: "Risk Quantification: From Guesswork to Math",
    excerpt: "Stop using spreadsheets for risk scoring. Learn how Monte Carlo simulation brings statistical rigor to your risk register and gives your board the financial language they need.",
    date: "2026-03-10",
    author: "Marcus Rodriguez",
    category: "Risk Management",
    readTime: "10 min read"
  },
  {
    id: 3,
    title: "The Contract Review Workflow That Stopped a Compliance Disaster",
    excerpt: "How one SaaS company used AI contract intelligence to catch a missing GDPR DPA clause before signing — and prevented a six-figure audit finding.",
    date: "2026-03-05",
    author: "Priya Kapoor",
    category: "Vendor Risk",
    readTime: "7 min read"
  },
  {
    id: 4,
    title: "Auditor Portal: From Chaos to Checklist in Hours",
    excerpt: "Your auditors shouldn't have to email you for documents. See how a dedicated scoped portal cuts audit preparation time from weeks to days.",
    date: "2026-02-28",
    author: "James Wilson",
    category: "Audit Management",
    readTime: "6 min read"
  },
  {
    id: 5,
    title: "Why Your Compliance Team Needs a Framework Builder",
    excerpt: "Off-the-shelf frameworks don't always fit. Learn how to fork built-in frameworks, edit controls, and build custom frameworks without losing cross-framework evidence sharing.",
    date: "2026-02-21",
    author: "Elena Torres",
    category: "Frameworks",
    readTime: "9 min read"
  },
  {
    id: 6,
    title: "GDPR DPA Checklist: What Your Vendor Contracts Need",
    excerpt: "Data Processing Agreements are non-negotiable under GDPR. Here's the definitive checklist of clauses your legal team should be looking for — and how AI can flag missing ones automatically.",
    date: "2026-02-14",
    author: "David Kim",
    category: "Legal",
    readTime: "11 min read"
  },
];

const CATEGORIES = ["All", "Compliance", "Risk Management", "Vendor Risk", "Audit Management", "Frameworks", "Legal"];

export default function BlogPage() {
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
            <Link to="/blog" className="hover:text-gray-900 transition-colors font-medium text-gray-900">Blog</Link>
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
      <section className="pt-32 pb-16 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            GRC Insights & Best Practices
          </h1>
          <p className="text-xl text-gray-500">
            Compliance guidance, risk strategies, and vendor management insights from the GRC experts.
          </p>
        </div>
      </section>

      {/* ── Featured Post ── */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-3xl p-12 cursor-pointer hover:shadow-xl transition-shadow">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-block bg-blue-400 text-blue-900 text-xs font-bold px-3 py-1 rounded-full">Featured</span>
              <span className="text-sm opacity-90">5 min read</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">How to Prepare for NIS2 Compliance in 2025</h2>
            <p className="text-lg opacity-90 mb-6">NIS2 enforcement begins this year. We break down the timeline, key requirements, and how to map your existing ISO 27001 controls to NIS2 obligations without duplicating effort.</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-semibold">Sarah Chen</p>
                  <p className="text-sm opacity-75">Mar 15, 2026</p>
                </div>
              </div>
              <ArrowUpRight className="w-6 h-6" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Category Filter ── */}
      <section className="px-6 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button key={cat} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                cat === "All"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}>
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Blog Grid ── */}
      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {BLOG_POSTS.map((post) => (
              <article key={post.id} className="group cursor-pointer">
                <div className="bg-gray-100 rounded-2xl h-48 mb-4 group-hover:bg-gray-200 transition-colors" />
                <div className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full mb-3">
                  {post.category}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">
                  {post.title}
                </h3>
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">{post.excerpt}</p>
                <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Calendar className="w-4 h-4" />
                    <span>{new Date(post.date).toLocaleDateString()}</span>
                  </div>
                  <span className="text-xs text-gray-500">{post.readTime}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Newsletter CTA ── */}
      <section className="px-6 py-24 bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Stay Updated</h2>
          <p className="text-gray-600 mb-8">Get GRC insights and compliance updates delivered to your inbox every week.</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              placeholder="your@email.com"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors">
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
