import type { Metadata } from "next";
import LandingView from "./LandingView";

export const metadata: Metadata = {
  title: { absolute: "GRCEye — Governance, Risk & Compliance Platform" },
  description:
    "The all-in-one GRC SaaS platform. 70+ compliance frameworks, AI gap analysis, risk quantification, audits, policies, vendor risk and a public trust center — built for security teams and CISOs.",
  keywords:
    "GRC platform, governance risk compliance, ISO 27001, SOC 2, NIST CSF, GDPR, NIS2, DORA, risk management software, compliance automation, AI compliance, vendor risk management, TPRM, audit software, policy management",
  alternates: { canonical: "https://grceye.com/" },
  openGraph: {
    title: "GRCEye — Governance, Risk & Compliance Platform",
    description:
      "The all-in-one GRC SaaS platform with 70+ frameworks, AI gap analysis, risk quantification, audits, policies and vendor risk.",
    url: "/",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
  twitter: {
    title: "GRCEye — Governance, Risk & Compliance Platform",
    description:
      "The all-in-one GRC SaaS platform with 70+ frameworks, AI gap analysis, risk quantification, audits, policies and vendor risk.",
  },
};

export default function HomePage() {
  return <LandingView />;
}
