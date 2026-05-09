import type { Metadata } from "next";
import FAQView from "./FAQView";
import { FAQ_ITEMS } from "./faqData";

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
    images: ["/logo.png"],
  },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.flatMap(cat =>
    cat.items.map(item => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
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
