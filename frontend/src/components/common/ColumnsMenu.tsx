/**
 * ColumnsMenu — "Columns" button + dropdown of checkboxes, paired with
 * useColumnVisibility. Drop next to a table's existing filter/search controls.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Columns3, RotateCcw } from "lucide-react";
import type { ColumnDef } from "./useColumnVisibility";

interface Props {
  readonly columns: ColumnDef[];
  readonly isVisible: (key: string) => boolean;
  readonly toggle: (key: string) => void;
  readonly reset: () => void;
}

export default function ColumnsMenu({ columns, isVisible, toggle, reset }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggleable = columns.filter((c) => c.lockable !== false);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (toggleable.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        <Columns3 className="w-4 h-4" /> {t("columns.button")}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t("columns.title")}</span>
            <button type="button" onClick={reset} title={t("columns.reset")} className="text-gray-400 hover:text-gray-600">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {toggleable.map((col) => (
              <label
                key={col.key}
                className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isVisible(col.key)}
                  onChange={() => toggle(col.key)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
