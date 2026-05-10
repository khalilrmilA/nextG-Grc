"use client";
import Link from "next/link";
import PublicNav from "@/components/landing/PublicNav";
import PublicFooter from "@/components/landing/PublicFooter";
import {
  ArrowRight, CheckCircle2, Shield, Copy, Wrench, Zap,
  FileText, Globe, Lock, Star, ChevronRight, Bot,
  Layers, PenLine, GitFork, Plus, Search,
} from "lucide-react";

/* ─── Framework categories with real examples ─── */
const FRAMEWORK_GROUPS = [
  {
    label: "ISO / IEC Certified",
    color: "bg-blue-50 border-blue-200 text-blue-800",
    dotColor: "bg-blue-500",
    frameworks: [
      "ISO/IEC 27001:2022", "ISO/IEC 27002:2022", "ISO/IEC 27017",
      "ISO/IEC 27018", "ISO/IEC 27701", "ISO 22301", "ISO 9001:2015",
    ],
  },
  {
    label: "Regulatory & Legal",
    color: "bg-violet-50 border-violet-200 text-violet-800",
    dotColor: "bg-violet-500",
    frameworks: [
      "GDPR (EU)", "NIS2 Directive", "DORA", "EU AI Act",
      "CCPA (California)", "LGPD (Brazil)", "PIPEDA (Canada)", "PDPA (Thailand)",
    ],
  },
  {
    label: "US Government & NIST",
    color: "bg-emerald-50 border-emerald-200 text-emerald-800",
    dotColor: "bg-emerald-500",
    frameworks: [
      "NIST CSF 2.0", "NIST SP 800-53 Rev5", "NIST SP 800-171",
      "FedRAMP", "FISMA", "CMMC 2.0", "StateRAMP",
    ],
  },
  {
    label: "Industry Standards",
    color: "bg-amber-50 border-amber-200 text-amber-800",
    dotColor: "bg-amber-500",
    frameworks: [
      "SOC 2 Type II", "PCI DSS 4.0", "HIPAA", "HITRUST CSF",
      "CIS Controls v8", "SWIFT CSCF", "COBIT 2019", "ITIL 4",
    ],
  },
  {
    label: "Threat & Security",
    color: "bg-rose-50 border-rose-200 text-rose-800",
    dotColor: "bg-rose-500",
    frameworks: [
      "MITRE ATT&CK", "MITRE D3FEND", "OWASP Top 10",
      "CSA CCM v4", "Zero Trust Architecture (NIST SP 800-207)",
    ],
  },
  {
    label: "Sector-Specific",
    color: "bg-cyan-50 border-cyan-200 text-cyan-800",
    dotColor: "bg-cyan-500",
    frameworks: [
      "NERC CIP (Energy)", "IEC 62443 (OT/ICS)", "TISAX (Automotive)",
      "NHS DSPT (UK Health)", "ENISA Good Practice", "SOX (Sarbanes-Oxley)",
    ],
  },
];

/* ─── Featured/popular frameworks shown as big cards ─── */
const FEATURED = [
  { name: "ISO 27001:2022", controls: 93, desc: "The global ISMS standard. 93 Annex A controls, full SoA generation, cross-mapped to NIST and SOC 2.", badge: "Most popular", badgeColor: "bg-blue-600 text-white" },
  { name: "SOC 2 Type II", controls: 64, desc: "5 Trust Service Criteria. Audit-ready evidence collection, readiness checklist, and auditor portal.", badge: "Enterprise sales", badgeColor: "bg-indigo-100 text-indigo-800" },
  { name: "GDPR", controls: 99, desc: "All 99 articles mapped. ROPA tracking, DPA templates, breach notification workflow, DSR management.", badge: "EU mandatory", badgeColor: "bg-violet-100 text-violet-800" },
  { name: "DORA", controls: 78, desc: "All 5 pillars: ICT risk, incident reporting, resilience testing, TPRM, and information sharing.", badge: "Jan 2025+", badgeColor: "bg-amber-100 text-amber-800" },
  { name: "NIS2 Directive", controls: 52, desc: "Risk management, incident reporting, supply chain security, and board accountability measures.", badge: "EU mandatory", badgeColor: "bg-violet-100 text-violet-800" },
  { name: "NIST CSF 2.0", controls: 106, desc: "Updated 2024 version. 6 functions: Govern, Identify, Protect, Detect, Respond, Recover.", badge: "US Gov & enterprise", badgeColor: "bg-emerald-100 text-emerald-800" },
];

