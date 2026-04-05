/**
 * Subreddits scanned each run. Edit this list to add/remove sources.
 * Names should be without the "r/" prefix.
 */
export const DEFAULT_SUBREDDITS: readonly string[] = [
  "legaladvice",
  "Ask_Lawyers",
  "LawyerAdvice",
  "Insurance",
  "CarAccidents",
  "AutoInsurance",
  "Austin",
  "personalfinance",
  "AmItheAsshole",
  "askaustin",
  "paralegal",
  "legalassistant",
  "injurylawyers",
  "LawyersUsefulThings",
  "Lawyertalk",
  "Car_Insurance_Help",
  "InsuranceClaims",
] as const;

export function getSubredditList(): string[] {
  const fromEnv = process.env.SUBREDDITS;
  if (fromEnv?.trim()) {
    return fromEnv
      .split(/[,\s]+/)
      .map((s) => s.replace(/^r\//i, "").trim())
      .filter(Boolean);
  }
  return [...DEFAULT_SUBREDDITS];
}
