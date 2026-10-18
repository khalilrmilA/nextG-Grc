/**
 * UI strings for the R2 lifecycle work (2026-10-18): edit / close / reopen / retire
 * flows across risks, scenarios, acceptances, vendors, policies, controls and
 * evidence. Everything lives under the `r2` namespace so it can never collide with
 * an existing key. Merged non-destructively in i18n/index.ts.
 */
const bundle: { en: Record<string, any>; fr: Record<string, any>; ar: Record<string, any> } = {
  en: {
    r2: {
      treatment: {
        justification: "Justification",
        error_justification: "A justification is required for every treatment decision",
      },
    },
  },
  fr: {
    r2: {
      treatment: {
        justification: "Justification",
        error_justification: "Une justification est requise pour chaque décision de traitement",
      },
    },
  },
  ar: {
    r2: {
      treatment: {
        justification: "المبرر",
        error_justification: "يلزم تقديم مبرر لكل قرار معالجة",
      },
    },
  },
};

export default bundle;
