"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SupportChat from "@/components/landing/SupportChat";
import PublicNav from "@/components/landing/PublicNav";
import PublicFooter from "@/components/landing/PublicFooter";
import { useI18n } from "@/i18n";
import {
  CheckCircle, ArrowRight, Zap, Lock, BarChart2,
  FileText, Building2, ClipboardList, BookOpen, AlertTriangle,
  Star, Shield, MessageSquare, Sparkles,
  TrendingUp, Activity, Send, Bot, User, Bell, Search,
  Database, Globe, Award, Cpu, ChevronRight, Handshake,
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
  // Seed with the first word in full rather than "" so the H1 is complete in the
  // server-rendered HTML — Googlebot indexes the markup it is served, and an
  // empty span made the <h1> read as a truncated sentence fragment.
  // Client and server both render words[0], so hydration matches; the animation
  // only takes over once `animating` flips on after mount.
  const [displayed, setDisplayed] = useState(words[0]);
  const [typing, setTyping] = useState(true);
  const [animating, setAnimating] = useState(false);

  useEffect(() => { setAnimating(true); }, []);

  useEffect(() => {
    if (!animating) return;
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
  }, [displayed, typing, index, words, pause, animating]);

  return displayed;
}

function CountUp({ to, suffix = "", prefix = "" }: { to: number; suffix?: string; prefix?: string }) {
  // Seed at the final value so the server-rendered HTML carries the real figure
  // ("70+", "3,500+", "60%") instead of "0+". Googlebot does not run the
  // IntersectionObserver, so a 0-seeded counter shipped three meaningless zeros
  // as the page's only hard numbers. Client and server agree on first render;
  // the effect rewinds to 0 and animates only once JS is actually running.
  const [count, setCount] = useState(to);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setCount(0);
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
  { icon: AlertTriangle, key: "risk",       color: "from-red-500 to-rose-600",     bg: "bg-red-50",    text: "text-red-600" },
  { icon: CheckCircle,   key: "compliance", color: "from-blue-500 to-blue-700",    bg: "bg-blue-50",   text: "text-blue-600" },
  { icon: ClipboardList, key: "audit",      color: "from-purple-500 to-indigo-600", bg: "bg-purple-50", text: "text-purple-600" },
  { icon: FileText,      key: "policy",     color: "from-orange-500 to-amber-600", bg: "bg-orange-50", text: "text-orange-600" },
  { icon: Building2,     key: "vendor",     color: "from-indigo-500 to-violet-600", bg: "bg-indigo-50", text: "text-indigo-600" },
  { icon: BarChart2,     key: "reporting",  color: "from-teal-500 to-cyan-600",    bg: "bg-teal-50",   text: "text-teal-600" },
  { icon: BookOpen,      key: "library",    color: "from-green-500 to-emerald-600", bg: "bg-green-50",  text: "text-green-600" },
  { icon: Zap,           key: "ai",         color: "from-yellow-500 to-orange-500", bg: "bg-yellow-50", text: "text-yellow-600" },
] as const;

const ALL_FRAMEWORKS = [
  "ISO 27001:2022", "SOC 2 Type II", "GDPR", "PCI DSS 4.0",
  "HIPAA", "NIST CSF 2.0", "NIST 800-53 Rev5", "CIS Controls v8",
  "NIS2 Directive", "DORA", "ISO 42001", "NIST AI RMF",
  "MITRE ATT&CK", "CSA CCM", "SOX ITGC", "FedRAMP", "HITRUST",
  "ISO 22301", "COBIT 2019", "ISO 31000", "ISO 27701", "SWIFT CSP",
];

const TESTIMONIALS = [
  { key: "story1", rating: 5, initials: "SK", color: "from-blue-500 to-indigo-600" },
  { key: "story2", rating: 5, initials: "MT", color: "from-purple-500 to-pink-600" },
  { key: "story3", rating: 5, initials: "PS", color: "from-teal-500 to-cyan-600" },
] as const;

const ROLES = [
  { icon: Shield,        key: "ciso",       color: "from-blue-500 to-blue-700"     },
  { icon: AlertTriangle, key: "risk_mgr",   color: "from-red-500 to-rose-600"      },
  { icon: CheckCircle,   key: "comp_mgr",   color: "from-green-500 to-emerald-600" },
  { icon: ClipboardList, key: "auditor",    color: "from-purple-500 to-indigo-600" },
  { icon: FileText,      key: "policy_mgr", color: "from-orange-500 to-amber-600"  },
] as const;

