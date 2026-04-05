/**
 * SQLite DDL for Reddit Comment Scout.
 */

export const CREATE_SCANNED_POSTS = `
CREATE TABLE IF NOT EXISTS scanned_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reddit_post_id TEXT NOT NULL UNIQUE,
  subreddit TEXT NOT NULL,
  title TEXT NOT NULL,
  permalink TEXT NOT NULL,
  created_utc REAL NOT NULL,
  num_comments INTEGER NOT NULL,
  raw_score REAL NOT NULL,
  llm_score REAL NOT NULL,
  final_score REAL NOT NULL,
  selected_for_digest INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const CREATE_DRAFTED_COMMENTS = `
CREATE TABLE IF NOT EXISTS drafted_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reddit_post_id TEXT NOT NULL,
  primary_comment TEXT NOT NULL,
  backup_comment TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reddit_post_id) REFERENCES scanned_posts(reddit_post_id)
);
`;

export const INDEX_SCANNED_SUBREDDIT = `
CREATE INDEX IF NOT EXISTS idx_scanned_subreddit ON scanned_posts(subreddit);
`;
