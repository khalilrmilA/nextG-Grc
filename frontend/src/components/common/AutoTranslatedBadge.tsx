import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Languages } from "lucide-react";

// ── Machine-translated system content ─────────────────────────────────────────
//
// The API translates SYSTEM content (built-in threats, feed items, regulatory
// feed items, built-in frameworks and requirements, CVE descriptions) into the
// UI language it receives in Accept-Language. A translated object carries
// `translated: true` and keeps the stored text in `original_<field>`. These
// helpers tell the reader the text is a machine translation and let them see
// the original. Edit forms must NOT use translated objects — they fetch with
// `original: 1` instead (see frameworksApi.get / getControls).

type Translatable = Record<string, any> | null | undefined;

/** The text of `field` to display: the original when `showOriginal` is on. */
export function pickText(item: Translatable, field: string, showOriginal = false): any {
  if (!item) return undefined;
  if (showOriginal && item.translated) return item[`original_${field}`] ?? item[field];
  return item[field];
}

/** The stored text behind a translated field, or undefined when not translated. */
export function originalOf(item: Translatable, field: string): string | undefined {
  if (!item) return undefined;
  const orig = item[`original_${field}`];
  return orig && orig !== item[field] ? String(orig) : undefined;
}

/** Per-item "show original" state for lists (keyed by id), plus a single flag for detail views. */
export function useShowOriginal() {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const isOriginal = useCallback((id: string) => ids.has(id), [ids]);
  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  return { isOriginal, toggle };
}

/** Pill saying the text is machine-translated, with a "Show original" toggle.
 *  `official`: the text is the regulator's own published translation (API flag
 *  `translation_official`, e.g. NCA's binding Arabic) — labelled as such, never as
 *  machine output. */
export function AutoTranslatedBadge({
  showingOriginal,
  onToggle,
  official = false,
  className = "",
}: {
  showingOriginal: boolean;
  onToggle: () => void;
  official?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${className}`}>
      {official ? (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
          title={t("common.official_text_hint", "Official text published by the regulator")}
        >
          <BadgeCheck className="w-3 h-3" />
          {t("common.official_text", "Official text")}
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold bg-sky-50 text-sky-700 border border-sky-200"
          title={t("common.auto_translated_hint", "Machine-translated from the original text")}
        >
          <Languages className="w-3 h-3" />
          {t("common.auto_translated", "Auto-translated")}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onToggle();
        }}
        className="font-medium text-sky-700 hover:text-sky-900 underline-offset-2 hover:underline"
      >
        {showingOriginal
          ? t("common.show_translation", "Show translation")
          : t("common.show_original", "Show original")}
      </button>
    </span>
  );
}

/** For dense tables: the displayed (possibly translated) text, with the original
 *  in a tooltip and a small marker. Renders children when given, else item[field]. */
export function TranslatedText({
  item,
  field,
  className,
  children,
}: {
  item: Translatable;
  field: string;
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const orig = originalOf(item, field);
  const content = children ?? item?.[field];
  if (!orig) return <span className={className}>{content}</span>;
  const official = !!item?.translation_official;
  const label = official
    ? t("common.official_text", "Official text")
    : t("common.auto_translated", "Auto-translated");
  return (
    <span className={className} title={`${label} — ${t("common.original_text", "Original")}: ${orig}`}>
      {content}
      {official ? (
        <BadgeCheck className="inline-block w-3 h-3 ms-1 text-emerald-500 align-[-2px]" aria-hidden="true" />
      ) : (
        <Languages className="inline-block w-3 h-3 ms-1 text-sky-500 align-[-2px]" aria-hidden="true" />
      )}
    </span>
  );
}
