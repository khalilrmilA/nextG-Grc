/**
 * SEO — declarative <head> manager for every public page.
 *
 * Usage:
 *   <SEO
 *     title="Solutions"
 *     description="Industry & role-specific GRC solutions for SaaS, FinTech, Healthcare and more."
 *     path="/solutions"
 *   />
 *
 * - title is auto-suffixed with the brand ("Solutions | GRC Eye"). Pass titleOverride to bypass.
 * - canonical is built from `path` + SITE_URL.
 * - og:image defaults to /logo.png on the production domain.
 * - jsonLd accepts any Schema.org payload (object or array).
 */
import { Helmet } from "react-helmet-async";

export const SITE_URL = "https://grceye.com";
export const SITE_NAME = "GRC Eye";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/logo.png`;
const DEFAULT_DESCRIPTION =
  "GRC Eye is the all-in-one GRC SaaS platform: 70+ compliance frameworks, AI gap analysis, risk quantification, audits, policies, vendor risk and a public trust center.";

interface SEOProps {
  title: string;
  description?: string;
  path?: string;          // e.g. "/solutions" — used to build canonical + og:url
  ogImage?: string;       // absolute URL preferred
  noIndex?: boolean;      // mark page as noindex,nofollow
  titleOverride?: boolean; // when true, do NOT append " | GRC Eye"
  jsonLd?: object | object[];
  keywords?: string;
}

export default function SEO({
  title,
  description = DEFAULT_DESCRIPTION,
  path = "/",
  ogImage = DEFAULT_OG_IMAGE,
  noIndex = false,
  titleOverride = false,
  jsonLd,
  keywords,
}: SEOProps) {
  const fullTitle = titleOverride ? title : `${title} | ${SITE_NAME}`;
  const canonical = `${SITE_URL}${path === "/" ? "/" : path}`;
  const robots = noIndex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1";
  const jsonLdArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      <meta name="robots" content={robots} />
      <link rel="canonical" href={canonical} />

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImage} />

      {/* Twitter / X */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* Structured data */}
      {jsonLdArray.map((data, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(data)}
        </script>
      ))}
    </Helmet>
  );
}
