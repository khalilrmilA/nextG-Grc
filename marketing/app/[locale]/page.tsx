import type { Metadata } from "next";
import LandingView from "./LandingView";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { PAGE_META } from "@/lib/seo-meta";

export function generateMetadata({ params }: { params: { locale: Locale } }): Metadata {
  const m = PAGE_META.home[params.locale];
  return {
    title: { absolute: m.title },
    description: m.description,
    keywords: m.keywords,
    alternates: { canonical: canonicalUrl(params.locale, "/"), languages: hreflangAlternates("/") },
    openGraph: {
      title: m.ogTitle,
      description: m.ogDescription,
      url: canonicalUrl(params.locale, "/"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: ["/logo-horizontal.png"],
    },
    twitter: {
      title: m.ogTitle,
      description: m.ogDescription,
    },
  };
}

export default function HomePage() {
  return <LandingView />;
}
