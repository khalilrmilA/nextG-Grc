import type { Metadata } from "next";
import NewsView from "./NewsView";

export const metadata: Metadata = {
  title: "Regulatory News & Framework Updates",
  description:
    "Track the latest GRC regulatory changes: EU AI Act, NIST CSF 2.0, GDPR enforcement, NIS2 deadlines, ISO 27001 updates and DORA milestones.",
  keywords:
    "EU AI Act news, NIST CSF 2.0, GDPR enforcement, NIS2 deadline, ISO 27001 update, DORA news, regulatory updates",
  alternates: { canonical: "/news" },
  openGraph: {
    title: "Regulatory News & Framework Updates | GRCEye",
    description:
      "Track the latest GRC regulatory changes: EU AI Act, NIST CSF 2.0, GDPR enforcement, NIS2 deadlines, ISO 27001 updates and DORA milestones.",
    url: "/news",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

export default function NewsPage() {
  return <NewsView />;
}
