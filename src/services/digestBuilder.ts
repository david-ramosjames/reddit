/**
 * Build Slack Block Kit payload for the daily digest.
 */

import type { SlackBlock } from "../clients/slack.js";
import type { DigestStats, DraftedOpportunity } from "../types/index.js";
import { hoursSinceUnixUtc } from "../utils/date.js";

function redditUrl(permalink: string): string {
  if (permalink.startsWith("http")) return permalink;
  return `https://www.reddit.com${permalink}`;
}

export function buildDigestPayload(
  stats: DigestStats,
  opportunities: DraftedOpportunity[]
): { blocks: SlackBlock[]; text: string } {
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Reddit Comment Scout — Daily digest", emoji: false },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Summary*\n` +
          `• Subreddits scanned: *${stats.subredditsScanned}*\n` +
          `• Posts fetched: *${stats.postsFetched}*\n` +
          `• Posts reviewed (after history dedupe): *${stats.postsReviewed}*\n` +
          `• Candidates scored (incl. rule-only): *${stats.candidatesScored}*\n` +
          `• Run time (UTC): \`${stats.timestampIso}\`\n\n` +
          `_Top ${opportunities.length} opportunities for manual review. Not auto-posted._`,
      },
    },
    { type: "divider" },
  ];

  opportunities.forEach((op, idx) => {
    const p = op.scored.post;
    const rank = idx + 1;
    const ageH = hoursSinceUnixUtc(p.createdUtc);
    const link = redditUrl(p.permalink);
    const commentLabel = p.rssIngestion ? "unknown (RSS)" : String(p.numComments);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*#${rank}* — r/${p.subreddit} — ${ageH.toFixed(1)}h old — *${commentLabel}* comments\n` +
          `*${escapeSlack(p.title)}*\n` +
          `Why: ${escapeSlack(op.selectionRationale)}\n` +
          `<${link}|Open thread>`,
      },
    });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Primary suggested comment*\n\`\`\`\n${escapeCodeFence(truncateBlock(op.primaryComment, 2700))}\n\`\`\``,
      },
    });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Backup angle*\n\`\`\`\n${escapeCodeFence(truncateBlock(op.backupComment, 2700))}\n\`\`\``,
      },
    });
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Final score ${op.scored.finalScore} · Rule ${op.scored.rawScore} · LLM ${op.scored.llmScore}`,
        },
      ],
    });
    blocks.push({ type: "divider" });
  });

  if (opportunities.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No qualifying opportunities today (or all posts were already in history)._",
      },
    });
  }

  return {
    text: `Reddit Comment Scout: ${opportunities.length} opportunity(ies)`,
    blocks,
  };
}

function escapeSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeCodeFence(s: string): string {
  return s.replace(/```/g, "`\u200b``");
}

function truncateBlock(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 40)}\n\n…(truncated for Slack length)`;
}
