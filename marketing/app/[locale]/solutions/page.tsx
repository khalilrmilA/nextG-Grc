import type { Metadata } from "next";
import SolutionsView from "./SolutionsView";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { PAGE_META } from "@/lib/seo-meta";

export function generateMetadata({ params }: { params: { locale: Locale } }): Metadata {
  const m = PAGE_META.solutions[params.locale];
  return {
    title: m.title,
    description: m.description,
    keywords: m.keywords,
    alternates: { canonical: canonicalUrl(params.locale, "/solutions"), languages: hreflangAlternates("/solutions") },
    openGraph: {
      title: m.ogTitle,
      description: m.ogDescription,
      url: canonicalUrl(params.locale, "/solutions"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: ["/logo-horizontal.png"],
    },
  };
}

export default function SolutionsPage() {
  return <SolutionsView />;
}
