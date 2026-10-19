import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/landing/LegalPage";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { SITE_URL } from "@/app/constants";
import { ORG_ID, OG_IMAGE } from "@/lib/brand";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "About GRC Eye | The Company Behind the GRC Platform",
    description:
      "GRC Eye is a governance, risk and compliance platform built for security teams. Learn who builds it, where it runs, and how it relates to SilentWolf.",
  },
  fr: {
    title: "À propos de GRC Eye | L'entreprise derrière la plateforme GRC",
    description:
      "GRC Eye est une plateforme de gouvernance, risques et conformité conçue pour les équipes sécurité. Découvrez qui la développe et son lien avec SilentWolf.",
  },
  ar: {
    title: "عن GRC Eye | الشركة وراء منصة الحوكمة والمخاطر والامتثال",
    description:
      "GRC Eye منصة للحوكمة والمخاطر والامتثال مصممة لفرق الأمن. تعرّف على من يطوّرها وعلاقتها بشركة SilentWolf.",
  },
};

export async function generateMetadata(props: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const params = await props.params;
  const m = META[params.locale];
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: {
      canonical: canonicalUrl(params.locale, "/about"),
      languages: hreflangAlternates("/about"),
    },
    openGraph: {
      siteName: "GRC Eye",
      title: m.title,
      description: m.description,
      url: canonicalUrl(params.locale, "/about"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: [OG_IMAGE],
    },
  };
}

/**
 * AboutPage schema, pointed at the Organization node in the root layout's
 * @graph. This is the page Google should treat as the entity's home: it states
 * the name in prose, spells out the variants, and names the related company.
 */
const ABOUT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": `${SITE_URL}/#about`,
  name: "About GRC Eye",
  mainEntity: { "@id": ORG_ID },
};

export default async function AboutPage(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const to = (path: string) => `/${params.locale}${path}`;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ABOUT_JSON_LD) }}
      />
      <LegalPage
        title="About GRC Eye"
        subtitle="The governance, risk and compliance platform built for security teams that are tired of spreadsheets."
      >
        <h2>What GRC Eye is</h2>
        <p>
          <strong>GRC Eye</strong> (pronounced &ldquo;GRC Eye&rdquo;, and sometimes written
          GRC Eye or GRC-Eye) is an all-in-one <strong>governance, risk and compliance</strong>{" "}
          SaaS platform. It gives CISOs, compliance leads and security teams a single
          system for the work that is usually scattered across dozens of spreadsheets,
          shared drives and email threads.
        </p>
        <p>
          The name is a compound of <strong>GRC</strong> &mdash; governance, risk and
          compliance &mdash; and <strong>eye</strong>, for the continuous visibility the
          platform is built to give you over your control environment. The company slogan
          is &ldquo;Keep an eye on risk.&rdquo;
        </p>

        <h2>What the platform does</h2>
        <ul>
          <li>
            <strong>Compliance across 85+ built-in frameworks</strong> &mdash; ISO/IEC 27001,
            SOC 2, GDPR, PCI DSS, NIST CSF, NIS2, DORA, the EU AI Act and more, with over
            5,000 pre-loaded controls, assessed in parallel with evidence mapped once and
            reused across every framework it satisfies. Eight Saudi regulatory frameworks
            (NCA ECC, CCC, DCC, CSCC, OTCC, TCC, SAMA CSF and the SDAIA PDPL) ship in their
            official English and Arabic wording, cross-mapped to NCA ECC.
          </li>
          <li>
            <strong>Risk management</strong> &mdash; a risk register scored on a configurable
            matrix, inherent, residual and target risk, appetite thresholds, risk scenarios
            linking threats, vulnerabilities, assets and controls, a heatmap and treatment
            plans.
          </li>
          <li>
            <strong>Audit management</strong> &mdash; internal and external audits end to
            end: auditor assignment, control checklists, findings, remediation tracking and
            PDF reporting, plus a dedicated portal for external auditors.
          </li>
          <li>
            <strong>Policy and document generation</strong> &mdash; 27 document types generated
            by AI against your industry, size and selected frameworks, with approval
            workflows and employee acknowledgement.
          </li>
          <li>
            <strong>Third-party risk management</strong> &mdash; vendor register, AI contract
            review, risk cartography, prescreening questionnaires and a vendor portal with
            e-signature.
          </li>
          <li>
            <strong>Assets and security operations</strong> &mdash; asset inventory with CIA
            valuation and cartography, vulnerability management with scanner connectors, a
            CVE knowledge base, a threat library and incident tracking.
          </li>
        </ul>

        <h2>Where the AI runs</h2>
        <p>
          Private AI on your terms: run GRC Eye on-premises with a local model &mdash; zero
          data egress &mdash; or connect your own AI endpoint (Ollama or OpenAI-compatible).
          For regulated customers, and for anyone whose compliance posture would be
          undermined by shipping audit evidence to an external provider, the Private
          edition keeps the application, the database and the model on infrastructure you
          control.
        </p>

        <h2>Who builds GRC Eye</h2>
        <p>
          GRC Eye is built and operated from <strong>Tunisia</strong>, and is developed
          alongside{" "}
          <a href="https://silentwolf.io/" target="_blank" rel="noopener noreferrer">
            SilentWolf
          </a>
          , a cybersecurity company working in the same market. The platform serves
          customers across Europe, the Middle East and North Africa, with the interface
          available in English, French and Arabic &mdash; including full right-to-left
          support.
        </p>

        <h2>Talk to us</h2>
        <p>
          Sales enquiries go to{" "}
          <a href="mailto:sales@grceye.com">sales@grceye.com</a>, support to{" "}
          <a href="mailto:support@grceye.com">support@grceye.com</a>. You can also{" "}
          <Link href={to("/contact")}>use the contact form</Link>, browse the{" "}
          <Link href={to("/faq")}>frequently asked questions</Link>, or read about{" "}
          <Link href={to("/security")}>how we secure the platform</Link>.
        </p>
        <p>
          If you want to see it rather than read about it,{" "}
          <Link href={to("/how-it-works")}>walk through how GRC Eye works</Link> or{" "}
          <Link href="/register">start a free trial</Link> &mdash; no credit card required.
        </p>
      </LegalPage>
    </>
  );
}
