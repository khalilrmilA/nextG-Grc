import type { Metadata } from "next";
import SolutionsView from "./SolutionsView";

export const metadata: Metadata = {
  title: "GRC Solutions for SaaS, FinTech, Healthcare & Enterprise",
  description:
    "GRCEye cuts compliance costs 40%, shortens enterprise deals 3–5 weeks, and gives boards a live risk score — for SaaS, FinTech, Healthcare & Enterprise.",
  keywords:
    "GRC for SaaS, GRC for FinTech, GRC for Healthcare, compliance cost reduction, CEO GRC platform, enterprise GRC solution",
  alternates: { canonical: "/solutions" },
  openGraph: {
    title: "GRC Solutions for SaaS, FinTech, Healthcare & Enterprise | GRCEye",
    description:
      "GRCEye cuts compliance costs 40%, shortens enterprise deals 3–5 weeks, and gives boards a live risk score — for SaaS, FinTech, Healthcare & Enterprise.",
    url: "/solutions",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

export default function SolutionsPage() {
  return <SolutionsView />;
}
