import type { Metadata } from "next";
import FAQView from "./FAQView";
import { FAQ_ITEMS } from "./faqData";
import en from "../../../i18n/locales/en";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { OG_IMAGE } from "@/lib/brand";
import { PAGE_META } from "@/lib/seo-meta";

type FaqQ = Record<string, string>;
const FAQ_Q = (en as { public: { faq_q: FaqQ } }).public.faq_q;

export function generateMetadata({ params }: { params: { locale: Locale } }): Metadata {
  const m = PAGE_META.faq[params.locale];
  return {
    title: m.title,
    description: m.description,
    keywords: m.keywords,
    alternates: { canonical: canonicalUrl(params.locale, "/faq"), languages: hreflangAlternates("/faq") },
    openGraph: {
      title: m.ogTitle,
      description: m.ogDescription,
      url: canonicalUrl(params.locale, "/faq"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: [OG_IMAGE],
    },
  };
}

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.flatMap(cat =>
    cat.ids.map(id => ({
      "@type": "Question",
      name: FAQ_Q[`${id}_q`] ?? id,
      acceptedAnswer: { "@type": "Answer", text: FAQ_Q[`${id}_a`] ?? "" },
    }))
  ),
};

export default function FAQPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <FAQView />
    </>
  );
}
