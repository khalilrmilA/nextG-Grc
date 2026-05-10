import type { Metadata } from "next";
import FrameworksView from "./FrameworksView";

export const metadata: Metadata = {
  title: "GRC Frameworks — 70+ Built-in, Fork Any, Build Your Own",
  description: "GRCEye ships with 70+ compliance frameworks. Fork any to create an editable copy, or build a custom framework from scratch with the AI-powered builder.",
  keywords: "GRC frameworks, ISO 27001, SOC 2, GDPR, DORA, NIS2, HIPAA, custom compliance framework, framework builder, compliance mapping",
  alternates: { canonical: "https://grceye.com/frameworks" },
  openGraph: {
    title: "GRC Frameworks — 70+ Built-in, Fork Any, Build Your Own | GRCEye",
    description: "GRCEye ships with 70+ compliance frameworks. Fork any to create an editable copy, or build a custom framework from scratch with the AI-powered builder.",
    url: "https://grceye.com/frameworks",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

export default function FrameworksPage() {
  return <FrameworksView />;
}
