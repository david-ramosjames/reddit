/**
 * Subreddit ingestion via public RSS: /r/{sub}/new/.rss
 * No Reddit OAuth. Parses Atom or RSS 2.0 XML into RedditPost.
 */

import { XMLParser } from "fast-xml-parser";
import type { RedditPost } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { stripHtmlToText } from "../utils/text.js";

const FEED_URL = (sub: string) =>
  `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, userAgent: string, label: string): Promise<string> {
  const maxAttempts = 5;
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml, */*",
          "User-Agent": userAgent,
        },
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 30;
        logger.warn("reddit_rss_rate_limited", { label, retryAfter, attempt });
        await sleep(retryAfter * 1000);
        continue;
      }
      if (res.status >= 500 && res.status < 600) {
        const backoff = Math.min(30_000, 1000 * 2 ** attempt);
        logger.warn("reddit_rss_server_error", { label, status: res.status, attempt, backoff });
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
      const backoff = Math.min(20_000, 500 * 2 ** attempt);
      logger.warn("reddit_rss_fetch_error", { label, attempt, backoff, error: String(e) });
      await sleep(backoff);
    }
  }
  throw new Error(`RSS fetch failed after retries: ${label} — ${String(lastErr)}`);
}

function ensureArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function getTextField(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "#text" in v) {
    return String((v as Record<string, unknown>)["#text"] ?? "");
  }
  return String(v);
}

function getAtomLinkHref(entry: Record<string, unknown>): string | null {
  const link = entry.link;
  const links = ensureArray(link);
  let fallback: string | null = null;
  for (const l of links) {
    if (typeof l === "string") {
      if (l.startsWith("http")) return l;
      continue;
    }
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    const href = o["@_href"] as string | undefined;
    const rel = (o["@_rel"] as string | undefined)?.toLowerCase();
    if (!href) continue;
    if (rel === "alternate" || rel === "self") return href;
    fallback ??= href;
  }
  return fallback;
}

function getDescriptionContent(entry: Record<string, unknown>): string {
  const content = entry.content ?? entry.summary ?? entry.description;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    return getTextField(c["#text"] ?? c);
  }
  return "";
}

function getPubDateIso(entry: Record<string, unknown>): Date | null {
  const raw =
    (entry.updated as string | undefined) ||
    (entry.published as string | undefined) ||
    (entry.pubDate as string | undefined);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getAuthor(entry: Record<string, unknown>): string {
  const dc = entry["dc:creator"];
  if (typeof dc === "string") return normalizeAuthor(dc);
  const a = entry.author;
  if (typeof a === "string") return normalizeAuthor(a);
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    if (o.name) return normalizeAuthor(getTextField(o.name));
    if (o.uri) return normalizeAuthor(getTextField(o.uri));
  }
  return "unknown";
}

function normalizeAuthor(s: string): string {
  const t = s.trim();
  const m = t.match(/^\/u\/(.+)/i);
  return m ? m[1]! : t.replace(/^u\//i, "");
}

/** Reddit post id from thread URL path. */
export function extractPostIdFromRedditUrl(href: string): string | null {
  try {
    const u = new URL(href, "https://www.reddit.com");
    const m = u.pathname.match(/\/comments\/([a-z0-9]+)\//i);
    return m ? m[1]!.toLowerCase() : null;
  } catch {
    const m = href.match(/\/comments\/([a-z0-9]+)\//i);
    return m ? m[1]!.toLowerCase() : null;
  }
}

export function extractSubredditFromRedditUrl(href: string): string | null {
  try {
    const u = new URL(href, "https://www.reddit.com");
    const m = u.pathname.match(/^\/r\/([^/]+)/i);
    return m ? m[1]! : null;
  } catch {
    const m = href.match(/reddit\.com\/r\/([^/]+)/i);
    return m ? m[1]! : null;
  }
}

function permalinkPathFromUrl(href: string): string {
  try {
    const u = new URL(href, "https://www.reddit.com");
    return u.pathname + (u.search || "");
  } catch {
    return href.startsWith("/") ? href : `/${href}`;
  }
}

function extractEntries(parsed: unknown): Record<string, unknown>[] {
  const p = parsed as Record<string, unknown>;
  if (p.feed && typeof p.feed === "object") {
    const feed = p.feed as Record<string, unknown>;
    return ensureArray(feed.entry) as Record<string, unknown>[];
  }
  if (p.rss && typeof p.rss === "object") {
    const rss = p.rss as Record<string, unknown>;
    const channel = rss.channel as Record<string, unknown> | undefined;
    if (channel?.item) {
      return ensureArray(channel.item) as Record<string, unknown>[];
    }
  }
  return [];
}

/**
 * Reddit Atom feeds ship HTML-heavy &amp;-escaped bodies; fast-xml-parser’s default
 * maxTotalExpansions (1000) is exceeded and parsing throws. Raise limits for this trusted source.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) => tagName === "entry" || tagName === "item",
  htmlEntities: true,
  processEntities: {
    enabled: true,
    maxTotalExpansions: 500_000,
    maxExpandedLength: 10_000_000,
    maxEntitySize: 100_000,
    maxEntityCount: 100_000,
  },
});

export interface FetchNewRssOptions {
  minCreatedUtc: number;
}

/**
 * Fetch /r/{subreddit}/new/.rss and return posts newer than minCreatedUtc (unix seconds).
 */
export class RedditRssClient {
  constructor(private readonly userAgent: string) {}

  async fetchNewPosts(subreddit: string, options: FetchNewRssOptions): Promise<RedditPost[]> {
    const url = FEED_URL(subreddit);
    const xml = await fetchWithRetry(url, this.userAgent, `rss_${subreddit}`);
    const trimmed = xml.trimStart();
    if (
      !trimmed.startsWith("<?xml") &&
      !trimmed.startsWith("<feed") &&
      !trimmed.startsWith("<rss")
    ) {
      throw new Error(
        `RSS ${subreddit}: expected XML feed, got: ${trimmed.slice(0, 160).replace(/\s+/g, " ")}`
      );
    }
    return parseRedditRssXml(xml, subreddit, options.minCreatedUtc);
  }
}

/**
 * Parse Reddit Atom/RSS XML into normalized posts (exported for tests).
 */
export function parseRedditRssXml(
  xml: string,
  fallbackSubreddit: string,
  minCreatedUtc: number
): RedditPost[] {
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch (e) {
    throw new Error(`RSS XML parse error: ${String(e)}`);
  }
  const entries = extractEntries(parsed);
  const out: RedditPost[] = [];

  for (const entry of entries) {
    const item = entry as Record<string, unknown>;
    const guidRaw = item.guid;
    const guidStr =
      typeof guidRaw === "string"
        ? guidRaw
        : guidRaw && typeof guidRaw === "object"
          ? getTextField((guidRaw as Record<string, unknown>)["#text"])
          : "";
    const href =
      getAtomLinkHref(item) ||
      (typeof item.link === "string" ? item.link : null) ||
      (guidStr.includes("reddit.com") ? guidStr : null);
    if (!href || !href.includes("reddit.com")) continue;

    const title = getTextField(item.title).trim();
    const rawDesc = getDescriptionContent(item);
    const selftext = stripHtmlToText(rawDesc);

    const created = getPubDateIso(item);
    if (!created) continue;
    const createdUtc = created.getTime() / 1000;
    if (createdUtc < minCreatedUtc) continue;

    const redditPostId = extractPostIdFromRedditUrl(href);
    if (!redditPostId) continue;

    const sub =
      extractSubredditFromRedditUrl(href) ?? fallbackSubreddit;
    const author = getAuthor(item);
    const permalink = permalinkPathFromUrl(href);
    const titleLower = title.toLowerCase();
    const over18 =
      /\bnsfw\b/i.test(title) ||
      titleLower.includes("[nsfw]") ||
      /\bnsfw\b/i.test(selftext);

    out.push({
      redditPostId,
      subreddit: sub,
      title,
      selftext,
      author,
      permalink,
      url: href.startsWith("http") ? href : `https://www.reddit.com${permalink}`,
      createdUtc,
      numComments: 0,
      score: 0,
      linkFlairText: null,
      over18,
      rssIngestion: true,
    });
  }

  return out;
}
