/**
 * Load `.env` from the project root (next to package.json), not from process.cwd().
 * Fixes scans run from another working directory and makes missing-file obvious.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env");

if (!fs.existsSync(envPath)) {
  // Railway / other hosts inject env vars; no file needed — avoid noisy warnings in cron logs.
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      `[reddit-comment-scout] Missing .env at ${envPath} and no OPENAI_API_KEY in environment.\n` +
        "  Copy .env.example to .env locally, or set variables in your host (e.g. Railway Variables)."
    );
  }
} else {
  const result = config({ path: envPath });
  if (result.error) {
    console.warn(`[reddit-comment-scout] Could not read .env: ${result.error.message}`);
  }
}
