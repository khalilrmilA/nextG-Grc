import type { Metadata } from "next";
import SolutionsView from "./SolutionsView";

export const metadata: Metadata = {
  title: "Solutions",
  description:
    "GRCEye for SaaS, FinTech, Healthcare and Enterprise. Role-based workflows for CISOs, risk managers, compliance officers, auditors and policy managers.",
  keywords:
    "GRC for SaaS, GRC for FinTech, GRC for Healthcare, CISO software, compliance manager tools, risk manager platform",
  alternates: { canonical: "/solutions" },
  openGraph: {
    title: "Solutions | GRCEye",
    description:
      "GRCEye for SaaS, FinTech, Healthcare and Enterprise. Role-based workflows for CISOs, risk managers, compliance officers, auditors and policy managers.",
    url: "/solutions",
    type: "website",
    images: ["/logo.png"],
  },
};

export default function SolutionsPage() {
  return <SolutionsView />;
}
