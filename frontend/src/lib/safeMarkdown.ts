/**
 * safeMarkdown — XSS-safe replacement for the per-page renderMarkdown helpers.
 *
 * The previous implementation applied regex transforms directly to model output
 * and dropped the result into dangerouslySetInnerHTML, which let a malicious
 * vendor name / risk title smuggle <img onerror> or <script> into a CISO's
 * browser. This helper escapes ALL HTML first, then re-introduces only the
 * tags it generated itself, so user/AI content can never inject HTML.
 *
 * Use:  <div dangerouslySetInnerHTML={{ __html: safeMarkdown(text) }} />
 */

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
  "/": "&#x2F;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`/]/g, (c) => HTML_ESCAPE[c] ?? c);
}

/**
 * Convert a Markdown-ish string to HTML, with all input pre-escaped.
 *
 * Supported tokens: ## / ### headings, **bold**, `code`, bullet/numbered lists,
 * blank-line paragraphs. Anything else stays as escaped text — no raw HTML
 * is ever permitted from the input.
 */
export function safeMarkdown(text: string): string {
  if (!text) return "";

  // 1. Escape everything up front. From here on we only INSERT trusted tags.
  let s = escapeHtml(text);

  // 2. Block-level transforms (headings) before inline rules touch them.
  s = s.replace(
    /^### (.+)$/gm,
    '<h4 class="text-xs font-semibold text-gray-700 mt-3 mb-1">$1</h4>',
  );
  s = s.replace(
    /^## (.+)$/gm,
    '<h3 class="text-sm font-bold text-gray-900 mt-4 mb-1 border-b border-gray-100 pb-1">$1</h3>',
  );

  // 3. Inline emphasis and inline code.
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(
    /`([^`\n]+?)`/g,
    '<code class="px-1 py-0.5 bg-gray-100 rounded text-[11px]">$1</code>',
  );

  // 4. Lists: bullets and numbered.
  s = s.replace(
    /^- (.+)$/gm,
    '<li class="ml-4 list-disc text-xs text-gray-600">$1</li>',
  );
  s = s.replace(
    /^\d+\. (.+)$/gm,
    '<li class="ml-4 list-decimal text-xs text-gray-600">$1</li>',
  );

  // 5. Newlines → <br/>. Tables and other structures are intentionally not
  // supported; if we add them later, do it via an allowlisted parser.
  s = s.replace(/\n/g, "<br/>");

  return s;
}
