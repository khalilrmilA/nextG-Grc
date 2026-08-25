"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import Link from "next/link";
import { useState } from "react";
import { Calendar, ArrowUpRight, Clock } from "lucide-react";
import PublicNav from "@/components/landing/PublicNav";
import { useI18n } from "@/i18n";
import { CATEGORIES, type BlogPost } from "./posts";

export default function BlogView({ posts }: { posts: BlogPost[] }) {
  const { t, lang } = useI18n();
  const dateLocale = lang === "fr" ? "fr-FR" : lang === "ar" ? "ar" : "en-US";
  const [activeCat, setActiveCat] = useState<string>("All");

  const featured = posts.find(p => p.featured) ?? posts[0];
  const filtered = activeCat === "All"
    ? posts.filter(p => p.slug !== featured.slug)
    : posts.filter(p => p.slug !== featured.slug && p.category === activeCat);

  // Localize the "All" pill; other category labels stay in EN since they
  // come from the post taxonomy.
  const localizeCat = (cat: string) => cat === "All" ? t("public.blog.cat_all") : cat;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <PublicNav />

      {/* Hero */}
      <section className="pt-16 pb-16 px-6 text-center bg-gradient-to-b from-slate-50 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight tracking-tight mb-4">
            {t("public.blog.hero_title")}
          </h1>
          <p className="text-xl text-gray-500">
            {t("public.blog.hero_subtitle")}
          </p>
        </div>
      </section>

      {/* Featured */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <Link href={`/${lang}/blog/${featured.slug}`} className="block group">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-3xl p-10 sm:p-12 group-hover:shadow-2xl group-hover:-translate-y-0.5 transition-all">
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <span className="inline-block bg-blue-400/30 backdrop-blur-sm text-white text-xs font-bold px-3 py-1 rounded-full">{t("public.blog.featured")}</span>
                <span className="inline-block bg-white/15 text-white text-xs font-medium px-3 py-1 rounded-full">{featured.category}</span>
                <div className="flex items-center gap-1.5 text-xs text-white/80">
                  <Clock className="w-3.5 h-3.5" />
                  {featured.readTime}
                </div>
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold mb-4 leading-tight">{featured.title}</h2>
              <p className="text-base sm:text-lg text-blue-100 leading-relaxed mb-6 max-w-3xl">{featured.excerpt}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-sm font-bold">
                    {featured.author.split(" ").map(s => s[0]).slice(0, 2).join("")}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{featured.author}</p>
                    <p className="text-xs text-blue-200">{new Date(featured.date).toLocaleDateString(dateLocale, { year: "numeric", month: "short", day: "numeric" })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold opacity-90 group-hover:gap-3 transition-all">
                  {t("public.news.read_more")}
                  <ArrowUpRight className="w-5 h-5 rtl:scale-x-[-1]" />
                </div>
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* Category filter */}
      <section className="px-6 pb-10">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCat(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  cat === activeCat
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {localizeCat(cat)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Article grid */}
      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          {filtered.length === 0 ? (
            <p className="text-center text-gray-500 py-16">{t("public.blog.no_articles")}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filtered.map((post) => (
                <Link key={post.slug} href={`/${lang}/blog/${post.slug}`} className="group block">
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-100/60 rounded-2xl h-44 mb-4 group-hover:from-blue-100 group-hover:to-indigo-200/60 transition-colors flex items-center justify-center">
                    <span className="text-5xl font-black text-blue-600/30 group-hover:text-blue-600/50 transition-colors">
                      {post.category[0]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full">
                      {post.category}
                    </span>
                    <span className="inline-block bg-gray-50 text-gray-600 text-xs font-medium px-2.5 py-1 rounded-full border border-gray-200">
                      {post.region}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">
                    {post.title}
                  </h3>
                  <p className="text-gray-600 text-sm mb-4 line-clamp-2">{post.excerpt}</p>
                  <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Calendar className="w-4 h-4" />
                      <span>{new Date(post.date).toLocaleDateString(dateLocale)}</span>
                    </div>
                    <span className="text-xs text-gray-500">{post.readTime}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Newsletter */}
      <section className="px-6 py-24 bg-gradient-to-br from-slate-50 to-blue-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-4">{t("public.blog.newsletter_title")}</h2>
          <p className="text-gray-600 mb-8">{t("public.blog.newsletter_subtitle")}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              placeholder={t("public.blog.email_placeholder")}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors">
              {t("public.blog.subscribe")}
            </button>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
