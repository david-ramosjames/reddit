import type { ScoutDatabase } from "./sqlite.js";

export class PostHistoryRepository {
  constructor(private readonly db: ScoutDatabase) {}

  hasSeenPost(redditPostId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM scanned_posts WHERE reddit_post_id = ? LIMIT 1`)
      .get(redditPostId) as { 1: number } | undefined;
    return !!row;
  }

  insertScannedPost(row: {
    redditPostId: string;
    subreddit: string;
    title: string;
    permalink: string;
    createdUtc: number;
    numComments: number;
    rawScore: number;
    llmScore: number;
    finalScore: number;
    selectedForDigest: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO scanned_posts (
          reddit_post_id, subreddit, title, permalink, created_utc, num_comments,
          raw_score, llm_score, final_score, selected_for_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.redditPostId,
        row.subreddit,
        row.title,
        row.permalink,
        row.createdUtc,
        row.numComments,
        row.rawScore,
        row.llmScore,
        row.finalScore,
        row.selectedForDigest ? 1 : 0
      );
  }

  insertDraftedComment(row: {
    redditPostId: string;
    primaryComment: string;
    backupComment: string;
    rationale: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO drafted_comments (reddit_post_id, primary_comment, backup_comment, rationale)
         VALUES (?, ?, ?, ?)`
      )
      .run(row.redditPostId, row.primaryComment, row.backupComment, row.rationale);
  }
}
