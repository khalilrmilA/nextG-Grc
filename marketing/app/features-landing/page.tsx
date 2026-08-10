import type { Metadata } from "next";
import FeaturesView from "./FeaturesView";

export const metadata: Metadata = {
  title: "GRC Platform Features | Risk, Compliance & AI Tools",
  description:
    "Explore GRCEye modules: risk register, Monte Carlo quantification, multi-framework compliance, AI gap analysis, audits, policies and vendor risk.",
  keywords:
    "GRC features, risk register, Monte Carlo risk, AI compliance, gap analysis, audit management, vendor risk, TPRM, policy management, threat library",
  alternates: { canonical: "/features-landing" },
  openGraph: {
    title: "GRC Platform Features: Risk, Compliance & AI Tools | GRCEye",
    description:
      "Explore every GRCEye module: risk register, Monte Carlo risk quantification, multi-framework compliance, AI gap analysis, audits, policies, vendor risk and more.",
    url: "/features-landing",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

export default function FeaturesLandingPage() {
  return <FeaturesView />;
}
