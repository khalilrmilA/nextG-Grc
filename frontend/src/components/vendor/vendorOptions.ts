// Vendor form vocabularies, shared by the new-vendor wizard and the edit form.
export type Tier   = "critical" | "high" | "medium" | "low";
export type Status = "active" | "under_review" | "onboarding" | "offboarding" | "inactive";

export const TIER_OPTIONS:   Tier[]   = ["critical", "high", "medium", "low"];
export const STATUS_OPTIONS: Status[] = ["active", "under_review", "onboarding", "offboarding", "inactive"];
export const INDUSTRY_OPTIONS = [
  "Cloud Infrastructure", "Telecommunications", "Payment Processing",
  "Identity & Access Mgmt", "Email Services", "Analytics", "Data Backup",
  "CRM / SaaS", "Security Services", "HR / Payroll", "Legal Tech",
  "IT Support & Maintenance", "Network Services", "Database Services",
  "Consulting & Advisory", "Managed Services Provider (MSP)",
  "Software Development", "Testing & QA", "Hosting & Colocation",
  "Disaster Recovery", "Backup & Archive", "Development Tools",
  "Supply Chain Management", "Healthcare Services", "Financial Services",
  "Insurance", "Retail & E-commerce", "Manufacturing", "Logistics",
  "Education", "Government", "Non-Profit", "Media & Entertainment",
  "Real Estate", "Travel & Hospitality", "Transportation", "Energy",
  "Utilities", "Pharmaceuticals", "Other",
];

/** i18n key suffix for an industry value (the stored value stays English). */
export const industryKey = (o: string) => o.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// An ended relationship is set through Offboard (date + reason), never by a plain edit.
export const ENDED_STATUSES: Status[] = ["offboarding", "inactive"];
