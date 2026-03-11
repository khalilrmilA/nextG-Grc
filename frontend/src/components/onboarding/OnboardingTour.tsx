import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  X, ChevronRight, ChevronLeft, SkipForward,
  LayoutDashboard, AlertTriangle, CheckSquare, BookOpen,
  ClipboardList, FileText, Building2, Sparkles, Shield,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";

// ── Visit-count gate ──────────────────────────────────────────────────────────
const MAX_VISITS = 3;

function tourKey(userId: string | undefined): string {
  return userId ? `grc_tour_visits_${userId}` : "grc_tour_visits";
}
function getVisitCount(userId: string | undefined): number {
  return parseInt(localStorage.getItem(tourKey(userId)) ?? "0", 10);
}
function incrementVisitCount(userId: string | undefined): number {
  const next = getVisitCount(userId) + 1;
  localStorage.setItem(tourKey(userId), String(next));
  return next;
}
export function resetTour(userId?: string) {
  localStorage.removeItem(tourKey(userId));
}

// ── Tour step definitions ─────────────────────────────────────────────────────
interface TourStep {
  id: string;
  target: string;          // CSS selector for the element to highlight
  title: string;
  body: string;
  icon: React.ElementType;
  iconColor: string;
  placement: "right" | "left" | "bottom" | "top" | "center";
  route?: string;          // navigate before showing this step
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    target: "",
    title: "Welcome to your GRC Platform!",
    body: "This quick tour walks you through the key sections of the platform. It will only appear for your first 3 visits. You can skip at any time.",
    icon: Shield,
    iconColor: "from-blue-500 to-indigo-600",
    placement: "center",
  },
  {
    id: "dashboard",
    target: 'a[href="/dashboard"]',
    title: "Dashboard",
    body: "Your command center. See overall compliance scores, open risks, recent activity, and quick-action shortcuts at a glance.",
    icon: LayoutDashboard,
    iconColor: "from-blue-500 to-blue-600",
    placement: "right",
    route: "/dashboard",
  },
  {
    id: "risks",
    target: 'a[href="/risks"]',
    title: "Risk Register",
    body: "Log, assess, and track all your organizational risks. Rate by likelihood and impact, assign owners, and monitor treatment plans.",
    icon: AlertTriangle,
    iconColor: "from-orange-500 to-red-500",
    placement: "right",
    route: "/risks",
  },
  {
    id: "compliance",
    target: 'a[href="/compliance"]',
    title: "Compliance",
    body: "Create compliance assessments against any framework (ISO 27001, SOC 2, GDPR…). Upload evidence, run AI gap analysis, and track closure of findings.",
    icon: CheckSquare,
    iconColor: "from-green-500 to-emerald-600",
    placement: "right",
    route: "/compliance",
  },
  {
    id: "frameworks",
    target: 'a[href="/frameworks"]',
    title: "Frameworks Library",
    body: "Browse 73+ built-in frameworks from ISO, NIST, GDPR, PCI DSS, regional laws and more — or build your own custom framework.",
    icon: BookOpen,
    iconColor: "from-purple-500 to-violet-600",
    placement: "right",
    route: "/frameworks",
  },
  {
    id: "audits",
    target: 'a[href="/audits"]',
    title: "Audits",
    body: "Plan and manage internal and external audits. Create auditor accounts, assign assessments, and generate formal audit reports.",
    icon: ClipboardList,
    iconColor: "from-sky-500 to-cyan-600",
    placement: "right",
    route: "/audits",
  },
  {
    id: "policies",
    target: 'a[href="/policies"]',
    title: "Policies",
    body: "Maintain your policy library with versioning and attestation. Use AI to draft new policies directly from control gaps.",
    icon: FileText,
    iconColor: "from-amber-500 to-yellow-600",
    placement: "right",
    route: "/policies",
  },
  {
    id: "vendors",
    target: 'a[href="/vendors"]',
    title: "Vendors (TPRM)",
    body: "Manage third-party vendor risk. Send questionnaires, track responses, and score each vendor's security posture automatically.",
    icon: Building2,
    iconColor: "from-pink-500 to-rose-600",
    placement: "right",
    route: "/vendors",
  },
  {
    id: "ai",
    target: ".ai-assistant-button",
    title: "AI Assistant",
    body: "Click the chat bubble (bottom-right) at any time to ask your built-in AI for help — gap analysis, policy drafts, risk advice, and more.",
    icon: Sparkles,
    iconColor: "from-violet-500 to-purple-600",
    placement: "top",
    route: "/dashboard",
  },
  {
    id: "done",
    target: "",
    title: "You're all set!",
    body: "Start by creating your first compliance assessment — go to Compliance and click 'New Assessment'. Need help later? Visit the Help & Support page anytime.",
    icon: Shield,
    iconColor: "from-green-500 to-emerald-600",
    placement: "center",
    route: "/dashboard",
  },
];

