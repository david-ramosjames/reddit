/**
 * Slack Incoming Webhooks — single message with Block Kit.
 * https://api.slack.com/messaging/webhooks
 */

import { logger } from "../utils/logger.js";

export type SlackBlock =
  | {
      type: "header";
      text: { type: "plain_text"; text: string; emoji?: boolean };
    }
  | {
      type: "section";
      text: { type: "mrkdwn"; text: string };
    }
  | { type: "divider" }
  | {
      type: "context";
      elements: Array<{ type: "mrkdwn"; text: string }>;
    };

export async function postSlackWebhook(webhookUrl: string, payload: { blocks: SlackBlock[]; text: string }): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: payload.text,
      blocks: payload.blocks,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${t}`);
  }
  const body = await res.text();
  if (body !== "ok") {
    logger.warn("slack_webhook_non_ok_body", { body });
  }
}
