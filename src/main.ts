/**
 * Reddit Comment Scout — daily pipeline entrypoint.
 * Fetches recent posts, scores, drafts top 5, posts to Slack, persists history.
 */

import "./loadEnv.js";
import { OpenAiClient } from "./clients/openai.js";
import { RedditRssClient } from "./clients/redditRss.js";
import { postSlackWebhook } from "./clients/slack.js";
import { getSubredditList } from "./config/subreddits.js";
import { PostHistoryRepository } from "./db/repositories.js";
import { openDatabase } from "./db/sqlite.js";
import { buildDigestPayload } from "./services/digestBuilder.js";
import { draftCommentsForTopPosts } from "./services/draftComments.js";
import { fetchPostsForSubreddits } from "./services/fetchPosts.js";
import { scorePosts } from "./services/scorePosts.js";
import { selectTopPosts } from "./services/selectTopPosts.js";
import { logger } from "./utils/logger.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

async function run(): Promise<void> {
  const databasePath = process.env.DATABASE_PATH?.trim() || "./data/scout.sqlite";
  const openaiModel = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const includeBranding =
    String(process.env.INCLUDE_BRANDING_IN_COMMENTS).toLowerCase() === "true";

  const rssUserAgent =
    process.env.RSS_USER_AGENT?.trim() ||
    "RedditCommentScout/1.0 (RSS ingestion; personal injury review digest)";
  const rss = new RedditRssClient(rssUserAgent);
  const openai = new OpenAiClient(requireEnv("OPENAI_API_KEY"), openaiModel);
  const slackUrl = requireEnv("SLACK_WEBHOOK_URL");

  const db = openDatabase(databasePath);
  try {
    const repo = new PostHistoryRepository(db);

    const subreddits = getSubredditList();
    logger.info("scout_run_start", { subreddits: subreddits.length, databasePath });

    const fetched = await fetchPostsForSubreddits(rss, subreddits);
    if (fetched.errors.length > 0) {
      logger.warn("some_subreddits_failed", { count: fetched.errors.length });
    }

    const fresh = fetched.posts.filter((p) => !repo.hasSeenPost(p.redditPostId));
    logger.info("posts_after_dedupe", { fetched: fetched.postsFetched, fresh: fresh.length });

    const scored = await scorePosts(fresh, openai);
    const top = selectTopPosts(scored, 5);
    const drafted = await draftCommentsForTopPosts(openai, top, includeBranding);

    const draftedIds = new Set(drafted.map((d) => d.scored.post.redditPostId));

    for (const s of scored) {
      try {
        repo.insertScannedPost({
          redditPostId: s.post.redditPostId,
          subreddit: s.post.subreddit,
          title: s.post.title,
          permalink: s.post.permalink,
          createdUtc: s.post.createdUtc,
          numComments: s.post.numComments,
          rawScore: s.rawScore,
          llmScore: s.llmScore,
          finalScore: s.finalScore,
          selectedForDigest: draftedIds.has(s.post.redditPostId),
        });
      } catch (e) {
        logger.error("insert_scanned_failed", { id: s.post.redditPostId, err: String(e) });
        throw e;
      }
    }

    for (const d of drafted) {
      repo.insertDraftedComment({
        redditPostId: d.scored.post.redditPostId,
        primaryComment: d.primaryComment,
        backupComment: d.backupComment,
        rationale: d.selectionRationale,
      });
    }

    const stats = {
      subredditsScanned: fetched.subredditsScanned,
      postsFetched: fetched.postsFetched,
      postsReviewed: fresh.length,
      candidatesScored: scored.length,
      timestampIso: new Date().toISOString(),
    };

    const payload = buildDigestPayload(stats, drafted);
    await postSlackWebhook(slackUrl, payload);

    logger.info("scout_run_complete", {
      drafted: drafted.length,
      scannedRows: scored.length,
    });
  } finally {
    db.close();
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error("scout_fatal", { error: String(err) });
    process.exit(1);
  });
