import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE_URL, SITE_NAME } from "./constants";
import { I18nProvider } from "../i18n";

const TITLE        = "GRCEye — Governance, Risk & Compliance Platform";
const DESCRIPTION  =
  "All-in-one GRC SaaS — 70+ frameworks, AI gap analysis, risk quantification, audits, policies, vendor risk and a public trust center.";
const OG_IMAGE     = "/android-chrome-512x512.png";

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
        width:  512,
        height: 512,
        alt:    "GRCEye — Governance, Risk & Compliance Platform",
      },
    ],
    locale: "en_US",
  },

  /* ── Twitter / X Card ─────────────────────────────────────── */
  twitter: {
    card:        "summary",
    title:       TITLE,
    description: DESCRIPTION,
    images:      [OG_IMAGE],
  },

  /* ── Verification placeholders (fill in when you have codes) ─ */
  // verification: {
  //   google: "YOUR_GOOGLE_SEARCH_CONSOLE_TOKEN",
  // },
};

/* ── Structured Data ──────────────────────────────────────────── */
const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "GRCEye",
  url: SITE_URL,
  logo: `${SITE_URL}/android-chrome-512x512.png`,
  description: "All-in-one Governance, Risk and Compliance SaaS platform.",
  sameAs: [],
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "sales",
      email: "sales@grceye.com",
      availableLanguage: ["en", "fr"],
    },
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@grceye.com",
      availableLanguage: ["en", "fr"],
    },
  ],
};

const SITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "GRCEye",
  url: SITE_URL,
};

/* ── Root Layout ──────────────────────────────────────────────── */
export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Explicit favicon tags — belt-and-suspenders alongside Next.js metadata */}
        <link rel="icon"             href="/favicon.ico"            sizes="any" />
        <link rel="icon"             href="/favicon-16x16.png"      sizes="16x16"  type="image/png" />
        <link rel="icon"             href="/favicon-32x32.png"      sizes="32x32"  type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png"   sizes="180x180" />
        <link rel="manifest"         href="/site.webmanifest" />
        <meta name="msapplication-TileImage"  content="/android-chrome-192x192.png" />
        <meta name="msapplication-TileColor"  content="#0f1729" />

        {/* Structured data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }}
        />
      </head>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
