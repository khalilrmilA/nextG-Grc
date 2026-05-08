import { Link } from "react-router-dom";
import { useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";

const FAQ_ITEMS = [
  {
    category: "Getting Started",
    items: [
      {
        q: "How do I sign up for GRCEye?",
        a: "Click 'Start free trial' and create an account with your email. You'll get instant access to the full platform for 14 days with no credit card required."
      },
      {
        q: "Is there a free trial?",
        a: "Yes! Every new account includes a 14-day free trial with full access to all Professional plan features. No credit card needed to start."
      },
      {
        q: "Can I import my existing data?",
        a: "Yes. GRCEye supports CSV import for risks, vendors, and assets. We can also help with custom data migrations during onboarding."
      },
      {
        q: "Do you offer onboarding support?",
        a: "Absolutely. Professional and Enterprise plans include dedicated onboarding support. We'll help you set up frameworks, map controls, and get your first assessments running."
      },
    ]
  },
  {
    category: "Features & Capabilities",
    items: [
      {
        q: "How many frameworks does GRCEye support?",
        a: "GRCEye includes 76 built-in frameworks (ISO 27001, SOC 2, GDPR, NIS2, DORA, AI Act, NIST, PCI DSS, HIPAA, and many more). You can also build unlimited custom frameworks."
      },
      {
        q: "Can I customize frameworks?",
        a: "Yes. You can fork any built-in framework into a fully editable tenant copy, then add, edit, or delete controls. Built-in frameworks remain read-only and shared."
      },
      {
        q: "Does GRCEye support multiple assessments?",
        a: "Yes. You can run assessments against any combination of frameworks simultaneously. Evidence uploaded to one control automatically propagates to equivalent controls across frameworks."
      },
      {
        q: "What is the AI used for?",
        a: "Our AI powers: compliance gap analysis, policy drafting (29 document types), contract clause detection, vendor prescreening, and framework building. All processing is local — your data never leaves your infrastructure."
      },
      {
        q: "Can auditors see my data?",
        a: "Auditors get a dedicated scoped portal with access only to assigned assessments. You can share secure links for document collection without granting platform access."
      },
    ]
  },
  {
    category: "Compliance & Security",
    items: [
      {
        q: "Is GRCEye GDPR compliant?",
        a: "Yes. GRCEye is fully GDPR compliant with Data Processing Agreements available. We support DPA templates and have controls for breach notification workflows."
      },
      {
        q: "Where is my data stored?",
        a: "Data can be stored in EU (Frankfurt) or US (Virginia) regions depending on your plan and regulatory requirements. Enterprise customers can self-host."
      },
      {
        q: "Is the AI processing local?",
        a: "Yes. All AI processing runs on your self-hosted LLM inside your infrastructure. No contract text, personal data, or sensitive information is transmitted externally."
      },
      {
        q: "Do you offer SSO or SAML?",
        a: "Enterprise plans include SAML 2.0 SSO integration. Professional plans support OAuth. Contact sales for custom auth configurations."
      },
      {
        q: "What happens to my data if I cancel?",
        a: "You retain access to export all your data in CSV format for 30 days after cancellation. Data is securely deleted after that period."
      },
    ]
  },
  {
    category: "Pricing & Plans",
    items: [
      {
        q: "What's included in each plan?",
        a: "Starter ($500/mo): 3 frameworks, 10 users. Professional ($2,500/mo): 10 frameworks, 50 users, AI features. Enterprise: Unlimited, custom features, self-hosted option."
      },
      {
        q: "Can I change plans later?",
        a: "Yes. You can upgrade or downgrade anytime. Changes take effect at your next billing cycle."
      },
      {
        q: "Do you offer annual discounts?",
        a: "Yes. Annual plans are billed at the monthly rate × 12 with a 10-15% discount. Contact sales for volume pricing."
      },
      {
        q: "Is there a setup fee?",
        a: "No setup fees. You only pay the monthly subscription. Professional and Enterprise plans include onboarding at no extra charge."
      },
      {
        q: "What's your refund policy?",
        a: "We offer a 30-day money-back guarantee if you're not satisfied. After that, you can cancel anytime."
      },
    ]
  },
  {
    category: "Deployment & Integration",
    items: [
      {
        q: "Is GRCEye cloud-only or can I self-host?",
        a: "GRCEye is cloud-hosted by default. Enterprise customers can deploy self-hosted or on-premise versions."
      },
      {
        q: "Does GRCEye integrate with other tools?",
        a: "Yes. We support webhooks for outbound integrations. We can also integrate with ITSM tools, vulnerability scanners, and identity platforms. Contact us for details."
      },
      {
        q: "Can I export reports?",
        a: "Yes. GRCEye generates 5 types of automated PDF reports (Executive, Risk, Compliance, Vendor, Audit). You can also export data in CSV format."
      },
      {
        q: "What's your uptime SLA?",
        a: "Professional: 99.5% SLA. Enterprise: 99.9% SLA with dedicated support."
      },
    ]
  },
];

function FAQAccordion({ category, items }: { category: string; items: Array<{ q: string; a: string }> }) {
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="mb-12">
      <h3 className="text-2xl font-bold text-gray-900 mb-6">{category}</h3>
      <div className="space-y-4">
        {items.map((item, idx) => (
          <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === idx ? null : idx)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
            >
              <span className="font-semibold text-gray-900">{item.q}</span>
              <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${expanded === idx ? 'rotate-180' : ''}`} />
            </button>
            {expanded === idx && (
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                <p className="text-gray-700 leading-relaxed">{item.a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FAQPage() {
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
            <Link to="/news" className="hover:text-gray-900 transition-colors">News</Link>
            <Link to="/faq" className="hover:text-gray-900 transition-colors font-medium text-gray-900">FAQ</Link>
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
            Frequently Asked Questions
          </h1>
          <p className="text-xl text-gray-500">
            Find answers to common questions about GRCEye features, pricing, deployment, and more.
          </p>
        </div>
      </section>

      {/* ── FAQ Content ── */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          {FAQ_ITEMS.map((section, idx) => (
            <FAQAccordion key={idx} category={section.category} items={section.items} />
          ))}
        </div>
      </section>

      {/* ── Contact CTA ── */}
      <section className="px-6 py-24 bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Still have questions?</h2>
          <p className="text-gray-600 mb-8">Can't find the answer you're looking for? Our support team is here to help.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="mailto:support@grcplatform.io" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-xl transition-colors">
              Email support <ArrowRight className="w-4 h-4" />
            </a>
            <a href="mailto:sales@grcplatform.io" className="flex items-center justify-center gap-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-semibold px-8 py-3 rounded-xl transition-colors">
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
