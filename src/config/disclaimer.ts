/**
 * Appended to every suggested Reddit comment (Slack + DB) after the model draft.
 * Edit here if counsel wants different wording.
 */

/** Reddit-friendly separator + short italic disclaimer (markdown). */
export const REDDIT_LEGAL_DISCLAIMER_BLOCK = `---

*General information only—not legal advice, and not an attorney–client relationship. Laws vary by state; if you need guidance for your specific situation, talk to a lawyer licensed in your jurisdiction.*`;

export function appendRedditDisclaimer(commentBody: string): string {
  const t = commentBody.trim();
  if (!t) {
    return REDDIT_LEGAL_DISCLAIMER_BLOCK.trim();
  }
  return `${t}\n\n${REDDIT_LEGAL_DISCLAIMER_BLOCK}`;
}
