# Reddit Comment Scout

Internal tool for **Ramos James Law** (Austin, TX). Each day it scans a fixed list of subreddits for recent posts, scores reply opportunities for **personal injury / auto / insurance** contexts, drafts **non-solicitous** suggested comments, and posts a **single Slack digest** for human review.

**This app never posts to Reddit**, never votes, and never awards. Humans copy/paste only if a reply is appropriate.

## What it does

1. Loads subreddits from `src/config/subreddits.ts` (or `SUBREDDITS` env override).
2. Fetches **new** posts via public **RSS** (`/r/{subreddit}/new/.rss`) and keeps items from the last **24 hours** (posts only, not comments).
3. Skips posts already stored in SQLite (`scanned_posts.reddit_post_id`).
4. Applies **rule-based** pre-scoring and **hard filters** (practice area, comment cap, etc.).
5. Sends promising posts to **OpenAI** for candidate evaluation + blended **final score**.
6. Selects the **top 5** candidates.
7. Uses OpenAI again to draft **primary** and **backup** comment angles + a short internal rationale.
8. Sends one **Slack** message (Block Kit) with links and copy.
9. Persists all scanned posts and drafts to **SQLite**.

## Requirements

- **Node.js 18+**
- OpenAI API key
- Slack **Incoming Webhook** URL
- No Reddit API keys — ingestion uses **public RSS feeds** (see caveats below).

## Setup

```bash
cd reddit
npm install
cp .env.example .env
# Edit .env with real values
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | yes | OpenAI API key |
| `SLACK_WEBHOOK_URL` | yes | Incoming webhook for the review channel |
| `RSS_USER_AGENT` | no | User-Agent string for RSS HTTP requests. Reddit may block empty or generic agents; set something stable and descriptive. |
| `DATABASE_PATH` | no | Default `./data/scout.sqlite` |
| `OPENAI_MODEL` | no | Default `gpt-4o-mini` |
| `SUBREDDITS` | no | Comma/space-separated list; overrides default list |
| `MAX_COMMENTS_THRESHOLD` | no | Max comments for **non-RSS** paths; RSS feeds do not include counts (see below). |
| `RULE_SCORE_LLM_THRESHOLD` | no | Min rule score before calling evaluation LLM |
| `FINAL_SCORE_MIN_FOR_SELECTION` | no | Min blended score to stay in selection pool |
| `INCLUDE_BRANDING_IN_COMMENTS` | no | `true` to allow firm name in drafts (see prompts) |
| `DEBUG_SCOUT` | no | Set to `1` for extra logs |

### Reddit RSS ingestion

Each subreddit is fetched at:

`https://www.reddit.com/r/{subreddit}/new/.rss`

The feed is parsed as **Atom or RSS 2.0**; items are normalized into the same `RedditPost` shape used by the scoring pipeline.

**Caveats**

