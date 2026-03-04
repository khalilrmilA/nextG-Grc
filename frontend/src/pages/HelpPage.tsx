import { useState } from "react";
import { Link } from "react-router-dom";
import {
  HelpCircle, Search, BookOpen, LayoutDashboard, AlertTriangle,
  CheckSquare, ClipboardList, FileText, Building2, BookMarked,
  ChevronDown, ChevronRight, Mail, MessageCircle, Zap,
  Shield, BarChart3, Upload, Bot, FolderUp, MousePointerClick,
  ArrowRight, Info,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Section = "getting-started" | "modules" | "faq" | "contact";

// ── FAQ data ──────────────────────────────────────────────────────────────────

const FAQ_ITEMS = [
  {
    q: "How do I create my first risk?",
    a: "Go to Risk Register → click \"Add Risk\" in the top-right corner. Fill in the title, category, likelihood and impact scores (1–5 scale), then click Save. Your risk score is calculated automatically as Likelihood × Impact.",
  },
  {
    q: "What is the difference between risk likelihood and impact?",
    a: "Likelihood (1–5) represents how probable the risk is to occur. Impact (1–5) represents the severity of consequences if it does occur. Risk Score = Likelihood × Impact, ranging from 1 (minimal) to 25 (critical).",
  },
  {
    q: "How do I run a compliance assessment?",
    a: "Navigate to Compliance → click \"New Assessment\" → select a framework (e.g. ISO 27001) and give it a name. Once created, open the assessment, upload your policy documents (PDF/DOCX/TXT), then click \"Run AI Analysis\". The AI will check each control against your documents and flag gaps.",
  },
  {
    q: "What frameworks are supported?",
    a: "The platform currently includes: ISO 27001:2022, SOC 2, NIST CSF 2.0, GDPR, HIPAA, PCI DSS 4.0, NIST 800-53 Rev5, and CIS Controls v8. You can also build custom frameworks under Frameworks → Create Custom Framework.",
  },
  {
    q: "How does the AI assistant work?",
    a: "Click the ⚡ blue floating button (bottom-right corner) to open the AI Assistant. It uses a large language model (Ollama cloud model) with GRC context. You can ask it to draft policies, explain controls, analyze risks, or answer compliance questions. Responses are streamed in real time.",
  },
  {
    q: "How do I generate a policy from a compliance gap?",
    a: "After running an AI analysis on a compliance assessment, go to the Results tab. Find a control with status \"Gap\" or \"Partial\", click the \"Generate Policy\" button on that row. The AI will stream a complete policy document addressing that specific gap.",
  },
  {
    q: "What does vendor tier mean?",
    a: "Vendor tier reflects criticality to your business: Critical = single point of failure (e.g. cloud provider), High = significant business impact, Medium = moderate dependency, Low = minimal impact. Tier guides how frequently you conduct vendor risk reviews.",
  },
  {
    q: "What is a DPA and why does it matter?",
    a: "DPA stands for Data Processing Agreement. Under GDPR and similar regulations, if a vendor processes personal data on your behalf, a DPA is legally required. Vendors without a signed DPA are flagged with a red warning in the Vendors module.",
  },
  {
    q: "How do I create a custom compliance framework?",
    a: "Go to Frameworks → click \"Create Custom Framework\" → fill in the metadata (name, version, description). After saving, you can add controls with IDs, titles, categories, and requirements (Must/Should/May). Custom frameworks appear alongside built-in ones.",
  },
  {
    q: "How do I track audit findings?",
    a: "In the Audits module, open an audit and navigate to the Findings section. Each finding has a severity (Critical/High/Medium/Low), status (Open/In Progress/Resolved), and can be linked to risks or controls. Audits support Planning → Fieldwork → Review → Closed workflow.",
  },
  {
    q: "How does policy attestation work?",
    a: "In the Policies module, each policy shows an attestation percentage — this is the proportion of assigned employees who have acknowledged reading and accepting the policy. You can track attestation progress and send reminders to non-compliant users.",
  },
  {
    q: "Can I export reports?",
    a: "Yes — the Dashboard has an Export button that generates PDF or CSV reports. Individual modules (Risks, Compliance, Audits) also support filtered exports. Enterprise plan includes scheduled report delivery via email.",
  },
  {
    q: "What do the compliance score colors mean?",
    a: "Green (≥80%): Good compliance posture. Yellow (60–79%): Moderate gaps requiring attention. Orange (40–59%): Significant gaps. Red (<40%): Critical non-compliance. Scores are calculated as (Implemented × 1.0 + Partial × 0.5) / Total controls.",
  },
  {
    q: "How is the risk heat map generated?",
    a: "The heat map is a 5×5 grid of Likelihood (Y axis) vs Impact (X axis). Each cell's color represents severity: green (low score), yellow (medium), orange (high), red (critical ≥20). Dots on the map represent your active risks positioned by their L×I scores.",
  },
];

// ── Module guide data ─────────────────────────────────────────────────────────

const MODULES = [
  {
    id: "dashboard",
    icon: LayoutDashboard,
    color: "bg-blue-50 text-blue-600",
    title: "Dashboard",
    summary: "High-level overview of your GRC posture.",
    steps: [
      "View key metrics: open risks, compliance score, upcoming audits, policy gaps.",
      "Use the risk heat map to spot high-likelihood / high-impact risks at a glance.",
      "Click any metric card to drill into the relevant module.",
      "Export a PDF summary report using the Export button (top-right).",
    ],
  },
  {
    id: "risks",
    icon: AlertTriangle,
    color: "bg-orange-50 text-orange-600",
    title: "Risk Register",
    summary: "Identify, assess, and treat organizational risks.",
    steps: [
      "Click \"Add Risk\" → fill in title, category, description, likelihood (1–5) and impact (1–5).",
      "Risk score is auto-calculated: Score = Likelihood × Impact (max 25).",
      "Filter risks by severity using the tabs (Critical / High / Medium / Low).",
      "Click any row to open the full risk detail popup with treatment plan and linked controls.",
      "Update treatment status as risks are mitigated.",
    ],
  },
  {
    id: "compliance",
    icon: CheckSquare,
    color: "bg-green-50 text-green-600",
    title: "Compliance",
    summary: "Multi-framework compliance assessments with AI gap analysis.",
    steps: [
      "Click \"New Assessment\" → select a framework and give it a name.",
      "Open the assessment → go to the Upload & Analyze tab.",
      "Upload your policy documents (PDF, DOCX, or TXT — max 10 MB each).",
      "Click \"Run AI Analysis\" — the AI checks each framework control against your documents.",
      "Review results in the Results tab: Compliant / Partial / Gap / Not Applicable.",
      "Click \"Generate Policy\" on any gap to stream an AI-drafted policy document.",
      "Check the Cross-Framework tab to see how your documents cover other standards.",
    ],
  },
  {
    id: "frameworks",
    icon: BookOpen,
    color: "bg-indigo-50 text-indigo-600",
    title: "Frameworks",
    summary: "Browse built-in frameworks and build custom ones.",
    steps: [
      "Browse the 8 built-in frameworks (ISO 27001, NIST CSF, SOC 2, GDPR, etc.).",
      "Click a framework card to see its controls, categories, and cross-walk mappings.",
      "Click \"Create Custom Framework\" to build your own (internal standards, sector-specific).",
      "Add controls with IDs, categories, and requirements (Must/Should/May).",
      "Custom frameworks are available immediately for compliance assessments.",
    ],
  },
  {
    id: "audits",
    icon: ClipboardList,
    color: "bg-purple-50 text-purple-600",
    title: "Audits",
    summary: "Plan, conduct, and close internal and external audits.",
    steps: [
      "Click \"New Audit\" → fill in title, framework, type (Internal/External/Regulatory), dates, and lead auditor.",
      "Audits follow a lifecycle: Planning → Fieldwork → Review → Closed.",
      "Click an audit row to see full details: objective, scope, findings breakdown.",
      "Add findings with severity (Critical/High/Medium/Low) and track their resolution.",
      "Use the status filter to focus on In Progress or Overdue audits.",
    ],
  },
  {
    id: "policies",
    icon: FileText,
    color: "bg-teal-50 text-teal-600",
    title: "Policies",
    summary: "Manage policy lifecycle, versioning, and attestation.",
    steps: [
      "Click \"New Policy\" → fill in title, category, owner, and review cycle (6 months / 1 year / 2 years).",
      "Policies track version history — each update creates a new version.",
      "Attestation rate shows what % of assigned employees have acknowledged the policy.",
      "Click a policy row to see full details: linked controls, next review date, attestation bar.",
      "Policies due for review are flagged automatically.",
    ],
  },
  {
    id: "vendors",
    icon: Building2,
    color: "bg-rose-50 text-rose-600",
    title: "Vendors (TPRM)",
    summary: "Third-Party Risk Management — assess and monitor vendor risk.",
    steps: [
      "Click \"Add Vendor\" → fill in name, industry, country, tier (Critical/High/Medium/Low), and risk score.",
      "Check the DPA checkbox if a Data Processing Agreement is signed (required for GDPR).",
      "Vendors without a DPA show a red warning banner in their detail popup.",
      "Risk score (1–40) reflects assessed risk. Scores >20 are flagged as high risk.",
      "Click a vendor row to see full details: services, contract expiry, DPA status, notes.",
      "Use the tier filter to focus on Critical or High vendors for priority review.",
    ],
  },
];

// ── FAQ accordion ─────────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full py-4 text-left gap-4"
      >
        <span className="text-sm font-medium text-gray-800">{q}</span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </button>
      {open && (
        <div className="pb-4 text-sm text-gray-600 leading-relaxed pl-0">
          {a}
        </div>
      )}
    </div>
  );
}

