import { Link } from "react-router-dom";
import { useState } from "react";
import { ArrowRight, ChevronDown, FileText, ExternalLink } from "lucide-react";

const FAQ_ITEMS = [
  {
    category: "Getting Started",
    items: [
      {
        q: "How do I create an account on GRCEye?",
        a: "Click 'Get started free' and fill in your name, email, organization name, and a unique slug. You'll get instant access to the full platform for 14 days — no credit card required.",
      },
      {
        q: "Can I import my existing data?",
        a: "Yes. GRCEye supports CSV import for risks, vendors, and assets. Each import provides a detailed error report so you can fix mismatches before re-uploading.",
      },
      {
        q: "What roles are available for my team?",
        a: "GRCEye has 9 built-in roles: Tenant Admin, CISO, Risk Manager, Compliance Manager, Policy Manager, Vendor Manager, Control Owner, Auditor, and Viewer. Each role has tailored access to the relevant modules.",
      },
      {
        q: "How does the multi-tenant setup work?",
        a: "Each organization gets its own isolated tenant. Your data, users, frameworks, and configurations are completely separate from other tenants on the platform.",
      },
    ],
  },
  {
    category: "Risk Management",
    items: [
      {
        q: "What does the Risk Register include?",
        a: "The risk register supports full CRUD operations with likelihood × impact scoring on a configurable 5×5 matrix. Each risk has a severity classification, owner, next-review date, treatment plan, and full activity history.",
      },
      {
        q: "What is Risk Quantification?",
        a: "GRCEye includes a Monte Carlo simulation engine (10,000 iterations) that produces ALE (Annual Loss Expectancy), SLE (Single Loss Expectancy), P90, and P95 values — turning qualitative risk scores into financial figures for executive reporting.",
      },
      {
        q: "Can I build custom risk matrices?",
        a: "Yes. You can create custom probability/impact scales (3×3, 5×5, or any custom size) with your own labels, colors, and score mappings. Custom matrices apply to your risk register and heatmap.",
      },
      {
        q: "What are Risk Scenarios?",
        a: "Risk Scenarios let you model Threat → Vulnerability → Asset → Control chains. Each scenario tracks current and target probability/impact, linking directly to your asset inventory and applied controls.",
      },
    ],
  },
  {
    category: "Compliance & Frameworks",
    items: [
      {
        q: "How many frameworks does GRCEye support?",
        a: "GRCEye includes 76 built-in frameworks: ISO 27001:2022, SOC 2, GDPR, NIS2, DORA, AI Act, NIST CSF 2.0, NIST 800-53 Rev5, PCI DSS 4.0, HIPAA, CIS Controls v8, MITRE ATT&CK, and many more.",
      },
      {
        q: "Can I customize a built-in framework?",
        a: "Yes. Use the 'Customize' button on any built-in framework to fork it into a fully editable tenant copy. You can rename the framework, add, edit, or delete controls, and manage parent/child control relationships. Built-in frameworks remain read-only.",
      },
      {
        q: "Can I build a completely custom framework?",
        a: "Yes. The Custom Framework Builder lets you create a framework from scratch by combining controls from any existing frameworks and adding your own. The AI can suggest relevant controls based on your industry and region.",
      },
      {
        q: "How does evidence upload work?",
        a: "Each control in an assessment has a dedicated evidence section. You can upload files, add justification text, and mark visibility for auditors. Evidence is versioned and linked to specific controls across assessments.",
      },
      {
        q: "What is the Cross-Framework Coverage view?",
        a: "The coverage view shows how your compliance effort maps across multiple frameworks simultaneously — identifying which controls satisfy requirements in more than one framework, so you avoid duplicating work.",
      },
    ],
  },
  {
    category: "Audit Management",
    items: [
      {
        q: "What does the Audit module cover?",
        a: "Audit Management covers the full audit lifecycle: planning, control assignment, checklist execution, finding creation, remediation tracking, and final report generation. Supports internal and external audit types.",
      },
      {
        q: "How do auditor accounts work?",
        a: "Auditors have a dedicated portal scoped to their assigned assessments only. They can view evidence, upload documents, and record findings — without access to the rest of the platform. Tenant admins create and manage auditor accounts.",
      },
      {
        q: "Can I assign auditors to specific assessments?",
        a: "Yes. From the Company Admin panel, you can assign any auditor account to one or more compliance assessments. Auditors only see the assessments they are assigned to.",
      },
      {
        q: "What is the Audit Checklist?",
        a: "Each assigned audit has a control checklist where the auditor can mark controls as compliant, non-compliant, or not applicable, attach evidence, and create findings with severity ratings (critical, high, medium, low, informational).",
      },
    ],
  },
  {
    category: "Policy & Document Management",
    items: [
      {
        q: "How does the AI Document Generator work?",
        a: "The Document Generator uses your local AI to produce complete, ready-to-adopt GRC documents (29 types across 4 categories) tailored to your organization's name, industry, size, country, and selected compliance frameworks. Generated documents auto-save as drafts.",
      },
      {
        q: "What document types are available?",
        a: "29 document types across 4 categories: Foundation (Information Security Policy, ISMS Scope, SoA, etc.), Security Policies (Access Control, BYOD, Cryptography, etc.), Procedures (Incident Response, Change Management, etc.), and Plans (BCP, DRP, IRP, etc.).",
      },
      {
        q: "Does GRCEye support policy versioning?",
        a: "Yes. Every policy has a full version history. You can create new versions, mark them as current, and track who authored and approved each version. Employees can be sent attestation requests to formally acknowledge policies.",
      },
      {
        q: "What are Policy Attestations?",
        a: "Attestations allow you to send formal acknowledgement requests to employees for any policy. Recipients can acknowledge or reject. The platform tracks response status and sends reminders for overdue attestations.",
      },
    ],
  },
  {
    category: "Vendor Risk (TPRM)",
    items: [
      {
        q: "What does the TPRM module include?",
        a: "Vendor Risk Management covers vendor onboarding with risk tiers (critical/high/medium/low), contract upload and AI review, a 6-dimension risk cartography heatmap, AI-powered prescreening questionnaires, and contract versioning with CISO approval workflows.",
      },
      {
        q: "How does AI contract review work?",
        a: "Upload a vendor contract and the AI performs a structured 6-section analysis: identifying risky clauses, suggesting fixes, flagging data processing terms, liability gaps, and SLA issues — all streamed in real time.",
      },
      {
        q: "What is the Vendor Prescreen Questionnaire?",
        a: "Before onboarding a vendor, you can run a 15-question AI prescreening. The AI analyzes the responses and produces a risk summary with a recommendation to proceed, review, or reject the vendor.",
      },
      {
        q: "What is the Risk Cartography view?",
        a: "The Risk Cartography view plots each vendor on a 6-dimension heatmap covering data access, financial exposure, operational dependency, regulatory risk, geographic risk, and reputational risk — giving you a visual picture of your supply chain risk.",
      },
    ],
  },
  {
    category: "AI Capabilities",
    items: [
      {
        q: "Is the AI processing local or cloud-based?",
        a: "All AI processing runs on your self-hosted LLM inside your own infrastructure using Ollama. No contract text, personal data, policy content, or sensitive information is ever transmitted to external AI providers — zero data egress, full privacy.",
      },
      {
        q: "What does the GRC AI Assistant do?",
        a: "The AI Assistant is a context-aware compliance chat interface trained for GRC work. It answers questions on ISO 27001, SOC 2, GDPR, NIS2, DORA, and more — helping you draft controls, interpret requirements, prepare for audits, and get instant expert guidance without leaving the platform.",
      },
      {
        q: "How does AI-powered document generation work?",
        a: "The Document Generator uses your private LLM to produce 29 types of GRC documents — Information Security Policy, ISMS Scope, BCP, DRP, Incident Response Plan, Access Control Policy, and more. You provide your organization name, industry, size, country, and target frameworks, and the AI writes a complete, audit-ready document tailored to your context. Documents stream in real time and auto-save as drafts.",
      },
      {
        q: "What is AI Contract Review and why does it matter?",
        a: "When you upload a vendor contract, the AI performs a structured 6-section analysis: it identifies risky clauses, flags data processing terms, spots SLA gaps, detects liability imbalances, and suggests specific fixes — all streamed live. This replaces hours of manual legal review and surfaces issues that are easy to miss when processing many contracts.",
      },
      {
        q: "How does AI Vendor Prescreening work?",
        a: "Before onboarding a new vendor, you can trigger a 15-question AI prescreening questionnaire. The AI analyzes the vendor's responses holistically and produces a risk recommendation: proceed, review further, or reject — saving your team from evaluating low-quality vendors manually.",
      },
      {
        q: "Can AI help with compliance gap analysis?",
        a: "Yes. The Compliance module uses AI to analyze each framework control against your stated implementation status. It estimates an AI confidence score, identifies gaps, and generates specific remediation steps — turning a manual review that takes days into an automated analysis that runs in minutes.",
      },
      {
        q: "Can AI suggest controls for a custom framework?",
        a: "Yes. The Custom Framework Builder includes an AI control suggestion engine. You describe your industry, region, and compliance objectives, and the AI recommends relevant controls drawn from any of the 76 built-in frameworks — saving you from building frameworks from scratch.",
      },
      {
        q: "Is GRCEye aligned with the EU AI Act?",
        a: "GRCEye's AI features are designed with the EU AI Act in mind: AI is used only as an advisory layer (humans make all final decisions), all AI processing is on-premise (no third-party AI providers), and the AI module is fully auditable within the platform's activity log.",
      },
      {
        q: "Does using the AI expose our sensitive data to third parties?",
        a: "No. GRCEye runs AI entirely on your own infrastructure via Ollama. Your policy content, contract clauses, vendor data, and compliance details never leave your servers. This is a core architectural decision — not a checkbox — and it makes GRCEye suitable for highly regulated industries where data sovereignty is non-negotiable.",
      },
    ],
  },
  {
    category: "Security & Platform",
    items: [
      {
        q: "Is GRCEye GDPR compliant?",
        a: "Yes. GRCEye supports GDPR breach notification workflows, DPA templates, and data subject request tracking. The platform itself is designed with privacy-by-design principles — including local AI processing that ensures no personal data is sent to external AI providers.",
      },
      {
        q: "What security features does GRCEye include?",
        a: "GRCEye includes role-based access control (9 roles), JWT authentication with refresh tokens, API token management, multi-tenant data isolation, activity logging for all user actions, and configurable webhooks for outbound security events.",
      },
    ],
  },
  {
    category: "Reporting & Integrations",
    items: [
      {
        q: "What types of reports does GRCEye generate?",
        a: "GRCEye generates 5 automated PDF report types: Executive Summary, Risk Report, Compliance Report, Vendor Risk Report, and Audit Report. Reports are generated weekly or on-demand.",
      },
      {
        q: "What is the Trust Center?",
        a: "The Trust Center is a public-facing compliance page you can configure and share with customers or auditors. It shows your compliance posture, active certifications, and security overview — without requiring them to log in.",
      },
      {
        q: "Does GRCEye support webhooks?",
        a: "Yes. GRCEye supports 20+ outbound webhook event types (risk created, compliance gap found, contract expiring, etc.). You can configure webhook endpoints, test them with a ping, and view delivery logs.",
      },
      {
        q: "Can I export data from GRCEye?",
        a: "Yes. You can export risks, vendors, assets, audits, policies, and compliance data as CSV files at any time. All exports are tenant-scoped and include all available fields.",
      },
    ],
  },
];

