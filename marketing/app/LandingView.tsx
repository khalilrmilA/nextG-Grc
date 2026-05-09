"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SupportChat from "@/components/landing/SupportChat";
import PublicNav from "@/components/landing/PublicNav";
import PublicFooter from "@/components/landing/PublicFooter";
import {
  CheckCircle, ArrowRight, Zap, Lock, BarChart2,
  FileText, Building2, ClipboardList, BookOpen, AlertTriangle,
  Star, Shield, MessageSquare, Sparkles,
  TrendingUp, Activity, Send, Bot, User, Bell, Search,
  Database, Globe, Award, Cpu, ChevronRight,
} from "lucide-react";

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

function Reveal({
  children, delay = 0, direction = "up", className = "",
}: {
  children: React.ReactNode; delay?: number; direction?: "up" | "left" | "right"; className?: string;
}) {
  const { ref, inView } = useInView();
  const from =
    direction === "left" ? "translateX(-32px)" :
    direction === "right" ? "translateX(32px)" :
    "translateY(32px)";
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "none" : from,
        transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function useTypewriter(words: string[], pause = 2200) {
  const [index, setIndex] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    const target = words[index];
    if (typing) {
      if (displayed.length < target.length) {
        const t = setTimeout(() => setDisplayed(target.slice(0, displayed.length + 1)), 65);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setTyping(false), pause);
      return () => clearTimeout(t);
    }
    if (displayed.length > 0) {
      const t = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 38);
      return () => clearTimeout(t);
    }
    setIndex(i => (i + 1) % words.length);
    setTyping(true);
  }, [displayed, typing, index, words, pause]);

  return displayed;
}

function CountUp({ to, suffix = "", prefix = "" }: { to: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        let cur = 0;
        const step = to / 80;
        const id = setInterval(() => {
          cur = Math.min(cur + step, to);
          setCount(Math.round(cur));
          if (cur >= to) clearInterval(id);
        }, 18);
      }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [to]);

  return <span ref={ref}>{prefix}{count.toLocaleString()}{suffix}</span>;
}

const FEATURES = [
  { icon: AlertTriangle, title: "Risk Management",       desc: "Interactive 5×5 heatmaps, risk registers, Monte Carlo simulations, and automated likelihood/impact scoring.", color: "from-red-500 to-rose-600", bg: "bg-red-50", text: "text-red-600" },
  { icon: CheckCircle,   title: "Compliance Tracking",   desc: "Map controls to 70+ frameworks. Track implementation progress with segmented dashboards and AI gap analysis.", color: "from-blue-500 to-blue-700", bg: "bg-blue-50", text: "text-blue-600" },
  { icon: ClipboardList, title: "Audit Management",      desc: "Plan, execute, and report on internal and external audits. Assign auditors, track findings, generate PDF reports.", color: "from-purple-500 to-indigo-600", bg: "bg-purple-50", text: "text-purple-600" },
  { icon: FileText,      title: "Policy Lifecycle",      desc: "Draft, version, approve, publish, and collect employee attestations — end-to-end policy governance in one place.", color: "from-orange-500 to-amber-600", bg: "bg-orange-50", text: "text-orange-600" },
  { icon: Building2,     title: "Vendor Risk (TPRM)",    desc: "Onboard, tier, and continuously monitor third-party vendors with AI-powered contract review and prescreen questionnaires.", color: "from-indigo-500 to-violet-600", bg: "bg-indigo-50", text: "text-indigo-600" },
  { icon: BarChart2,     title: "Executive Reporting",   desc: "Board-ready dashboards, automated weekly PDF reports (5 types), and real-time compliance scores.", color: "from-teal-500 to-cyan-600", bg: "bg-teal-50", text: "text-teal-600" },
  { icon: BookOpen,      title: "Framework Library",     desc: "ISO 27001, SOC 2, GDPR, PCI DSS, HIPAA, NIST CSF, NIST 800-53, CIS Controls v8, DORA, NIS2, AI Act, and 64 more.", color: "from-green-500 to-emerald-600", bg: "bg-green-50", text: "text-green-600" },
  { icon: Zap,           title: "AI-Powered Workflows",  desc: "Generate policies, analyze contracts, prescreen vendors, and get compliance guidance — all on-premise. Zero data egress.", color: "from-yellow-500 to-orange-500", bg: "bg-yellow-50", text: "text-yellow-600" },
];

const ALL_FRAMEWORKS = [
  "ISO 27001:2022", "SOC 2 Type II", "GDPR", "PCI DSS 4.0",
  "HIPAA", "NIST CSF 2.0", "NIST 800-53 Rev5", "CIS Controls v8",
  "NIS2 Directive", "DORA", "ISO 42001", "NIST AI RMF",
  "MITRE ATT&CK", "CSA CCM", "SOX ITGC", "FedRAMP", "HITRUST",
  "ISO 22301", "COBIT 2019", "ISO 31000", "ISO 27701", "SWIFT CSP",
];

