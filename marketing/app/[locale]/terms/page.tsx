import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/landing/LegalPage";
import { canonicalUrl, hreflangAlternates, OG_LOCALE, type Locale } from "@/lib/seo";
import { OG_IMAGE } from "@/lib/brand";

export function generateMetadata({ params }: { params: { locale: Locale } }): Metadata {
  const title = "Terms of Service | GRCEye";
  const description =
    "The terms governing use of the GRCEye governance, risk and compliance platform: subscriptions, acceptable use, data ownership and liability.";
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: canonicalUrl(params.locale, "/terms"),
      languages: hreflangAlternates("/terms"),
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl(params.locale, "/terms"),
      type: "website",
      locale: OG_LOCALE[params.locale],
      images: [OG_IMAGE],
    },
  };
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      subtitle="The agreement between you and GRCEye for use of the platform."
      updated="8 September 2026"
    >
      <h2>1. Agreement</h2>
      <p>
        These terms govern your access to and use of the GRCEye platform and the grceye.com
        website. By creating an account, or by using the service on behalf of an
        organisation, you accept these terms. If you are accepting on behalf of an
        organisation, you confirm you have authority to bind it.
      </p>

      <h2>2. The service</h2>
      <p>
        GRCEye provides a governance, risk and compliance platform covering compliance
        assessment, risk management and quantification, audit management, policy and
        document generation, third-party risk management and related functionality. We may
        add, change or remove features; we will not materially degrade the core
        functionality of a paid subscription during its term.
      </p>

      <h2>3. Accounts</h2>
      <p>
        You are responsible for the accuracy of your account details, for the security of
        your credentials, and for all activity under your account. Enable multi-factor
        authentication where it is available. Tell us promptly at{" "}
        <a href="mailto:security@grceye.com">security@grceye.com</a> if you suspect
        unauthorised access.
      </p>

      <h2>4. Subscriptions and payment</h2>
      <p>
        Paid subscriptions run for the term stated at purchase and renew unless cancelled
        before the end of the current term. Fees are payable in advance and are
        non-refundable except where required by law. Trials are provided as described at
        sign-up and convert only if you choose to subscribe.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the service unlawfully, or to store or transmit unlawful content.</li>
        <li>
          Attempt to gain unauthorised access to the service, other tenants, or any
          underlying infrastructure.
        </li>
        <li>
          Probe, scan or load-test the service without our prior written consent. If you
          want to run a security test, ask us first &mdash; we will usually say yes.
        </li>
        <li>
          Reverse engineer, decompile or attempt to derive the source code of the service,
          except to the extent that restriction is unenforceable under applicable law.
        </li>
        <li>Resell or provide the service to third parties except as expressly agreed.</li>
      </ul>

      <h2>6. Your data</h2>
      <p>
        You retain all rights in the content you put into the platform. You grant us only
        the licence needed to host, process and display that content in order to provide the
        service. We process personal data as described in our{" "}
        <Link href="/privacy">privacy policy</Link>. We do not use your content to train
        general-purpose AI models.
      </p>
      <p>
        You are responsible for having the necessary rights and lawful basis for the content
        you upload, including any personal data it contains.
      </p>

      <h2>7. AI-generated output</h2>
      <p>
        The platform generates documents, gap analyses, risk assessments and contract
        reviews using AI. This output is a drafting and analysis aid, not legal, audit or
        regulatory advice, and it can be wrong. You are responsible for reviewing and
        validating any AI-generated output before relying on it, and for any decision taken
        on the basis of it. GRCEye does not warrant that use of the platform will result in
        certification against any framework, or in a passed audit.
      </p>

      <h2>8. Availability</h2>
      <p>
        We aim for high availability but do not guarantee uninterrupted service unless a
        service level agreement has been agreed separately in writing. Maintenance,
        third-party failures and force majeure events may cause interruption.
      </p>

      <h2>9. Intellectual property</h2>
      <p>
        The platform, its software, design and documentation remain our property or that of
        our licensors. These terms grant you a limited, non-exclusive, non-transferable
        right to use the service during your subscription, and nothing more.
      </p>

      <h2>10. Termination</h2>
      <p>
        You may cancel at any time, effective at the end of the current term. We may suspend
        or terminate access for material breach of these terms, for non-payment, or where
        required by law. On termination you may export your data for a reasonable period,
        after which we delete it in line with our retention practice.
      </p>

      <h2>11. Warranties and liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; to the fullest extent permitted by law,
        and we disclaim implied warranties of merchantability, fitness for a particular
        purpose and non-infringement. To the extent permitted by law, neither party is
        liable for indirect, incidental or consequential loss, or for lost profits or data,
        and our aggregate liability is limited to the fees you paid in the twelve months
        preceding the claim. Nothing limits liability that cannot lawfully be limited.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        We may update these terms; the &ldquo;last updated&rdquo; date above will change and
        material revisions will be notified to account holders. Continued use after a change
        takes effect constitutes acceptance.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these terms: <Link href="/contact">contact us</Link> or email{" "}
        <a href="mailto:sales@grceye.com">sales@grceye.com</a>.
      </p>
    </LegalPage>
  );
}
