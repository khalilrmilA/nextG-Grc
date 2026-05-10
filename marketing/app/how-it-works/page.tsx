import type { Metadata } from "next";
import HowItWorksView from "./HowItWorksView";

export const metadata: Metadata = {
  title: "How GRCEye Works — AI-Powered GRC Explained",
  description: "See how GRCEye's AI works: vendor chat, AI contract review, document generation, compliance gap analysis, and on-premise AI that never sends your data anywhere.",
  keywords: "how GRC works, AI contract review, AI document generator, GRC AI assistant, vendor risk AI, compliance gap analysis AI",
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    title: "How GRCEye Works — AI-Powered GRC Explained | GRCEye",
    description: "See how GRCEye's AI works: vendor chat, AI contract review, document generation, compliance gap analysis, and on-premise AI that never sends your data anywhere.",
    url: "/how-it-works",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

export default function HowItWorksPage() {
  return <HowItWorksView />;
}
