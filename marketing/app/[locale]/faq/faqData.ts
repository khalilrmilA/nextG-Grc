// Categories + question ids - actual Q&A text lives in the i18n locale files
// under the `public.faq_q.*_q` / `*_a` keys, and category headings under
// `public.faq.cat_*`. Adjust here if you add/remove questions.
export const FAQ_ITEMS = [
  { category: "Getting Started",              ids: ["gs1", "gs2", "gs3", "gs4", "gs5"] },
  { category: "Risk Management",              ids: ["rm1", "rm2", "rm3", "rm4"] },
  { category: "Compliance & Frameworks",      ids: ["cf1", "cf6", "cf2", "cf3", "cf4", "cf5"] },
  { category: "Audit Management",             ids: ["au1", "au2", "au3", "au4"] },
  { category: "Policy & Document Management", ids: ["pol1", "pol2", "pol3", "pol4"] },
  { category: "Vendor Risk (TPRM)",           ids: ["vr1", "vr2", "vr3", "vr4"] },
  { category: "AI Capabilities",              ids: ["ai1", "ai2", "ai3", "ai4", "ai5", "ai6", "ai7", "ai8", "ai9"] },
  { category: "Security & Platform",          ids: ["sec1", "sec2", "sec3"] },
  { category: "Reporting & Integrations",     ids: ["rep1", "rep2", "rep3", "rep4"] },
] as const;

/** Optional in-site link rendered under an answer (path is locale-prefixed at render). */
export const FAQ_LINKS: Record<string, { href: string; labelKey: string }> = {
  gs5: { href: "/pricing", labelKey: "public.faq.see_pricing" },
};

export const FAQ_CATEGORY_KEYS: Record<string, string> = {
  "Getting Started":               "public.faq.cat_getting_started",
  "Risk Management":               "public.faq.cat_risk",
  "Compliance & Frameworks":       "public.faq.cat_compliance",
  "Audit Management":              "public.faq.cat_audit",
  "Policy & Document Management":  "public.faq.cat_policy",
  "Vendor Risk (TPRM)":            "public.faq.cat_vendor",
  "AI Capabilities":               "public.faq.cat_ai",
  "Security & Platform":           "public.faq.cat_security",
  "Reporting & Integrations":      "public.faq.cat_reporting",
};