- **Volume & window:** Reddit’s new-feed RSS typically exposes a **limited number of recent posts**; very quiet subreddits or heavy throttling may yield fewer than 24 hours of coverage.
- **Comment count & score:** Not present in standard RSS. Posts are tagged with `rssIngestion: true`; rule scoring **does not** boost/penalize by comment count, and Slack shows `unknown (RSS)` for comments. The LLM prompt notes that comment counts are unknown.
- **Blocking:** Reddit may return HTML error pages or block requests from certain networks or User-Agents. Set a sensible `RSS_USER_AGENT`, respect spacing between subreddits (~1.1s), and handle failures gracefully (logged per subreddit).
- **Terms:** Use in line with [Reddit’s Terms](https://www.reddit.com/policies/user-agreement) and each subreddit’s rules; this tool only reads public feeds for internal review.

### Slack webhook

1. In Slack: **Apps** → **Incoming Webhooks** (or create a minimal Slack app with an incoming webhook).
2. Choose the internal review channel and copy the webhook URL into `SLACK_WEBHOOK_URL`.

## Run locally

```bash
npm run scan
# or during development:
npm run dev
```

Compiled run:

```bash
npm run build
npm start
```

## Tests

```bash
npm test
```

## Customize subreddits

Edit `src/config/subreddits.ts` (`DEFAULT_SUBREDDITS`), or set:

```env
SUBREDDITS=legaladvice,Austin,Insurance
```

## Schedule daily (cron)

Run once per day on a server or workstation that can reach Reddit, OpenAI, and Slack.

**Linux / macOS (crontab)** — example 6:30 AM local time:

```cron
30 6 * * * cd /path/to/reddit && /usr/bin/env NODE_ENV=production /usr/local/bin/node dist/main.js >> /var/log/reddit-scout.log 2>&1
```

Build first (`npm run build`) or invoke `npx tsx src/main.ts` if Node has `tsx` installed globally.

**Windows (Task Scheduler)**  

- Action: Start a program  
- Program: full path to `node.exe`  
- Arguments: `C:\path\to\reddit\dist\main.js`  
- Start in: `C:\path\to\reddit`  
- Set user env vars or use a wrapper `.cmd` that `cd`s and loads `.env` (dotenv loads automatically from cwd).

## Deploy on Railway (daily run + Slack)

Railway can run this repo as a **Cron Job**: on each schedule it runs your **start command**, then the process **exits** (required). See [Railway Cron Jobs](https://docs.railway.com/guides/cron-jobs).

### 1. Create the project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** (or CLI) and select this repo.
2. Railway should pick up `railway.toml` and build with the **Dockerfile** (recommended for `better-sqlite3` native builds).

### 2. Turn the service into a scheduled job

1. Open your **service** → **Settings**.
2. Under **Cron Schedule**, set a [cron expression](https://crontab.guru) (Railway uses **UTC**).

**9:00 AM Austin (US/Central)** — Central Time shifts with DST, so pick the UTC hour that matches your season or accept a one-hour drift twice a year:

| Local (Austin) | Approx. UTC hour | Cron (minute 0) |
|----------------|------------------|-----------------|
| 9:00 AM **CST** (winter) | 15:00 UTC | `0 15 * * *` |
| 9:00 AM **CDT** (summer) | 14:00 UTC | `0 14 * * *` |

Example for **9:00 AM Central Standard Time**: `0 15 * * *`

3. **Start Command** (if not inherited from the image): `node dist/main.js`  
   **Build** is handled by the Dockerfile (`npm run build` inside the build stage).

### 3. Environment variables

In **Variables**, set at least:

- `OPENAI_API_KEY`
- `SLACK_WEBHOOK_URL`
- `RSS_USER_AGENT` (recommended)

Optional: `SUBREDDITS`, `OPENAI_MODEL`, `FINAL_SCORE_MIN_FOR_SELECTION`, etc. You do **not** need a `.env` file on Railway; the app reads the platform env.

### 4. Persist SQLite (dedupe history)

The container filesystem is ephemeral. Add a **volume** so dedupe survives redeploys:

1. Service → **Settings** → **Volumes** → **Add volume**.
2. **Mount path:** `/app/data`
3. Set variable **`DATABASE_PATH=/app/data/scout.sqlite`** (the Dockerfile default is already this path; setting it explicitly is fine).

Without a volume, each run still works, but **post history resets** every deploy.

### 5. Smoke test

From the service **Deployments** tab, **Run** a one-off deploy or use **“Run now”** if available, or temporarily set a cron of `*/5 * * * *` for a test, then fix to `0 15 * * *`.

Logs should show `scout_run_complete` and Slack should receive the digest.

## Where to tune scoring

- **Rule weights, boosts, penalties, keyword lists, hard filters:** `src/services/scorePosts.ts` — see `SCORING_WEIGHTS`, `computeRuleBasedScore`, `evaluateHardFilters`, and the `*_BLOCK` / `PI_BOOST` arrays.
- **Blend between rule score and LLM score:** `SCORING_WEIGHTS.finalBlendRaw` in the same file.
- **LLM behavior and guardrails:** `src/config/prompts.ts` (`candidateEvaluationSystem`, `commentDraftingSystem`, and the `build*` helpers).

## Branding on/off

- **Off (default):** `INCLUDE_BRANDING_IN_COMMENTS=false` in `.env` — drafts must not name the firm (enforced in the drafting prompt).
- **On:** set `INCLUDE_BRANDING_IN_COMMENTS=true` — `buildCommentDraftingUserPrompt` switches the instruction block in `src/config/prompts.ts` so the model may mention Ramos James once, still without contact info unless you extend the prompt yourself.

## Compliance / product guardrails

- Internal review only; **no auto-posting** to Reddit.
- No automated voting or awards.
- Drafts are **educational and low-pressure**; a human must review for accuracy, subreddit rules, and ethics before posting.
- Outputs avoid solicitation language by design; still verify every thread context manually.

## Project layout

```
src/
  clients/     Reddit RSS, OpenAI, Slack
  services/    fetch, score, select, draft, digest
  db/          schema, SQLite, repositories
  config/      subreddits, prompts
  types/       shared interfaces
  utils/       logger, text, date
  main.ts      pipeline entrypoint
```

## License

Private / internal use — UNLICENSED.
