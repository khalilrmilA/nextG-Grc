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
  // Company + legal. /about carries real weight here: it is the page that
  // states the brand name in prose and names the related company, which is
  // what Google needs to treat "GRCEye" as an entity rather than a typo.
  { path: "/about",            changeFrequency: "monthly", priority: 0.8 },
  { path: "/security",         changeFrequency: "monthly", priority: 0.7 },
  { path: "/privacy",          changeFrequency: "monthly", priority: 0.3 },
  { path: "/terms",            changeFrequency: "monthly", priority: 0.3 },
];

/**
 * Content-change dates for the static pages, edited by hand when a page's copy
 * actually changes. Previously every static URL was stamped with `new Date()` at
 * build time, so a deploy that touched one component told Google all 27 pages had
 * changed. Crawlers learn to distrust a lastmod that always equals "the last
 * deploy" and start ignoring the field entirely, which costs recrawl priority on
 * the pages that genuinely did change.
 */
const STATIC_PAGES_LAST_MODIFIED = new Date("2026-09-08T00:00:00Z");

export default function sitemap(): MetadataRoute.Sitemap {
  const now = STATIC_PAGES_LAST_MODIFIED;

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
