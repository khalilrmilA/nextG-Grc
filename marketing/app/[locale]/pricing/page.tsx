import type { Metadata } from "next";
import PricingView from "./PricingView";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { OG_IMAGE } from "@/lib/brand";
import { PAGE_META } from "@/lib/seo-meta";

export async function generateMetadata(props: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const params = await props.params;
  const m = PAGE_META.pricing[params.locale];
  return {
    title: m.title,
    description: m.description,
    keywords: m.keywords,
    alternates: { canonical: canonicalUrl(params.locale, "/pricing"), languages: hreflangAlternates("/pricing") },
    openGraph: {
      siteName: "GRC Eye",
      title: m.ogTitle,
      description: m.ogDescription,
      url: canonicalUrl(params.locale, "/pricing"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: [OG_IMAGE],
    },
  };
}

export default function PricingPage() {
  return <PricingView />;
}