// ── Module guide card ─────────────────────────────────────────────────────────

function ModuleCard({ mod }: { mod: typeof MODULES[0] }) {
  const [open, setOpen] = useState(false);
  const Icon = mod.icon;
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-4 w-full p-5 text-left hover:bg-gray-50 transition-colors"
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${mod.color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{mod.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{mod.summary}</p>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-0 border-t border-gray-100">
          <ol className="mt-4 space-y-2">
            {mod.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-700">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState<Section>("getting-started");
  const [searchQuery, setSearchQuery]     = useState("");

  const filteredFaq = FAQ_ITEMS.filter(
    item =>
      item.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.a.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const SECTIONS: { id: Section; icon: React.ElementType; label: string }[] = [
    { id: "getting-started", icon: Zap,         label: "Getting Started"  },
    { id: "modules",         icon: BookMarked,  label: "Module Guides"    },
    { id: "faq",             icon: HelpCircle,  label: "FAQ"              },
    { id: "contact",         icon: Mail,        label: "Contact Support"  },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <HelpCircle className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Help & Support</h1>
          <p className="text-sm text-gray-500">Everything you need to get the most out of your GRC platform</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-8">
        <Search className="absolute left-4 top-3 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); if (e.target.value) setActiveSection("faq"); }}
          placeholder="Search help articles and FAQs..."
          className="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <aside className="w-48 flex-shrink-0">
          <nav className="space-y-0.5">
            {SECTIONS.map(({ id, icon: Icon, label }) => (
              <button key={id} type="button" onClick={() => { setActiveSection(id); setSearchQuery(""); }}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeSection === id
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100"
                }`}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">

          {/* ── Getting Started ── */}
          {activeSection === "getting-started" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Getting Started</h2>
                <p className="text-sm text-gray-500 mt-0.5">Follow these steps to have a working compliance assessment in minutes.</p>
              </div>

              {/* ── HOW TO IMPORT DOCUMENTS ── highlighted box */}
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FolderUp className="w-5 h-5 text-blue-600" />
                  <p className="font-bold text-blue-900 text-sm">How to import your documents</p>
                  <Info className="w-4 h-4 text-blue-400" />
                </div>
                <ol className="space-y-2.5">
                  {[
                    { nav: "Sidebar → Compliance", action: "Click \"Compliance\" in the left sidebar." },
                    { nav: "New Assessment", action: "Click the \"New Assessment\" button (top-right). Choose your framework (e.g. ISO 27001) and give it a name." },
                    { nav: "Open the assessment", action: "Click the assessment card that appears in the list." },
                    { nav: "Upload & Analyze tab", action: "Click the \"Upload & Analyze\" tab inside the assessment." },
                    { nav: "Drop your files", action: "Drag-and-drop or click to upload your PDFs, Word docs, or text files (up to 10 MB each). You can upload multiple files." },
                    { nav: "Run AI Analysis", action: "Click the blue \"Run AI Analysis\" button. The AI reads all uploaded files and scores every control automatically." },
                    { nav: "See results", action: "Switch to the \"Results\" tab to see which controls are Compliant / Partial / Gap. Open \"Gap Report\" to see what needs fixing." },
                  ].map((s, i) => (
                    <li key={i} className="flex gap-3 items-start">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                      <div>
                        <span className="inline-flex items-center gap-1 bg-white border border-blue-200 rounded px-1.5 py-0.5 text-xs font-mono text-blue-700 mr-1.5">
                          <MousePointerClick className="w-3 h-3" /> {s.nav}
                        </span>
                        <span className="text-sm text-blue-900">{s.action}</span>
                      </div>
                    </li>
                  ))}
                </ol>
                <Link
                  to="/compliance"
                  className="mt-4 inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  Go to Compliance <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Full setup steps */}
              <div className="space-y-3">
                {[
                  { icon: Shield,        color: "bg-blue-100 text-blue-600",    step: 1, title: "Create a Compliance Assessment",  where: "Sidebar → Compliance → New Assessment", desc: "Select a framework (ISO 27001, SOC 2, NIST CSF, etc.) and name your assessment. This is your working space for all documents and controls." },
                  { icon: FolderUp,      color: "bg-purple-100 text-purple-600", step: 2, title: "Upload your documents",           where: "Assessment → Upload & Analyze tab", desc: "Upload any PDFs, Word documents, or TXT files (policies, procedures, evidence). Multiple files allowed." },
                  { icon: Bot,           color: "bg-orange-100 text-orange-600", step: 3, title: "Run AI Analysis",                 where: "Upload & Analyze tab → Run AI Analysis button", desc: "The AI reads your files and automatically maps them to framework controls, flagging gaps." },
                  { icon: BarChart3,     color: "bg-green-100 text-green-600",   step: 4, title: "Review Gap Report",               where: "Assessment → Gap Report tab", desc: "See every failing control with severity (Critical/High/Medium). Accept gaps to create action items." },
                  { icon: BookMarked,    color: "bg-teal-100 text-teal-600",     step: 5, title: "Check Document Checklist",        where: "Assessment → Document Checklist tab", desc: "See all mandatory documents for your framework (ISO 27001 needs ~40). Upload missing ones inline per row." },
                  { icon: AlertTriangle, color: "bg-red-100 text-red-600",       step: 6, title: "Add Risks",                       where: "Sidebar → Risk Register → Add Risk", desc: "Log your identified risks with likelihood (1–5) and impact (1–5). The heat map populates automatically." },
                  { icon: FileText,      color: "bg-indigo-100 text-indigo-600", step: 7, title: "Add Policies",                    where: "Sidebar → Policies → New Policy", desc: "Document your security policies. Track versions, review dates, and employee attestation." },
                  { icon: Building2,     color: "bg-rose-100 text-rose-600",     step: 8, title: "Add Vendors",                     where: "Sidebar → Vendors → Add Vendor", desc: "Track third-party risk. Flag vendors without signed DPAs (required for GDPR/ISO 27001)." },
                ].map(({ icon: Icon, color, step, title, where, desc }) => (
                  <div key={step} className="flex gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-colors">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-gray-400">Step {step}</span>
                        <span className="inline-flex items-center gap-1 bg-gray-100 rounded px-1.5 py-0.5 text-xs font-mono text-gray-600">
                          <MousePointerClick className="w-3 h-3" /> {where}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">{title}</p>
                      <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Module Guides ── */}
          {activeSection === "modules" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Module Guides</h2>
                <p className="text-sm text-gray-500 mt-0.5">Step-by-step instructions for each platform module. Click to expand.</p>
              </div>
              {MODULES.map(mod => <ModuleCard key={mod.id} mod={mod} />)}
            </div>
          )}

          {/* ── FAQ ── */}
          {activeSection === "faq" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Frequently Asked Questions
                  {searchQuery && <span className="ml-2 text-sm font-normal text-gray-400">— {filteredFaq.length} result{filteredFaq.length !== 1 ? "s" : ""} for "{searchQuery}"</span>}
                </h2>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl px-5">
                {filteredFaq.length > 0
                  ? filteredFaq.map((item, i) => <FaqItem key={i} q={item.q} a={item.a} />)
                  : <p className="py-8 text-center text-sm text-gray-400">No results found for "{searchQuery}"</p>
                }
              </div>
            </div>
          )}

          {/* ── Contact ── */}
          {activeSection === "contact" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Contact Support</h2>
                <p className="text-sm text-gray-500 mt-0.5">We typically respond within 4 business hours.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 bg-white border border-gray-200 rounded-xl hover:border-blue-300 transition-colors cursor-pointer">
                  <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center mb-3">
                    <Mail className="w-4 h-4 text-blue-600" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900">Email Support</p>
                  <p className="text-xs text-gray-500 mt-1">For billing, account, and technical issues.</p>
                  <p className="text-xs text-blue-600 mt-2 font-medium">support@grcplatform.io</p>
                </div>
                <div className="p-5 bg-white border border-gray-200 rounded-xl hover:border-blue-300 transition-colors cursor-pointer">
                  <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center mb-3">
                    <MessageCircle className="w-4 h-4 text-green-600" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900">Live Chat</p>
                  <p className="text-xs text-gray-500 mt-1">Available Mon–Fri, 9am–6pm CET.</p>
                  <p className="text-xs text-green-600 mt-2 font-medium">Start a chat →</p>
                </div>
              </div>

              {/* Submit a ticket */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                <p className="text-sm font-semibold text-gray-800">Submit a Support Ticket</p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                  <input type="text" placeholder="Briefly describe your issue"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option>Technical Issue</option>
                    <option>Billing & Subscription</option>
                    <option>Feature Request</option>
                    <option>Framework / Compliance Question</option>
                    <option>Account & Access</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <textarea rows={4} placeholder="Provide as much detail as possible — steps to reproduce, error messages, screenshots..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>
                <button type="button"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
                  <Mail className="w-4 h-4" />
                  Submit ticket
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
