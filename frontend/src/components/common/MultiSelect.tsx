import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface MultiSelectOption {
  id: string;
  label: string;
}

/** Inline checkbox-dropdown multi-select — no external UI-library dependency. */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  emptyLabel,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const summary =
    selected.length === 0
      ? placeholder
      : options
          .filter((o) => selected.includes(o.id))
          .map((o) => o.label)
          .join(", ");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      >
        <span className={`truncate ${selected.length === 0 ? "text-gray-400" : "text-gray-800"}`}>{summary}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-gray-100">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="..."
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-sm text-gray-400 text-center">{emptyLabel}</div>
              ) : (
                filtered.map((o) => {
                  const checked = selected.includes(o.id);
                  return (
                    <button
                      type="button"
                      key={o.id}
                      onClick={() => toggle(o.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50"
                    >
                      <span
                        className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                          checked ? "bg-blue-600 border-blue-600" : "border-gray-300"
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className="truncate text-gray-700">{o.label}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
