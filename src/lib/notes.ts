import sanitizeHtml from "sanitize-html";

/** Pipedrive notes are HTML. Convert to plain text, keeping link URLs. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ");
  // Keep the href of links, drop the anchor text if it is just the URL.
  const linksKept = withBreaks.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi,
    (_m, href: string, text: string) => {
      const t = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }).trim();
      const h = decodeEntities(href);
      return !t || decodeEntities(t) === h || h.startsWith(decodeEntities(t)) ? h : `${t} (${h})`;
    },
  );
  const text = sanitizeHtml(linksKept, { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(text).replace(/\n{3,}/g, "\n\n").trim();
}

/** Plain text -> simple HTML for writing back to Pipedrive. */
export function textToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener noreferrer" target="_blank">$1</a>')
    .replace(/\n/g, "<br>");
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