function FAQAccordion({ category, items }: { category: string; items: Array<{ q: string; a: string }> }) {
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="mb-12">
      <h3 className="text-xl font-bold text-gray-900 mb-5 pb-3 border-b border-gray-100">{category}</h3>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden hover:border-blue-200 transition-colors">
            <button
              onClick={() => setExpanded(expanded === idx ? null : idx)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
            >
              <span className="font-semibold text-gray-900 pr-4">{item.q}</span>
              <ChevronDown className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${expanded === idx ? "rotate-180" : ""}`} />
            </button>
            {expanded === idx && (
              <div className="px-6 py-4 bg-blue-50/50 border-t border-gray-200">
                <p className="text-gray-700 leading-relaxed text-sm">{item.a}</p>
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
      <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="GRCEye" className="h-14 w-auto object-contain" />
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-gray-500 font-medium">
            <Link to="/#features" className="hover:text-gray-900 transition-colors">Features</Link>
            <Link to="/#frameworks" className="hover:text-gray-900 transition-colors">Frameworks</Link>
            <Link to="/faq" className="text-blue-600 font-semibold">FAQ</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">
              Sign in
            </Link>
            <Link to="/register" className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm">
              Get started free <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="pt-32 pb-16 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed">
            Everything you need to know about GRCEye — features, modules, AI capabilities, and how it all works.
          </p>
        </div>
      </section>

      {/* ── FAQ Content ── */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">

          {/* Datasheet banner */}
          <div className="mb-12 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg shadow-blue-500/20">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white font-bold text-lg leading-tight">GRCEye Product Datasheet</p>
                <p className="text-blue-100 text-sm mt-0.5">Full feature breakdown, AI capabilities, architecture overview, and module details.</p>
              </div>
            </div>
            <a
              href="/GRCEye_Datasheet_2026.html"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-white text-blue-700 font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-50 transition-colors flex-shrink-0 shadow-sm"
            >
              View Datasheet <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {FAQ_ITEMS.map((section, idx) => (
            <FAQAccordion key={idx} category={section.category} items={section.items} />
          ))}
        </div>
      </section>

      {/* ── Contact CTA ── */}
      <section className="px-6 py-20 bg-gradient-to-br from-blue-50 to-indigo-50 border-t border-blue-100">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Still have questions?</h2>
          <p className="text-gray-600 mb-8 leading-relaxed">Can't find the answer you're looking for? Our support team is here to help you get started.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="mailto:support@grceye.io" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors shadow-sm">
              Email support <ArrowRight className="w-4 h-4" />
            </a>
            <Link to="/register" className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold px-8 py-3.5 rounded-xl transition-colors">
              Try it for free
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-slate-900 text-slate-400 py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <img src="/logo.png" alt="GRCEye" className="h-12 w-auto object-contain bg-white rounded-xl p-1.5" />
          <p className="text-xs text-slate-600">© 2026 GRCEye. All rights reserved. · Powered by <span className="text-slate-500 font-semibold">SilentWolf</span></p>
          <div className="flex gap-5 text-sm">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="mailto:support@grceye.io" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