// ── Spotlight dimensions ──────────────────────────────────────────────────────
interface Rect { top: number; left: number; width: number; height: number }
const NONE: Rect = { top: 0, left: 0, width: 0, height: 0 };
const PAD = 8; // spotlight padding around element

function getElementRect(selector: string): Rect {
  if (!selector) return NONE;
  const el = document.querySelector(selector);
  if (!el) return NONE;
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

// ── Tooltip placement ─────────────────────────────────────────────────────────
function tooltipStyle(rect: Rect, placement: TourStep["placement"], vw: number, vh: number): React.CSSProperties {
  const TW = 340; // tooltip width approx
  const TH = 220; // tooltip height approx
  const GAP = 16;

  if (placement === "center" || rect === NONE || (rect.width === 0 && rect.height === 0)) {
    return {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: TW,
    };
  }
  if (placement === "right") {
    const left = Math.min(rect.left + rect.width + GAP, vw - TW - 8);
    const top  = Math.max(8, Math.min(rect.top + rect.height / 2 - TH / 2, vh - TH - 8));
    return { position: "fixed", left, top, width: TW };
  }
  if (placement === "left") {
    const left = Math.max(8, rect.left - TW - GAP);
    const top  = Math.max(8, Math.min(rect.top + rect.height / 2 - TH / 2, vh - TH - 8));
    return { position: "fixed", left, top, width: TW };
  }
  if (placement === "bottom") {
    const top  = rect.top + rect.height + GAP;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - TW / 2, vw - TW - 8));
    return { position: "fixed", top, left, width: TW };
  }
  // top
  const top  = Math.max(8, rect.top - TH - GAP);
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - TW / 2, vw - TW - 8));
  return { position: "fixed", top, left, width: TW };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OnboardingTour() {
  const navigate = useNavigate();
  const userId = useAuthStore((u) => u?.email);
  const [visible, setVisible] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<Rect>(NONE);
  const [animIn, setAnimIn] = useState(false);
  const rafRef = useRef<number | null>(null);

  // ── Mount: check visit count (per user) ─────────────────────────────────────
  useEffect(() => {
    if (!userId) return; // wait until user is loaded
    const visits = incrementVisitCount(userId);
    if (visits <= MAX_VISITS) {
      // small delay so the page renders first
      const t = setTimeout(() => {
        setVisible(true);
        setAnimIn(true);
      }, 800);
      return () => clearTimeout(t);
    }
  }, [userId]);

  // ── Navigate + measure target when step changes ─────────────────────────────
  const step = TOUR_STEPS[stepIdx];

  useEffect(() => {
    if (!visible) return;
    if (step.route) navigate(step.route);
  }, [stepIdx, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const measureTarget = useCallback(() => {
    if (!step.target) { setRect(NONE); return; }
    const r = getElementRect(step.target);
    setRect(r);
  }, [step]);

  useEffect(() => {
    if (!visible) return;
    // poll for a short period after navigation/render
    let attempts = 0;
    function poll() {
      measureTarget();
      attempts++;
      if (attempts < 12) {
        rafRef.current = requestAnimationFrame(poll);
      }
    }
    const t = setTimeout(() => { rafRef.current = requestAnimationFrame(poll); }, 200);
    return () => {
      clearTimeout(t);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [stepIdx, visible, measureTarget]);

  // ── Scroll target into view ─────────────────────────────────────────────────
  useEffect(() => {
    if (!step.target) return;
    const el = document.querySelector(step.target);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [stepIdx, step.target]);

  function dismiss() {
    setAnimIn(false);
    setTimeout(() => setVisible(false), 250);
  }
  function next() {
    if (stepIdx >= TOUR_STEPS.length - 1) { dismiss(); return; }
    setAnimIn(false);
    setTimeout(() => { setStepIdx(s => s + 1); setAnimIn(true); }, 150);
  }
  function prev() {
    if (stepIdx === 0) return;
    setAnimIn(false);
    setTimeout(() => { setStepIdx(s => s - 1); setAnimIn(true); }, 150);
  }

  if (!visible) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isCenter = step.placement === "center" || !step.target;
  const tooltipPos = tooltipStyle(rect, step.placement, vw, vh);
  const { icon: Icon } = { icon: step.icon };
  const isLast = stepIdx === TOUR_STEPS.length - 1;
  const isFirst = stepIdx === 0;
  const progress = ((stepIdx + 1) / TOUR_STEPS.length) * 100;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* ── Dark overlay with spotlight cutout ── */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-auto"
        style={{ cursor: "default" }}
        onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
      >
        <defs>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {!isCenter && rect.width > 0 && (
              <rect
                x={rect.left}
                y={rect.top}
                width={rect.width}
                height={rect.height}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#tour-spotlight-mask)"
          className="backdrop-blur-[1px]"
        />
      </svg>

      {/* ── Spotlight ring ── */}
      {!isCenter && rect.width > 0 && (
        <div
          className="absolute pointer-events-none transition-all duration-300"
          style={{
            top: rect.top - 2,
            left: rect.left - 2,
            width: rect.width + 4,
            height: rect.height + 4,
            borderRadius: 12,
            boxShadow: "0 0 0 3px rgba(99,102,241,0.9), 0 0 20px 4px rgba(99,102,241,0.4)",
          }}
        />
      )}

      {/* ── Tooltip card ── */}
      <div
        className="pointer-events-auto"
        style={{
          ...tooltipPos,
          transition: "opacity 0.2s ease, transform 0.2s ease",
          opacity: animIn ? 1 : 0,
          transform: animIn ? "translateY(0) scale(1)" : "translateY(8px) scale(0.97)",
          zIndex: 10000,
        }}
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-gray-100">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Header */}
          <div className="px-5 pt-4 pb-3 flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.iconColor} flex items-center justify-center flex-shrink-0 shadow-lg`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-gray-900 text-sm leading-snug">{step.title}</p>
                <button
                  type="button"
                  onClick={dismiss}
                  className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Close tour"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Step {stepIdx + 1} of {TOUR_STEPS.length}
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="px-5 pb-4">
            <p className="text-sm text-gray-600 leading-relaxed">{step.body}</p>
          </div>

          {/* Footer */}
          <div className="px-5 pb-4 flex items-center justify-between gap-3">
            {/* Dots */}
            <div className="flex items-center gap-1">
              {TOUR_STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setAnimIn(false); setTimeout(() => { setStepIdx(i); setAnimIn(true); }, 150); }}
                  className={`rounded-full transition-all ${
                    i === stepIdx
                      ? "w-4 h-2 bg-indigo-500"
                      : i < stepIdx
                      ? "w-2 h-2 bg-indigo-300"
                      : "w-2 h-2 bg-gray-200"
                  }`}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              {!isFirst && (
                <button
                  type="button"
                  onClick={prev}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back
                </button>
              )}
              {!isLast && (
                <button
                  type="button"
                  onClick={dismiss}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  Skip
                </button>
              )}
              <button
                type="button"
                onClick={next}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-sm shadow-blue-500/20"
              >
                {isLast ? "Get Started!" : "Next"}
                {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
