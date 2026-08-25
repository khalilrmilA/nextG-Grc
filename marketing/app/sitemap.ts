import type { MetadataRoute } from "next";
import { POSTS } from "./[locale]/blog/posts";
import { SITE_URL } from "./constants";
import { LOCALES, hreflangAlternates, localePath } from "../lib/seo";

const PAGES: { path: string; changeFrequency: "weekly" | "monthly"; priority: number }[] = [
  { path: "/",                 changeFrequency: "weekly",  priority: 1.0 },
  { path: "/how-it-works",     changeFrequency: "monthly", priority: 0.9 },
  { path: "/frameworks",       changeFrequency: "monthly", priority: 0.9 },
  { path: "/features-landing", changeFrequency: "monthly", priority: 0.9 },
  { path: "/solutions",        changeFrequency: "monthly", priority: 0.9 },
  { path: "/blog",             changeFrequency: "weekly",  priority: 0.8 },
  { path: "/news",             changeFrequency: "weekly",  priority: 0.8 },
  { path: "/faq",              changeFrequency: "monthly", priority: 0.7 },
  { path: "/contact",          changeFrequency: "monthly", priority: 0.7 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // One entry per locale per page, each carrying hreflang alternates to the
  // other locales — lets Google discover and index /fr and /ar as distinct
  // pages instead of only ever finding the English version.
  const staticPages: MetadataRoute.Sitemap = PAGES.flatMap((page) =>
    LOCALES.map((locale) => ({
      url: `${SITE_URL}${localePath(locale, page.path)}`,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
      lastModified: now,
      alternates: { languages: hreflangAlternates(page.path) },
    }))
  );

  const blogPages: MetadataRoute.Sitemap = POSTS.flatMap((post) =>
    LOCALES.map((locale) => ({
      url: `${SITE_URL}${localePath(locale, `/blog/${post.slug}`)}`,
      lastModified: new Date(post.date),
      changeFrequency: "monthly" as const,
      priority: 0.8,
      alternates: { languages: hreflangAlternates(`/blog/${post.slug}`) },
    }))
  );

  return [...staticPages, ...blogPages];
}
