import type { Metadata } from "next";
import HowItWorksView from "./HowItWorksView";

export const metadata: Metadata = {
  title: "How GRCEye Works — AI-Powered GRC Explained",
  description: "GRCEye AI: vendor chat, contract review, document generation, gap analysis — all on-premise. Zero data egress. See exactly how each AI feature works.",
  keywords: "how GRC works, AI contract review, AI document generator, GRC AI assistant, vendor risk AI, compliance gap analysis AI",
  alternates: { canonical: "https://grceye.com/how-it-works" },
  openGraph: {
    title: "How GRCEye Works — AI-Powered GRC Explained | GRCEye",
    description: "GRCEye AI: vendor chat, contract review, document generation, gap analysis — all on-premise. Zero data egress. See exactly how each AI feature works.",
    url: "https://grceye.com/how-it-works",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

export default function HowItWorksPage() {
  return <HowItWorksView />;
}
