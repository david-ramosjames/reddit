import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  CREATE_DRAFTED_COMMENTS,
  CREATE_SCANNED_POSTS,
  INDEX_SCANNED_SUBREDDIT,
} from "./schema.js";

export type ScoutDatabase = Database.Database;

export function openDatabase(filePath: string): ScoutDatabase {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_SCANNED_POSTS);
  db.exec(CREATE_DRAFTED_COMMENTS);
  db.exec(INDEX_SCANNED_SUBREDDIT);
  return db;
}
