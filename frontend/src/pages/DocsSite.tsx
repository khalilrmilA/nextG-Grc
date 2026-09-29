/**
 * /docs — the product documentation, laid out as a standalone docs site
 * (GitBook-style): top bar with search, section tree on the left, article in
 * the middle, "On this page" on the right, previous/next at the bottom.
 *
 * Content: the per-module user guide lives in src/kb (en/fr/ar); training and
 * service-level pages come from the `docs.*` i18n keys that the old
 * Documentation page rendered. Replaces /knowledge-base and /documentation,
 * which now redirect here.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Search, Menu, X, ChevronRight, ChevronLeft, ArrowLeft, ArrowRight, Moon, Sun,
  Lightbulb, BookOpen, Rocket, GraduationCap, FileText, UserCog, ExternalLink,
  LayoutDashboard, Boxes, Bug, CheckSquare, ClipboardList, Building2, Scale, ClipboardCheck,
  Target, Radar, Siren, ShieldCheck,
} from "lucide-react";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useAuthStore } from "../store/auth";
import { articlesFor } from "../kb";
import type { KbArticle } from "../kb/types";
import { LANGUAGES, saveLanguage, applyDirection, type Language } from "../i18n";

// ── Page model ────────────────────────────────────────────────────────────────

type DocSection = {
  heading: string;
  body?: string;
  steps?: string[];
  bullets?: string[];
  tips?: string[];
  table?: { head: string[]; rows: string[][] };
};
type DocPage = {
  id: string;
  title: string;
  summary: string;
  crumb: string;          // section label shown above the title
  route?: string;         // in-app page this documents
  sections: DocSection[];
  cards?: { id: string; title: string; summary: string; Icon?: React.ElementType; image?: string }[];
  keywords?: string[];
  image?: string;         // screenshot of the page, shown under the summary
};

type NavNode =
  | { kind: "page"; id: string; title: string; Icon?: React.ElementType }
  | { kind: "heading"; label: string }
  | { kind: "group"; id: string; title: string; children: { id: string; title: string }[] };

const USER_GROUPS: { id: string; Icon: React.ElementType }[] = [
  { id: "overview", Icon: LayoutDashboard },
  { id: "assets", Icon: Boxes },
  { id: "risk", Icon: Target },
  { id: "vulnerability", Icon: Bug },
  { id: "threat", Icon: Radar },
  { id: "incident", Icon: Siren },
  { id: "compliance", Icon: CheckSquare },
  { id: "controls", Icon: ShieldCheck },
  { id: "audit", Icon: ClipboardList },
  { id: "documents", Icon: FileText },
  { id: "third_parties", Icon: Building2 },
  { id: "governance", Icon: Scale },
  { id: "reporting", Icon: ClipboardCheck },
];

// Inline markup: `code` and **bold** (same convention as the KB content).
function fmt(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`"))
      out.push(<code key={m.index} className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-[0.85em] font-mono">{tok.slice(1, -1)}</code>);
    else out.push(<strong key={m.index} className="font-semibold text-gray-900 dark:text-slate-100">{tok.slice(2, -2)}</strong>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// Screenshots live in public/assets/docs/<lang>/<article id>.webp, one per
// article and language, captured from the demo tenant (never client data).
const SHOT_LANGS = ["en", "fr", "ar"];
function shot(lang: string, id: string): string {
  const l = SHOT_LANGS.includes(lang) ? lang : "en";
  return `/assets/docs/${l}/${id}.webp`;
}

function fromKb(a: KbArticle, crumb: string, lang: string): DocPage {
  return { id: a.id, title: a.title, summary: a.summary, crumb, route: a.route, sections: a.sections, keywords: a.keywords, image: shot(lang, a.id) };
}

function asList(v: unknown): any[] { return Array.isArray(v) ? v : []; }

// ── Build the whole site for the current language ─────────────────────────────

function useDocs() {
  const { t, i18n } = useTranslation();
  const articles = articlesFor(i18n.language);
  const lang = (i18n.language || "en").split("-")[0];

  return useMemo(() => {
    const pages: Record<string, DocPage> = {};
    const nav: NavNode[] = [];
    const groupName = (g: string) => t(`navgroup.${g}` as never, g) as string;
    const byGroup = (g: string) => articles.filter(a => a.group === g);
    const S = (k: string, d: string) => t(`docsite.${k}` as never, d) as string;

    // Introduction — an overview page of cards.
    const userGuideCards = USER_GROUPS.filter(g => byGroup(g.id).length > 0).map(g => ({
      id: `section-${g.id}`, title: groupName(g.id), Icon: g.Icon,
      summary: byGroup(g.id).map(a => a.title).join(" · "),
    }));
    pages["introduction"] = {
      id: "introduction", crumb: S("intro_crumb", "Welcome"),
      title: S("intro_title", "GRCeye documentation"),
      summary: S("intro_summary", "Everything you need to run governance, risk and compliance on GRCeye — from your first login to audits, third parties and reporting."),
      sections: [],
      image: shot(lang, "dashboard"),
      cards: [
        { id: "getting-started", title: articles.find(a => a.id === "getting-started")?.title ?? "Getting started", summary: S("card_start", "Sign in, find your way around and set up your first week."), Icon: Rocket },
        ...userGuideCards,
        { id: "section-account", title: S("account", "Account & administration"), summary: byGroup("account").map(a => a.title).join(" · "), Icon: UserCog },
        { id: "training", title: t("docs.tab_training", "Training") as string, summary: S("card_training", "The two-day training programme for administrators and GRC teams."), Icon: GraduationCap },
        { id: "sla", title: t("docs.tab_sla", "Service Level (SLA)") as string, summary: S("card_sla", "Availability, support response times, backup and recovery commitments."), Icon: FileText },
      ],
    };
    nav.push({ kind: "page", id: "introduction", title: pages["introduction"].title, Icon: BookOpen });

    const gs = articles.find(a => a.id === "getting-started");
    if (gs) {
      pages[gs.id] = fromKb(gs, S("getting_started", "Getting started"), lang);
      nav.push({ kind: "page", id: gs.id, title: gs.title, Icon: Rocket });
    }

    // User guide — one collapsible group per sidebar menu, each with an overview page.
    nav.push({ kind: "heading", label: S("user_guide", "User guide") });
    for (const g of USER_GROUPS) {
      const list = byGroup(g.id);
      if (list.length === 0) continue;
      const name = groupName(g.id);
      pages[`section-${g.id}`] = {
        id: `section-${g.id}`, crumb: S("user_guide", "User guide"), title: name,
        summary: S("group_summary", "Guides for every page in this part of the platform."),
        sections: [],
        cards: list.map(a => ({ id: a.id, title: a.title, summary: a.summary, image: shot(lang, a.id) })),
      };
      list.forEach(a => { pages[a.id] = fromKb(a, `${S("user_guide", "User guide")} / ${name}`, lang); });
      nav.push({ kind: "group", id: `section-${g.id}`, title: name, children: list.map(a => ({ id: a.id, title: a.title })) });
    }

    // Account & administration.
    const account = byGroup("account");
    if (account.length) {
      const name = S("account", "Account & administration");
      pages["section-account"] = {
        id: "section-account", crumb: name, title: name,
        summary: S("account_summary", "Your profile, security settings, team management and settings."),
        sections: [], cards: account.map(a => ({ id: a.id, title: a.title, summary: a.summary, image: shot(lang, a.id) })),
      };
      nav.push({ kind: "heading", label: name });
      account.forEach(a => { pages[a.id] = fromKb(a, name, lang); nav.push({ kind: "page", id: a.id, title: a.title }); });
    }

    // Resources — training + SLA, from the docs.* strings.
    const resources = S("resources", "Resources");
    const toSections = (arr: any[]): DocSection[] => arr.map((sec: any) => ({ heading: String(sec.h ?? ""), bullets: asList(sec.items).map(String) }));
    pages["training"] = {
      id: "training", crumb: resources, title: t("docs.tab_training", "Training") as string,
      summary: S("training_summary", "How your teams are trained to run the platform independently."),
      sections: toSections(asList(t("docs.training", { returnObjects: true }))),
    };
    const slaSections = toSections(asList(t("docs.sla", { returnObjects: true })));
    const slaRaw = asList(t("docs.sla", { returnObjects: true }));
    slaRaw.forEach((sec: any, i: number) => {
      if (sec?.table) slaSections[i].table = {
        head: asList(t("docs.sla_thead", { returnObjects: true })).map(String),
        rows: asList(t("docs.sla_rows", { returnObjects: true })).map((r: any) => asList(r).map(String)),
      };
    });
    pages["sla"] = {
      id: "sla", crumb: resources, title: t("docs.tab_sla", "Service Level (SLA)") as string,
      summary: String(t("docs.sla_note", "")) || S("sla_summary", "Service commitments for the platform."),
      sections: slaSections,
    };
    nav.push({ kind: "heading", label: resources });
    nav.push({ kind: "page", id: "training", title: pages["training"].title, Icon: GraduationCap });
    nav.push({ kind: "page", id: "sla", title: pages["sla"].title, Icon: FileText });

    // Reading order for previous / next.
    const order: string[] = [];
    for (const n of nav) {
      if (n.kind === "page") order.push(n.id);
      if (n.kind === "group") { order.push(n.id); n.children.forEach(c => order.push(c.id)); }
    }
    return { pages, nav, order };
  }, [articles, t, lang]);
}

// ── Search ────────────────────────────────────────────────────────────────────

type Hit = { id: string; title: string; crumb: string; snippet: string; anchor?: string };

function searchDocs(pages: Record<string, DocPage>, q: string): Hit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: (Hit & { score: number })[] = [];
  for (const p of Object.values(pages)) {
    const head = [p.title, p.summary, ...(p.keywords ?? [])].join(" ").toLowerCase();
    const secTexts = p.sections.map(s => [s.heading, s.body ?? "", ...(s.steps ?? []), ...(s.bullets ?? []), ...(s.tips ?? [])].join(" "));
    const all = head + " " + secTexts.join(" ").toLowerCase();
    if (!words.every(w => all.includes(w))) continue;
    let score = words.filter(w => p.title.toLowerCase().includes(w)).length * 10 + words.filter(w => head.includes(w)).length * 3;
    let snippet = p.summary;
    let anchor: string | undefined;
    const si = secTexts.findIndex(txt => words.some(w => txt.toLowerCase().includes(w)));
    if (si >= 0 && !words.every(w => head.includes(w))) {
      anchor = `sec-${si + 1}`;
      const txt = secTexts[si].replace(/\*\*|`/g, "");
      const pos = Math.max(0, txt.toLowerCase().indexOf(words[0]) - 40);
      snippet = `${p.sections[si].heading} — ${pos > 0 ? "…" : ""}${txt.slice(pos, pos + 140)}…`;
      score += 1;
    }
    hits.push({ id: p.id, title: p.title, crumb: p.crumb, snippet, anchor, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}

function SearchDialog({ pages, onClose, base }: { pages: Record<string, DocPage>; onClose: () => void; base: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const hits = useMemo(() => searchDocs(pages, q), [pages, q]);
  useEffect(() => { setSel(0); }, [q]);

  const go = (h: Hit) => { navigate(`${base}/${h.id}${h.anchor ? `#${h.anchor}` : ""}`); onClose(); };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4" onMouseDown={onClose}>
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 border-b border-gray-100 dark:border-slate-800">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            autoFocus value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && hits[sel]) go(hits[sel]);
              if (e.key === "Escape") onClose();
            }}
            placeholder={t("docsite.search_placeholder", "Search the documentation…") as string}
            className="flex-1 py-4 bg-transparent text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 focus:outline-none"
          />
          <kbd className="text-[10px] font-medium text-gray-400 border border-gray-200 dark:border-slate-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {q && hits.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400 px-3 py-6 text-center">{t("docsite.no_results", "No results for this search.")}</p>}
          {!q && <p className="text-sm text-gray-500 dark:text-slate-400 px-3 py-6 text-center">{t("docsite.search_hint", "Type to search every guide, step and tip.")}</p>}
          {hits.map((h, i) => (
            <button
              key={h.id + (h.anchor ?? "")} type="button" onMouseEnter={() => setSel(i)} onClick={() => go(h)}
              className={`w-full text-start px-3 py-2.5 rounded-xl ${i === sel ? "bg-blue-50 dark:bg-blue-500/10" : ""}`}
            >
              <p className="text-[11px] text-gray-400 dark:text-slate-500">{h.crumb}</p>
              <p className={`text-sm font-medium ${i === sel ? "text-blue-700 dark:text-blue-300" : "text-gray-900 dark:text-slate-100"}`}>{h.title}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2 mt-0.5">{h.snippet.replace(/\*\*|`/g, "")}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Screenshot figure (browser-framed, click to enlarge) ──────────────────────

function Screenshot({ src, alt, route }: { src: string; alt: string; route?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);
  if (failed) return null;
  return (
    <>
      <figure className="mt-8">
        <button type="button" onClick={() => setOpen(true)} className="block w-full text-start rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 shadow-lg shadow-gray-200/60 dark:shadow-black/40 cursor-zoom-in bg-white dark:bg-slate-900">
          <div dir="ltr" className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
            {route && <span className="ms-3 flex-1 max-w-xs truncate rounded-md bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 px-2 py-0.5 text-[11px] text-gray-400">grceye.com{route}</span>}
          </div>
          <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="w-full h-auto block" />
        </button>
      </figure>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 cursor-zoom-out" onClick={() => setOpen(false)}>
          <img src={src} alt={alt} className="max-w-full max-h-full rounded-lg shadow-2xl" />
          <button type="button" aria-label={t("common.close")} className="absolute top-4 end-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"><X className="w-5 h-5" /></button>
        </div>
      )}
    </>
  );
}

// ── Left navigation tree ──────────────────────────────────────────────────────

function SideNav({ nav, current, onNavigate, base }: { nav: NavNode[]; current: string; onNavigate: () => void; base: string }) {
  const { t } = useTranslation();
  const holder = nav.find(n => n.kind === "group" && (n.id === current || n.children.some(c => c.id === current)));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { if (holder && holder.kind === "group") setOpen(o => ({ ...o, [holder.id]: true })); }, [holder]);

  const itemCls = (active: boolean) =>
    `flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-sm transition-colors ${
      active
        ? "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium"
        : "text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-100"
    }`;

  return (
    <nav className="space-y-0.5 text-sm">
      {nav.map((n, i) => {
        if (n.kind === "heading")
          return <p key={i} className="px-3 pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">{n.label}</p>;
        if (n.kind === "page") {
          const Icon = n.Icon;
          return (
            <Link key={n.id} to={`${base}/${n.id}`} onClick={onNavigate} className={itemCls(current === n.id)}>
              {Icon && <Icon className="w-4 h-4 flex-shrink-0 opacity-70" />}<span className="truncate">{n.title}</span>
            </Link>
          );
        }
        const isOpen = !!open[n.id];
        return (
          <div key={n.id}>
            <div className={`${itemCls(current === n.id)} !pe-1`}>
              <Link to={`${base}/${n.id}`} onClick={() => { setOpen(o => ({ ...o, [n.id]: true })); onNavigate(); }} className="flex-1 truncate">{n.title}</Link>
              <button type="button" aria-label={t("docsite.toggle_section")} aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [n.id]: !o[n.id] }))}
                className="p-1 rounded-md hover:bg-gray-200/60 dark:hover:bg-slate-700">
                <ChevronRight className={`w-3.5 h-3.5 transition-transform rtl:rotate-180 ${isOpen ? "rotate-90 rtl:rotate-90" : ""}`} />
              </button>
            </div>
            {isOpen && (
              <div className="ms-4 ps-2 border-s border-gray-200 dark:border-slate-700 my-0.5 space-y-0.5">
                {n.children.map(c => (
                  <Link key={c.id} to={`${base}/${c.id}`} onClick={onNavigate} className={itemCls(current === c.id)}>
                    <span className="truncate">{c.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DocsSite() {
  const { t, i18n } = useTranslation();
  const { locale: localeParam, pageId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { pages, nav, order } = useDocs();

  // /en/docs, /fr/docs, /ar/docs are real routes (see App.tsx) so the docs site
  // has one canonical, indexable URL per language instead of a single URL whose
  // language silently depends on whatever this browser last saved.
  const activeLocale = localeParam && LANGUAGES.some(l => l.code === localeParam) ? (localeParam as Language) : undefined;
  const base = activeLocale ? `/${activeLocale}/docs` : "/docs";

  // An unrecognized first segment isn't a locale — send it to the unprefixed
  // site instead of rendering docs under a bogus locale.
  useEffect(() => {
    if (localeParam && !activeLocale) navigate(`/docs/${pageId ?? "introduction"}`, { replace: true });
  }, [localeParam, activeLocale, pageId, navigate]);

  // URL → language: loading /fr/docs shows French even if this browser last
  // saved a different language.
  useEffect(() => {
    if (activeLocale && activeLocale !== i18n.language) {
      i18n.changeLanguage(activeLocale);
      saveLanguage(activeLocale);
      applyDirection(activeLocale);
    }
  }, [activeLocale, i18n]);

  // Language → URL: switching language from the in-page switcher while on a
  // locale-prefixed URL keeps the URL in sync, instead of leaving it pointed
  // at a locale the page is no longer showing.
  useEffect(() => {
    function onLanguageChanged(lng: string) {
      const code = lng.split("-")[0];
      if (activeLocale && code !== activeLocale && LANGUAGES.some(l => l.code === code)) {
        navigate(location.pathname.replace(/^\/[a-z]{2}\/docs/, `/${code}/docs`) + location.hash, { replace: true });
      }
    }
    i18n.on("languageChanged", onLanguageChanged);
    return () => { i18n.off("languageChanged", onLanguageChanged); };
  }, [activeLocale, i18n, navigate, location.pathname, location.hash]);

  // Signed-in members get "Back to app" (→ the dashboard). Signed-out visitors
  // almost always arrived from the marketing site (e.g. the nav's Docs link),
  // just browsing before deciding to sign up — so their button reads "Go back"
  // and returns them to wherever they came from instead of prompting a login.
  const signedIn = useAuthStore(u => !!u);
  const appLabel = signedIn ? t("docsite.back_to_app", "Back to app") : t("docsite.go_back", "Go back");
  const handleAppNav = () => { if (!signedIn) navigate(-1); };

  const page = pages[pageId ?? "introduction"];
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dark, setDark] = useState<boolean>(() => {
    try { return localStorage.getItem("grc_docs_theme") === "dark"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("grc_docs_theme", dark ? "dark" : "light"); } catch { /* ignore */ } }, [dark]);

  // Unknown page → introduction.
  useEffect(() => { if (!page) navigate(`${base}/introduction`, { replace: true }); }, [page, navigate, base]);

  // Ctrl/⌘ + K opens search.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Page title.
  useEffect(() => {
    if (!page) return;
    const prev = document.title;
    document.title = `${page.title} · GRCeye ${t("docsite.docs", "Docs")}`;
    return () => { document.title = prev; };
  }, [page, t]);

  // Scroll: to the #anchor if any, else to the top on page change.
  useEffect(() => {
    const id = location.hash.replace(/^#/, "");
    if (id) {
      const el = document.getElementById(id);
      if (el) { setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50); return; }
    }
    window.scrollTo({ top: 0 });
  }, [pageId, location.hash]);

  // "On this page" scroll-spy.
  const [activeSec, setActiveSec] = useState<string>("");
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const heads = Array.from(root.querySelectorAll<HTMLElement>("h2[id]"));
    setActiveSec(heads[0]?.id ?? "");
    const obs = new IntersectionObserver(entries => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActiveSec(vis[0].target.id);
    }, { rootMargin: "-72px 0px -70% 0px" });
    heads.forEach(h => obs.observe(h));
    return () => obs.disconnect();
  }, [page]);

  const closeDrawer = useCallback(() => setDrawer(false), []);
  if (!page) return null;

  const idx = order.indexOf(page.id);
  const prev = idx > 0 ? pages[order[idx - 1]] : undefined;
  const next = idx >= 0 && idx < order.length - 1 ? pages[order[idx + 1]] : undefined;
  const toc = page.sections.map((s, i) => ({ id: `sec-${i + 1}`, label: s.heading }));

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-white dark:bg-slate-950 text-gray-800 dark:text-slate-300">
        {/* ── Top bar ── */}
        <header className="sticky top-0 z-40 h-16 border-b border-gray-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur">
          <div className="h-full max-w-[90rem] mx-auto px-4 lg:px-6 flex items-center gap-3">
            <button type="button" onClick={() => setDrawer(true)} className="lg:hidden p-2 -ms-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800" aria-label={t("docsite.menu")}>
              <Menu className="w-5 h-5" />
            </button>
            <Link to={`${base}/introduction`} className="flex items-center gap-2 flex-shrink-0">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold text-sm">G</span>
              <span className="font-semibold text-gray-900 dark:text-white">GRCeye</span>
              <span className="text-gray-400 dark:text-slate-500 font-medium hidden sm:inline">{t("docsite.docs", "Docs")}</span>
            </Link>

            <button type="button" onClick={() => setSearchOpen(true)} aria-label={t("common.search")}
              className="sm:hidden ms-auto p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800">
              <Search className="w-5 h-5" />
            </button>
            <button type="button" onClick={() => setSearchOpen(true)}
              className="hidden sm:flex ms-2 lg:ms-10 flex-1 max-w-md items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-sm text-gray-400 hover:border-gray-300 dark:hover:border-slate-600">
              <Search className="w-4 h-4" />
              <span className="flex-1 text-start truncate">{t("docsite.search_placeholder", "Search the documentation…")}</span>
              <kbd className="hidden sm:inline text-[10px] font-medium border border-gray-200 dark:border-slate-700 rounded px-1.5 py-0.5">Ctrl K</kbd>
            </button>

            <div className="sm:ms-auto flex items-center gap-1.5">
              <LanguageSwitcher />
              <button type="button" onClick={() => setDark(d => !d)} className="p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800" aria-label={t("docsite.theme")}>
                {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              {signedIn ? (
                <Link to="/dashboard" className="hidden sm:inline-flex items-center gap-1.5 ms-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                  <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {appLabel}
                </Link>
              ) : (
                <button type="button" onClick={handleAppNav} className="hidden sm:inline-flex items-center gap-1.5 ms-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                  <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {appLabel}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="max-w-[90rem] mx-auto flex">
          {/* ── Left tree (desktop) ── */}
          <div className="hidden lg:block w-72 flex-shrink-0 border-e border-gray-100 dark:border-slate-800">
            <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto px-4 py-6">
              <SideNav nav={nav} current={page.id} onNavigate={closeDrawer} base={base} />
            </div>
          </div>

          {/* ── Left tree (mobile drawer) ── */}
          {drawer && (
            <div className="lg:hidden fixed inset-0 z-50">
              <div className="absolute inset-0 bg-black/40" onClick={closeDrawer} />
              <div className="absolute inset-y-0 start-0 w-80 max-w-[85vw] bg-white dark:bg-slate-950 shadow-xl overflow-y-auto px-4 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 dark:text-white">{t("docsite.docs", "Docs")}</span>
                  <button type="button" onClick={closeDrawer} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
                </div>
                {signedIn ? (
                  <Link to="/dashboard" className="sm:hidden flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-blue-600 text-white text-sm font-medium">
                    <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {appLabel}
                  </Link>
                ) : (
                  <button type="button" onClick={() => { handleAppNav(); closeDrawer(); }} className="sm:hidden flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-blue-600 text-white text-sm font-medium">
                    <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {appLabel}
                  </button>
                )}
                <SideNav nav={nav} current={page.id} onNavigate={closeDrawer} base={base} />
              </div>
            </div>
          )}

          {/* ── Article ── */}
          <main className="flex-1 min-w-0 px-5 sm:px-8 lg:px-12 py-10">
            <article ref={contentRef} className="max-w-3xl mx-auto">
              <p className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">{page.crumb}</p>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 dark:text-white">{page.title}</h1>
              <p className="mt-4 text-lg leading-relaxed text-gray-600 dark:text-slate-400">{fmt(page.summary)}</p>

              {page.route && (
                <Link to={page.route} className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                  {t("docsite.open_in_app", "Open this page in the app")} <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}

              {page.image && <Screenshot src={page.image} alt={page.title} route={page.route} />}

              {page.cards && (
                <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {page.cards.map(c => {
                    const Icon = c.Icon;
                    return (
                      <Link key={c.id} to={`${base}/${c.id}`}
                        className="group block p-5 rounded-2xl border border-gray-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-500/50 hover:shadow-sm transition-all">
                        {c.image && (
                          <div className="-mx-5 -mt-5 mb-4 aspect-[16/9] overflow-hidden rounded-t-2xl border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900">
                            <img src={c.image} alt="" loading="lazy" onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                              className="w-full h-full object-cover object-top group-hover:scale-[1.02] transition-transform duration-300" />
                          </div>
                        )}
                        <div className="flex items-center gap-2.5">
                          {Icon && <span className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center"><Icon className="w-4 h-4" /></span>}
                          <span className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300">{c.title}</span>
                          <ChevronRight className="w-4 h-4 ms-auto text-gray-300 group-hover:text-blue-500 rtl:rotate-180" />
                        </div>
                        <p className="mt-2 text-sm text-gray-500 dark:text-slate-400 line-clamp-3">{fmt(c.summary)}</p>
                      </Link>
                    );
                  })}
                </div>
              )}

              {page.sections.map((s, i) => (
                <section key={i} className="mt-12">
                  <h2 id={`sec-${i + 1}`} className="scroll-mt-24 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
                    <a href={`#sec-${i + 1}`} className="hover:underline decoration-gray-300 underline-offset-4">{s.heading}</a>
                  </h2>
                  {s.body && <p className="mt-4 leading-7 text-gray-700 dark:text-slate-300">{fmt(s.body)}</p>}
                  {s.steps && s.steps.length > 0 && (
                    <ol className="mt-5 space-y-4">
                      {s.steps.map((st, j) => (
                        <li key={j} className="flex gap-4">
                          <span className="w-7 h-7 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 text-sm font-semibold flex items-center justify-center flex-shrink-0">{j + 1}</span>
                          <span className="pt-0.5 leading-7 text-gray-700 dark:text-slate-300">{fmt(st)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {s.bullets && s.bullets.length > 0 && (
                    <ul className="mt-4 space-y-2 list-disc ps-6 marker:text-gray-400">
                      {s.bullets.map((b, j) => <li key={j} className="leading-7 text-gray-700 dark:text-slate-300">{fmt(b)}</li>)}
                    </ul>
                  )}
                  {s.table && (
                    <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-900 text-gray-500 dark:text-slate-400">
                          <tr>{s.table.head.map((h, k) => <th key={k} className="text-start px-4 py-2.5 font-medium">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {s.table.rows.map((r, k) => (
                            <tr key={k} className="border-t border-gray-100 dark:border-slate-800">
                              {r.map((c, m) => <td key={m} className={`px-4 py-2.5 ${m === 0 ? "font-medium text-gray-900 dark:text-white" : ""}`}>{c}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {s.tips && s.tips.length > 0 && (
                    <div className="mt-5 flex gap-3 rounded-xl border border-blue-100 dark:border-blue-500/20 bg-blue-50/60 dark:bg-blue-500/5 p-4">
                      <Lightbulb className="w-5 h-5 flex-shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                      <div className="space-y-1.5">
                        {s.tips.map((tip, j) => <p key={j} className="text-sm leading-6 text-gray-700 dark:text-slate-300">{fmt(tip)}</p>)}
                      </div>
                    </div>
                  )}
                </section>
              ))}

              {/* Previous / next */}
              <div className="mt-16 pt-8 border-t border-gray-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {prev ? (
                  <Link to={`${base}/${prev.id}`} className="group p-4 rounded-xl border border-gray-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-500/50">
                    <p className="text-xs text-gray-400 flex items-center gap-1"><ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" />{t("docsite.previous", "Previous")}</p>
                    <p className="mt-1 font-medium text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 truncate">{prev.title}</p>
                  </Link>
                ) : <span />}
                {next && (
                  <Link to={`${base}/${next.id}`} className="group p-4 rounded-xl border border-gray-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-500/50 text-end">
                    <p className="text-xs text-gray-400 flex items-center gap-1 justify-end">{t("docsite.next", "Next")}<ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" /></p>
                    <p className="mt-1 font-medium text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300 truncate">{next.title}</p>
                  </Link>
                )}
              </div>
            </article>
          </main>

          {/* ── On this page ── */}
          <div className="hidden xl:block w-60 flex-shrink-0">
            {toc.length > 0 && (
              <div className="sticky top-16 py-10 pe-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-3">{t("docsite.on_this_page", "On this page")}</p>
                <ul className="space-y-1 border-s border-gray-200 dark:border-slate-800">
                  {toc.map(item => (
                    <li key={item.id}>
                      <a href={`#${item.id}`}
                        onClick={e => { e.preventDefault(); navigate({ hash: item.id }, { replace: true }); }}
                        className={`block -ms-px ps-3 py-1 text-sm border-s-2 transition-colors ${
                          activeSec === item.id
                            ? "border-blue-600 text-blue-700 dark:text-blue-300 font-medium"
                            : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100"
                        }`}>
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
                {page.route && (
                  <Link to={page.route} className="mt-6 inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-blue-600">
                    <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" /> {t("docsite.open_in_app", "Open this page in the app")}
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {searchOpen && <SearchDialog pages={pages} onClose={() => setSearchOpen(false)} base={base} />}
    </div>
  );
}
