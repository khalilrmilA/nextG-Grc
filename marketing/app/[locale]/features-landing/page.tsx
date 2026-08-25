import type { Metadata } from "next";
import FeaturesView from "./FeaturesView";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { PAGE_META } from "@/lib/seo-meta";

export function generateMetadata({ params }: { params: { locale: Locale } }): Metadata {
  const m = PAGE_META.featuresLanding[params.locale];
  return {
    title: m.title,
    description: m.description,
    keywords: m.keywords,
    alternates: { canonical: canonicalUrl(params.locale, "/features-landing"), languages: hreflangAlternates("/features-landing") },
    openGraph: {
      title: m.ogTitle,
      description: m.ogDescription,
      url: canonicalUrl(params.locale, "/features-landing"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: ["/logo-horizontal.png"],
    },
  };
}

export default function FeaturesLandingPage() {
  return <FeaturesView />;
}
