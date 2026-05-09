import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE_URL, SITE_NAME } from "./constants";

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "GRCEye — Governance, Risk & Compliance Platform",
    template: "%s | GRCEye",
  },
  description:
    "GRCEye is the all-in-one GRC SaaS platform: 70+ compliance frameworks, AI gap analysis, risk quantification, audits, policies, vendor risk and a public trust center.",
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    images: [{ url: "/logo.png", alt: "GRCEye logo" }],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    images: ["/logo.png"],
  },
};

const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "GRCEye",
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  description: "All-in-one Governance, Risk and Compliance SaaS platform.",
  sameAs: [],
  contactPoint: [
    { "@type": "ContactPoint", contactType: "sales", email: "sales@grceye.io", availableLanguage: ["en", "fr"] },
    { "@type": "ContactPoint", contactType: "customer support", email: "support@grceye.io", availableLanguage: ["en", "fr"] },
  ],
};

const SITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "GRCEye",
  url: SITE_URL,
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
