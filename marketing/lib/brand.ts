import { SITE_URL, SITE_NAME } from "../app/constants";

/**
 * Single source of truth for the GRCEye brand entity.
 *
 * Why this file exists: Google does not currently recognise "GRCEye" as an
 * entity. A search for "grceye" gets rewritten to "GRC eye" / "GRC" and returns
 * generic governance-risk-compliance results, because an invented word with no
 * external citations and no self-declared identity has nothing to anchor to.
 * Everything below is the on-site half of fixing that: state the name, its
 * spelling variants, what it is, and every profile that corroborates it.
 *
 * The off-site half (LinkedIn company page, Crunchbase, G2/Capterra, Wikidata,
 * press) cannot be done from this repo — but the moment those exist their URLs
 * belong in SAME_AS below, which is what tells Google they are the same entity.
 */

/**
 * Canonical brand casing. "GRCEye" — capital G, R, C, E, then lowercase "ye".
 * Enforced across i18n dictionaries, metadata and JSON-LD. Mixed casing across
 * a site is a weak but real signal that the string is a common noun rather than
 * a name, which is exactly the confusion we are trying to undo.
 */
export const BRAND = SITE_NAME;

/**
 * Spelling variants Google should collapse into the same entity. This is the
 * direct countermeasure to the "grceye" -> "GRC eye" query rewrite: declaring
 * the variants tells Google they denote one thing rather than a typo to correct.
 */
export const BRAND_ALTERNATE_NAMES = ["GRCeye", "GRC Eye", "GRC-Eye", "GRCEYE"];

/**
 * External profiles that corroborate the entity.
 *
 * ONLY add URLs that actually resolve and actually belong to GRCEye. A sameAs
 * pointing at a 404 or at someone else's profile is worse than an empty array:
 * it is a false claim about identity and Google discounts the whole block.
 *
 * silentwolf.io is the sibling/parent company and already links here, so it is
 * a genuine reciprocal signal and safe to assert today.
 *
 * TODO(marketing): append each of these as it goes live —
 *   https://www.linkedin.com/company/grceye
 *   https://www.crunchbase.com/organization/grceye
 *   https://www.g2.com/products/grceye
 *   https://www.capterra.com/p/<id>/GRCEye
 *   https://github.com/grceye
 *   https://www.youtube.com/@grceye
 *   https://www.wikidata.org/wiki/<Q-id>
 */
export const SAME_AS: string[] = [
  "https://silentwolf.io/",
];

/** Country of operation. Feeds Organization.address without inventing a street. */
export const BRAND_COUNTRY = "TN";

/**
 * Topical scope. Helps Google associate the entity with the subject area it
 * should rank for, rather than leaving "GRCEye" as an unattached string.
 */
export const KNOWS_ABOUT = [
  "Governance, Risk and Compliance",
  "Information security management",
  "ISO/IEC 27001",
  "SOC 2",
  "NIST Cybersecurity Framework",
  "GDPR",
  "NIS2 Directive",
  "DORA",
  "Third-party risk management",
  "Risk quantification",
  "Internal audit",
  "Security policy management",
];

/** Stable @id anchors so the JSON-LD blocks reference one entity, not three. */
export const ORG_ID = `${SITE_URL}/#organization`;
export const SITE_ID = `${SITE_URL}/#website`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;

/** 1200x630 Open Graph card. Square app icons get cropped by every social platform. */
export const OG_IMAGE = "/og-image.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
