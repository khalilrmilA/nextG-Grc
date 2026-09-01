/**
 * useColumnVisibility — per-user, per-page column show/hide, persisted in
 * localStorage (client-side only, no backend model — see CLAUDE.md T13).
 *
 * Usage:
 *   const COLUMNS: ColumnDef[] = [
 *     { key: "title", label: t("risks.risk_title"), lockable: false }, // always visible
 *     { key: "category", label: t("risks.category") },
 *     ...
 *   ];
 *   const { isVisible, toggle, reset, visibleCount } = useColumnVisibility("risks", COLUMNS);
 *   ...
 *   {isVisible("category") && <th>...</th>}
 *
 * Storage key: `grc_columns_<pageKey>_v1`. A column with `lockable: false`
 * (e.g. the row's primary title/name, or a trailing actions column) is
 * always rendered — it isn't offered as a checkbox and can't be hidden, so
 * row-click-to-open and edit/delete affordances never disappear.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export interface ColumnDef {
  /** Stable identifier — used as the localStorage key and the React key. */
  key: string;
  /** Display label for the checkbox in the Columns menu. */
  label: string;
  /** Set false for a column that must always stay visible (default true). */
  lockable?: boolean;
}

type VisibilityMap = Record<string, boolean>;

function readStoredVisibility(storageKey: string): VisibilityMap {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function useColumnVisibility(pageKey: string, columns: ColumnDef[]) {
  const storageKey = `grc_columns_${pageKey}_v1`;
  const [overrides, setOverrides] = useState<VisibilityMap>(() => readStoredVisibility(storageKey));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(overrides));
    } catch {
      // Private browsing / storage quota — column prefs just won't persist.
    }
  }, [storageKey, overrides]);

  const isVisible = useCallback(
    (key: string) => {
      const col = columns.find((c) => c.key === key);
      if (col?.lockable === false) return true;
      return overrides[key] !== false;
    },
    [columns, overrides]
  );

  const toggle = useCallback((key: string) => {
    setOverrides((prev) => ({ ...prev, [key]: prev[key] === false ? true : false }));
  }, []);

  const reset = useCallback(() => setOverrides({}), []);

  const visibleCount = useMemo(() => columns.filter((c) => isVisible(c.key)).length, [columns, isVisible]);

  return { isVisible, toggle, reset, visibleCount };
}
