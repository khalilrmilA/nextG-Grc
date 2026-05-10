import type { Metadata } from "next";
import FAQView from "./FAQView";
import { FAQ_ITEMS } from "./faqData";
import en from "../../i18n/locales/en";

type FaqQ = Record<string, string>;
const FAQ_Q = (en as { public: { faq_q: FaqQ } }).public.faq_q;

export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description:
    "Answers to common questions about GRCEye — pricing, security, integrations, frameworks, AI features and the auditor portal.",
  keywords: "GRCEye FAQ, GRC platform pricing, GRC security, compliance software questions",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "Frequently Asked Questions | GRCEye",
    description:
      "Answers to common questions about GRCEye — pricing, security, integrations, frameworks, AI features and the auditor portal.",
    url: "/faq",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

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
