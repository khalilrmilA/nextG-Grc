/**
 * Commercial packages — display names and the plan-limit 402 payload.
 *
 * Stored tier values never change (starter | professional | enterprise | elite);
 * only the marketing names do: professional (and legacy starter, and any trial)
 * = Growth, enterprise = Enterprise, elite = Elite. Names are i18n keys
 * `plan.<tier>` (see i18n/sweep/plans.ts).
 */
import type { TFunction } from "i18next";

export type PlanLimitKey = "max_contributors" | "max_frameworks" | "max_vendors";

/** detail of an HTTP 402 refused by app/services/plan_limits.py */
export interface PlanLimitDetail {
  code: "plan_limit";
  limit: PlanLimitKey;
  current: number;
  max: number;
  tier: string;
  plan: string;
  message?: string;
}

export function isPlanLimitDetail(detail: unknown): detail is PlanLimitDetail {
  return !!detail && typeof detail === "object" && (detail as { code?: string }).code === "plan_limit";
}

const FALLBACK: Record<string, string> = {
  starter: "Growth", professional: "Growth", enterprise: "Enterprise", elite: "Elite",
};

/** Marketing display name of a stored tier value, localised. */
export function planDisplayName(tier: string | null | undefined, t: TFunction): string {
  const key = (tier || "professional").toLowerCase();
  return String(t(`plan.${key}` as never, { defaultValue: FALLBACK[key] ?? key }));
}

/** The localised sentence for a plan-limit refusal (falls back to the server text). */
export function planLimitMessage(detail: PlanLimitDetail, t: TFunction): string {
  return String(t(`plan_limits.${detail.limit}` as never, {
    plan: planDisplayName(detail.tier, t),
    max: detail.max,
    current: detail.current,
    defaultValue: detail.message ?? "",
  }));
}

/** Marketing contact page (same origin: the marketing site fronts the app). */
export function contactUrl(lang: string | undefined): string {
  const l = ["en", "fr", "ar"].includes((lang || "").slice(0, 2)) ? (lang || "en").slice(0, 2) : "en";
  return `/${l}/contact`;
}
