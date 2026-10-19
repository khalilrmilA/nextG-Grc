import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/landing/LegalPage";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { OG_IMAGE } from "@/lib/brand";

export async function generateMetadata(props: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const params = await props.params;
  const title = "Security at GRC Eye | How We Protect Your Compliance Data";
  const description =
    "The security controls built into GRC Eye: multi-factor authentication, 13 built-in roles, Active Directory / LDAP sign-in, tenant isolation, a tamper-evident activity log and private AI options.";
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: canonicalUrl(params.locale, "/security"),
      languages: hreflangAlternates("/security"),
    },
    openGraph: {
      siteName: "GRC Eye",
      title,
      description,
      url: canonicalUrl(params.locale, "/security"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: [OG_IMAGE],
    },
  };
}

export default async function SecurityPage(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const to = (path: string) => `/${params.locale}${path}`;
  return (
    <LegalPage
      title="Security"
      subtitle="A GRC platform holds the evidence of your entire control environment. Here is how GRC Eye protects it."
      updated="19 October 2026"
    >
      <h2>Why this page exists</h2>
      <p>
        A governance, risk and compliance platform ends up holding the most sensitive
        summary of your organisation that exists anywhere: your gaps, your findings, your
        unremediated risks. That makes GRC Eye itself a target, and makes our own security
        posture a fair question for any prospect to ask. This page answers it directly.
      </p>

      <h2>Authentication and access</h2>
      <ul>
        <li>
          <strong>Multi-factor authentication</strong> &mdash; TOTP-based MFA is enforced as
          a real second step at login for enrolled accounts, not merely offered as an
          enrolment option.
        </li>
        <li>
          <strong>Account protection</strong> &mdash; account lockout after repeated failed
          sign-ins and a configurable password policy.
        </li>
        <li>
          <strong>Role-based access control</strong> &mdash; 13 built-in roles determine which
          modules and records an account can reach. A user can hold several roles, and team
          groups make assignment easier.
        </li>
        <li>
          <strong>Scoped auditor access</strong> &mdash; external auditors get a dedicated
          portal limited to the audits assigned to them and the documents attached to those
          audits. They never see the wider tenant.
        </li>
        <li>
          <strong>Active Directory / LDAP sign-in</strong> &mdash; organisations that
          centralise identity can let users sign in with their directory account, with AD
          groups mapped to GRC Eye roles.
        </li>
      </ul>

      <h2>Tenant isolation</h2>
      <p>
        GRC Eye is multi-tenant. Every record carries a tenant identifier, and every API
        endpoint resolves the caller&apos;s tenant from their authenticated session before
        it reads or writes anything. One customer&apos;s data is never reachable from
        another customer&apos;s session.
      </p>

      <h2>Audit trail</h2>
      <p>
        The platform records user actions &mdash; what was changed, by whom, and when
        &mdash; in an activity log available to tenant administrators. The log is
        tamper-evident: entries are hash-chained so the trail can be independently
        verified. This is both a security control and a compliance feature: most of the
        frameworks GRC Eye supports require an audit trail of changes to the control
        environment.
      </p>
      <p>
        Uploaded evidence and contracts carry file integrity checks and a version history,
        so you can show which version of a document was reviewed and that it has not been
        altered since.
      </p>

      <h2>Private AI on your terms</h2>
      <p>
        GRC Eye&apos;s AI features &mdash; gap analysis, contract review, document
        generation, vendor prescreening &mdash; are advisory: people make the final
        decisions. Where the AI runs is your choice:
      </p>
      <ul>
        <li>
          <strong>Private edition</strong> &mdash; run GRC Eye on-premises or air-gapped
          with a local model. Your control evidence, contracts and draft policies never
          leave your network: zero data egress.
        </li>
        <li>
          <strong>Bring your own AI model</strong> &mdash; connect your own Ollama or
          OpenAI-compatible endpoint, so AI processing runs where you decide.
        </li>
      </ul>

      <h2>Data protection</h2>
      <ul>
        <li>
          <strong>Encryption in transit</strong> &mdash; all traffic to the platform is
          served over TLS.
        </li>
        <li>
          <strong>Credential handling</strong> &mdash; passwords are stored as salted
          hashes, never in recoverable form.
        </li>
        <li>
          <strong>Session management</strong> &mdash; authentication uses short-lived access
          tokens with separate refresh tokens.
        </li>
        <li>
          <strong>Data ownership</strong> &mdash; your content is yours. See the{" "}
          <Link href={to("/terms")}>terms of service</Link> and{" "}
          <Link href={to("/privacy")}>privacy policy</Link>.
        </li>
      </ul>

      <h2>Deployment options</h2>
      <p>
        GRC Eye can be run as a managed SaaS deployment or, with the Private edition,
        installed on-premises in your own environment &mdash; as Docker containers, a VMware
        OVA appliance or an offline installer for air-gapped networks, with offline licence
        keys. On-premises deployments give you full data residency: the application, the
        database and the AI model all run on infrastructure you control, with no egress
        to us.
      </p>

      <h2>Reporting a vulnerability</h2>
      <p>
        If you believe you have found a security issue in GRC Eye, email{" "}
        <a href="mailto:security@grceye.com">security@grceye.com</a> with enough detail to
        reproduce it. We will acknowledge your report, keep you updated while we
        investigate, and will not pursue action against researchers who report in good
        faith, act within the scope of their own test environment, and give us reasonable
        time to remediate before disclosure.
      </p>
      <p>
        Please do not run automated scans or load tests against production without asking us
        first &mdash; contact us and we will arrange a window.
      </p>

      <h2>Security questionnaires</h2>
      <p>
        If you need a completed security questionnaire, a data processing agreement, or
        architecture detail for your vendor review, ask via the{" "}
        <Link href={to("/contact")}>contact form</Link> and we will turn it around.
      </p>
    </LegalPage>
  );
}
