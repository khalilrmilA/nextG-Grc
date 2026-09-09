import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import "../globals.css";
import { SITE_URL, SITE_NAME } from "../constants";
import { I18nProvider, type Language } from "../../i18n";
import { LOCALES, isLocale } from "../../lib/seo";
import {
  BRAND, BRAND_ALTERNATE_NAMES, BRAND_COUNTRY, SAME_AS, KNOWS_ABOUT,
  ORG_ID, SITE_ID, SOFTWARE_ID,
  OG_IMAGE, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT,
} from "../../lib/brand";

const TITLE        = "GRCEye | Governance, Risk & Compliance Platform";
const DESCRIPTION  =
  "All-in-one GRC SaaS: 70+ frameworks, AI gap analysis, risk quantification, audits, policies, vendor risk and a public trust center.";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  /* ── Title ────────────────────────────────────────────────── */
  title: {
    default: TITLE,
    template: "%s | GRCEye",
  },

  /* ── Core SEO ─────────────────────────────────────────────── */
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  publisher: SITE_NAME,
  keywords: [
    "GRC platform", "compliance automation", "risk management",
    "audit management", "ISO 27001", "SOC 2", "GDPR compliance",
    "CISO tools", "vendor risk management", "policy management",
  ],

  /* ── Favicons / Icons ─────────────────────────────────────── */
  icons: {
    icon: [
      { url: "/favicon.ico",        sizes: "any" },
      { url: "/favicon-16x16.png",  sizes: "16x16",  type: "image/png" },
      { url: "/favicon-32x32.png",  sizes: "32x32",  type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple:    [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: [{ url: "/favicon.ico" }],
  },

  /* ── Manifest ─────────────────────────────────────────────── */
  manifest: "/site.webmanifest",

  /* ── Robots ───────────────────────────────────────────────── */
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
  },

  /* ── Open Graph ───────────────────────────────────────────── */
  openGraph: {
    type:      "website",
    siteName:  SITE_NAME,
    url:       SITE_URL,
    title:     TITLE,
    description: DESCRIPTION,
    images: [
      {
        url:    OG_IMAGE,
        width:  OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        alt:    "GRCEye | Governance, Risk & Compliance Platform",
      },
    ],
    locale: "en_US",
  },

  /* ── Twitter / X Card ─────────────────────────────────────── */
  twitter: {
    // summary_large_image, not summary: the card is now a real 1200x630 asset,
    // so it renders as a full-width preview instead of a cropped square thumb.
    card:        "summary_large_image",
    title:       TITLE,
    description: DESCRIPTION,
    images:      [OG_IMAGE],
  },

  /* ── Search-engine verification ───────────────────────────────
     Set GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION in the environment
     (marketing/.env.local, then rebuild). Without a verified property in
     Search Console there is no way to submit the sitemap, request indexing, or
     see manual actions — which is the first blocker to clear on this site. */
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? { google: process.env.GOOGLE_SITE_VERIFICATION }
      : {}),
    ...(process.env.BING_SITE_VERIFICATION
      ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } }
      : {}),
  },
};

/* ── Structured Data ──────────────────────────────────────────────
   Emitted as a single @graph rather than three standalone blocks. The three
   nodes carry stable @ids and reference each other (site -> publisher -> org,
   software -> publisher -> org), so Google reads one entity described from
   three angles instead of three unrelated islands that each have to earn
   recognition on their own.

   alternateName is the load-bearing addition: "GRCEye" is an invented word, so
   a query for "grceye" currently gets rewritten to "GRC eye". Declaring the
   spelling variants is how we tell Google they are one entity, not a typo. */
function buildJsonLd(locale: Language) {
  const org = {
    "@type": "Organization",
    "@id": ORG_ID,
    name: BRAND,
    alternateName: BRAND_ALTERNATE_NAMES,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/android-chrome-512x512.png`,
      width: 512,
      height: 512,
    },
    image: `${SITE_URL}${OG_IMAGE}`,
    description: "All-in-one Governance, Risk and Compliance SaaS platform.",
    slogan: "Keep an eye on risk.",
    email: "sales@grceye.com",
    address: { "@type": "PostalAddress", addressCountry: BRAND_COUNTRY },
    knowsAbout: KNOWS_ABOUT,
    // Empty sameAs is omitted entirely rather than emitted as []: an empty
    // array asserts "this entity has no other profiles", which is worse than
    // making no claim. See lib/brand.ts for the list to grow.
    ...(SAME_AS.length ? { sameAs: SAME_AS } : {}),
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "sales",
        email: "sales@grceye.com",
        availableLanguage: ["en", "fr", "ar"],
      },
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "support@grceye.com",
        availableLanguage: ["en", "fr", "ar"],
      },
    ],
  };

  const website = {
    "@type": "WebSite",
    "@id": SITE_ID,
    name: BRAND,
    alternateName: BRAND_ALTERNATE_NAMES,
    url: SITE_URL,
    description: DESCRIPTION,
    inLanguage: locale,
    publisher: { "@id": ORG_ID },
  };

  const software = {
    "@type": "SoftwareApplication",
    "@id": SOFTWARE_ID,
    name: BRAND,
    alternateName: BRAND_ALTERNATE_NAMES,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Governance, Risk and Compliance",
    operatingSystem: "Web",
    url: SITE_URL,
    description: DESCRIPTION,
    inLanguage: locale,
    publisher: { "@id": ORG_ID },
    provider: { "@id": ORG_ID },
    screenshot: `${SITE_URL}${OG_IMAGE}`,
    // No aggregateRating / review: fabricating either is a manual-action risk
    // and Google strips unverifiable review markup anyway.
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "14-day free trial, no credit card required",
      availability: "https://schema.org/InStock",
    },
    featureList: [
      "70+ compliance frameworks", "AI-powered gap analysis", "Risk quantification",
      "Audit management", "Policy governance", "Vendor risk management", "Trust center",
    ],
  };

  return { "@context": "https://schema.org", "@graph": [org, website, software] };
}

/* ── Root Layout ──────────────────────────────────────────────── */
export default async function RootLayout(
  props: {
    readonly children: React.ReactNode;
    readonly params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  if (!isLocale(params.locale)) notFound();
  const lang = params.locale as Language;

  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <head>
        {/* Explicit favicon tags - belt-and-suspenders alongside Next.js metadata */}
        <link rel="icon"             href="/favicon.ico"            sizes="any" />
        <link rel="icon"             href="/favicon-16x16.png"      sizes="16x16"  type="image/png" />
        <link rel="icon"             href="/favicon-32x32.png"      sizes="32x32"  type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png"   sizes="180x180" />
        <link rel="manifest"         href="/site.webmanifest" />
        <meta name="msapplication-TileImage"  content="/android-chrome-192x192.png" />
        <meta name="msapplication-TileColor"  content="#0f1729" />

        {/* Structured data — one @graph, three cross-referenced nodes */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildJsonLd(lang)) }}
        />
      </head>
      <body>
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
