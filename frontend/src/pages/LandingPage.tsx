import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import SupportChat from "../components/landing/SupportChat";
import PublicNav from "../components/landing/PublicNav";
import {
  CheckCircle, ArrowRight, Zap, Lock, BarChart2,
  FileText, Building2, ClipboardList, BookOpen, AlertTriangle,
  ChevronRight, Star, Users, Award, Shield, MessageSquare,
  TrendingUp, Activity, Send, Bot, User, Bell, Search,
  Database, Globe, Cpu,
} from "lucide-react";

// ── Scroll-reveal hook ────────────────────────────────────────────────────────
function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// Wrapper that fades+slides a child into view on scroll
function Reveal({
  children, delay = 0, direction = "up", className = "",
}: {
  children: React.ReactNode; delay?: number; direction?: "up" | "left" | "right"; className?: string;
}) {
  const { ref, inView } = useInView();
  const from =
    direction === "left" ? "translateX(-28px)" :
    direction === "right" ? "translateX(28px)" :
    "translateY(28px)";
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "none" : from,
        transition: `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

const FEATURES = [
  { icon: AlertTriangle, title: "Risk Management",       desc: "Interactive 5×5 heat maps, risk registers, Monte Carlo simulations, and automated likelihood/impact scoring." },
  { icon: CheckCircle,   title: "Compliance Tracking",   desc: "Map controls to 76+ frameworks. Track implementation progress with segmented dashboards and AI gap analysis." },
  { icon: ClipboardList, title: "Audit Management",      desc: "Plan, execute, and report on internal and external audits. Assign auditors, track findings, generate PDF reports." },
  { icon: FileText,      title: "Policy Lifecycle",      desc: "Draft, version, approve, publish, and collect employee attestations — end-to-end policy governance in one place." },
  { icon: Building2,     title: "Vendor Risk (TPRM)",    desc: "Onboard, tier, and continuously monitor third-party vendors with AI-powered contract review and prescreen questionnaires." },
  { icon: BarChart2,     title: "Executive Reporting",   desc: "Board-ready dashboards, automated weekly PDF reports (5 types), and real-time compliance scores." },
  { icon: BookOpen,      title: "Framework Library",     desc: "ISO 27001, SOC 2, GDPR, PCI DSS, HIPAA, NIST CSF, NIST 800-53, CIS Controls v8, DORA, NIS2, AI Act, and 64 more." },
  { icon: Zap,           title: "AI-Powered Workflows",  desc: "Generate policies, analyze contracts, prescreen vendors, and get compliance guidance — all on-premise. Zero data egress." },
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

const ROLES = [
  { icon: Shield,        title: "CISO",               color: "from-blue-500 to-blue-700",     desc: "Full visibility across all risk domains, compliance posture, and vendor exposure. Real-time alerts for critical issues." },
  { icon: AlertTriangle, title: "Risk Manager",        color: "from-red-500 to-rose-600",      desc: "Build and maintain the risk register, run Monte Carlo simulations, link risks to assets, threats, and controls." },
  { icon: CheckCircle,   title: "Compliance Manager",  color: "from-green-500 to-emerald-600", desc: "Run multi-framework assessments, track control implementation, manage evidence, and close gaps efficiently." },
  { icon: ClipboardList, title: "Auditor",             color: "from-purple-500 to-indigo-600", desc: "Dedicated auditor portal scoped to assigned assessments only. Upload findings, attach evidence, generate reports." },
  { icon: FileText,      title: "Policy Manager",      color: "from-orange-500 to-amber-600",  desc: "Author and version policies, route for approval, send employee attestations, and track acknowledgement status." },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Connect your frameworks", desc: "Select from 76 built-in compliance frameworks or build a custom one. GRCEye pre-loads all controls, requirements, and crosswalk mappings automatically." },
  { step: "02", title: "Assess and close gaps", desc: "Run AI-powered compliance assessments. The platform identifies gaps, suggests remediation steps, and links evidence across all mapped controls simultaneously." },
  { step: "03", title: "Report with confidence", desc: "Generate board-ready PDF reports, share a public Trust Center with customers, and give auditors scoped portal access — all without leaving the platform." },
];

// ── Mockups ───────────────────────────────────────────────────────────────────

function MockupShell({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return null; // used below inline
}

function DashboardMockup() {
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-xs font-semibold text-gray-500">GRCEye Dashboard</span>
        </div>
        <div className="flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-gray-400" />
          <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      </div>
      <div className="flex h-[260px]">
        <div className="w-28 bg-slate-900 p-3 flex flex-col gap-1 flex-shrink-0">
          {[
            { label: "Dashboard", active: true },
            { label: "Risks", active: false },
            { label: "Compliance", active: false },
            { label: "Audits", active: false },
            { label: "Vendors", active: false },
            { label: "Policies", active: false },
          ].map(item => (
            <div key={item.label} className={`px-2 py-1.5 rounded-lg text-[9px] font-medium transition-colors ${item.active ? "bg-blue-600 text-white" : "text-slate-400"}`}>
              {item.label}
            </div>
          ))}
        </div>
        <div className="flex-1 p-4 overflow-hidden">
          <p className="text-[10px] font-bold text-gray-700 mb-3">Security Overview — Q2 2026</p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: "Compliance Score", value: "76%", color: "text-blue-600", bg: "bg-blue-50" },
              { label: "Open Risks", value: "14", color: "text-red-600", bg: "bg-red-50" },
              { label: "Controls Passing", value: "89", color: "text-green-600", bg: "bg-green-50" },
            ].map(kpi => (
              <div key={kpi.label} className={`${kpi.bg} rounded-xl p-2.5 text-center`}>
                <p className={`text-lg font-extrabold ${kpi.color}`}>{kpi.value}</p>
                <p className="text-[8px] text-gray-500 mt-0.5">{kpi.label}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 rounded-xl p-2.5">
              <p className="text-[9px] font-bold text-gray-600 mb-2">Framework Coverage</p>
              {[["ISO 27001", 76], ["SOC 2", 91], ["GDPR", 65]].map(([fw, pct]) => (
                <div key={fw as string} className="mb-1.5">
                  <div className="flex justify-between text-[8px] text-gray-500 mb-0.5">
                    <span>{fw}</span><span>{pct}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1">
                    <div className="h-1 rounded-full bg-blue-500 transition-all duration-1000" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-gray-50 rounded-xl p-2.5">
              <p className="text-[9px] font-bold text-gray-600 mb-2">Recent Alerts</p>
              {[
                { text: "Contract expiring in 7d", color: "text-red-600" },
                { text: "3 controls overdue", color: "text-orange-600" },
                { text: "Audit report ready", color: "text-blue-600" },
              ].map((a, i) => (
                <div key={i} className={`text-[8px] ${a.color} font-medium mb-1.5 flex items-center gap-1`}>
                  <span className="w-1 h-1 rounded-full bg-current flex-shrink-0" />{a.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RiskHeatmapMockup() {
  const cells = [[0,0,1,2,2],[0,1,1,2,3],[0,1,2,2,3],[1,1,2,3,3],[1,2,2,3,3]];
  const colors = ["bg-green-200","bg-yellow-200","bg-orange-200","bg-red-300"];
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-400">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-gray-500">Risk Register</span>
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-bold text-gray-800">Risk Heatmap — Q2 2026</span>
          </div>
          <span className="text-[10px] bg-red-50 text-red-600 font-semibold px-2 py-0.5 rounded-full">4 Critical</span>
        </div>
        <div className="grid grid-cols-5 gap-1 mb-4">
          {cells.map((row, r) => row.map((v, c) => (
            <div key={`${r}-${c}`} className={`aspect-square rounded ${colors[v]} flex items-center justify-center transition-transform hover:scale-110`}>
              {v >= 2 && <span className="text-[9px] font-bold text-white">{v === 3 ? "H" : "M"}</span>}
            </div>
          )))}
        </div>
        <div className="space-y-1.5">
          {[
            { label: "Data Breach Risk", severity: "Critical", color: "bg-red-100 text-red-700", owner: "CISO" },
            { label: "Third-Party Access", severity: "High", color: "bg-orange-100 text-orange-700", owner: "Risk Mgr" },
            { label: "Patch Management", severity: "Medium", color: "bg-yellow-100 text-yellow-700", owner: "IT Ops" },
          ].map(r => (
            <div key={r.label} className="flex items-center justify-between px-2 py-1.5 bg-gray-50 rounded-lg hover:bg-blue-50 transition-colors">
              <div>
                <span className="text-xs text-gray-700 font-medium">{r.label}</span>
                <span className="ml-2 text-[9px] text-gray-400">{r.owner}</span>
              </div>
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
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-200">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-gray-500">Compliance Assessment</span>
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-bold text-gray-800">ISO 27001:2022</p>
            <p className="text-xs text-gray-400">114 controls · 64% compliant</p>
          </div>
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3b82f6" strokeWidth="3" strokeDasharray="64 36" strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-blue-600">64%</span>
          </div>
        </div>
        <div className="flex gap-2 mb-3">
          {[["Compliant","bg-green-100 text-green-700","73"],["Gaps","bg-red-100 text-red-700","28"],["N/A","bg-gray-100 text-gray-600","13"]].map(([label, cls, count]) => (
            <div key={label as string} className={`flex-1 rounded-lg px-2 py-1.5 text-center ${cls}`}>
              <p className="text-xs font-bold">{count}</p>
              <p className="text-[9px]">{label}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2.5">
          {controls.map(c => (
            <div key={c.id}>
              <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                <span className="font-mono font-semibold text-gray-700">{c.id} {c.name}</span>
                <span>{c.pct}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${c.color} transition-all duration-1000`} style={{ width: `${c.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuditMockup() {
  const findings = [
    { id: "F-001", title: "MFA not enforced on admin accounts", severity: "Critical", status: "Open" },
    { id: "F-002", title: "Patch cycle exceeds 30-day SLA", severity: "High", status: "In Progress" },
    { id: "F-003", title: "Log retention policy missing", severity: "Medium", status: "Resolved" },
  ];
  const sev: Record<string,string> = { Critical:"bg-red-100 text-red-700", High:"bg-orange-100 text-orange-700", Medium:"bg-yellow-100 text-yellow-700" };
  const sta: Record<string,string> = { Open:"text-red-500", "In Progress":"text-blue-500", Resolved:"text-green-500" };
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-600">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-gray-500">Audit Management</span>
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-bold text-gray-800">ISO 27001 Internal Audit</p>
            <p className="text-xs text-gray-400">Lead: J. Martinez · 14 controls reviewed</p>
          </div>
          <span className="text-[10px] bg-blue-50 text-blue-600 font-semibold px-2 py-0.5 rounded-full">In Progress</span>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[["Done","9","text-green-600","bg-green-50"],["Pending","5","text-orange-600","bg-orange-50"],["Findings","3","text-red-600","bg-red-50"],["Resolved","1","text-blue-600","bg-blue-50"]].map(([label,val,tc,bg]) => (
            <div key={label as string} className={`${bg} rounded-lg p-2 text-center`}>
              <p className={`text-sm font-extrabold ${tc}`}>{val}</p>
              <p className="text-[8px] text-gray-500">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Findings</p>
        <div className="space-y-2">
          {findings.map(f => (
            <div key={f.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 hover:bg-blue-50 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[9px] font-mono text-gray-400 flex-shrink-0">{f.id}</span>
                <span className="text-[10px] text-gray-700 truncate">{f.title}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${sev[f.severity]}`}>{f.severity}</span>
                <span className={`text-[9px] font-semibold ${sta[f.status]}`}>{f.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PolicyMockup() {
  const policies = [
    { name: "Information Security Policy", version: "v3.1", status: "Published", attestation: "94%" },
    { name: "Access Control Policy", version: "v2.0", status: "Under Review", attestation: "—" },
    { name: "Incident Response Plan", version: "v1.5", status: "Published", attestation: "88%" },
    { name: "BYOD & Remote Work Policy", version: "v1.0", status: "Draft", attestation: "—" },
  ];
  const statusColor: Record<string,string> = { Published:"bg-green-100 text-green-700", "Under Review":"bg-yellow-100 text-yellow-700", Draft:"bg-gray-100 text-gray-600" };
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-800">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-xs font-semibold text-gray-500">Policy Management</span>
        </div>
        <div className="flex items-center gap-1.5 bg-blue-50 rounded-lg px-2 py-1">
          <Bot className="w-3 h-3 text-blue-500" />
          <span className="text-[9px] text-blue-600 font-semibold">AI Generate</span>
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 flex items-center gap-2">
            <Search className="w-3 h-3 text-gray-400" />
            <span className="text-[10px] text-gray-400">Search policies…</span>
          </div>
          <div className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-[10px] font-semibold cursor-pointer hover:bg-blue-700 transition-colors">+ New</div>
        </div>
        <div className="space-y-2">
          {policies.map(p => (
            <div key={p.name} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5 hover:bg-blue-50 transition-colors cursor-pointer">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-gray-800 truncate">{p.name}</p>
                <p className="text-[9px] text-gray-400">{p.version} · Attestation: {p.attestation}</p>
              </div>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${statusColor[p.status]}`}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AIMockup() {
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-200">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-gray-500">AI Document Generator</span>
        <span className="ml-auto text-[9px] bg-green-100 text-green-600 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" /> On-premise
        </span>
      </div>
      <div className="p-5 space-y-3">
        {[
          { role: "user", text: "Generate an Access Control Policy for our SaaS company." },
          { role: "ai",   text: "# Access Control Policy\n**Version 1.0 · Effective 2026-01-01**\n\n## 1. Purpose\nThis policy establishes requirements for controlling access to information assets…" },
        ].map((m, i) => (
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
          <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center"><Send className="w-3 h-3 text-white" /></div>
        </div>
      </div>
    </div>
  );
}

function VendorChatMockup() {
  const messages = [
    { from: "Vendor (Acme IT)", text: "We've uploaded our SOC 2 report and updated our data processing addendum.", side: "left",  color: "bg-blue-50 border-blue-100 text-blue-900" },
    { from: "Your Team",        text: "AI review flagged 3 clauses in section 4 — liability cap seems below threshold.", side: "right", color: "bg-indigo-600 text-white border-transparent" },
    { from: "Vendor (Acme IT)", text: "Understood. Our legal team will send a redline by EOD.", side: "left",  color: "bg-blue-50 border-blue-100 text-blue-900" },
    { from: "Your Team",        text: "Perfect. CISO review scheduled for Friday. Status → 'Under Review'.", side: "right", color: "bg-indigo-600 text-white border-transparent" },
  ];
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-400">
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-xs font-semibold text-gray-500">Vendor Collaboration</span>
        </div>
        <span className="text-[10px] bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" /> Live
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-bold text-gray-800">Acme IT Services — Contract Review</span>
        </div>
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-0.5 ${m.side === "right" ? "items-end" : "items-start"}`}>
            <span className="text-[9px] text-gray-400 px-1">{m.from}</span>
            <div className={`rounded-xl px-3 py-2 text-[11px] max-w-[85%] border ${m.color}`}>{m.text}</div>
          </div>
        ))}
        <div className="flex gap-2 items-center pt-2 border-t border-gray-100">
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-[10px] text-gray-400">Reply to vendor…</div>
          <div className="w-6 h-6 bg-indigo-600 rounded-lg flex items-center justify-center"><Send className="w-3 h-3 text-white" /></div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f0f9ff] text-gray-900">

      {/* ── Nav ── */}
      <PublicNav links={[
        { to: "#how-it-works", label: "How it works", hash: true },
        { to: "/features-landing", label: "Features" },
        { to: "/solutions", label: "Solutions" },
        { to: "#frameworks", label: "Frameworks", hash: true },
        { to: "/faq", label: "FAQ" },
      ]} />

      {/* ── Hero ── */}
      <section className="relative pt-28 sm:pt-32 pb-16 sm:pb-24 px-4 sm:px-6 text-center overflow-hidden bg-gradient-to-b from-sky-100 via-[#f0f9ff] to-[#f0f9ff]">
        {/* Animated blobs */}
        <div className="absolute -top-24 -left-24 w-[420px] h-[420px] bg-blue-200/40 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute top-32 -right-20 w-[360px] h-[360px] bg-sky-200/35 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-indigo-200/25 rounded-full blur-3xl animate-blob animation-delay-4000 pointer-events-none" />

        <div className="relative max-w-4xl mx-auto">
          <div className="animate-fade-in-up inline-flex items-center gap-2 bg-white/70 border border-sky-200 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 shadow-sm">
            <Zap className="w-3.5 h-3.5" />
            76 compliance frameworks · On-premise AI · Zero data egress
          </div>

          <h1 className="animate-fade-in-up animation-delay-200 text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
            Enterprise GRC,{" "}
            <span className="gradient-text-animated">simplified.</span>
          </h1>

          <p className="animate-fade-in-up animation-delay-400 text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            One platform for risk management, compliance tracking, audit workflows,
            policy governance, and vendor risk — built for modern security teams.
            Powered by private AI that stays inside your infrastructure.
          </p>

          <div className="animate-fade-in-up animation-delay-600 flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register" className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-500/25 text-base hover:shadow-blue-500/40 hover:-translate-y-0.5">
              Start 14-day free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/login" className="flex items-center justify-center gap-2 bg-white border border-sky-200 text-gray-700 hover:bg-sky-50 font-semibold px-8 py-3.5 rounded-2xl transition-all text-base hover:-translate-y-0.5">
              Sign in to dashboard <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="animate-fade-in-up animation-delay-800 mt-4 text-xs text-gray-400">No credit card required · 14-day free trial · Cancel anytime</p>

          <div className="animate-fade-in-up animation-delay-1000 mt-16 grid grid-cols-3 gap-6 max-w-lg mx-auto">
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

      {/* ── Dashboard Preview ── */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <Reveal direction="left">
              <div className="inline-flex items-center gap-2 text-blue-600 text-xs font-semibold bg-blue-50 px-3 py-1.5 rounded-full mb-4">
                <BarChart2 className="w-3.5 h-3.5" /> Command Center
              </div>
              <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Your entire GRC posture at a glance</h2>
              <p className="text-gray-500 leading-relaxed mb-6">
                The GRCEye dashboard gives you real-time visibility into every domain — compliance scores, open risks, contract deadlines, audit progress, and policy attestation rates — all in one screen.
              </p>
              <ul className="space-y-3">
                {["Live compliance score per framework","Critical risk and contract expiry alerts","Audit completion and finding status","Framework coverage progress bars","Role-specific views for each team member"].map((f, i) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600" style={{ animationDelay: `${i * 80}ms` }}>
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal direction="right" delay={100}>
              <DashboardMockup />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── How it Works ── */}
      <section id="how-it-works" className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">How GRCEye works</h2>
              <p className="text-gray-500 max-w-xl mx-auto">From setup to board report in three straightforward steps.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step, i) => (
              <Reveal key={step.step} delay={i * 150}>
                <div className="relative bg-white rounded-2xl p-7 border border-sky-100 shadow-sm card-hover">
                  {i < HOW_IT_WORKS.length - 1 && (
                    <div className="hidden md:block absolute top-8 left-[calc(100%+1rem)] w-8 h-0.5 bg-sky-200" />
                  )}
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-blue-500/20">
                    <span className="text-white font-extrabold text-lg">{step.step}</span>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{step.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Module Mockups ── */}
      <section id="modules" className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Every module, purpose-built</h2>
              <p className="text-gray-500 max-w-xl mx-auto">GRCEye covers the full lifecycle — not just a subset. See what each module looks like in practice.</p>
            </div>
          </Reveal>

          {/* Risk */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left">
              <div className="inline-flex items-center gap-2 text-red-600 text-xs font-semibold bg-red-50 px-3 py-1.5 rounded-full mb-4">
                <AlertTriangle className="w-3.5 h-3.5" /> Risk Management
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Quantify and treat risk — not just log it</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Go beyond basic risk registers. GRCEye combines a visual 5×5 heatmap with Monte Carlo simulation, producing ALE, SLE, P90/P95 figures your board can act on. Every risk links to assets, threats, vulnerabilities, and controls.</p>
              <ul className="space-y-2">
                {["Interactive heatmap with owner + next-review tracking","Monte Carlo quantification — ALE, SLE, P90, P95","Custom risk matrices: 3×3, 5×5, or fully configurable","Risk scenarios: Threat → Vuln → Asset → Control chains","Formal risk acceptance workflow with expiration"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal direction="right" delay={100}><RiskHeatmapMockup /></Reveal>
          </div>

          {/* Compliance */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left" delay={100} className="order-2 md:order-1"><ComplianceMockup /></Reveal>
            <Reveal direction="right" className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 text-blue-600 text-xs font-semibold bg-blue-50 px-3 py-1.5 rounded-full mb-4">
                <CheckCircle className="w-3.5 h-3.5" /> Compliance & Frameworks
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">76 frameworks, one assessment workflow</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Run simultaneous assessments across ISO 27001, SOC 2, GDPR, PCI DSS, and any other framework. Evidence uploaded once applies to all mapped controls. The AI analyses gaps and generates remediation steps in minutes, not weeks.</p>
              <ul className="space-y-2">
                {["76 built-in frameworks with pre-mapped controls","AI-powered gap analysis with remediation guidance","Cross-framework evidence reuse — no duplication","Customizable frameworks: fork, edit, add controls","Auditor portal with scoped, read-only access","Stakeholder evidence upload via secure share links"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* Audit */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left">
              <div className="inline-flex items-center gap-2 text-purple-600 text-xs font-semibold bg-purple-50 px-3 py-1.5 rounded-full mb-4">
                <ClipboardList className="w-3.5 h-3.5" /> Audit Management
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Full audit lifecycle from planning to report</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Manage internal and external audits end-to-end. Assign auditors, build control checklists, record findings with severity ratings, track remediation, and generate PDF reports — no spreadsheet emails needed.</p>
              <ul className="space-y-2">
                {["Internal and external audit types","Auditor portal: scoped access to assigned audits only","Finding severity: Critical / High / Medium / Low / Info","Remediation tracking with owner assignment","One-click PDF audit report generation","Evidence upload and document attachment per finding"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal direction="right" delay={100}><AuditMockup /></Reveal>
          </div>

          {/* Policy */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left" delay={100} className="order-2 md:order-1"><PolicyMockup /></Reveal>
            <Reveal direction="right" className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 text-orange-600 text-xs font-semibold bg-orange-50 px-3 py-1.5 rounded-full mb-4">
                <FileText className="w-3.5 h-3.5" /> Policy & Document Management
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">AI-generated policies, versioned and attested</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Stop writing policies from scratch. GRCEye's AI document generator produces 29 audit-ready document types — tailored to your organization's industry, size, and frameworks — in seconds.</p>
              <ul className="space-y-2">
                {["AI generates 29 document types in seconds","Full version history with author and approval tracking","Employee attestation with email reminders","Policy approval workflow before publishing","Link policies to framework controls for compliance evidence","Categories: Foundation, Policies, Procedures, Plans"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* AI */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <Reveal direction="left">
              <div className="inline-flex items-center gap-2 text-indigo-600 text-xs font-semibold bg-indigo-50 px-3 py-1.5 rounded-full mb-4">
                <Cpu className="w-3.5 h-3.5" /> On-Premise AI
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Powerful AI — entirely inside your infrastructure</h3>
              <p className="text-gray-500 leading-relaxed mb-4">GRCEye's AI runs on Ollama inside your own servers. Your contracts, policies, and compliance data never touch an external API. Full AI power with the data sovereignty required for regulated industries.</p>
              <ul className="space-y-2">
                {["Document generator: 29 GRC document types","Contract clause analysis: 6-section structured review","Vendor prescreen: 15-question AI questionnaire analysis","Compliance gap analysis with remediation suggestions","Custom framework control suggestions by industry","GRC assistant chatbot for instant compliance guidance"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal direction="right" delay={100}><AIMockup /></Reveal>
          </div>
        </div>
      </section>

      {/* ── Vendor Collaboration ── */}
      <section className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <Reveal direction="left" delay={100} className="order-2 md:order-1"><VendorChatMockup /></Reveal>
            <Reveal direction="right" className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 text-indigo-600 text-xs font-semibold bg-indigo-50 px-3 py-1.5 rounded-full mb-4">
                <MessageSquare className="w-3.5 h-3.5" /> Vendor Risk (TPRM)
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Close vendor contracts faster with real-time collaboration</h3>
              <p className="text-gray-500 leading-relaxed mb-4">The vendor module handles the full third-party risk lifecycle — from onboarding and AI prescreening through contract review, CISO approval, and ongoing monitoring.</p>
              <ul className="space-y-2">
                {["Vendor onboarding with risk tiers: Critical / High / Medium / Low","AI prescreen: 15-question analysis before onboarding","Contract upload → AI review → CISO approval workflow","Real-time vendor collaboration with message threads","Risk cartography: 6-dimension visual heatmap per vendor","Contract versioning and validation status tracking"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Built for every role ── */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Built for every role on your team</h2>
              <p className="text-gray-500 max-w-xl mx-auto">9 built-in roles with tailored access. Each person sees exactly what they need — nothing more.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {ROLES.map(({ icon: Icon, title, color, desc }, i) => (
              <Reveal key={title} delay={i * 100}>
                <div className="bg-[#f0f9ff] rounded-2xl p-6 border border-sky-100 card-hover h-full">
                  <div className={`w-10 h-10 bg-gradient-to-br ${color} rounded-xl flex items-center justify-center mb-4 shadow-sm`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={300}>
            <div className="mt-8 text-center">
              <p className="text-sm text-gray-400">Also includes: <span className="text-gray-600 font-medium">Risk Manager · Compliance Manager · Control Owner · Viewer · Tenant Admin</span></p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="py-16 px-6 bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { icon: Shield,     value: "76+",    label: "Compliance frameworks" },
              { icon: Activity,   value: "3,500+", label: "Pre-mapped controls" },
              { icon: TrendingUp, value: "60%",    label: "Faster audit prep" },
              { icon: Database,   value: "0",      label: "Data sent to external AI" },
            ].map((s, i) => (
              <Reveal key={s.label} delay={i * 100}>
                <s.icon className="w-7 h-7 mx-auto mb-3 text-blue-200" />
                <p className="text-4xl font-extrabold mb-1">{s.value}</p>
                <p className="text-sm text-blue-200">{s.label}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features grid ── */}
      <section id="features" className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Everything your GRC team needs</h2>
              <p className="text-gray-500 max-w-xl mx-auto">From risk to compliance to audit — one integrated workflow, no spreadsheets required.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <Reveal key={title} delay={i * 70}>
                <div className="bg-white rounded-2xl p-6 hover:bg-sky-50 hover:border-sky-200 border border-sky-100 transition-all group card-hover h-full">
                  <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center shadow-sm mb-4 group-hover:bg-blue-600 transition-colors">
                    <Icon className="w-5 h-5 text-blue-600 group-hover:text-white transition-colors" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1.5">{title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={200}>
            <div className="mt-10 flex flex-wrap justify-center gap-2">
              {["Activity Log","Webhook Events","CSV Export/Import","Trust Center","Regulatory Updates","Incident Management","Vulnerability Tracking","Threat Library","Applied Controls","Security Exceptions","Risk Quantification (Monte Carlo)","Multi-tenant Isolation"].map(cap => (
                <span key={cap} className="text-xs font-medium text-gray-600 bg-white border border-sky-100 px-3 py-1.5 rounded-full hover:bg-sky-50 hover:text-blue-700 transition-colors cursor-default shadow-sm">
                  {cap}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Frameworks ── */}
      <section id="frameworks" className="py-24 px-6 bg-slate-900">
        <div className="max-w-5xl mx-auto text-center">
          <Reveal>
            <h2 className="text-3xl font-extrabold text-white mb-3">Built for every framework</h2>
            <p className="text-slate-400 mb-12 max-w-xl mx-auto">Pre-loaded with controls, crosswalk mappings, and evidence requirements for 76 global frameworks.</p>
          </Reveal>
          <Reveal delay={100}>
            <div className="flex flex-wrap justify-center gap-3">
              {FRAMEWORKS.map(fw => (
                <span key={fw} className="bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium px-4 py-2 rounded-xl hover:bg-slate-700 hover:text-white transition-all cursor-default hover:-translate-y-0.5">
                  {fw}
                </span>
              ))}
              <span className="bg-blue-600/20 border border-blue-500/30 text-blue-400 text-sm font-medium px-4 py-2 rounded-xl">
                + 64 more frameworks
              </span>
            </div>
          </Reveal>
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl mx-auto">
            {[
              { icon: Lock,  label: "ISO/IEC certified controls", value: "ISO 27001 · ISO 27002 · ISO 42001" },
              { icon: Award, label: "Regulatory frameworks",      value: "GDPR · HIPAA · PCI DSS · DORA · NIS2" },
              { icon: Globe, label: "Industry standards",         value: "SOC 2 · CIS v8 · NIST · CSA CCM" },
            ].map((s, i) => (
              <Reveal key={s.label} delay={i * 100}>
                <div className="bg-slate-800 rounded-2xl p-5 text-left border border-slate-700 card-hover h-full">
                  <s.icon className="w-5 h-5 text-blue-400 mb-3" />
                  <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                  <p className="text-sm font-semibold text-white leading-snug">{s.value}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-3">Trusted by security teams</h2>
              <p className="text-gray-500">From fast-growing startups to regulated enterprises.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 120}>
                <div className="bg-[#f0f9ff] rounded-2xl p-6 border border-sky-100 card-hover h-full">
                  <div className="flex gap-0.5 mb-4">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed mb-5 italic">"{t.quote}"</p>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-500">{t.role}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Resources ── */}
      <section className="py-24 px-6 bg-[#f0f9ff]">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-12">Learn More</h2>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { to: "/features-landing", title: "Features",  desc: "Deep-dive into every module — Risk, Compliance, Audit, Policy, Vendor, AI, and Governance.", cta: "Explore features →" },
              { to: "/solutions",        title: "Solutions", desc: "GRCEye for SaaS, Healthcare, FinTech, and Enterprise — use cases and workflows by industry.", cta: "View solutions →" },
              { to: "/blog",             title: "Blog",      desc: "Insights on compliance strategy, risk management, and best practices from experts.", cta: "Read articles →" },
              { to: "/faq",              title: "FAQ",       desc: "Common questions about GRCEye features, deployment, and getting started.", cta: "View FAQ →" },
            ].map((item, i) => (
              <Reveal key={item.title} delay={i * 80}>
                <Link to={item.to} className="group bg-white rounded-2xl p-8 border border-sky-100 hover:border-blue-400 hover:shadow-lg transition-all card-hover block h-full">
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{item.title}</h3>
                    <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                  </div>
                  <p className="text-gray-600 text-sm">{item.desc}</p>
                  <div className="mt-6 pt-6 border-t border-gray-100">
                    <span className="text-blue-600 font-semibold text-xs">{item.cta}</span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative py-24 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-center overflow-hidden">
        <div className="absolute top-0 left-1/4 w-64 h-64 bg-white/10 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-indigo-400/20 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <Reveal>
          <div className="relative max-w-2xl mx-auto">
            <h2 className="text-3xl font-extrabold mb-4">Start your GRC journey today</h2>
            <p className="text-blue-100 mb-8 text-lg">14-day free trial. No credit card. Full access to all 38 modules.</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/register" className="flex items-center justify-center gap-2 bg-white text-blue-600 font-semibold px-8 py-3.5 rounded-2xl hover:bg-blue-50 transition-all shadow-md text-base hover:-translate-y-0.5 hover:shadow-lg">
                Start free trial <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="mailto:sales@grceye.io" className="flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-semibold px-8 py-3.5 rounded-2xl hover:bg-white/20 transition-all text-base hover:-translate-y-0.5">
                Talk to sales
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      <SupportChat />

      {/* ── Footer ── */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <img src="/logo.png" alt="GRCEye" className="h-12 w-auto object-contain bg-white rounded-lg p-1.5" />
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
