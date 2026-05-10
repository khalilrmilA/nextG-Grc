import PublicFooter from "../components/landing/PublicFooter";
import { useTranslation } from "react-i18next";
import PublicNav from "../components/landing/PublicNav";
import SEO from "../components/seo/SEO";

const LAST_UPDATED = "May 1, 2026";
const EFFECTIVE_DATE = "May 1, 2026";

const SECTIONS = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    body: `By accessing or using the GRCEye platform (the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you are using the Service on behalf of an organisation, you represent that you have authority to bind that organisation to these Terms, and "you" refers to both you and the organisation.

If you do not agree to these Terms, do not use the Service.`,
  },
  {
    id: "description",
    title: "2. Description of Service",
    body: `GRCEye provides a cloud-based Governance, Risk and Compliance (GRC) platform that includes risk management, compliance tracking, audit workflows, policy management, vendor risk management, and AI-assisted document generation tools (collectively, the "Service").

We reserve the right to modify, suspend, or discontinue any part of the Service at any time with reasonable notice where practicable.`,
  },
  {
    id: "accounts",
    title: "3. Accounts and Access",
    body: `3.1 Registration. You must provide accurate, complete, and current information when registering. You are responsible for keeping your credentials confidential and for all activity under your account.

3.2 Authorised Users. Only individuals authorised by the account owner ("Authorised Users") may access the Service. You are responsible for ensuring Authorised Users comply with these Terms.

3.3 Account Security. You must notify us immediately at support@grceye.com if you suspect unauthorised access to your account. We are not liable for losses arising from unauthorised use where you have not exercised reasonable care.`,
  },
  {
    id: "acceptable-use",
    title: "4. Acceptable Use",
    body: `You agree not to:

• Use the Service for any unlawful purpose or in violation of applicable laws or regulations.
• Upload, transmit, or store content that is illegal, infringing, defamatory, or harmful.
• Attempt to gain unauthorised access to any part of the Service or its underlying infrastructure.
• Reverse engineer, decompile, or disassemble the Service or attempt to derive its source code.
• Use the Service to develop a competing product or service.
• Scrape, crawl, or extract data from the Service using automated means without our prior written consent.
• Interfere with or disrupt the integrity or performance of the Service.

We reserve the right to suspend or terminate access for violations of these rules without notice.`,
  },
  {
    id: "data",
    title: "5. Your Data",
    body: `5.1 Ownership. You retain all ownership rights to the data you upload or create within the Service ("Customer Data").

5.2 Licence to GRCEye. You grant GRCEye a limited, non-exclusive licence to store, process, and display your Customer Data solely to provide and improve the Service.

5.3 Responsibility. You are solely responsible for the accuracy, quality, and legality of your Customer Data. You represent that you have all necessary rights and permissions to upload that data.

5.4 Deletion. Upon termination, we will delete your Customer Data within 30 days unless a longer retention period is required by law.`,
  },
  {
    id: "ai",
    title: "6. AI-Powered Features",
    body: `The Service includes AI-assisted features (policy generation, risk analysis, contract review, etc.) powered by on-premise language models. You acknowledge that:

• AI-generated content is provided for informational and drafting purposes only and does not constitute legal, compliance, or professional advice.
• You are responsible for reviewing, validating, and approving any AI-generated output before relying on it.
• AI outputs may contain errors, omissions, or inaccuracies. GRCEye makes no warranty regarding the accuracy or completeness of AI-generated content.`,
  },
  {
    id: "ip",
    title: "7. Intellectual Property",
    body: `7.1 GRCEye IP. The Service, including all software, frameworks, templates, design, and content provided by GRCEye (excluding Customer Data), is owned by GRCEye and its licensors and is protected by intellectual property laws.

7.2 Feedback. If you provide feedback or suggestions about the Service, you grant GRCEye a perpetual, irrevocable, royalty-free licence to use that feedback without restriction or compensation.

7.3 Restrictions. You may not copy, modify, distribute, sell, or lease any part of the Service, or create derivative works, without our prior written consent.`,
  },
  {
    id: "payment",
    title: "8. Subscriptions and Payment",
    body: `8.1 Plans. The Service is offered on subscription plans. Fees are set out on our pricing page and may change on 30 days' notice.

8.2 Payment. Subscriptions are billed in advance on a monthly or annual basis. All fees are non-refundable except as expressly stated in these Terms or required by law.

8.3 Taxes. You are responsible for all applicable taxes. Fees do not include taxes unless explicitly stated.

8.4 Suspension for Non-Payment. We may suspend access to the Service if payment is overdue by more than 10 days, following notice to your registered email address.`,
  },
  {
    id: "confidentiality",
    title: "9. Confidentiality",
    body: `Each party agrees to keep confidential any non-public information of the other party that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and circumstances of disclosure ("Confidential Information").

Each party agrees to: (a) use Confidential Information only to exercise its rights and obligations under these Terms; and (b) protect it with at least the same degree of care it uses for its own confidential information, but no less than reasonable care.`,
  },
  {
    id: "warranties",
    title: "10. Warranties and Disclaimers",
    body: `10.1 GRCEye Warranty. We warrant that the Service will perform materially in accordance with its documentation under normal use. If the Service fails to meet this warranty, your sole remedy is for us to use commercially reasonable efforts to correct the issue.

10.2 Disclaimer. EXCEPT AS EXPRESSLY STATED IN SECTION 10.1, THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.`,
  },
  {
    id: "liability",
    title: "11. Limitation of Liability",
    body: `TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:

• NEITHER PARTY WILL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM OR RELATED TO THESE TERMS OR THE USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

• GRCEYE'S TOTAL AGGREGATE LIABILITY ARISING FROM OR RELATED TO THESE TERMS WILL NOT EXCEED THE AMOUNTS PAID BY YOU FOR THE SERVICE IN THE 12 MONTHS PRECEDING THE CLAIM.

Some jurisdictions do not allow the exclusion of certain warranties or the limitation of certain liabilities, so the above may not apply to you in full.`,
  },
  {
    id: "indemnification",
    title: "12. Indemnification",
    body: `You agree to indemnify, defend, and hold harmless GRCEye and its officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising from: (a) your use of the Service; (b) your Customer Data; (c) your violation of these Terms; or (d) your violation of any applicable law or third-party rights.`,
  },
  {
    id: "termination",
    title: "13. Term and Termination",
    body: `13.1 Term. These Terms remain in effect while you use the Service.

13.2 Termination by You. You may cancel your subscription at any time through your account settings or by contacting support@grceye.com. Cancellation takes effect at the end of the current billing period.

13.3 Termination by GRCEye. We may terminate or suspend your access immediately for material breach of these Terms, or with 30 days' notice for any other reason.

13.4 Effect of Termination. Upon termination, your right to use the Service ceases immediately. Sections 7, 9, 10, 11, 12, 14, and 15 survive termination.`,
  },
  {
    id: "governing-law",
    title: "14. Governing Law and Disputes",
    body: `These Terms are governed by and construed in accordance with the laws of the European Union and, where applicable, the laws of the jurisdiction in which GRCEye is incorporated, without regard to conflict of law principles.

Any disputes arising from or related to these Terms or the Service will be subject to the exclusive jurisdiction of the courts of that jurisdiction. You and GRCEye each waive any right to a jury trial.`,
  },
  {
    id: "general",
    title: "15. General Provisions",
    body: `15.1 Entire Agreement. These Terms, together with our Privacy Policy, constitute the entire agreement between you and GRCEye regarding the Service and supersede any prior agreements.

15.2 Modifications. We may update these Terms from time to time. We will notify you of material changes by email or in-app notice at least 14 days before the changes take effect. Your continued use after the effective date constitutes acceptance.

15.3 Severability. If any provision of these Terms is found unenforceable, it will be modified to the minimum extent necessary to make it enforceable, and the remaining provisions will continue in full force.

15.4 No Waiver. Our failure to enforce any right or provision of these Terms will not be deemed a waiver of that right or provision.

15.5 Assignment. You may not assign these Terms without our prior written consent. We may assign these Terms without restriction.

15.6 Force Majeure. Neither party is liable for failures or delays caused by circumstances beyond its reasonable control, provided the affected party gives prompt notice.`,
  },
  {
    id: "contact",
    title: "16. Contact",
    body: `If you have any questions about these Terms, please contact us:

Email: legal@grceye.com
Support: support@grceye.com
Contact form: grceye.com/contact`,
  },
];

