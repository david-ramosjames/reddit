/**
 * Generate primary + backup comment drafts for the top opportunities only.
 */

import type { OpenAiClient } from "../clients/openai.js";
import { appendRedditDisclaimer } from "../config/disclaimer.js";
import {
  buildCommentDraftingUserPrompt,
  commentDraftingSystem,
} from "../config/prompts.js";
import type { DraftedOpportunity, ScoredPost } from "../types/index.js";
import { logger } from "../utils/logger.js";

export async function draftCommentsForTopPosts(
  openai: OpenAiClient,
  posts: ScoredPost[],
  includeBranding: boolean
): Promise<DraftedOpportunity[]> {
  const out: DraftedOpportunity[] = [];
  for (const scored of posts) {
    try {
      const user = buildCommentDraftingUserPrompt({
        subreddit: scored.post.subreddit,
        title: scored.post.title,
        selftext: scored.post.selftext,
        includeBranding,
        priorRationale: scored.llmRationale,
      });
      type Row = {
        primaryComment: string;
        backupComment: string;
        selectionRationale: string;
      };
      const row = await openai.completeJson<Row>(commentDraftingSystem, user);
      out.push({
        scored,
        primaryComment: appendRedditDisclaimer(String(row.primaryComment || "")),
        backupComment: appendRedditDisclaimer(String(row.backupComment || "")),
        selectionRationale: String(row.selectionRationale || scored.llmRationale).trim(),
      });
    } catch (e) {
      logger.warn("draft_failed", { id: scored.post.redditPostId, err: String(e) });
    }
  }
  return out;
}