/* ─── Cross-walk / evidence reuse table ─── */
const CROSSWALK_ROWS = [
  { control: "Access Control Policy", fw1: "A.8.3", fw2: "CC6.1", fw3: "Art. 32", fw4: "PR.AC-1" },
  { control: "Encryption at Rest", fw1: "A.8.24", fw2: "CC6.7", fw3: "Art. 32(1)(a)", fw4: "PR.DS-1" },
  { control: "Incident Response Plan", fw1: "A.5.26", fw2: "CC7.3", fw3: "Art. 33", fw4: "RS.RP-1" },
  { control: "Vulnerability Management", fw1: "A.8.8", fw2: "CC7.1", fw3: "Rec. 2017/1584", fw4: "DE.CM-8" },
];

export default function FrameworksView() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      {/* ── Hero ── */}
      <section className="pt-20 pb-20 px-6 text-center bg-gradient-to-b from-slate-50 via-blue-50/30 to-white">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
            <Layers className="w-4 h-4" />
            70+ frameworks · Fork any · Build your own
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            Every compliance framework —{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              ready on day one
            </span>
          </h1>
          <p className="text-xl text-gray-500 leading-relaxed max-w-2xl mx-auto mb-10">
            GRCEye ships with 70+ pre-loaded frameworks, complete with controls, crosswalk mappings, and evidence requirements.
            Fork any framework to create your own editable copy, or build a completely custom one from scratch with the AI-powered builder.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-md hover:shadow-lg hover:shadow-blue-500/25"
            >
              Start free — explore all frameworks
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Request a framework
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats strip ── */}
      <section className="py-10 px-6 border-y border-gray-100 bg-white">
        <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {[
            { value: "70+", label: "Built-in frameworks" },
            { value: "4,000+", label: "Pre-mapped controls" },
            { value: "Day 1", label: "Ready to assess" },
            { value: "∞", label: "Custom frameworks you can create" },
          ].map(({ value, label }) => (
            <div key={label}>
              <p className="text-3xl font-extrabold text-gray-900 mb-1">{value}</p>
              <p className="text-sm text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Featured frameworks ── */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              The frameworks your auditors will ask for
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              The most common certifications and regulatory requirements — fully loaded, crosswalk-mapped, and audit-ready.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURED.map(({ name, controls, desc, badge, badgeColor }) => (
              <div key={name} className="border border-gray-200 rounded-2xl p-6 hover:shadow-md transition-shadow group">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                    <Shield className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgeColor}`}>{badge}</span>
                </div>
                <h3 className="font-bold text-gray-900 text-lg mb-1">{name}</h3>
                <p className="text-xs text-gray-400 mb-3">{controls} controls pre-loaded</p>
                <p className="text-sm text-gray-500 leading-relaxed mb-4">{desc}</p>
                <div className="flex items-center gap-2 text-xs text-blue-600 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Ready to assess instantly
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-gray-400 mt-8">
            + 64 more frameworks including HIPAA, CIS Controls v8, MITRE ATT&CK, NIST 800-53, PCI DSS, TISAX, NERC CIP, SOX, and more
          </p>
        </div>
      </section>

      {/* ── Full framework library by category ── */}
      <section className="py-20 px-6 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              The complete framework library
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              Organised by category. Every framework ships with full control sets, cross-walk mappings, and evidence templates.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FRAMEWORK_GROUPS.map(({ label, color, dotColor, frameworks }) => (
              <div key={label} className={`border rounded-2xl p-5 ${color}`}>
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                  <h3 className="font-bold text-sm">{label}</h3>
                </div>
                <ul className="space-y-1.5">
                  {frameworks.map((fw) => (
                    <li key={fw} className="flex items-center gap-2 text-sm opacity-80">
                      <ChevronRight className="w-3 h-3 flex-shrink-0" />
                      {fw}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Fork feature ── */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-sm">
                  <GitFork className="w-5 h-5 text-white" />
                </div>
                <span className="text-sm font-semibold text-violet-700 uppercase tracking-wide">Fork & Customize</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
                Take any framework and make it yours
              </h2>
              <p className="text-gray-500 leading-relaxed mb-8">
                Every built-in framework is protected and shared across all organisations — so it stays accurate
                and up to date. But one click creates your own private, fully editable copy: a fork.
              </p>
              <div className="space-y-5">
                {[
                  {
                    icon: GitFork,
                    title: "Fork with one click",
                    body: "Click Customize on any built-in framework card. GRCEye creates an exact copy — all controls, categories, cross-walk mappings, and parent/child relationships — owned entirely by your organisation.",
                  },
                  {
                    icon: PenLine,
                    title: "Edit controls inline",
                    body: "Rename controls to match your internal terminology. Edit descriptions, assessment criteria, and evidence requirements. Delete controls that do not apply. Add new custom controls that are unique to your environment.",
                  },
                  {
                    icon: Plus,
                    title: "Add proprietary requirements",
                    body: "Your forked framework is fully independent. Add your company-specific security requirements, internal policies, or sector-specific obligations that no off-the-shelf framework covers.",
                  },
                  {
                    icon: Lock,
                    title: "Your fork, your data",
                    body: "The original built-in framework remains unchanged for all other organisations. Your fork is only visible to your team — no changes flow back to the shared library.",
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex gap-4">
                    <div className="w-8 h-8 bg-violet-50 border border-violet-200 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-violet-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 text-sm mb-1">{title}</h3>
                      <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Fork UI mockup */}
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-white/10">
                <Layers className="w-4 h-4 text-violet-400" />
                <p className="text-sm font-semibold text-white">Framework Library</p>
                <div className="ml-auto flex items-center gap-1.5 bg-white/10 rounded-lg px-2 py-1">
                  <Search className="w-3 h-3 text-white/40" />
                  <span className="text-xs text-white/40">Search 70+ frameworks…</span>
                </div>
              </div>
              {/* Framework card with fork button */}
              <div className="bg-white/10 border border-violet-500/30 rounded-xl p-4 mb-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-bold text-white">ISO/IEC 27001:2022</p>
                    <p className="text-xs text-white/50">93 controls · Cross-mapped to SOC 2 & NIST CSF</p>
                  </div>
                  <span className="text-xs bg-blue-500/20 text-blue-300 font-semibold px-2 py-0.5 rounded-full">Built-in</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                    <GitFork className="w-3 h-3" />
                    Customize (Fork)
                  </button>
                  <button className="flex items-center gap-1.5 bg-white/10 text-white/70 text-xs font-semibold px-3 py-1.5 rounded-lg">
                    <FileText className="w-3 h-3" />
                    View Controls
                  </button>
                </div>
              </div>
              {/* Forked copy */}
              <div className="bg-violet-500/15 border border-violet-400/40 rounded-xl p-4 mb-2">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-bold text-white">ISO 27001 — Acme Corp (Custom)</p>
                    <p className="text-xs text-white/50">93 controls + 7 custom · Forked from ISO 27001:2022</p>
                  </div>
                  <span className="text-xs bg-violet-400/30 text-violet-300 font-semibold px-2 py-0.5 rounded-full">Your fork</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="flex items-center gap-1.5 bg-violet-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
                    <PenLine className="w-3 h-3" />
                    Edit Controls
                  </button>
                  <button className="flex items-center gap-1.5 bg-white/10 text-white/70 text-xs font-semibold px-3 py-1.5 rounded-lg">
                    <Plus className="w-3 h-3" />
                    Add Control
                  </button>
                </div>
              </div>
              <p className="text-xs text-white/30 text-center mt-3">The original ISO 27001 remains unchanged for all other orgs</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Custom framework builder ── */}
      <section className="py-24 px-6 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">

            {/* Builder UI mockup */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden order-2 lg:order-1">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-emerald-50/50">
                <div className="flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-emerald-600" />
                  <p className="text-sm font-bold text-gray-900">Custom Framework Builder</p>
                </div>
                <span className="text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">AI-assisted</span>
              </div>
              <div className="p-5 space-y-4">
                {/* Framework metadata */}
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Framework Name</label>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900">Acme Internal Security Standard v2.0</div>
                </div>
                {/* Controls list */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Controls</label>
                    <span className="text-xs text-gray-400">12 controls added</span>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { id: "AC-01", title: "Identity & Access Management", category: "Access Control", status: "complete" },
                      { id: "AC-02", title: "Privileged Access Review", category: "Access Control", status: "complete" },
                      { id: "IR-01", title: "Incident Classification Policy", category: "Incident Response", status: "complete" },
                      { id: "NEW", title: "AI Model Risk Assessment", category: "AI Governance", status: "editing" },
                    ].map(({ id, title, category, status }) => (
                      <div key={id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${status === "editing" ? "border-emerald-300 bg-emerald-50" : "border-gray-100 bg-gray-50"}`}>
                        <span className={`font-mono font-bold ${status === "editing" ? "text-emerald-700" : "text-gray-400"}`}>{id}</span>
                        <div className="flex-1">
                          <p className="font-semibold text-gray-900">{title}</p>
                          <p className="text-gray-400">{category}</p>
                        </div>
                        {status === "editing" && (
                          <span className="bg-emerald-100 text-emerald-700 font-semibold px-1.5 py-0.5 rounded">Editing</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {/* AI assist */}
                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Bot className="w-4 h-4 text-emerald-600" />
                    <p className="text-xs font-semibold text-emerald-800">AI suggestion</p>
                  </div>
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    Based on &quot;AI Governance&quot; category, consider adding: AI Training Data Management, Model Version Control, and Algorithmic Bias Assessment controls — aligned with EU AI Act Article 9–12.
                  </p>
                  <button className="mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-900">Add suggested controls →</button>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-sm">
                  <Wrench className="w-5 h-5 text-white" />
                </div>
                <span className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">Custom Builder</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
                Build any framework from scratch
              </h2>
              <p className="text-gray-500 leading-relaxed mb-8">
                No suitable framework exists? Build one. The custom framework builder lets you define any control set —
                for internal security standards, supplier requirements, or proprietary risk methodologies — and use it
                exactly like a built-in framework throughout GRCEye.
              </p>
              <div className="space-y-4">
                {[
                  {
                    icon: Plus,
                    title: "Define your control structure",
                    body: "Create categories, add controls with IDs, titles, descriptions, and evidence requirements. Organise them in any hierarchy you need.",
                  },
                  {
                    icon: Bot,
                    title: "AI helps you build it",
                    body: "Describe what the control should cover and the AI drafts the control language — tailored to your industry, jurisdiction, and regulatory context. You review, approve, and publish.",
                  },
                  {
                    icon: Layers,
                    title: "Map to built-in frameworks",
                    body: "Link your custom controls to ISO 27001, NIST, or any other framework you are running. Evidence uploaded to your custom control automatically satisfies the mapped built-in controls.",
                  },
                  {
                    icon: Globe,
                    title: "Run assessments and audits",
                    body: "Your custom framework works identically to any built-in one — gap analysis, compliance scoring, auditor portal, evidence collection, and board-ready reporting all work out of the box.",
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex gap-4">
                    <div className="w-8 h-8 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 text-sm mb-1">{title}</h3>
                      <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Cross-framework evidence reuse ── */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-100 text-amber-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">
              <Zap className="w-4 h-4" />
              Evidence uploaded once — applied everywhere
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              Multi-framework crosswalk — no duplicate work
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              GRCEye pre-maps controls across frameworks. Upload your Access Control Policy once
              and it satisfies ISO 27001 A.8.3, SOC 2 CC6.1, GDPR Art. 32, and NIST CSF PR.AC-1 simultaneously.
            </p>
          </div>

          {/* Crosswalk table */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm mb-10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-4 text-gray-500 font-semibold">Evidence / Control</th>
                  <th className="text-left px-5 py-4 text-blue-700 font-semibold">ISO 27001</th>
                  <th className="text-left px-5 py-4 text-indigo-700 font-semibold">SOC 2</th>
                  <th className="text-left px-5 py-4 text-violet-700 font-semibold">GDPR</th>
                  <th className="text-left px-5 py-4 text-emerald-700 font-semibold">NIST CSF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {CROSSWALK_ROWS.map(({ control, fw1, fw2, fw3, fw4 }) => (
                  <tr key={control} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-gray-800 text-sm">{control}</td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5 text-xs font-mono font-semibold text-blue-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />{fw1}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5 text-xs font-mono font-semibold text-indigo-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />{fw2}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5 text-xs font-mono font-semibold text-violet-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />{fw3}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5 text-xs font-mono font-semibold text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />{fw4}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            {[
              {
                icon: Copy,
                color: "bg-amber-50 text-amber-700",
                title: "Upload evidence once",
                body: "One document upload satisfies multiple framework controls automatically. No re-uploading, no copy-paste, no duplicate work for your team.",
              },
              {
                icon: Layers,
                color: "bg-blue-50 text-blue-700",
                title: "See coverage across all frameworks",
                body: "The cross-framework view shows which controls are already covered, which are partially covered by another framework, and which still have gaps.",
              },
              {
                icon: Zap,
                color: "bg-emerald-50 text-emerald-700",
                title: "Add a second framework in days",
                body: "Already certified for ISO 27001? Adding SOC 2 takes days, not months — 60–70% of controls are already satisfied by your existing evidence.",
              },
            ].map(({ icon: Icon, color, title, body }) => (
              <div key={title} className="border border-gray-200 rounded-2xl p-5">
                <div className={`w-9 h-9 ${color} rounded-xl flex items-center justify-center mb-3`}>
                  <Icon className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-gray-900 text-sm mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Three paths summary ── */}
      <section className="py-20 px-6 bg-gradient-to-br from-slate-900 to-indigo-950 text-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">Three ways to use frameworks in GRCEye</h2>
            <p className="text-blue-200">Every path gives you the same audit-ready, crosswalk-mapped, evidence-linked programme.</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                icon: Shield,
                number: "01",
                title: "Use built-in",
                body: "Select from 70+ pre-loaded frameworks. Full control set, evidence templates, and crosswalk mappings ready instantly. No setup needed.",
                action: "Start assessing on day one",
              },
              {
                icon: GitFork,
                number: "02",
                title: "Fork & customise",
                body: "One click creates your own private, fully editable copy of any built-in framework. Rename, edit, delete, or add controls without affecting the original.",
                action: "Make it fit your exact needs",
              },
              {
                icon: Wrench,
                number: "03",
                title: "Build from scratch",
                body: "Use the custom framework builder to create any control set — internal security standards, supplier requirements, or proprietary risk methodologies — with AI assistance.",
                action: "Define your own standard",
              },
            ].map(({ icon: Icon, number, title, body, action }) => (
              <div key={number} className="bg-white/10 border border-white/20 rounded-2xl p-6">
                <p className="text-5xl font-black text-white/10 mb-3">{number}</p>
                <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-blue-300" />
                </div>
                <h3 className="font-bold text-white text-lg mb-2">{title}</h3>
                <p className="text-sm text-blue-200 leading-relaxed mb-4">{body}</p>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  {action}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social proof ── */}
      <section className="py-16 px-6 bg-white">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 gap-6">
          {[
            {
              quote: "We forked ISO 27001 and added our 14 internal controls in an afternoon. The whole framework was live and crosswalk-mapped to our existing evidence by end of day.",
              name: "Alex F.",
              role: "Head of Security, Enterprise SaaS — Berlin",
            },
            {
              quote: "We built a custom DORA compliance framework specific to our ICT risk appetite. GRCEye treated it identically to any built-in framework — full audit trail, evidence collection, the works.",
              name: "Marie D.",
              role: "Chief Risk Officer, FinTech — Luxembourg",
            },
          ].map(({ quote, name, role }) => (
            <div key={name} className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white">
              <Star className="w-5 h-5 text-yellow-300 mb-3 fill-yellow-300" />
              <p className="text-sm leading-relaxed italic mb-4 text-blue-100">&quot;{quote}&quot;</p>
              <div>
                <p className="font-semibold text-sm">{name}</p>
                <p className="text-blue-300 text-xs">{role}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4">
            Start with 70+ frameworks — customise as you grow
          </h2>
          <p className="text-lg text-blue-100 mb-8">
            Full framework library access from day one. Fork, customise, or build your own.
            Free 14-day trial — no credit card, no consultants, no setup fees.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="group inline-flex items-center justify-center gap-2 bg-white text-blue-700 font-bold px-6 py-3.5 rounded-xl hover:bg-blue-50 transition-colors shadow-lg"
            >
              Start free trial
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold px-6 py-3.5 rounded-xl transition-colors"
            >
              <FileText className="w-4 h-4" />
              Request a framework
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
