import type { Metadata } from "next";
import ContactView from "./ContactView";

export const metadata: Metadata = {
  title: "Contact us",
  description:
    "Talk to the GRCEye team. Sales, support, partnerships, demos. We typically reply within one business day.",
  keywords: "contact GRCEye, GRC demo, GRC sales contact, GRCEye support",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact us | GRCEye",
    description:
      "Talk to the GRCEye team. Sales, support, partnerships, demos. We typically reply within one business day.",
    url: "/contact",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

const contactJsonLd = {
  "@context": "https://schema.org",
  "@type": "ContactPage",
  url: "https://grceye.com/contact",
  name: "Contact GRCEye",
  description: "Get in touch with the GRCEye team — sales, support, partnerships.",
};

export default function ContactPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(contactJsonLd) }} />
      <ContactView />
    </>
  );
}
