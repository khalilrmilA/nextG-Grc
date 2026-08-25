import type { BlogPost } from "../posts";
import type { Locale } from "@/lib/seo";
import type { PostTranslations } from "./types";

import nis2 from "./nis2-directive-explained-cisos-2026";
import isoVsSoc2 from "./iso-27001-vs-soc-2-which-first";
import riskQuant from "./risk-quantification-from-heatmaps-to-monte-carlo";
import dora from "./dora-compliance-financial-services-2026";
import tprm from "./ciso-guide-vendor-risk-management-tprm-2026";
import aiAct from "./eu-ai-act-security-teams-ai-governance";
import automationCost from "./grc-automation-2026-cost-of-manual-compliance";
import aiGrc from "./ai-powered-grc-automation-iso27001-soc2-nis2";
import autoRisk from "./automated-risk-management-monte-carlo-quantification";
import continuousCompliance from "./continuous-compliance-monitoring-vs-annual-audits";
import vendorRiskAuto from "./vendor-risk-management-automation-ai-contract-review";
import crossFramework from "./cross-framework-compliance-iso-nist-soc2-gdpr-dora";

const TRANSLATIONS: Record<string, PostTranslations> = {
  "nis2-directive-explained-cisos-2026": nis2,
  "iso-27001-vs-soc-2-which-first": isoVsSoc2,
  "risk-quantification-from-heatmaps-to-monte-carlo": riskQuant,
  "dora-compliance-financial-services-2026": dora,
  "ciso-guide-vendor-risk-management-tprm-2026": tprm,
  "eu-ai-act-security-teams-ai-governance": aiAct,
  "grc-automation-2026-cost-of-manual-compliance": automationCost,
  "ai-powered-grc-automation-iso27001-soc2-nis2": aiGrc,
  "automated-risk-management-monte-carlo-quantification": autoRisk,
  "continuous-compliance-monitoring-vs-annual-audits": continuousCompliance,
  "vendor-risk-management-automation-ai-contract-review": vendorRiskAuto,
  "cross-framework-compliance-iso-nist-soc2-gdpr-dora": crossFramework,
};

/**
 * Returns `post` with its translatable fields swapped for the target locale's
 * translation, falling back to the English source for any locale/post pair
 * that has no translation on file (never renders missing/blank content).
 */
export function localizePost(post: BlogPost, locale: Locale): BlogPost {
  if (locale === "en") return post;
  const t = TRANSLATIONS[post.slug]?.[locale as "fr" | "ar"];
  if (!t) return post;
  return {
    ...post,
    title: t.title,
    metaTitle: t.metaTitle,
    metaDescription: t.metaDescription,
    keywords: t.keywords,
    excerpt: t.excerpt,
    body: t.body,
    faqs: t.faqs,
  };
}
