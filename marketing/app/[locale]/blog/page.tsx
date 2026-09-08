import type { Metadata } from "next";
import BlogView from "./BlogView";
import { POSTS } from "./posts";
import { localizePost } from "./translations";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { OG_IMAGE } from "@/lib/brand";
import { PAGE_META } from "@/lib/seo-meta";

export function generateMetadata({ params }: { params: { locale: Locale } }): Metadata {
  const m = PAGE_META.blog[params.locale];
  return {
    title: { absolute: m.title },
    description: m.description,
    keywords: m.keywords,
    alternates: { canonical: canonicalUrl(params.locale, "/blog"), languages: hreflangAlternates("/blog") },
    openGraph: {
      title: m.ogTitle,
      description: m.ogDescription,
      url: canonicalUrl(params.locale, "/blog"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: [OG_IMAGE],
    },
  };
}

export default function BlogPage({ params }: { params: { locale: Locale } }) {
  // Localize server-side so the client bundle only ships this locale's text —
  // importing all 12 posts' fr+ar translations directly into a client component
  // would bundle every locale's content into every locale's page.
  const posts = POSTS.map(p => localizePost(p, params.locale));
  return <BlogView posts={posts} />;
}
