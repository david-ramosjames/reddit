/**
 * Fetch recent posts from all configured subreddits (last 24h window).
 * One subreddit failure does not abort the whole run.
 */

import type { RedditRssClient } from "../clients/redditRss.js";
import type { RedditPost } from "../types/index.js";
import { MS_PER_DAY } from "../utils/date.js";
import { isRemovedOrDeletedContent } from "../utils/text.js";
import { logger } from "../utils/logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FetchPostsResult {
  posts: RedditPost[];
  subredditsScanned: number;
  postsFetched: number;
  errors: Array<{ subreddit: string; message: string }>;
}

/**
 * Pull new posts from each subreddit; filter NSFW, deleted, and time window.
 */
export async function fetchPostsForSubreddits(
  client: RedditRssClient,
  subreddits: string[]
): Promise<FetchPostsResult> {
  const minCreatedUtc = Date.now() / 1000 - MS_PER_DAY / 1000;
  const all: RedditPost[] = [];
  const errors: Array<{ subreddit: string; message: string }> = [];

  for (let i = 0; i < subreddits.length; i++) {
    const sub = subreddits[i]!;
    try {
      const rows = await client.fetchNewPosts(sub, { minCreatedUtc });
      const filtered = rows.filter((p) => {
        if (p.over18) return false;
        if (isRemovedOrDeletedContent(p.author, p.selftext)) return false;
        return true;
      });
      all.push(...filtered);
      logger.info("subreddit_fetched", { subreddit: sub, count: filtered.length });
      if (i < subreddits.length - 1) {
        await sleep(1100);
      }
    } catch (e) {
      const message = String(e);
      logger.warn("subreddit_fetch_failed", { subreddit: sub, error: message });
      errors.push({ subreddit: sub, message });
    }
  }

  return {
    posts: all,
    subredditsScanned: subreddits.length,
    postsFetched: all.length,
    errors,
  };
}
