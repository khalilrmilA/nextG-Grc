export type ChangelogTheme =
  | "platform" | "ai" | "compliance" | "tprm" | "security" | "risk" | "governance" | "enterprise";

export interface ChangelogEntry {
  id: string;
  /** Looks up public.changelog.{key}_title / {key}_desc in the locale files. */
  key: string;
  date: string;
  theme: ChangelogTheme;
}

// Chronological (oldest first) — the headline releases only, curated from the
// actual commit history. This is deliberately NOT a 1:1 mirror of git log:
// internal refactors, dependency bumps, i18n sweeps, and admin/role/permission
// plumbing (RBAC hardening, custom roles, access recertification, the Super
// Admin and Company Admin consoles, ...) are left out even where they shipped,
// so the page reads as a small set of major capabilities rather than an
// engineering ledger. Reversed to newest-first when rendered.
export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  { id: "1",  key: "c1",  date: "2026-02-27", theme: "platform" },
  { id: "2",  key: "c2",  date: "2026-03-02", theme: "ai" },
  { id: "3",  key: "c3",  date: "2026-03-04", theme: "compliance" },
  { id: "4",  key: "c4",  date: "2026-03-06", theme: "platform" },
  { id: "5",  key: "c5",  date: "2026-03-11", theme: "ai" },
  { id: "8",  key: "c8",  date: "2026-04-08", theme: "tprm" },
  { id: "10", key: "c10", date: "2026-04-13", theme: "security" },
  { id: "11", key: "c11", date: "2026-04-13", theme: "risk" },
  { id: "12", key: "c12", date: "2026-04-13", theme: "governance" },
  { id: "18", key: "c18", date: "2026-05-13", theme: "compliance" },
  { id: "20", key: "c20", date: "2026-08-12", theme: "risk" },
  { id: "21", key: "c21", date: "2026-08-12", theme: "security" },
  { id: "22", key: "c22", date: "2026-08-12", theme: "governance" },
  { id: "23", key: "c23", date: "2026-08-13", theme: "ai" },
  { id: "25", key: "c25", date: "2026-08-14", theme: "security" },
  { id: "27", key: "c27", date: "2026-08-18", theme: "security" },
  { id: "31", key: "c31", date: "2026-09-03", theme: "enterprise" },
  { id: "37", key: "c37", date: "2026-09-25", theme: "platform" },
  { id: "38", key: "c38", date: "2026-09-28", theme: "platform" },
];
