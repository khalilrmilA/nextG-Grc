"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SupportChat from "@/components/landing/SupportChat";
import PublicNav from "@/components/landing/PublicNav";
import {
  ArrowRight, CheckCircle, Shield, AlertTriangle, ClipboardList,
  FileText, Building2, Users, Globe, Heart, Cpu, Lock,
  BarChart2, ChevronRight, Star, Award, ShieldCheck, Landmark,
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

const INDUSTRIES = [
  { icon: Building2, color: "from-blue-500 to-blue-700", bg: "bg-blue-50", border: "border-blue-100", badge: "text-blue-700 bg-blue-50",
    title: "SaaS & Technology", headline: "Achieve SOC 2 and ISO 27001 — fast.",
    desc: "SaaS companies face constant pressure from enterprise customers to demonstrate compliance. GRCEye gives your security team a structured path from gap assessment to certification, without hiring a full GRC team.",
    points: ["Pre-built SOC 2 Trust Service Criteria controls","ISO 27001:2022 gap analysis in hours, not weeks","Customer-facing Trust Center for sales calls","Evidence collection via secure stakeholder upload links","AI-generated Information Security Policy in minutes"],
    frameworks: ["SOC 2 Type II", "ISO 27001:2022", "CIS Controls v8"],
  },
  { icon: Heart, color: "from-rose-500 to-pink-600", bg: "bg-rose-50", border: "border-rose-100", badge: "text-rose-700 bg-rose-50",
    title: "Healthcare & Life Sciences", headline: "HIPAA compliance with a complete audit trail.",
    desc: "Healthcare organizations need airtight documentation, strict access controls, and breach notification workflows. GRCEye covers the full HIPAA security rule, privacy rule, and breach notification requirements — with evidence tied to every control.",
    points: ["HIPAA Security Rule and Privacy Rule controls","Breach notification workflow with timeline tracking","DPA templates and data subject request management","Role-based access — staff see only what they need","Automated weekly compliance reports for leadership"],
    frameworks: ["HIPAA", "GDPR", "ISO 27001:2022", "NIST 800-53"],
  },
  { icon: BarChart2, color: "from-emerald-500 to-teal-600", bg: "bg-emerald-50", border: "border-emerald-100", badge: "text-emerald-700 bg-emerald-50",
    title: "Financial Services & FinTech", headline: "DORA, PCI DSS, and NIS2 — in one platform.",
    desc: "Financial services firms face overlapping regulatory requirements across DORA, PCI DSS, NIS2, and national supervisory guidelines. GRCEye maps controls across all applicable frameworks simultaneously so you close gaps once and satisfy multiple regulators.",
    points: ["DORA digital operational resilience controls","PCI DSS 4.0 cardholder data environment controls","NIS2 Directive implementation requirements","Vendor risk cartography for supply chain exposure","Monte Carlo risk quantification for board reporting"],
    frameworks: ["DORA", "PCI DSS 4.0", "NIS2 Directive", "ISO 27001:2022"],
  },
  { icon: Globe, color: "from-violet-500 to-purple-700", bg: "bg-violet-50", border: "border-violet-100", badge: "text-violet-700 bg-violet-50",
    title: "Enterprise & Regulated Industries", headline: "Multi-framework GRC for complex organizations.",
    desc: "Large enterprises operating across jurisdictions need a GRC platform that scales with organizational complexity — multiple business units, overlapping frameworks, and dozens of active audits. GRCEye's multi-tenant architecture and 9-role RBAC handles all of it.",
    points: ["Multi-tenant isolation for business units or subsidiaries","9 built-in roles with granular module-level access","70+ built-in frameworks with cross-walk mappings","Webhook integrations with existing SIEM and ticketing tools","Full activity log and audit trail for every user action"],
    frameworks: ["ISO 27001:2022", "NIST CSF 2.0", "SOC 2", "GDPR", "NIST 800-53"],
  },
];

const ROLES = [
  { icon: Shield, color: "from-blue-600 to-indigo-700",
    title: "For the CISO", subtitle: "Board-level visibility without the manual work",
    desc: "GRCEye gives CISOs a real-time picture of the organization's entire risk and compliance posture. Executive dashboards, automated weekly PDF reports, and a public Trust Center — everything needed to communicate security credibly to the board and customers.",
    points: ["Live compliance score across all active frameworks","Risk heat map with financial impact quantification (ALE/SLE)","Automated Executive Summary PDF every week","Public Trust Center for customer and auditor transparency","Webhook alerts to Slack, Teams, or any SIEM when risk thresholds are breached"],
  },
  { icon: AlertTriangle, color: "from-red-500 to-rose-600",
    title: "For the Risk Manager", subtitle: "From qualitative ratings to financial figures",
    desc: "Move beyond spreadsheet risk registers. GRCEye's risk module combines structured registers, heat maps, scenario modelling, and Monte Carlo simulation — so risk managers can communicate in the language of the business.",
    points: ["5×5 heatmap with owner assignment and review scheduling","Monte Carlo simulation: ALE, SLE, P90, P95 outputs","Custom probability/impact scales (3×3, 5×5, or custom)","Risk scenarios: link threats, vulnerabilities, assets, and controls","Formal risk acceptance with approval workflow and expiration tracking"],
  },
  { icon: CheckCircle, color: "from-green-500 to-emerald-600",
    title: "For the Compliance Manager", subtitle: "Run assessments across all frameworks at once",
    desc: "Stop running separate assessments for ISO 27001, SOC 2, and GDPR. GRCEye maps controls across frameworks so evidence uploaded once satisfies multiple requirements. The AI identifies gaps and writes remediation steps so you can close them faster.",
    points: ["Simultaneous multi-framework assessments","AI gap analysis with per-control remediation guidance","Evidence upload links shareable with external stakeholders","Cross-framework coverage view — see what work overlaps","Custom framework builder: fork, edit, or build from scratch"],
  },
  { icon: ClipboardList, color: "from-purple-500 to-indigo-600",
    title: "For the Auditor", subtitle: "A dedicated portal — no platform access required",
    desc: "External auditors get their own scoped portal showing only the assessments assigned to them. They can review evidence, upload findings, complete control checklists, and generate audit reports — without accessing any other part of the platform.",
    points: ["Scoped auditor portal — only assigned assessments visible","Control checklist: Compliant / Non-Compliant / N/A","Finding creation with severity, owner, and remediation tracking","Evidence review with file attachments per control","One-click PDF audit report generation"],
  },
  { icon: FileText, color: "from-orange-500 to-amber-600",
    title: "For the Policy Manager", subtitle: "AI-drafted policies, versioned and formally attested",
    desc: "GRCEye's AI document generator writes complete, audit-ready GRC policies in seconds — tailored to your industry, size, country, and active frameworks. Once published, send attestation requests to every employee and track who has acknowledged each policy.",
    points: ["29 document types across Foundation, Policy, Procedure, and Plan categories","Full version history with author and approval tracking","Employee attestation requests with automated email reminders","Approval workflow before any policy goes live","Link published policies to framework controls as compliance evidence"],
  },
];

const USE_CASES = [
  { icon: Award,         iconColor: "from-blue-500 to-indigo-600",  title: "ISO 27001:2022 Certification",       desc: "GRCEye pre-loads all 93 Annex A controls and the full ISMS scope requirements. Run a gap assessment, generate your Statement of Applicability, collect evidence per control, and manage your internal audit — all in one place.", time: "Typical prep time: 4–6 months", color: "border-blue-200 bg-blue-50/50" },
  { icon: CheckCircle,   iconColor: "from-green-500 to-emerald-600", title: "SOC 2 Type II Readiness",            desc: "Map your controls to the Trust Service Criteria (Security, Availability, Confidentiality, Privacy, Processing Integrity). Generate evidence, run an internal readiness audit, and share a Trust Center with auditors before the formal engagement.", time: "Typical prep time: 3–5 months", color: "border-green-200 bg-green-50/50" },
  { icon: Lock,          iconColor: "from-purple-500 to-pink-600",   title: "GDPR Compliance Program",            desc: "Track your data processing activities, manage DPA templates, run a GDPR gap assessment against all 99 articles, implement breach notification workflows, and respond to data subject requests — all within GRCEye.", time: "Initial assessment: 2–4 weeks", color: "border-purple-200 bg-purple-50/50" },
  { icon: Landmark,      iconColor: "from-emerald-500 to-teal-600",  title: "DORA Digital Resilience",            desc: "Meet DORA's five pillars — ICT risk management, incident reporting, digital resilience testing, third-party risk, and information sharing — with GRCEye's pre-built control set and vendor risk module.", time: "Ongoing compliance program", color: "border-emerald-200 bg-emerald-50/50" },
  { icon: ShieldCheck,   iconColor: "from-orange-500 to-amber-600",  title: "Vendor Risk Management Program",     desc: "Tier every vendor (Critical/High/Medium/Low), run AI-powered prescreen questionnaires before onboarding, review contracts with AI clause detection, route for CISO approval, and monitor ongoing risk with a 6-dimension cartography heatmap.", time: "Onboarding per vendor: 1–3 days", color: "border-orange-200 bg-orange-50/50" },
  { icon: ClipboardList, iconColor: "from-red-500 to-rose-600",      title: "Internal Audit Program",             desc: "Plan and execute internal audits with structured checklists, assign lead auditors, record findings with severity ratings, track remediation to closure, and generate a final PDF audit report — without email or spreadsheets.", time: "Per audit cycle: 2–6 weeks", color: "border-red-200 bg-red-50/50" },
];

export default function SolutionsView() {
  const [activeIndustry, setActiveIndustry] = useState(0);
  const ind = INDUSTRIES[activeIndustry];

  return (
    <div className="min-h-screen bg-[#f0f9ff] text-gray-900">
      <PublicNav />

      <section className="relative pt-16 pb-20 px-6 text-center overflow-hidden bg-gradient-to-b from-sky-100 via-[#f0f9ff] to-[#f0f9ff]">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute top-10 -right-10 w-80 h-80 bg-sky-200/25 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/70 border border-sky-200 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 shadow-sm animate-fade-in-up">
            <Users className="w-3.5 h-3.5" /> Built for every industry and every role
          </div>
          <h1 className="animate-fade-in-up animation-delay-200 text-5xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            GRC that fits{" "}
            <span className="gradient-text-animated">your world.</span>
          </h1>
          <p className="animate-fade-in-up animation-delay-400 text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            Whether you&apos;re a CISO preparing for ISO 27001, a compliance manager running SOC 2, or a FinTech navigating DORA — GRCEye has a ready path for your specific situation.
          </p>
          <div className="animate-fade-in-up animation-delay-600 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-500/25 hover:-translate-y-0.5 hover:shadow-blue-500/40">
              Start free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/faq" className="flex items-center justify-center gap-2 bg-white border border-sky-200 text-gray-700 hover:bg-sky-50 font-semibold px-8 py-3.5 rounded-2xl transition-all hover:-translate-y-0.5">
              Read the FAQ <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Solutions by industry</h2>
              <p className="text-gray-500 max-w-xl mx-auto">Every industry has specific frameworks, regulators, and audit requirements. GRCEye is pre-loaded for all of them.</p>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="flex flex-wrap gap-3 justify-center mb-12">
              {INDUSTRIES.map((indItem, i) => (
                <button
                  key={indItem.title}
                  onClick={() => setActiveIndustry(i)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all border ${
                    activeIndustry === i
                      ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20 -translate-y-0.5"
                      : "bg-white border-sky-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 hover:-translate-y-0.5"
                  }`}
                >
                  <indItem.icon className="w-4 h-4" />
                  {indItem.title}
                </button>
              ))}
            </div>
          </Reveal>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            <Reveal key={ind.title} delay={50}>
              <div className={`rounded-2xl p-8 border ${ind.border} ${ind.bg}`}>
                <div className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mb-5 ${ind.badge}`}>
                  <ind.icon className="w-3.5 h-3.5" /> {ind.title}
                </div>
                <h3 className="text-2xl font-extrabold text-gray-900 mb-3">{ind.headline}</h3>
                <p className="text-gray-600 leading-relaxed mb-6">{ind.desc}</p>
                <ul className="space-y-2.5 mb-8">
                  {ind.points.map(p => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-gray-700">
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{p}
                    </li>
                  ))}
                </ul>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Frameworks included</p>
                  <div className="flex flex-wrap gap-2">
                    {ind.frameworks.map(fw => (
                      <span key={fw} className="bg-white border border-sky-200 text-gray-700 text-xs font-medium px-3 py-1 rounded-full">{fw}</span>
                    ))}
                  </div>
                </div>
              </div>
            </Reveal>

            <div className="space-y-4">
              <Reveal delay={150}>
                <div className="bg-white rounded-2xl p-6 border border-sky-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 bg-gradient-to-br ${ind.color} rounded-xl flex items-center justify-center flex-shrink-0`}>
                      <ind.icon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-gray-900 text-sm">Typical workflow for {ind.title}</p>
                      <p className="text-xs text-gray-400">How teams use GRCEye in your industry</p>
                    </div>
                  </div>
                  <ol className="space-y-3">
                    {[
                      "Select your relevant frameworks from the 70+ built-in library",
                      "Run an AI-powered gap assessment across all controls",
                      "Upload evidence and close gaps with AI remediation guidance",
                      "Assign auditors and manage findings in the audit module",
                      "Generate board-ready compliance reports and share your Trust Center",
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                        <p className="text-sm text-gray-600">{step}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              </Reveal>

              <Reveal delay={200}>
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white">
                  <Star className="w-6 h-6 text-yellow-300 mb-3 fill-yellow-300" />
                  <p className="text-sm leading-relaxed italic mb-4">
                    &quot;GRCEye cut our ISO 27001 certification prep from 18 months to 6. The AI gap analysis alone identified 34 control gaps we had missed in our manual review.&quot;
                  </p>
                  <div>
                    <p className="font-semibold text-sm">Sarah K.</p>
                    <p className="text-blue-200 text-xs">CISO, FinTech Scale-up</p>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Common use cases</h2>
              <p className="text-gray-500 max-w-xl mx-auto">Whether you&apos;re starting a compliance program from scratch or scaling an existing one, GRCEye has a structured path.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {USE_CASES.map((uc, i) => (
              <Reveal key={uc.title} delay={i * 80}>
                <div className={`rounded-2xl p-6 border ${uc.color} card-hover h-full`}>
                  <div className={`w-12 h-12 bg-gradient-to-br ${uc.iconColor} rounded-2xl flex items-center justify-center mb-4 shadow-lg`}>
                    <uc.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">{uc.title}</h3>
                  <p className="text-gray-600 text-sm leading-relaxed mb-4">{uc.desc}</p>
                  <p className="text-xs font-semibold text-gray-400 border-t border-gray-200 pt-3">{uc.time}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Solutions by role</h2>
              <p className="text-gray-500 max-w-xl mx-auto">GRCEye has 9 built-in roles. Each person gets tools purpose-built for their job — not a generic dashboard.</p>
            </div>
          </Reveal>
          <div className="space-y-6">
            {ROLES.map((role, i) => (
              <Reveal key={role.title} delay={i * 60}>
                <div className="bg-[#f0f9ff] border border-sky-100 rounded-2xl p-7 grid grid-cols-1 md:grid-cols-3 gap-6 items-start card-hover">
                  <div className="md:col-span-1">
                    <div className={`w-12 h-12 bg-gradient-to-br ${role.color} rounded-2xl flex items-center justify-center mb-4 shadow-md`}>
                      <role.icon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="text-xl font-extrabold text-gray-900 mb-1">{role.title}</h3>
                    <p className="text-sm text-gray-500">{role.subtitle}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-gray-600 text-sm leading-relaxed mb-4">{role.desc}</p>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                      {role.points.map(p => (
                        <li key={p} className="flex items-start gap-2 text-xs text-gray-600">
                          <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />{p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 rounded-3xl p-10 md:p-14 text-white text-center relative overflow-hidden">
              <div className="absolute top-0 left-1/4 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-900/30">
                  <Cpu className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-3xl font-extrabold mb-4">AI that never leaves your infrastructure</h2>
                <p className="text-slate-300 text-lg leading-relaxed max-w-2xl mx-auto mb-8">
                  Every AI feature in GRCEye — document generation, contract review, gap analysis, vendor prescreening — runs on Ollama inside your own servers. No data is ever sent to OpenAI, Anthropic, or any external provider. This makes GRCEye suitable for the most sensitive regulated environments.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto mb-10">
                  {[
                    { icon: Lock,   label: "Zero data egress" },
                    { icon: Cpu,    label: "On-premise LLM" },
                    { icon: Shield, label: "EU AI Act aligned" },
                    { icon: Globe,  label: "Air-gap capable" },
                  ].map(item => (
                    <div key={item.label} className="bg-white/10 rounded-xl p-4 flex flex-col items-center gap-2">
                      <item.icon className="w-5 h-5 text-blue-300" />
                      <p className="text-xs font-semibold text-slate-200 text-center">{item.label}</p>
                    </div>
                  ))}
                </div>
                <Link href="/register" className="inline-flex items-center gap-2 bg-white text-blue-700 font-semibold px-8 py-3.5 rounded-2xl hover:bg-blue-50 transition-all shadow-md hover:-translate-y-0.5 hover:shadow-lg">
                  Try it free — no credit card <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="py-20 px-6 bg-white">
        <Reveal>
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Ready to get started?</h2>
            <p className="text-gray-500 mb-8 text-lg">14-day free trial. Full access to all modules. No credit card required.</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/register" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-500/20 hover:-translate-y-0.5 hover:shadow-blue-500/40">
                Start free trial <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/faq" className="flex items-center justify-center gap-2 bg-[#f0f9ff] border border-sky-200 text-gray-700 hover:bg-sky-100 font-semibold px-8 py-3.5 rounded-2xl transition-all hover:-translate-y-0.5">
                View FAQ <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <SupportChat />
      <PublicFooter />
    </div>
  );
}