const TESTIMONIALS = [
  { quote: "We cut our ISO 27001 certification prep from 18 months to 6. The framework gap analysis alone is worth every cent.", name: "Sarah K.", role: "CISO, FinTech Scale-up", rating: 5, initials: "SK", color: "from-blue-500 to-indigo-600" },
  { quote: "Finally a GRC tool that doesn't require a PhD to use. Our compliance team was up and running in a day.", name: "Marcus T.", role: "Head of Compliance, SaaS Co.", rating: 5, initials: "MT", color: "from-purple-500 to-pink-600" },
  { quote: "The vendor risk module saved us countless hours of spreadsheet work. Board-ready reports in one click.", name: "Priya S.", role: "VP Risk, Healthcare Platform", rating: 5, initials: "PS", color: "from-teal-500 to-cyan-600" },
];

const ROLES = [
  { icon: Shield,        title: "CISO",               color: "from-blue-500 to-blue-700",     desc: "Full visibility across all risk domains, compliance posture, and vendor exposure." },
  { icon: AlertTriangle, title: "Risk Manager",        color: "from-red-500 to-rose-600",      desc: "Build and maintain the risk register, run Monte Carlo simulations, link risks to assets." },
  { icon: CheckCircle,   title: "Compliance Manager",  color: "from-green-500 to-emerald-600", desc: "Run multi-framework assessments, track control implementation, manage evidence." },
  { icon: ClipboardList, title: "Auditor",             color: "from-purple-500 to-indigo-600", desc: "Dedicated portal scoped to assigned assessments. Upload findings, generate reports." },
  { icon: FileText,      title: "Policy Manager",      color: "from-orange-500 to-amber-600",  desc: "Author and version policies, route for approval, send employee attestations." },
];

const HOW_IT_WORKS = [
  { step: "01", icon: BookOpen, title: "Connect your frameworks", desc: "Select from 70+ built-in compliance frameworks or build a custom one. GRCEye pre-loads all controls, requirements, and crosswalk mappings automatically.", color: "from-blue-500 to-indigo-600" },
  { step: "02", icon: Zap,      title: "Assess and close gaps",   desc: "Run AI-powered compliance assessments. The platform identifies gaps, suggests remediation steps, and links evidence across all mapped controls simultaneously.", color: "from-purple-500 to-pink-600" },
  { step: "03", icon: BarChart2,title: "Report with confidence",  desc: "Generate board-ready PDF reports, share a public Trust Center with customers, and give auditors scoped portal access — all without leaving the platform.", color: "from-teal-500 to-cyan-600" },
];

