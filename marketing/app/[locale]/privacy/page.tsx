import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/landing/LegalPage";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { OG_IMAGE } from "@/lib/brand";

export async function generateMetadata(props: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const params = await props.params;
  const title = "Privacy Policy | GRCEye";
  const description =
    "How GRCEye collects, uses, stores and protects personal data, and the rights you have over it under the GDPR.";
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: canonicalUrl(params.locale, "/privacy"),
      languages: hreflangAlternates("/privacy"),
    },
    openGraph: {
      siteName: "GRCEye",
      title,
      description,
      url: canonicalUrl(params.locale, "/privacy"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: [OG_IMAGE],
    },
  };
}

export default async function PrivacyPage(props: { params: Promise<{ locale: Locale }> }) {
  const params = await props.params;
  const to = (path: string) => `/${params.locale}${path}`;
  return (
    <LegalPage
      title="Privacy Policy"
      subtitle="How GRCEye handles personal data, and what rights you have over it."
      updated="8 September 2026"
    >
      <h2>1. Who we are</h2>
      <p>
        GRCEye provides a governance, risk and compliance (GRC) SaaS platform. This policy
        explains what personal data we process when you visit grceye.com or use the GRCEye
        application, why we process it, and how you can exercise your rights.
      </p>
      <p>
        For any privacy question, or to exercise any of the rights described in section 7,
        contact <a href="mailto:privacy@grceye.com">privacy@grceye.com</a>.
      </p>

      <h2>2. Data we collect</h2>
      <h3>Data you give us</h3>
      <ul>
        <li>
          <strong>Account data</strong> &mdash; name, work email address, organisation name
          and role, provided when you register or when an administrator creates your account.
        </li>
        <li>
          <strong>Contact data</strong> &mdash; anything you type into the contact form or
          send to one of our published email addresses.
        </li>
        <li>
          <strong>Customer content</strong> &mdash; the risks, controls, policies, evidence,
          audit records and vendor information you enter into the platform. We process this
          on your instructions as a processor; you remain the controller.
        </li>
      </ul>
      <h3>Data we collect automatically</h3>
      <ul>
        <li>
          <strong>Authentication and session data</strong> &mdash; needed to keep you signed
          in and to enforce access control.
        </li>
        <li>
          <strong>Activity logs</strong> &mdash; the platform records actions taken in your
          tenant. This is a compliance feature: an audit trail is required by most of the
          frameworks GRCEye supports.
        </li>
        <li>
          <strong>Technical data</strong> &mdash; IP address, browser and device type, and
          request timestamps, retained for security monitoring and abuse prevention.
        </li>
      </ul>

      <h2>3. Why we process it</h2>
      <ul>
        <li>
          <strong>To provide the service</strong> (performance of a contract) &mdash;
          authentication, delivering platform functionality, support.
        </li>
        <li>
          <strong>To secure the service</strong> (legitimate interest) &mdash; detecting
          abuse, investigating incidents, maintaining the audit trail.
        </li>
        <li>
          <strong>To communicate with you</strong> (legitimate interest, or consent where
          required) &mdash; service notices, and replies to enquiries you send us.
        </li>
        <li>
          <strong>To meet legal obligations</strong> &mdash; where retention or disclosure
          is required by applicable law.
        </li>
      </ul>
      <p>
        We do not sell personal data, and we do not use customer content to train
        general-purpose AI models.
      </p>

      <h2>4. AI processing</h2>
      <p>
        GRCEye&apos;s AI features run on infrastructure under our or your control rather
        than being sent to a third-party AI provider. Content you submit to an AI feature
        &mdash; a contract for review, a policy to generate, controls to analyse &mdash; is
        processed to return that result and is not shared with an external model vendor.
        Self-hosted and on-premise deployments keep this processing entirely within your own
        environment.
      </p>

      <h2>5. Sharing</h2>
      <p>We share personal data only with:</p>
      <ul>
        <li>
          <strong>Infrastructure and email providers</strong> acting as our sub-processors,
          under contract and only as needed to run the service.
        </li>
        <li>
          <strong>Other users in your tenant</strong>, according to the role-based access
          control your administrator configures.
        </li>
        <li>
          <strong>Authorities</strong>, where we are legally compelled to disclose.
        </li>
      </ul>

      <h2>6. Retention</h2>
      <p>
        Account and customer content is retained for the life of your subscription. After
        termination we delete or return customer content within a commercially reasonable
        period, except where retention is required by law. Security and audit logs are
        retained for as long as needed for their security and compliance purpose.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Where the GDPR or an equivalent regime applies, you have the right to access,
        rectify, erase, restrict and port your personal data, and to object to processing
        based on legitimate interest. Where processing rests on consent, you may withdraw it
        at any time. Send requests to{" "}
        <a href="mailto:privacy@grceye.com">privacy@grceye.com</a>; we respond within one
        month. You may also complain to your local supervisory authority.
      </p>
      <p>
        If you are an end user of a GRCEye customer, direct your request to that
        organisation first &mdash; they are the controller of the data in their tenant, and
        we act on their instructions.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Where personal data is transferred outside its country of origin, we rely on an
        appropriate transfer mechanism, such as the European Commission&apos;s Standard
        Contractual Clauses. On-premise and self-hosted deployments involve no transfer to
        us at all.
      </p>

      <h2>9. Cookies</h2>
      <p>
        The application uses strictly necessary cookies for authentication and session
        management, plus a preference cookie that remembers your language choice. These are
        required for the service to function and are not used for advertising or
        cross-site tracking.
      </p>

      <h2>10. Security</h2>
      <p>
        Technical and organisational measures &mdash; encryption in transit, role-based
        access control, tenant isolation, multi-factor authentication and audit logging
        &mdash; are described on our{" "}
        <Link href={to("/security")}>security page</Link>.
      </p>

      <h2>11. Changes</h2>
      <p>
        We will update this policy as the service evolves and will revise the &ldquo;last
        updated&rdquo; date above. Material changes will be communicated to account holders
        directly.
      </p>

      <h2>12. Contact</h2>
      <p>
        Privacy: <a href="mailto:privacy@grceye.com">privacy@grceye.com</a> &middot; General:{" "}
        <Link href={to("/contact")}>contact form</Link>
      </p>
    </LegalPage>
  );
}
