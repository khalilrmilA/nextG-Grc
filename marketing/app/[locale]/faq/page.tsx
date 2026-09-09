import type { Metadata } from "next";
import FAQView from "./FAQView";
import { FAQ_ITEMS } from "./faqData";
import en from "../../../i18n/locales/en";
import fr from "../../../i18n/locales/fr";
import ar from "../../../i18n/locales/ar";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { OG_IMAGE } from "@/lib/brand";
import { PAGE_META } from "@/lib/seo-meta";

type FaqQ = Record<string, string>;

// One dictionary per locale. The schema used to be built from `en` alone, so
// /fr/faq and /ar/faq shipped 40 English question/answer pairs in their FAQPage
// markup while displaying translated text — structured data contradicting the
// visible page, on the very pages meant to rank in those languages.
const FAQ_Q_BY_LOCALE: Record<Locale, FaqQ> = {
  en: (en as { public: { faq_q: FaqQ } }).public.faq_q,
  fr: (fr as unknown as { public: { faq_q: FaqQ } }).public.faq_q,
  ar: (ar as unknown as { public: { faq_q: FaqQ } }).public.faq_q,
};

export async function generateMetadata(props: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const params = await props.params;
  const m = PAGE_META.faq[params.locale];
  return {
    title: m.title,
    description: m.description,
    keywords: m.keywords,
    alternates: { canonical: canonicalUrl(params.locale, "/faq"), languages: hreflangAlternates("/faq") },
    openGraph: {
      siteName: "GRCEye",
      title: m.ogTitle,
      description: m.ogDescription,
      url: canonicalUrl(params.locale, "/faq"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: [OG_IMAGE],
    },
  };
}

function buildFaqJsonLd(locale: Locale) {
  const q = FAQ_Q_BY_LOCALE[locale] ?? FAQ_Q_BY_LOCALE.en;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: locale,
    url: canonicalUrl(locale, "/faq"),
    // Only emit entries whose question AND answer both resolve. A Question whose
    // acceptedAnswer is "" is markup asserting an answer the page never shows.
    mainEntity: FAQ_ITEMS.flatMap(cat =>
      cat.ids
        .map(id => ({ question: q[`${id}_q`], answer: q[`${id}_a`] }))
        .filter((e): e is { question: string; answer: string } => Boolean(e.question && e.answer))
        .map(e => ({
          "@type": "Question",
          name: e.question,
          acceptedAnswer: { "@type": "Answer", text: e.answer },
        }))
    ),
  };
}

export default async function FAQPage(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqJsonLd(params.locale)) }}
      />
      <FAQView />
    </>
  );
}
