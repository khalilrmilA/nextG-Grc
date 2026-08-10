import type { Metadata } from "next";
import BlogView from "./BlogView";

export const metadata: Metadata = {
  title: { absolute: "GRC Blog | NIS2, ISO 27001, Risk Quantification & More" },
  description:
    "In-depth articles on GRC: NIS2 compliance, risk quantification, contract review with AI, auditor portals and how to build custom frameworks.",
  keywords:
    "GRC blog, NIS2 article, risk quantification guide, ISO 27001 tips, audit blog, compliance articles",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "GRC Blog | NIS2, ISO 27001, Risk Quantification & More",
    description:
      "In-depth articles on GRC: NIS2 compliance, risk quantification, contract review with AI, auditor portals and how to build custom frameworks.",
    url: "/blog",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

export default function BlogPage() {
  return <BlogView />;
}
