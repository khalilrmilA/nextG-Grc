import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/landing/LegalPage";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { OG_IMAGE } from "@/lib/brand";

export function generateMetadata({ params }: { params: { locale: Locale } }): Metadata {
  const title = "Security at GRCEye | How We Protect Your Compliance Data";
  const description =
    "The security controls built into GRCEye: multi-factor authentication, role-based access control, tenant isolation, audit logging and self-hosted AI.";
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: canonicalUrl(params.locale, "/security"),
      languages: hreflangAlternates("/security"),
    },
    openGraph: {
      siteName: "GRCEye",
      title,
      description,
      url: canonicalUrl(params.locale, "/security"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: [OG_IMAGE],
    },
  };
}

export default function SecurityPage({ params }: { params: { locale: Locale } }) {
  const to = (path: string) => `/${params.locale}${path}`;
  return (
    <LegalPage
      title="Security"
      subtitle="A GRC platform holds the evidence of your entire control environment. Here is how GRCEye protects it."
      updated="8 September 2026"
    >
      <h2>Why this page exists</h2>
      <p>
        A governance, risk and compliance platform ends up holding the most sensitive
        summary of your organisation that exists anywhere: your gaps, your findings, your
        unremediated risks. That makes GRCEye itself a target, and makes our own security
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
          <strong>Role-based access control</strong> &mdash; every account carries a role
          (administrator, CISO, user, auditor) that determines which modules and records it
          can reach.
        </li>
        <li>
          <strong>Scoped auditor access</strong> &mdash; external auditors get a dedicated
          portal limited to the audits assigned to them and the documents attached to those
          audits. They never see the wider tenant.
        </li>
        <li>
          <strong>Single sign-on</strong> &mdash; SSO integration is available for
          organisations that centralise identity.
        </li>
      </ul>

      <h2>Tenant isolation</h2>
      <p>
        GRCEye is multi-tenant. Every record carries a tenant identifier, and every API
        endpoint resolves the caller&apos;s tenant from their authenticated session before
        it reads or writes anything. One customer&apos;s data is never reachable from
        another customer&apos;s session.
      </p>

      <h2>Audit trail</h2>
      <p>
        The platform records user actions &mdash; what was changed, by whom, and when
        &mdash; in an activity log available to tenant administrators. This is both a
        security control and a compliance feature: most of the frameworks GRCEye supports
        require an audit trail of changes to the control environment.
      </p>

      <h2>AI processing stays with you</h2>
      <p>
        This is the control that matters most for a GRC tool, and the one most competing
        platforms cannot offer. GRCEye&apos;s AI features &mdash; gap analysis, contract
        review, document generation, vendor prescreening &mdash; run on a locally hosted
        model rather than a third-party AI API.
      </p>
      <p>
        Your control evidence, contracts and draft policies are not sent to an external
        model vendor. For an on-premise deployment, they never leave your network at all.
        If you have ever had a compliance tool fail its own vendor security review because
        it shipped your audit evidence to an external API, this is the difference.
      </p>

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
        GRCEye can be run as a managed SaaS deployment or installed on-premise in your own
        environment. On-premise deployments give you full data residency: the application,
        the database and the AI model all run on infrastructure you control, with no egress
        to us.
      </p>

      <h2>Reporting a vulnerability</h2>
      <p>
        If you believe you have found a security issue in GRCEye, email{" "}
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
        <Link href={to("/contact")}>contact form</Link> and we will turn it around. Customers can
        also publish their own posture through the platform&apos;s built-in trust center.
      </p>
    </LegalPage>
  );
}
