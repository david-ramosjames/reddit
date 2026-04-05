/**
 * Text helpers for keyword matching and normalization.
 */

const WS = /\s+/g;

export function normalizeText(s: string): string {
  return s.trim().replace(WS, " ").toLowerCase();
}

export function combinePostText(title: string, selftext: string): string {
  return normalizeText(`${title}\n${selftext}`);
}

/**
 * Strip basic HTML from RSS description/content for use as selftext.
 */
export function stripHtmlToText(html: string): string {
  if (!html.trim()) return "";
  const noTags = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return normalizeText(
    noTags
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
  );
}

/** True if body looks removed/deleted. */
export function isRemovedOrDeletedContent(author: string, selftext: string): boolean {
  const a = author.trim().toLowerCase();
  if (a === "[deleted]" || a === "deleted") return true;
  const t = selftext.trim();
  if (t === "[removed]" || t === "[deleted]") return true;
  return false;
}
