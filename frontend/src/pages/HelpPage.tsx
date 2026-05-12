import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  HelpCircle, Search, BookOpen, LayoutDashboard, AlertTriangle,
  CheckSquare, ClipboardList, FileText, Building2, BookMarked,
  ChevronDown, ChevronRight, Mail, MessageCircle, Zap,
  Shield, BarChart3, Bot, FolderUp, MousePointerClick,
  ArrowRight, Info,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Section = "getting-started" | "modules" | "faq" | "contact";

type FaqItem    = { q: string; a: string };
type ModuleData = { title: string; summary: string; steps: string[] };
type ImportStep = { nav: string; action: string };
type SetupStep  = { title: string; where: string; desc: string };

// ── Module icon/color metadata (static, not translated) ───────────────────────

const MODULES_META = [
  { id: "dashboard",  icon: LayoutDashboard, color: "bg-blue-50 text-blue-600"   },
  { id: "risks",      icon: AlertTriangle,   color: "bg-orange-50 text-orange-600" },
  { id: "compliance", icon: CheckSquare,     color: "bg-green-50 text-green-600"  },
  { id: "frameworks", icon: BookOpen,        color: "bg-indigo-50 text-indigo-600" },
  { id: "audits",     icon: ClipboardList,   color: "bg-purple-50 text-purple-600" },
  { id: "policies",   icon: FileText,        color: "bg-teal-50 text-teal-600"    },
  { id: "vendors",    icon: Building2,       color: "bg-rose-50 text-rose-600"    },
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

function ModuleCard({ mod }: { mod: typeof MODULES_META[0] & ModuleData }) {
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
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<Section>("getting-started");
  const [searchQuery, setSearchQuery]     = useState("");

  const faqItems    = t("help.faq_items",    { returnObjects: true }) as FaqItem[];
  const modulesData = t("help.modules",      { returnObjects: true }) as Record<string, ModuleData>;
  const importSteps = t("help.import_steps", { returnObjects: true }) as ImportStep[];
  const setupSteps  = t("help.setup_steps",  { returnObjects: true }) as SetupStep[];

  const modules = MODULES_META.map(m => ({ ...m, ...(modulesData[m.id] ?? { title: m.id, summary: "", steps: [] }) }));

  const filteredFaq = (Array.isArray(faqItems) ? faqItems : []).filter(
    item =>
      item.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.a.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const SECTIONS: { id: Section; icon: React.ElementType; label: string }[] = [
    { id: "getting-started", icon: Zap,         label: t("help.getting_started")  },
    { id: "modules",         icon: BookMarked,  label: t("help.module_guides")    },
    { id: "faq",             icon: HelpCircle,  label: t("help.faq")              },
    { id: "contact",         icon: Mail,        label: t("help.contact")          },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <HelpCircle className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t("help.title")}</h1>
          <p className="text-sm text-gray-500">{t("help.subtitle")}</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-8">
        <Search className="absolute left-4 top-3 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); if (e.target.value) setActiveSection("faq"); }}
          placeholder={t("help.search_placeholder")}
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
                <h2 className="text-base font-semibold text-gray-900">{t("help.getting_started")}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{t("help.getting_started_subtitle")}</p>
              </div>

              {/* ── HOW TO IMPORT DOCUMENTS ── highlighted box */}
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FolderUp className="w-5 h-5 text-blue-600" />
                  <p className="font-bold text-blue-900 text-sm">{t("help.how_to_import")}</p>
                  <Info className="w-4 h-4 text-blue-400" />
                </div>
                <ol className="space-y-2.5">
                  {(Array.isArray(importSteps) ? importSteps : []).map((s, i) => (
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
                  {t("help.go_to_compliance")} <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Full setup steps */}
              <div className="space-y-3">
                {(() => {
                  const STEP_ICONS = [Shield, FolderUp, Bot, BarChart3, BookMarked, AlertTriangle, FileText, Building2];
                  const STEP_COLORS = ["bg-blue-100 text-blue-600", "bg-purple-100 text-purple-600", "bg-orange-100 text-orange-600", "bg-green-100 text-green-600", "bg-teal-100 text-teal-600", "bg-red-100 text-red-600", "bg-indigo-100 text-indigo-600", "bg-rose-100 text-rose-600"];
                  return (Array.isArray(setupSteps) ? setupSteps : []).map(({ title, where, desc }, idx) => {
                    const Icon  = STEP_ICONS[idx] ?? Shield;
                    const color = STEP_COLORS[idx] ?? "bg-gray-100 text-gray-600";
                    return (
                      <div key={idx} className="flex gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-colors">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-gray-400">{t("help.step_label")} {idx + 1}</span>
                            <span className="inline-flex items-center gap-1 bg-gray-100 rounded px-1.5 py-0.5 text-xs font-mono text-gray-600">
                              <MousePointerClick className="w-3 h-3" /> {where}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-gray-900 mt-0.5">{title}</p>
                          <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* ── Module Guides ── */}
          {activeSection === "modules" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{t("help.module_guides")}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{t("help.faq_subtitle")}</p>
              </div>
              {modules.map(mod => <ModuleCard key={mod.id} mod={mod} />)}
            </div>
          )}

          {/* ── FAQ ── */}
          {activeSection === "faq" && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  {t("help.faq")}
                  {searchQuery && <span className="ml-2 text-sm font-normal text-gray-400">— {filteredFaq.length} {t("help.results_for")} "{searchQuery}"</span>}
                </h2>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl px-5">
                {filteredFaq.length > 0
                  ? filteredFaq.map((item, i) => <FaqItem key={i} q={item.q} a={item.a} />)
                  : <p className="py-8 text-center text-sm text-gray-400">{t("help.no_results")} "{searchQuery}"</p>
                }
              </div>
            </div>
          )}

          {/* ── Contact ── */}
          {activeSection === "contact" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{t("help.contact")}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{t("help.contact_subtitle")}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 bg-white border border-gray-200 rounded-xl hover:border-blue-300 transition-colors cursor-pointer">
                  <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center mb-3">
                    <Mail className="w-4 h-4 text-blue-600" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{t("help.email_support")}</p>
                  <p className="text-xs text-gray-500 mt-1">{t("help.email_support_desc")}</p>
                  <p className="text-xs text-blue-600 mt-2 font-medium">support@grcplatform.com</p>
                </div>
                <div className="p-5 bg-white border border-gray-200 rounded-xl hover:border-blue-300 transition-colors cursor-pointer">
                  <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center mb-3">
                    <MessageCircle className="w-4 h-4 text-green-600" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{t("help.live_chat")}</p>
                  <p className="text-xs text-gray-500 mt-1">{t("help.live_chat_desc")}</p>
                  <p className="text-xs text-green-600 mt-2 font-medium">{t("help.live_chat_action")}</p>
                </div>
              </div>

              {/* Submit a ticket */}
              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                <p className="text-sm font-semibold text-gray-800">{t("help.submit_ticket")}</p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("help.ticket_subject")}</label>
                  <input type="text" placeholder={t("help.ticket_subject_placeholder")}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("help.ticket_category")}</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option>{t("help.ticket_cat_technical")}</option>
                    <option>{t("help.ticket_cat_billing")}</option>
                    <option>{t("help.ticket_cat_feature")}</option>
                    <option>{t("help.ticket_cat_compliance")}</option>
                    <option>{t("help.ticket_cat_account")}</option>
                    <option>{t("help.ticket_cat_other")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("help.ticket_description")}</label>
                  <textarea rows={4} placeholder={t("help.ticket_description_placeholder")}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>
                <button type="button"
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
                  <Mail className="w-4 h-4" />
                  {t("help.ticket_submit")}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
