import type { Metadata } from "next";
import HowItWorksView from "./HowItWorksView";

export const metadata: Metadata = {
  title: "How GRCEye Works — From Setup to Board Report in 30 Days",
  description: "See how GRCEye turns manual compliance into an automated programme. 4 steps from framework selection to board-ready reporting — no consultants needed.",
  keywords: "how GRC works, GRC implementation, compliance automation steps, GRC onboarding, GRC ROI, compliance programme setup",
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    title: "How GRCEye Works — From Setup to Board Report in 30 Days | GRCEye",
    description: "See how GRCEye turns manual compliance into an automated programme. 4 steps from framework selection to board-ready reporting.",
    url: "/how-it-works",
    type: "website",
    images: ["/logo-horizontal.png"],
  },
};

export default function HowItWorksPage() {
  return <HowItWorksView />;
}
