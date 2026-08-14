import type { MetadataRoute } from "next";
import { POSTS } from "./blog/posts";

const SITE_URL = "https://grceye.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL,                       changeFrequency: "weekly",  priority: 1.0, lastModified: now },
    { url: `${SITE_URL}/how-it-works`,     changeFrequency: "monthly", priority: 0.9, lastModified: now },
    { url: `${SITE_URL}/frameworks`,       changeFrequency: "monthly", priority: 0.9, lastModified: now },
    { url: `${SITE_URL}/features-landing`, changeFrequency: "monthly", priority: 0.9, lastModified: now },
    { url: `${SITE_URL}/solutions`,        changeFrequency: "monthly", priority: 0.9, lastModified: now },
    { url: `${SITE_URL}/blog`,             changeFrequency: "weekly",  priority: 0.8, lastModified: now },
    { url: `${SITE_URL}/news`,             changeFrequency: "weekly",  priority: 0.8, lastModified: now },
    { url: `${SITE_URL}/faq`,              changeFrequency: "monthly", priority: 0.7, lastModified: now },
    { url: `${SITE_URL}/contact`,          changeFrequency: "monthly", priority: 0.7, lastModified: now },
  ];

  const blogPages: MetadataRoute.Sitemap = POSTS.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [...staticPages, ...blogPages];
}