const HOW_IT_WORKS = [
  { step: "01", icon: BookOpen,  k: "step1", color: "from-blue-500 to-indigo-600"   },
  { step: "02", icon: Zap,       k: "step2", color: "from-purple-500 to-pink-600"   },
  { step: "03", icon: BarChart2, k: "step3", color: "from-teal-500 to-cyan-600"     },
] as const;

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
          <p className="text-[10px] font-bold text-gray-700 mb-3">Security Overview: Q2 2026</p>
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
            <span className="text-sm font-bold text-gray-800">Risk Heatmap: Q2 2026</span>
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
    { name: "Access Control Policy", version: "v2.0", status: "Under Review", attestation: "N/A" },
    { name: "Incident Response Plan", version: "v1.5", status: "Published", attestation: "88%" },
    { name: "BYOD & Remote Work Policy", version: "v1.0", status: "Draft", attestation: "N/A" },
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
    { from: "Your Team",        text: "AI review flagged 3 clauses in section 4: liability cap is below threshold.", side: "right", color: "bg-gradient-to-br from-indigo-600 to-purple-600 text-white border-transparent" },
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
          <span className="text-xs font-bold text-gray-800">Acme IT Services: Contract Review</span>
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
  const { t, lang } = useI18n();
  const typeword = useTypewriter([
    t("public.landing.typeword1"),
    t("public.landing.typeword2"),
    t("public.landing.typeword3"),
    t("public.landing.typeword4"),
    t("public.landing.typeword5"),
  ]);

  return (
    <div className="min-h-screen bg-[#f0f9ff] text-gray-900">
      <ScrollProgress />

      <PublicNav />

      <section className="relative pt-12 sm:pt-16 pb-16 sm:pb-24 px-4 sm:px-6 text-center overflow-hidden">
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none [background-image:linear-gradient(rgba(99,102,241,.2)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,.2)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-sky-100/80 via-[#f0f9ff]/90 to-[#f0f9ff] pointer-events-none" />
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-blue-300/30 rounded-full blur-3xl animate-blob pointer-events-none" />
        <div className="absolute top-20 -right-24 w-[400px] h-[400px] bg-indigo-300/25 rounded-full blur-3xl animate-blob animation-delay-2000 pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-[350px] h-[350px] bg-cyan-300/20 rounded-full blur-3xl animate-blob animation-delay-4000 pointer-events-none" />

        <div className="relative max-w-4xl mx-auto">
          <div className="animate-fade-in-up inline-flex items-center gap-2 bg-white/80 border border-blue-200 text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 shadow-sm backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5 text-yellow-500 animate-pulse" />
            {t("public.landing.hero_badge")}
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          </div>

          <h1 className="animate-fade-in-up animation-delay-200 text-4xl sm:text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            {t("public.landing.hero_title_pre")}{" "}
            <br className="hidden sm:block" />
            <span className="gradient-text-animated">{typeword}</span>
            <span className="typing-cursor" />
          </h1>

          <p className="animate-fade-in-up animation-delay-400 text-lg sm:text-xl text-gray-500 leading-relaxed mb-10 max-w-2xl mx-auto">
            {t("public.landing.hero_subtitle")}
          </p>

          <div className="animate-fade-in-up animation-delay-600 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/register"
              className="glow-btn flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold px-8 py-4 rounded-2xl transition-all text-base shadow-lg shadow-blue-500/30"
            >
              {t("public.landing.cta_trial")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 bg-white/80 backdrop-blur-sm border border-sky-200 text-gray-700 hover:bg-white font-semibold px-8 py-4 rounded-2xl transition-all text-base hover:-translate-y-0.5 shadow-sm"
            >
              {t("public.landing.cta_signin")} <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
          </div>
          <p className="animate-fade-in-up animation-delay-800 mt-4 text-xs text-gray-400">{t("public.landing.no_card")}</p>

          <div className="animate-fade-in-up animation-delay-1000 mt-14 grid grid-cols-3 gap-4 max-w-md mx-auto">
            {[
              { value: 70, suffix: "+", label: t("public.landing.stat_frameworks") },
              { value: 3500, suffix: "+", label: t("public.landing.stat_controls") },
              { value: 60, suffix: "%", label: t("public.landing.stat_faster") },
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
                <BarChart2 className="w-3.5 h-3.5" /> {t("public.landing.command_center")}
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4">{t("public.landing.dashboard_title")}</h2>
              <p className="text-gray-500 leading-relaxed mb-6">
                {t("public.landing.dashboard_desc")}
              </p>
              <ul className="space-y-3">
                {[t("public.landing.dash_b1"), t("public.landing.dash_b2"), t("public.landing.dash_b3"), t("public.landing.dash_b4"), t("public.landing.dash_b5")].map(f => (
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
                <Zap className="w-3.5 h-3.5" /> {t("public.landing.quick_setup")}
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">{t("public.landing.hiw_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.landing.hiw_subtitle")}</p>
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
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{t(`public.landing.hiw_${step.k}`)}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{t(`public.landing.hiw_${step.k}_desc`)}</p>
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
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">{t("public.landing.modules_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.landing.modules_subtitle")}</p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-24 items-center">
            <Reveal direction="left">
              <div className="inline-flex items-center gap-2 text-red-600 text-xs font-semibold bg-red-50 border border-red-100 px-3 py-1.5 rounded-full mb-4">
                <AlertTriangle className="w-3.5 h-3.5" /> {t("public.mod.risk_badge")}
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">{t("public.mod.risk_title")}</h3>
              <p className="text-gray-500 leading-relaxed mb-4">{t("public.mod.risk_desc")}</p>
              <ul className="space-y-2">
                {[t("public.mod.risk_b1"), t("public.mod.risk_b2"), t("public.mod.risk_b3"), t("public.mod.risk_b4"), t("public.mod.risk_b5")].map(f => (
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
                <CheckCircle className="w-3.5 h-3.5" /> {t("public.mod.compliance_badge")}
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">{t("public.mod.compliance_title")}</h3>
              <p className="text-gray-500 leading-relaxed mb-4">{t("public.mod.compliance_desc")}</p>
              <ul className="space-y-2">
                {[t("public.mod.compliance_b1"), t("public.mod.compliance_b2"), t("public.mod.compliance_b3"), t("public.mod.compliance_b4"), t("public.mod.compliance_b5")].map(f => (
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
                <ClipboardList className="w-3.5 h-3.5" /> {t("public.mod.audit_badge")}
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">{t("public.mod.audit_title")}</h3>
              <p className="text-gray-500 leading-relaxed mb-4">{t("public.mod.audit_desc")}</p>
              <ul className="space-y-2">
                {[t("public.mod.audit_b1"), t("public.mod.audit_b2"), t("public.mod.audit_b3"), t("public.mod.audit_b4"), t("public.mod.audit_b5")].map(f => (
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
                <FileText className="w-3.5 h-3.5" /> {t("public.mod.policy_badge")}
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">{t("public.mod.policy_title")}</h3>
              <p className="text-gray-500 leading-relaxed mb-4">{t("public.mod.policy_desc")}</p>
              <ul className="space-y-2">
                {[t("public.mod.policy_b1"), t("public.mod.policy_b2"), t("public.mod.policy_b3"), t("public.mod.policy_b4"), t("public.mod.policy_b5")].map(f => (
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
                <Cpu className="w-3.5 h-3.5" /> {t("public.mod.ai_badge")}
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">{t("public.mod.ai_title")}</h3>
              <p className="text-gray-500 leading-relaxed mb-4">{t("public.mod.ai_desc")}</p>
              <ul className="space-y-2">
                {[t("public.mod.ai_b1"), t("public.mod.ai_b2"), t("public.mod.ai_b3"), t("public.mod.ai_b4"), t("public.mod.ai_b5")].map(f => (
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
                <MessageSquare className="w-3.5 h-3.5" /> {t("public.mod.vendor_badge")}
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">{t("public.mod.vendor_title")}</h3>
              <p className="text-gray-500 leading-relaxed mb-4">{t("public.mod.vendor_desc")}</p>
              <ul className="space-y-2">
                {[t("public.mod.vendor_b1"), t("public.mod.vendor_b2"), t("public.mod.vendor_b3"), t("public.mod.vendor_b4")].map(f => (
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
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">{t("public.landing.roles_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.landing.roles_subtitle")}</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {ROLES.map(({ icon: Icon, key, color }, i) => (
              <Reveal key={key} delay={i * 100}>
                <div className="gradient-border bg-white rounded-2xl p-6 card-hover h-full">
                  <div className={`w-12 h-12 bg-gradient-to-br ${color} rounded-2xl flex items-center justify-center mb-4 shadow-lg`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2">{t(`public.landing.role_${key}`)}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{t(`public.landing.role_${key}_desc`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 bg-slate-950 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.025] [background-image:linear-gradient(rgba(255,255,255,.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.15)_1px,transparent_1px)] [background-size:48px_48px]" />
        <div className="absolute -top-32 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 right-1/4 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-5xl mx-auto">
          <Reveal>
            <p className="text-center text-xs font-bold uppercase tracking-widest text-slate-500 mb-10">{t("public.landing.platform_numbers")}</p>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Shield,     to: 70,   suffix: "+", label: t("public.landing.stats_frameworks_label"), sub: t("public.landing.stats_frameworks_sub"), accent: "from-blue-500 to-indigo-500",   iconBg: "bg-blue-500/15",  iconColor: "text-blue-400"   },
              { icon: Activity,   to: 3500, suffix: "+", label: t("public.landing.stats_controls_label"),   sub: t("public.landing.stats_controls_sub"),   accent: "from-violet-500 to-purple-500", iconBg: "bg-violet-500/15", iconColor: "text-violet-400" },
              { icon: TrendingUp, to: 60,   suffix: "%", label: t("public.landing.stats_faster_label"),     sub: t("public.landing.stats_faster_sub"),     accent: "from-teal-500 to-cyan-500",     iconBg: "bg-teal-500/15",   iconColor: "text-teal-400"   },
              { icon: Database,   to: 0,    suffix: "",  label: t("public.landing.stats_egress_label"),     sub: t("public.landing.stats_egress_sub"),     accent: "from-green-500 to-emerald-500", iconBg: "bg-green-500/15",  iconColor: "text-green-400"  },
            ].map((s, i) => (
              <Reveal key={s.label} delay={i * 100}>
                <div className="relative bg-slate-900 rounded-2xl p-6 border border-slate-800 hover:border-slate-700 transition-colors overflow-hidden group text-center">
                  <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${s.accent}`} />
                  <div className={`w-11 h-11 ${s.iconBg} rounded-xl flex items-center justify-center mx-auto mb-5`}>
                    <s.icon className={`w-5 h-5 ${s.iconColor}`} />
                  </div>
                  <p className={`text-4xl sm:text-5xl font-black mb-2 bg-gradient-to-br ${s.accent} bg-clip-text text-transparent`}>
                    <CountUp to={s.to} suffix={s.suffix} />
                  </p>
                  <p className="text-sm font-semibold text-white mb-1">{s.label}</p>
                  <p className="text-xs text-slate-500 leading-snug">{s.sub}</p>
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
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">{t("public.landing.features_title")}</h2>
              <p className="text-gray-500 max-w-xl mx-auto">{t("public.landing.features_subtitle")}</p>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(({ icon: Icon, key, color, bg, text }, i) => (
              <Reveal key={key} delay={i * 60}>
                <div className="gradient-border bg-white rounded-2xl p-6 card-hover h-full group cursor-default">
                  <div className={`w-12 h-12 ${bg} rounded-2xl flex items-center justify-center mb-4 group-hover:bg-gradient-to-br group-hover:${color} transition-all duration-300`}>
                    <Icon className={`w-5 h-5 ${text} group-hover:text-white transition-colors duration-300`} />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">{t(`public.landing.feat_${key}`)}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{t(`public.landing.feat_${key}_desc`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="frameworks" className="py-24 px-4 sm:px-6 bg-slate-950 overflow-hidden">
        <div className="max-w-5xl mx-auto text-center mb-12">
          <Reveal>
            <div className="inline-flex items-center gap-2 text-blue-400 text-xs font-semibold bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-full mb-4">
              <BookOpen className="w-3.5 h-3.5" /> {t("public.landing.framework_lib")}
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-3">{t("public.landing.framework_title")}</h2>
            <p className="text-slate-400 max-w-xl mx-auto">{t("public.landing.framework_subtitle")}</p>
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
            { icon: Lock,  label: t("public.landing.iso_certified"),      value: "ISO 27001 · ISO 27002 · ISO 42001",   color: "from-blue-500 to-indigo-600" },
            { icon: Award, label: t("public.landing.regulatory"),         value: "GDPR · HIPAA · PCI DSS · DORA · NIS2", color: "from-purple-500 to-pink-600" },
            { icon: Globe, label: t("public.landing.industry_standards"), value: "SOC 2 · CIS v8 · NIST · CSA CCM",       color: "from-teal-500 to-cyan-600" },
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

      <section className="py-24 px-4 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 text-center mb-12">{t("public.landing.explore_title")}</h2>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { to: "/features-landing", title: t("public.nav.features"),  icon: Zap,          desc: t("public.landing.explore_features_desc"),  cta: t("public.landing.explore_features_cta"),  color: "from-blue-500 to-indigo-600" },
              { to: "/solutions",        title: t("public.nav.solutions"), icon: Building2,    desc: t("public.landing.explore_solutions_desc"), cta: t("public.landing.explore_solutions_cta"), color: "from-purple-500 to-pink-600" },
              { to: "/blog",             title: t("public.nav.blog"),      icon: FileText,     desc: t("public.landing.explore_blog_desc"),      cta: t("public.landing.explore_blog_cta"),      color: "from-teal-500 to-cyan-600" },
              { to: "/faq",              title: t("public.nav.faq"),       icon: MessageSquare, desc: t("public.landing.explore_faq_desc"),       cta: t("public.landing.explore_faq_cta"),       color: "from-orange-500 to-amber-500" },
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

      <section className="py-20 px-4 sm:px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-6 py-12 sm:px-14 sm:py-14 text-center shadow-xl">
              <div className="absolute inset-0 opacity-[0.04] pointer-events-none [background-image:linear-gradient(rgba(255,255,255,.2)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.2)_1px,transparent_1px)] [background-size:36px_36px]" />
              <div className="absolute -top-24 -right-24 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 text-white text-xs font-semibold px-4 py-1.5 rounded-full mb-6 backdrop-blur-sm">
                  <Handshake className="w-3.5 h-3.5 text-yellow-300" />
                  Partnerships &amp; Resellers
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
                  Open for partnerships and reseller programs
                </h2>
                <p className="text-slate-300 max-w-2xl mx-auto mb-8 leading-relaxed">
                  We&apos;re actively partnering with consultancies, MSSPs, and resellers who want to bring GRCEye to their clients. Get in touch to talk white-labeling, referral, or reseller terms.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link
                    href={`/${lang}/contact`}
                    className="flex items-center justify-center gap-2 bg-white text-slate-900 font-bold px-7 py-3.5 rounded-2xl hover:bg-slate-100 transition-all text-sm shadow-lg"
                  >
                    Contact Us <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                  </Link>
                  <a
                    href="mailto:partners@grceye.com"
                    className="flex items-center justify-center gap-2 bg-white/10 border border-white/25 text-white font-semibold px-7 py-3.5 rounded-2xl hover:bg-white/20 transition-all text-sm backdrop-blur-sm"
                  >
                    partners@grceye.com
                  </a>
                </div>
              </div>
            </div>
          </Reveal>
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
              {t("public.landing.cta_badge")}
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold mb-4 leading-tight">{t("public.landing.cta_title")}</h2>
            <p className="text-blue-100 mb-10 text-lg">{t("public.landing.cta_subtitle")}</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/register"
                className="glow-btn flex items-center justify-center gap-2 bg-white text-blue-700 font-bold px-8 py-4 rounded-2xl hover:bg-blue-50 transition-all text-base shadow-xl"
              >
                {t("public.landing.cta_trial_btn")} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </Link>
              <a
                href="mailto:sales@grceye.com"
                className="flex items-center justify-center gap-2 bg-white/10 border border-white/30 text-white font-semibold px-8 py-4 rounded-2xl hover:bg-white/20 transition-all text-base backdrop-blur-sm"
              >
                {t("public.landing.cta_sales_btn")}
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
