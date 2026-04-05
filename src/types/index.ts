/**
 * Core domain types for Reddit Comment Scout.
 */

/** Normalized post from Reddit /new listing or RSS ingestion. */
export interface RedditPost {
  redditPostId: string;
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  permalink: string;
  url: string;
  createdUtc: number;
  numComments: number;
  score: number;
  linkFlairText: string | null;
  over18: boolean;
  /**
   * Set when ingested via `/r/{sub}/new/.rss`.
   * Comment count and score are not in the feed; rule scoring skips comment competition signals.
   */
  rssIngestion?: boolean;
}

/** After rule-based pre-scoring. */
export interface RuleScoredPost {
  post: RedditPost;
  rawScore: number;
  ruleNotes: string[];
}

/** LLM evaluation of a candidate thread. */
export interface LlmEvaluation {
  /** Whether the model recommends surfacing this post at all. */
  isGoodCandidate: boolean;
  /** 0–100 quality / fit for a helpful educational reply. */
  llmScore: number;
  /** Brief explanation for internal use / Slack. */
  rationale: string;
  /** If false, hard skip from selection (rules violation, wrong practice area, etc.). */
  passesGuardrails: boolean;
  guardrailReason?: string;
}

/** Fully scored post ready for ranking. */
export interface ScoredPost {
  post: RedditPost;
  rawScore: number;
  llmScore: number;
  finalScore: number;
  llmRationale: string;
  isGoodCandidate: boolean;
  passesGuardrails: boolean;
  ruleNotes: string[];
}

/** One of the top opportunities with drafted copy. */
export interface DraftedOpportunity {
  scored: ScoredPost;
  primaryComment: string;
  backupComment: string;
  selectionRationale: string;
}

/** Metrics for Slack digest header. */
export interface DigestStats {
  subredditsScanned: number;
  postsFetched: number;
  postsReviewed: number;
  candidatesScored: number;
  timestampIso: string;
}
