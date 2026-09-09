import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/landing/LegalPage";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { SITE_URL } from "@/app/constants";
import { ORG_ID, OG_IMAGE } from "@/lib/brand";

const META: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "About GRCEye | The Company Behind the GRC Platform",
    description:
      "GRCEye is a governance, risk and compliance platform built for security teams. Learn who builds it, where it runs, and how it relates to SilentWolf.",
  },
  fr: {
    title: "À propos de GRCEye | L'entreprise derrière la plateforme GRC",
    description:
      "GRCEye est une plateforme de gouvernance, risques et conformité conçue pour les équipes sécurité. Découvrez qui la développe et son lien avec SilentWolf.",
  },
  ar: {
    title: "عن GRCEye | الشركة وراء منصة الحوكمة والمخاطر والامتثال",
    description:
      "GRCEye منصة للحوكمة والمخاطر والامتثال مصممة لفرق الأمن. تعرّف على من يطوّرها وعلاقتها بشركة SilentWolf.",
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
      siteName: "GRCEye",
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
  name: "About GRCEye",
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
        title="About GRCEye"
        subtitle="The governance, risk and compliance platform built for security teams that are tired of spreadsheets."
      >
        <h2>What GRCEye is</h2>
        <p>
          <strong>GRCEye</strong> (pronounced &ldquo;GRC eye&rdquo;, and sometimes written
          GRCeye or GRC-Eye) is an all-in-one <strong>governance, risk and compliance</strong>{" "}
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
            <strong>Compliance across 70+ frameworks</strong> &mdash; ISO/IEC 27001, SOC 2,
            GDPR, PCI DSS, NIST CSF, NIS2, DORA, the EU AI Act and more, assessed in
            parallel with evidence mapped once and reused across every framework it
            satisfies.
          </li>
          <li>
            <strong>Risk management and quantification</strong> &mdash; a 5&times;5 heatmap
            for the qualitative view, and Monte Carlo simulation producing ALE, SLE and
            P90/P95 figures for the board-level conversation.
          </li>
          <li>
            <strong>Audit management</strong> &mdash; internal and external audits end to
            end: auditor assignment, control checklists, findings, remediation tracking and
            PDF reporting.
          </li>
          <li>
            <strong>Policy and document generation</strong> &mdash; audit-ready documents
            generated against your industry, size and selected frameworks.
          </li>
          <li>
            <strong>Third-party risk management</strong> &mdash; vendor register, contract
            review, risk cartography and prescreening questionnaires.
          </li>
          <li>
            <strong>Trust center</strong> &mdash; a public compliance page you can point
            prospects at instead of answering the same security questionnaire again.
          </li>
        </ul>

        <h2>Where the AI runs</h2>
        <p>
          GRCEye&apos;s AI features run on your own infrastructure. The platform uses a
          locally hosted model rather than sending your control evidence, contracts or
          policies to a third-party API. For regulated customers, and for anyone whose
          compliance posture would be undermined by shipping audit evidence to an external
          provider, this is the difference between a usable tool and one that fails its own
          vendor review.
        </p>

        <h2>Who builds GRCEye</h2>
        <p>
          GRCEye is built and operated from <strong>Tunisia</strong>, and is developed
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
          <Link href={to("/how-it-works")}>walk through how GRCEye works</Link> or{" "}
          <Link href="/register">start a free trial</Link> &mdash; no credit card required.
        </p>
      </LegalPage>
    </>
  );
}