export default function TermsPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <SEO
        title="Terms of Service"
        description="Read the GRCEye Terms of Service — the rules that govern your use of the GRCEye GRC platform, including your rights, obligations, and our liability limitations."
        path="/terms"
        keywords="GRCEye terms of service, GRC platform terms, terms and conditions"
      />

      <PublicNav links={[
        { to: "/",                 label: t("public.nav.home")      },
        { to: "/features-landing", label: t("public.nav.features")  },
        { to: "/solutions",        label: t("public.nav.solutions") },
        { to: "/faq",              label: t("public.nav.faq")       },
        { to: "/contact",          label: t("public.nav.contact")   },
      ]} />

      <div className="h-20" />

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-12 pb-8">
        <p className="text-xs font-semibold text-blue-600 uppercase tracking-widest mb-3">Legal</p>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
          Terms of Service
        </h1>
        <div className="flex flex-wrap gap-6 text-sm text-gray-500">
          <span>Effective: <strong className="text-gray-700">{EFFECTIVE_DATE}</strong></span>
          <span>Last updated: <strong className="text-gray-700">{LAST_UPDATED}</strong></span>
        </div>
        <p className="mt-6 text-gray-600 leading-relaxed max-w-3xl">
          Please read these Terms carefully before using the GRCEye platform. They explain your rights and obligations and form a binding agreement between you and GRCEye, Inc.
        </p>
      </section>

      {/* Table of contents + body */}
      <section className="max-w-4xl mx-auto px-6 pb-24 grid lg:grid-cols-4 gap-10">
        {/* TOC */}
        <aside className="lg:col-span-1 hidden lg:block">
          <div className="sticky top-24 bg-gray-50 border border-gray-100 rounded-2xl p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Contents</p>
            <ul className="space-y-1.5">
              {SECTIONS.map(s => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="text-sm text-gray-600 hover:text-blue-600 transition-colors leading-snug block"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Sections */}
        <div className="lg:col-span-3 space-y-10">
          {SECTIONS.map(s => (
            <div key={s.id} id={s.id} className="scroll-mt-28">
              <h2 className="text-xl font-bold text-gray-900 mb-3">{s.title}</h2>
              <div className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">
                {s.body}
              </div>
            </div>
          ))}

          <div className="border-t border-gray-100 pt-8">
            <p className="text-xs text-gray-400">
              These Terms of Service were last updated on {LAST_UPDATED}. Previous versions are available on request.
            </p>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
