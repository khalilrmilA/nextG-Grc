import type { Metadata } from "next";
import FrameworksView from "./FrameworksView";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { PAGE_META } from "@/lib/seo-meta";

export function generateMetadata({ params }: { params: { locale: Locale } }): Metadata {
  const m = PAGE_META.frameworks[params.locale];
  return {
    title: m.title,
    description: m.description,
    keywords: m.keywords,
    alternates: { canonical: canonicalUrl(params.locale, "/frameworks"), languages: hreflangAlternates("/frameworks") },
    openGraph: {
      title: m.ogTitle,
      description: m.ogDescription,
      url: canonicalUrl(params.locale, "/frameworks"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: ["/logo-horizontal.png"],
    },
  };
}

export default function FrameworksPage() {
  return <FrameworksView />;
}
