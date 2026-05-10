import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Calendar, Clock, ChevronDown } from "lucide-react";
import PublicNav from "@/components/landing/PublicNav";
import PublicFooter from "@/components/landing/PublicFooter";
import { POSTS, findPostBySlug } from "../posts";
import Markdown from "../Markdown";

export function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = findPostBySlug(params.slug);
  if (!post) return { title: "Article not found" };
  const url = `https://grceye.com/blog/${post.slug}`;
  return {
    title: { absolute: post.metaTitle },
    description: post.metaDescription,
    keywords: post.keywords,
    alternates: { canonical: `/blog/${post.slug}` },
    authors: [{ name: post.author }],
    openGraph: {
      title: post.metaTitle,
      description: post.metaDescription,
      url,
      type: "article",
      publishedTime: new Date(post.date).toISOString(),
      authors: [post.author],
      tags: post.keywords.split(",").map(k => k.trim()),
      images: ["/logo.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: post.metaTitle,
      description: post.metaDescription,
      images: ["/logo.png"],
    },
  };
}

export default function ArticlePage({ params }: { params: { slug: string } }) {
  const post = findPostBySlug(params.slug);
  if (!post) notFound();

  const url = `https://grceye.com/blog/${post.slug}`;

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.metaTitle,
    description: post.metaDescription,
    image: "https://grceye.com/logo.png",
    datePublished: new Date(post.date).toISOString(),
    dateModified: new Date(post.date).toISOString(),
    author: {
      "@type": "Person",
      name: post.author,
      jobTitle: post.authorRole,
    },
    publisher: {
      "@type": "Organization",
      name: "GRCEye",
      logo: { "@type": "ImageObject", url: "https://grceye.com/logo.png" },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    keywords: post.keywords,
  };

  const faqJsonLd = post.faqs.length > 0 ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: post.faqs.map(f => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  } : null;

  // Pick 2 related posts in the same category (or any other 2)
  const related = POSTS.filter(p => p.slug !== post.slug && p.category === post.category)
    .concat(POSTS.filter(p => p.slug !== post.slug && p.category !== post.category))
    .slice(0, 2);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      {faqJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      )}

      <div className="min-h-screen bg-white text-gray-900">
        <PublicNav />

        {/* Hero */}
        <section className="px-6 pt-12 pb-10 bg-gradient-to-b from-slate-50 via-white to-white">
          <div className="max-w-3xl mx-auto">
            <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-6">
              <ArrowLeft className="w-4 h-4" />
              All articles
            </Link>

            <div className="flex flex-wrap items-center gap-3 mb-5">
              <span className="inline-block bg-blue-50 text-blue-700 text-xs font-bold px-3 py-1 rounded-full border border-blue-100">
                {post.category}
              </span>
              <span className="inline-block bg-gray-50 text-gray-600 text-xs font-medium px-3 py-1 rounded-full border border-gray-200">
                {post.region}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Calendar className="w-3.5 h-3.5" />
                <span>{new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Clock className="w-3.5 h-3.5" />
                <span>{post.readTime}</span>
              </div>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-900 leading-tight tracking-tight mb-6">
              {post.title}
            </h1>

            <p className="text-lg text-gray-600 leading-relaxed">
              {post.excerpt}
            </p>

            <div className="mt-8 flex items-center gap-3 pt-6 border-t border-gray-100">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {post.author.split(" ").map(s => s[0]).slice(0, 2).join("")}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{post.author}</p>
                <p className="text-xs text-gray-500">{post.authorRole}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Article body */}
        <article className="px-6 pb-16">
          <div className="max-w-3xl mx-auto">
            <Markdown source={post.body} />
          </div>
        </article>

        {/* FAQs */}
        {post.faqs.length > 0 && (
          <section className="px-6 py-16 bg-gradient-to-b from-white to-blue-50/40">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-8">Frequently asked questions</h2>
              <div className="space-y-3">
                {post.faqs.map((faq, idx) => (
                  <details key={idx} className="group bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-blue-200 transition-colors">
                    <summary className="cursor-pointer px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left list-none">
                      <span className="font-semibold text-gray-900 pr-4">{faq.q}</span>
                      <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="px-6 py-4 bg-blue-50/50 border-t border-gray-200">
                      <p className="text-gray-700 leading-relaxed text-sm">{faq.a}</p>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="px-6 py-16 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-extrabold mb-3">Ready to operationalize this?</h2>
            <p className="text-blue-100 mb-8">
              GRCEye gives security teams a single platform for risk, compliance, audit, vendor risk, and policy — with AI that runs on your own infrastructure.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/register" className="inline-flex items-center justify-center gap-2 bg-white text-blue-700 font-semibold px-6 py-3 rounded-xl hover:bg-blue-50 transition-colors shadow-md">
                Start free trial <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/contact" className="inline-flex items-center justify-center gap-2 bg-white/10 border border-white/20 text-white font-semibold px-6 py-3 rounded-xl hover:bg-white/20 transition-colors">
                Talk to us
              </Link>
            </div>
          </div>
        </section>

        {/* Related */}
        {related.length > 0 && (
          <section className="px-6 py-16">
            <div className="max-w-5xl mx-auto">
              <h2 className="text-2xl font-extrabold text-gray-900 mb-8">Continue reading</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {related.map(p => (
                  <Link key={p.slug} href={`/blog/${p.slug}`} className="group block bg-white border border-gray-200 rounded-2xl p-6 hover:border-blue-300 hover:shadow-md transition-all">
                    <span className="inline-block bg-blue-50 text-blue-700 text-xs font-bold px-3 py-1 rounded-full mb-3">
                      {p.category}
                    </span>
                    <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors mb-2">
                      {p.title}
                    </h3>
                    <p className="text-sm text-gray-600 line-clamp-2 mb-4">{p.excerpt}</p>
                    <span className="text-xs text-gray-500">{p.readTime}</span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        <PublicFooter />
      </div>
    </>
  );
}