function DashboardMockup() {
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-tilt">
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-xs font-semibold text-slate-400">GRCEye Dashboard</span>
        </div>
        <div className="flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-slate-500" />
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
            <div key={item.label} className={`px-2 py-1.5 rounded-lg text-[9px] font-medium ${item.active ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>
              {item.label}
            </div>
          ))}
        </div>
        <div className="flex-1 p-4 bg-gray-50 overflow-hidden">
          <p className="text-[10px] font-bold text-gray-700 mb-3">Security Overview — Q2 2026</p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: "Compliance Score", value: "76%", color: "text-blue-600", bg: "bg-blue-50 border-blue-100" },
              { label: "Open Risks", value: "14", color: "text-red-600", bg: "bg-red-50 border-red-100" },
              { label: "Controls Passing", value: "89", color: "text-green-600", bg: "bg-green-50 border-green-100" },
            ].map(kpi => (
              <div key={kpi.label} className={`${kpi.bg} border rounded-xl p-2.5 text-center`}>
                <p className={`text-lg font-extrabold ${kpi.color}`}>{kpi.value}</p>
                <p className="text-[8px] text-gray-500 mt-0.5">{kpi.label}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-gray-100 rounded-xl p-2.5">
              <p className="text-[9px] font-bold text-gray-600 mb-2">Framework Coverage</p>
              {[["ISO 27001", 76], ["SOC 2", 91], ["GDPR", 65]].map(([fw, pct]) => (
                <div key={fw as string} className="mb-1.5">
                  <div className="flex justify-between text-[8px] text-gray-500 mb-0.5">
                    <span>{fw}</span><span>{pct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-2.5">
              <p className="text-[9px] font-bold text-gray-600 mb-2">Recent Alerts</p>
              {[
                { text: "Contract expiring in 7d", color: "text-red-600", dot: "bg-red-500" },
                { text: "3 controls overdue", color: "text-orange-600", dot: "bg-orange-500" },
                { text: "Audit report ready", color: "text-blue-600", dot: "bg-blue-500" },
              ].map((a, i) => (
                <div key={i} className={`text-[8px] ${a.color} font-medium mb-1.5 flex items-center gap-1.5`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${a.dot} flex-shrink-0 animate-pulse`} />{a.text}
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
  const colors = ["bg-green-200","bg-yellow-200","bg-orange-300","bg-red-400"];
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-400">
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-2.5 flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-slate-400">Risk Register</span>
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-bold text-gray-800">Risk Heatmap — Q2 2026</span>
          </div>
          <span className="text-[10px] bg-red-50 text-red-600 font-semibold px-2 py-0.5 rounded-full border border-red-100">4 Critical</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5 mb-4">
          {cells.map((row, r) => row.map((v, c) => (
            <div key={`${r}-${c}`} className={`aspect-square rounded-lg ${colors[v]} flex items-center justify-center transition-transform hover:scale-110`}>
              {v >= 2 && <span className="text-[9px] font-bold text-white">{v === 3 ? "H" : "M"}</span>}
            </div>
          )))}
        </div>
        <div className="space-y-1.5">
          {[
            { label: "Data Breach Risk", severity: "Critical", color: "bg-red-100 text-red-700 border-red-200", owner: "CISO" },
            { label: "Third-Party Access", severity: "High", color: "bg-orange-100 text-orange-700 border-orange-200", owner: "Risk Mgr" },
            { label: "Patch Management", severity: "Medium", color: "bg-yellow-100 text-yellow-700 border-yellow-200", owner: "IT Ops" },
          ].map(r => (
            <div key={r.label} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl hover:bg-blue-50 transition-colors border border-gray-100">
              <div>
                <span className="text-xs text-gray-700 font-semibold">{r.label}</span>
                <span className="ml-2 text-[9px] text-gray-400">{r.owner}</span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${r.color}`}>{r.severity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComplianceMockup() {
  const controls = [
    { id: "A.8.1", name: "Asset inventory", pct: 100, color: "bg-gradient-to-r from-green-400 to-emerald-500" },
    { id: "A.9.1", name: "Access control policy", pct: 75, color: "bg-gradient-to-r from-blue-400 to-blue-600" },
    { id: "A.12.1", name: "Operational procedures", pct: 50, color: "bg-gradient-to-r from-yellow-400 to-orange-400" },
    { id: "A.18.1", name: "Legal compliance", pct: 30, color: "bg-gradient-to-r from-red-400 to-red-500" },
  ];
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-200">
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-2.5 flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-slate-400">Compliance Assessment</span>
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
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="url(#grad)" strokeWidth="3" strokeDasharray="64 36" strokeLinecap="round" />
              <defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#3b82f6"/><stop offset="100%" stopColor="#6366f1"/></linearGradient></defs>
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-blue-600">64%</span>
          </div>
        </div>
        <div className="flex gap-2 mb-4">
          {[["Compliant","bg-green-50 text-green-700 border-green-100","73"],["Gaps","bg-red-50 text-red-700 border-red-100","28"],["N/A","bg-gray-50 text-gray-600 border-gray-100","13"]].map(([label, cls, count]) => (
            <div key={label as string} className={`flex-1 rounded-xl px-2 py-1.5 text-center border ${cls}`}>
              <p className="text-sm font-black">{count}</p>
              <p className="text-[9px]">{label}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2.5">
          {controls.map(c => (
            <div key={c.id}>
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span className="font-mono font-semibold text-gray-700">{c.id} {c.name}</span>
                <span>{c.pct}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${c.color}`} style={{ width: `${c.pct}%` }} />
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
    { id: "F-001", title: "MFA not enforced on admin accounts", severity: "Critical", status: "Open", sc: "bg-red-100 text-red-700", ss: "text-red-500" },
    { id: "F-002", title: "Patch cycle exceeds 30-day SLA", severity: "High", status: "In Progress", sc: "bg-orange-100 text-orange-700", ss: "text-blue-500" },
    { id: "F-003", title: "Log retention policy missing", severity: "Medium", status: "Resolved", sc: "bg-yellow-100 text-yellow-700", ss: "text-green-500" },
  ];
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-600">
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-2.5 flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-slate-400">Audit Management</span>
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-bold text-gray-800">ISO 27001 Internal Audit</p>
            <p className="text-xs text-gray-400">Lead: J. Martinez · 14 controls reviewed</p>
          </div>
          <span className="text-[10px] bg-blue-50 text-blue-600 font-semibold px-2 py-0.5 rounded-full border border-blue-100">In Progress</span>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {[["Done","9","text-green-600","bg-green-50 border-green-100"],["Pending","5","text-orange-600","bg-orange-50 border-orange-100"],["Findings","3","text-red-600","bg-red-50 border-red-100"],["Resolved","1","text-blue-600","bg-blue-50 border-blue-100"]].map(([label,val,tc,bg]) => (
            <div key={label as string} className={`${bg} border rounded-xl p-2 text-center`}>
              <p className={`text-sm font-extrabold ${tc}`}>{val}</p>
              <p className="text-[8px] text-gray-500">{label}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {findings.map(f => (
            <div key={f.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 hover:bg-blue-50 transition-colors border border-gray-100">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[9px] font-mono text-gray-400 flex-shrink-0">{f.id}</span>
                <span className="text-[10px] text-gray-700 truncate">{f.title}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${f.sc}`}>{f.severity}</span>
                <span className={`text-[9px] font-semibold ${f.ss}`}>{f.status}</span>
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
  const statusColor: Record<string,string> = { Published:"bg-green-50 text-green-700 border-green-100", "Under Review":"bg-yellow-50 text-yellow-700 border-yellow-100", Draft:"bg-gray-50 text-gray-600 border-gray-100" };
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-800">
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-xs font-semibold text-slate-400">Policy Management</span>
        </div>
        <div className="flex items-center gap-1.5 bg-purple-900/40 rounded-lg px-2 py-1 border border-purple-700/30">
          <Bot className="w-3 h-3 text-purple-400" />
          <span className="text-[9px] text-purple-300 font-semibold">AI Generate</span>
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 flex items-center gap-2">
            <Search className="w-3 h-3 text-gray-400" />
            <span className="text-[10px] text-gray-400">Search policies…</span>
          </div>
          <div className="bg-blue-600 text-white rounded-xl px-3 py-1.5 text-[10px] font-bold">+ New</div>
        </div>
        <div className="space-y-2">
          {policies.map(p => (
            <div key={p.name} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 hover:bg-blue-50 hover:border-blue-100 transition-colors cursor-pointer">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-gray-800 truncate">{p.name}</p>
                <p className="text-[9px] text-gray-400">{p.version} · Attestation: {p.attestation}</p>
              </div>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ml-2 border ${statusColor[p.status]}`}>{p.status}</span>
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
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-2.5 flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="ml-2 text-xs font-semibold text-slate-400">AI Document Generator</span>
        <span className="ml-auto text-[9px] bg-green-900/40 text-green-400 font-semibold px-2 py-0.5 rounded-full border border-green-700/30 flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> On-premise
        </span>
      </div>
      <div className="p-5 space-y-3">
        {[
          { role: "user", text: "Generate an Access Control Policy for our SaaS company." },
          { role: "ai",   text: "# Access Control Policy\n**Version 1.0 · Effective 2026-01-01**\n\n## 1. Purpose\nThis policy establishes requirements for controlling access to information assets…" },
        ].map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${m.role === "ai" ? "bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg shadow-purple-500/20" : "bg-gray-200"}`}>
              {m.role === "ai" ? <Bot className="w-3.5 h-3.5 text-white" /> : <User className="w-3.5 h-3.5 text-gray-600" />}
            </div>
            <div className={`rounded-2xl px-3 py-2 text-xs max-w-[80%] ${m.role === "ai" ? "bg-gray-50 border border-gray-100 text-gray-700 font-mono leading-relaxed" : "bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20"}`}>
              {m.text.split("\n").map((l, j) => <div key={j}>{l || <br />}</div>)}
            </div>
          </div>
        ))}
        <div className="flex gap-2 items-center mt-2 pt-2 border-t border-gray-100">
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-[10px] text-gray-400">Ask GRCEye AI…</div>
          <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-sm"><Send className="w-3 h-3 text-white" /></div>
        </div>
      </div>
    </div>
  );
}

function VendorChatMockup() {
  const messages = [
    { from: "Vendor (Acme IT)", text: "We've uploaded our SOC 2 report and updated our DPA.", side: "left",  color: "bg-blue-50 border-blue-100 text-blue-900" },
    { from: "Your Team",        text: "AI review flagged 3 clauses in section 4 — liability cap is below threshold.", side: "right", color: "bg-gradient-to-br from-indigo-600 to-purple-600 text-white border-transparent" },
    { from: "Vendor (Acme IT)", text: "Our legal team will send a redline by EOD.", side: "left",  color: "bg-blue-50 border-blue-100 text-blue-900" },
  ];
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-sky-100 overflow-hidden animate-float animation-delay-400">
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" />
          <span className="ml-2 text-xs font-semibold text-slate-400">Vendor Collaboration</span>
        </div>
        <span className="text-[10px] bg-green-900/40 text-green-400 font-semibold px-2 py-0.5 rounded-full border border-green-700/30 flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse inline-block" /> Live
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
          <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Building2 className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-xs font-bold text-gray-800">Acme IT Services — Contract Review</span>
          <span className="ml-auto text-[9px] bg-yellow-50 text-yellow-700 font-semibold px-2 py-0.5 rounded-full border border-yellow-100">Under Review</span>
        </div>
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col gap-0.5 ${m.side === "right" ? "items-end" : "items-start"}`}>
            <span className="text-[9px] text-gray-400 px-1">{m.from}</span>
            <div className={`rounded-2xl px-3 py-2 text-[11px] max-w-[85%] border shadow-sm ${m.color}`}>{m.text}</div>
          </div>
        ))}
        <div className="flex gap-2 items-center pt-2 border-t border-gray-100">
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-[10px] text-gray-400">Reply to vendor…</div>
          <div className="w-7 h-7 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center shadow-sm"><Send className="w-3 h-3 text-white" /></div>
        </div>
      </div>
    </div>
  );
}

function FrameworkMarquee() {
  const doubled = [...ALL_FRAMEWORKS, ...ALL_FRAMEWORKS];
  return (
    <div className="overflow-hidden py-3" style={{ WebkitMaskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)", maskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)" }}>
      <div className="flex gap-3 animate-marquee">
        {doubled.map((fw, i) => (
          <span key={i} className="inline-flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium px-4 py-2 rounded-xl flex-shrink-0 hover:bg-slate-700 hover:text-white transition-colors">
            <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
            {fw}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    function onScroll() {
      const el = document.documentElement;
      setProgress(el.scrollTop / (el.scrollHeight - el.clientHeight));
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-[3px] bg-transparent pointer-events-none">
      <div
        className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-none"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}

export default function LandingView() {
  const typeword = useTypewriter(["security teams", "CISOs", "risk managers", "compliance officers", "modern enterprises"]);

  return (
    <div className="min-h-screen bg-[#f0f9ff] text-gray-900">
      <ScrollProgress />

      <PublicNav links={[
        { to: "#how-it-works", label: "How it works", hash: true },
        { to: "/features-landing", label: "Features" },
        { to: "/solutions", label: "Solutions" },
        { to: "#frameworks", label: "Frameworks", hash: true },
        { to: "/faq", label: "FAQ" },
      ]} />

      <section className="relative pt-28 sm:pt-32 pb-16 sm:pb-24 px-4 sm:px-6 text-center overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none [background-image:linear-gradient(rgba(99,102,241,.2)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,.2)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-sky-100/80 via-[#f0f9ff]/90 to-[#f0f9ff] pointer-events-none" />
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-blue-300/30 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute top-20 -right-24 w-[400px] h-[400px] bg-indigo-300/25 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-[350px] h-[350px] bg-cyan-300/20 rounded-full blur-3xl animate-blob animation-delay-4000 pointer-events-none" />

        <div className="relative max-w-4xl mx-auto">
          <div className="animate-fade-in-up inline-flex items-center gap-2 bg-white/80 border border-blue-200 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 shadow-sm backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5 text-yellow-500 animate-pulse" />
            70+ compliance frameworks · On-premise AI · Zero data egress
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          </div>

          <h1 className="animate-fade-in-up animation-delay-200 text-4xl sm:text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            Enterprise GRC for{" "}
            <br className="hidden sm:block" />
            <span className="gradient-text-animated">{typeword}</span>
            <span className="typing-cursor" />
          </h1>

          <p className="animate-fade-in-up animation-delay-400 text-lg sm:text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            One platform for risk management, compliance tracking, audit workflows,
            policy governance, and vendor risk — powered by private AI that never
            leaves your infrastructure.
          </p>

          <div className="animate-fade-in-up animation-delay-600 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/register"
              className="glow-btn flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold px-8 py-4 rounded-2xl transition-all text-base shadow-lg shadow-blue-500/30"
            >
              Start 14-day free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 bg-white/80 backdrop-blur-sm border border-sky-200 text-gray-700 hover:bg-white font-semibold px-8 py-4 rounded-2xl transition-all text-base hover:-translate-y-0.5 shadow-sm"
            >
              Sign in to dashboard <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="animate-fade-in-up animation-delay-800 mt-4 text-xs text-gray-400">No credit card required · 14-day free trial · Cancel anytime</p>

          <div className="animate-fade-in-up animation-delay-1000 mt-14 grid grid-cols-3 gap-4 max-w-md mx-auto">
            {[
              { value: 70, suffix: "+", label: "Frameworks" },
              { value: 3500, suffix: "+", label: "Controls mapped" },
              { value: 60, suffix: "%", label: "Faster audits" },
            ].map(s => (
              <div key={s.label} className="text-center glass-card rounded-2xl py-4 px-2 border border-white/80 shadow-sm">
                <p className="text-2xl sm:text-3xl font-extrabold text-gray-900">
                  <CountUp to={s.value} suffix={s.suffix} />
                </p>
                <p className="text-[11px] text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <Reveal direction="left">
              <div className="inline-flex items-center gap-2 text-blue-600 text-xs font-semibold bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full mb-4">
                <BarChart2 className="w-3.5 h-3.5" /> Command Center
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4">Your entire GRC posture at a glance</h2>
              <p className="text-gray-500 leading-relaxed mb-6">
                Real-time visibility into every domain — compliance scores, open risks, contract deadlines, audit progress, and policy attestation rates — all in one screen.
              </p>
              <ul className="space-y-3">
                {["Live compliance score per framework","Critical risk and contract expiry alerts","Audit completion and finding status","Framework coverage progress bars","Role-specific views for each team member"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="w-3 h-3 text-green-600" />
                    </span>
                    {f}
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

      <section id="how-it-works" className="py-24 px-4 sm:px-6 bg-[#f0f9ff]">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 text-indigo-600 text-xs font-semibold bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-full mb-4">
                <Zap className="w-3.5 h-3.5" /> Quick setup
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">How GRCEye works</h2>
              <p className="text-gray-500 max-w-xl mx-auto">From setup to board report in three straightforward steps.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((step, i) => (
              <Reveal key={step.step} delay={i * 150}>
                <div className="relative bg-white rounded-2xl p-7 border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all h-full">
                  {i < HOW_IT_WORKS.length - 1 && (
                    <div className="hidden md:block absolute top-10 left-[calc(100%+1rem)] w-8 h-0.5 bg-gradient-to-r from-blue-300 to-indigo-300" />
                  )}
                  <div className={`w-14 h-14 bg-gradient-to-br ${step.color} rounded-2xl flex items-center justify-center mb-5 shadow-lg`}>
                    <step.icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-xs font-black text-gray-300 mb-1 tracking-widest">{step.step}</div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{step.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="modules" className="py-24 px-4 sm:px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-16">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">Every module, purpose-built</h2>
              <p className="text-gray-500 max-w-xl mx-auto">GRCEye covers the full lifecycle. See what each module looks like in practice.</p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left">
              <div className="inline-flex items-center gap-2 text-red-600 text-xs font-semibold bg-red-50 border border-red-100 px-3 py-1.5 rounded-full mb-4">
                <AlertTriangle className="w-3.5 h-3.5" /> Risk Management
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">Quantify and treat risk — not just log it</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Go beyond basic risk registers. GRCEye combines a visual 5×5 heatmap with Monte Carlo simulation, producing ALE, SLE, P90/P95 figures your board can act on.</p>
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left" delay={100} className="order-2 md:order-1"><ComplianceMockup /></Reveal>
            <Reveal direction="right" className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 text-blue-600 text-xs font-semibold bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full mb-4">
                <CheckCircle className="w-3.5 h-3.5" /> Compliance & Frameworks
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">70+ frameworks, one assessment workflow</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Run simultaneous assessments across ISO 27001, SOC 2, GDPR, PCI DSS, and any other framework. Evidence uploaded once applies to all mapped controls.</p>
              <ul className="space-y-2">
                {["70+ built-in frameworks with pre-mapped controls","AI-powered gap analysis with remediation guidance","Cross-framework evidence reuse — no duplication","Customizable frameworks: fork, edit, add controls","Auditor portal with scoped, read-only access"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left">
              <div className="inline-flex items-center gap-2 text-purple-600 text-xs font-semibold bg-purple-50 border border-purple-100 px-3 py-1.5 rounded-full mb-4">
                <ClipboardList className="w-3.5 h-3.5" /> Audit Management
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">Full audit lifecycle from planning to report</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Manage internal and external audits end-to-end. Assign auditors, build control checklists, record findings, track remediation, and generate PDF reports.</p>
              <ul className="space-y-2">
                {["Internal and external audit types","Auditor portal: scoped to assigned audits only","Finding severity: Critical / High / Medium / Low","Remediation tracking with owner assignment","One-click PDF audit report generation"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal direction="right" delay={100}><AuditMockup /></Reveal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left" delay={100} className="order-2 md:order-1"><PolicyMockup /></Reveal>
            <Reveal direction="right" className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 text-orange-600 text-xs font-semibold bg-orange-50 border border-orange-100 px-3 py-1.5 rounded-full mb-4">
                <FileText className="w-3.5 h-3.5" /> Policy & Document Management
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">AI-generated policies, versioned and attested</h3>
              <p className="text-gray-500 leading-relaxed mb-4">Stop writing policies from scratch. GRCEye's AI generates 29 audit-ready document types — tailored to your organization's industry, size, and frameworks — in seconds.</p>
              <ul className="space-y-2">
                {["AI generates 29 document types in seconds","Full version history with approval tracking","Employee attestation with email reminders","Policy approval workflow before publishing","Link policies to framework controls"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left" delay={100} className="order-2 md:order-1"><AIMockup /></Reveal>
            <Reveal direction="right" className="order-1 md:order-2">
              <div className="inline-flex items-center gap-2 text-indigo-600 text-xs font-semibold bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-full mb-4">
                <Cpu className="w-3.5 h-3.5" /> On-Premise AI
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">Powerful AI — entirely inside your infrastructure</h3>
              <p className="text-gray-500 leading-relaxed mb-4">GRCEye's AI runs on Ollama inside your own servers. Your contracts, policies, and compliance data never touch an external API.</p>
              <ul className="space-y-2">
                {["Document generator: 29 GRC document types","Contract clause analysis: 6-section structured review","Vendor prescreen: 15-question AI questionnaire","Compliance gap analysis with remediation suggestions","GRC assistant chatbot for instant guidance"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <Reveal direction="left">
              <div className="inline-flex items-center gap-2 text-violet-600 text-xs font-semibold bg-violet-50 border border-violet-100 px-3 py-1.5 rounded-full mb-4">
                <MessageSquare className="w-3.5 h-3.5" /> Vendor Risk (TPRM)
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">Close vendor contracts faster with real-time collaboration</h3>
              <p className="text-gray-500 leading-relaxed mb-4">The vendor module handles the full third-party risk lifecycle — from onboarding and AI prescreening through contract review, CISO approval, and ongoing monitoring.</p>
              <ul className="space-y-2">
                {["Vendor onboarding with risk tiers: Critical / High / Medium / Low","AI prescreen: 15-question analysis before onboarding","Contract upload → AI review → CISO approval workflow","Risk cartography: 6-dimension visual heatmap per vendor"].map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />{f}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal direction="right" delay={100}><VendorChatMockup /></Reveal>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 sm:px-6 bg-[#f0f9ff]">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">Built for every role on your team</h2>
              <p className="text-gray-500 max-w-xl mx-auto">9 built-in roles with tailored access. Each person sees exactly what they need.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {ROLES.map(({ icon: Icon, title, color, desc }, i) => (
              <Reveal key={title} delay={i * 100}>
                <div className="gradient-border bg-white rounded-2xl p-6 card-hover h-full">
                  <div className={`w-12 h-12 bg-gradient-to-br ${color} rounded-2xl flex items-center justify-center mb-4 shadow-lg`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-slate-900" />
        <div className="absolute inset-0 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.15)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-white/5 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-indigo-400/10 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="relative max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center text-white">
            {[
              { icon: Shield,     to: 70,   suffix: "+", label: "Compliance frameworks",   sub: "pre-loaded controls & crosswalks" },
              { icon: Activity,   to: 3500, suffix: "+", label: "Pre-mapped controls",      sub: "across all frameworks" },
              { icon: TrendingUp, to: 60,   suffix: "%", label: "Faster audit prep",        sub: "vs. manual spreadsheet work" },
              { icon: Database,   to: 0,    suffix: "",  label: "Data sent to external AI", sub: "on-premise model, zero egress" },
            ].map((s, i) => (
              <Reveal key={s.label} delay={i * 120}>
                <div className="glass-card rounded-2xl px-4 py-6 border border-white/20">
                  <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center mx-auto mb-4">
                    <s.icon className="w-5 h-5 text-blue-200" />
                  </div>
                  <p className="text-3xl sm:text-4xl font-black mb-1">
                    <CountUp to={s.to} suffix={s.suffix} />
                  </p>
                  <p className="text-sm font-semibold text-blue-100 mb-0.5">{s.label}</p>
                  <p className="text-xs text-blue-300/70">{s.sub}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-24 px-4 sm:px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">Everything your GRC team needs</h2>
              <p className="text-gray-500 max-w-xl mx-auto">From risk to compliance to audit — one integrated workflow, no spreadsheets required.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc, color, bg, text }, i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="gradient-border bg-white rounded-2xl p-6 card-hover h-full group cursor-default">
                  <div className={`w-12 h-12 ${bg} rounded-2xl flex items-center justify-center mb-4 group-hover:bg-gradient-to-br group-hover:${color} transition-all duration-300`}>
                    <Icon className={`w-5 h-5 ${text} group-hover:text-white transition-colors duration-300`} />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">{title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={200}>
            <div className="mt-10 flex flex-wrap justify-center gap-2">
              {["Activity Log","Webhook Events","CSV Export/Import","Trust Center","Regulatory Updates","Incident Management","Vulnerability Tracking","Threat Library","Applied Controls","Security Exceptions","Risk Quantification (Monte Carlo)","Multi-tenant Isolation"].map(cap => (
                <span key={cap} className="text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors cursor-default">
                  {cap}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section id="frameworks" className="py-24 px-4 sm:px-6 bg-slate-950 overflow-hidden">
        <div className="max-w-5xl mx-auto text-center mb-12">
          <Reveal>
            <div className="inline-flex items-center gap-2 text-blue-400 text-xs font-semibold bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-full mb-4">
              <BookOpen className="w-3.5 h-3.5" /> Framework Library
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-3">Built for every framework</h2>
            <p className="text-slate-400 max-w-xl mx-auto">Pre-loaded with controls, crosswalk mappings, and evidence requirements for 70+ global frameworks.</p>
          </Reveal>
        </div>

        <div className="space-y-4 mb-12">
          <FrameworkMarquee />
          <div className="overflow-hidden" style={{ WebkitMaskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)", maskImage: "linear-gradient(to right, transparent, black 10%, black 90%, transparent)" }}>
            <div className="flex gap-3 animate-marquee-rev">
              {[...ALL_FRAMEWORKS.slice(8), ...ALL_FRAMEWORKS, ...ALL_FRAMEWORKS.slice(0, 8)].map((fw, i) => (
                <span key={i} className="inline-flex items-center gap-2 bg-slate-800 border border-slate-700 text-slate-400 text-sm font-medium px-4 py-2 rounded-xl flex-shrink-0 hover:text-white transition-colors">
                  <span className="w-2 h-2 bg-indigo-500 rounded-full flex-shrink-0" />{fw}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-5">
          {[
            { icon: Lock,  label: "ISO/IEC certified",  value: "ISO 27001 · ISO 27002 · ISO 42001", color: "from-blue-500 to-indigo-600" },
            { icon: Award, label: "Regulatory",         value: "GDPR · HIPAA · PCI DSS · DORA · NIS2", color: "from-purple-500 to-pink-600" },
            { icon: Globe, label: "Industry standards", value: "SOC 2 · CIS v8 · NIST · CSA CCM", color: "from-teal-500 to-cyan-600" },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 100}>
              <div className="bg-slate-800 rounded-2xl p-5 text-left border border-slate-700 hover:border-slate-600 hover:bg-slate-700/60 transition-all">
                <div className="w-9 h-9 bg-slate-700 rounded-xl flex items-center justify-center mb-3">
                  <s.icon className="w-4 h-4 text-slate-300" />
                </div>
                <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                <p className="text-sm font-semibold text-white leading-snug">{s.value}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="py-24 px-4 sm:px-6 bg-[#f0f9ff]">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2 text-yellow-600 text-xs font-semibold bg-yellow-50 border border-yellow-100 px-3 py-1.5 rounded-full mb-4">
                <Star className="w-3.5 h-3.5 fill-yellow-500 text-yellow-500" /> Customer stories
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">Trusted by security teams</h2>
              <p className="text-gray-500">From fast-growing startups to regulated enterprises.</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 120}>
                <div className="gradient-border bg-white rounded-2xl p-6 card-hover h-full flex flex-col">
                  <div className="flex gap-0.5 mb-4">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed mb-5 flex-1">&quot;{t.quote}&quot;</p>
                  <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                    <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center text-white text-xs font-bold shadow-sm flex-shrink-0`}>
                      {t.initials}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-500">{t.role}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 text-center mb-12">Explore further</h2>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { to: "/features-landing", title: "Features",  icon: Zap,          desc: "Deep-dive into every module — Risk, Compliance, Audit, Policy, Vendor, AI, and Governance.", cta: "Explore features →", color: "from-blue-500 to-indigo-600" },
              { to: "/solutions",        title: "Solutions", icon: Building2,     desc: "GRCEye for SaaS, Healthcare, FinTech, and Enterprise — use cases and workflows by industry.", cta: "View solutions →", color: "from-purple-500 to-pink-600" },
              { to: "/blog",             title: "Blog",      icon: FileText,      desc: "Insights on compliance strategy, risk management, and best practices from the GRCEye team.", cta: "Read articles →", color: "from-teal-500 to-cyan-600" },
              { to: "/faq",              title: "FAQ",       icon: MessageSquare, desc: "Common questions about GRCEye features, deployment, and getting started.", cta: "View FAQ →", color: "from-orange-500 to-amber-500" },
            ].map((item, i) => (
              <Reveal key={item.title} delay={i * 80}>
                <Link href={item.to} className="group gradient-border bg-white rounded-2xl p-7 card-hover block h-full">
                  <div className={`w-10 h-10 bg-gradient-to-br ${item.color} rounded-xl flex items-center justify-center mb-4 shadow-md group-hover:scale-110 transition-transform`}>
                    <item.icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors mb-2">{item.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed mb-4">{item.desc}</p>
                  <span className="text-blue-600 font-semibold text-xs flex items-center gap-1 group-hover:gap-2 transition-all">
                    {item.cta}
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative py-28 px-4 sm:px-6 overflow-hidden">
        <div className="absolute inset-0 bg-blue-600" />
        <div className="absolute inset-0 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.15)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="absolute top-0 left-1/4 w-80 h-80 bg-white/10 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-indigo-300/20 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-3xl animate-blob-slow pointer-events-none" />

        <Reveal>
          <div className="relative max-w-2xl mx-auto text-center text-white">
            <div className="inline-flex items-center gap-2 bg-white/15 border border-white/20 text-white text-xs font-semibold px-4 py-1.5 rounded-full mb-6 backdrop-blur-sm">
              <Sparkles className="w-3.5 h-3.5 text-yellow-300 animate-pulse" />
              14-day free trial · No credit card · Full access
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold mb-4 leading-tight">Start your GRC journey today</h2>
            <p className="text-blue-100 mb-10 text-lg">Join hundreds of security teams who replaced spreadsheets with GRCEye.</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/register"
                className="glow-btn flex items-center justify-center gap-2 bg-white text-blue-700 font-bold px-8 py-4 rounded-2xl hover:bg-blue-50 transition-all text-base shadow-xl"
              >
                Start free trial <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="mailto:sales@grceye.io"
                className="flex items-center justify-center gap-2 bg-white/10 border border-white/30 text-white font-semibold px-8 py-4 rounded-2xl hover:bg-white/20 transition-all text-base backdrop-blur-sm"
              >
                Talk to sales
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      <SupportChat />
      <PublicFooter />
    </div>
  );
}
