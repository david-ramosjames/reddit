/**
 * Two-layer scoring: rule-based pre-score (0–100), then LLM quality score.
 * Tune weights and keyword lists in SCORING_WEIGHTS and keyword blocks below.
 */

import type { OpenAiClient } from "../clients/openai.js";
import {
  buildCandidateEvaluationUserPrompt,
  candidateEvaluationSystem,
} from "../config/prompts.js";
import type { LlmEvaluation, RedditPost, RuleScoredPost, ScoredPost } from "../types/index.js";
import { combinePostText, normalizeText } from "../utils/text.js";
import { hoursSinceUnixUtc } from "../utils/date.js";
import { logger } from "../utils/logger.js";

/**
 * Central place to tweak rule-based scoring behavior.
 */
export const SCORING_WEIGHTS = {
  /** final_score = blend * raw + (1-blend) * llm (when LLM ran). */
  finalBlendRaw: 0.35,
  /** Minimum rule score before calling the LLM (cost control). */
  defaultLlmThreshold: 28,
  /** Minimum blended score to remain in the selection pool. */
  defaultMinForSelection: 55,
  /** Default cap; override with MAX_COMMENTS_THRESHOLD in env. */
  defaultMaxComments: 75,
} as const;

export function getMaxCommentsThreshold(): number {
  const raw = process.env.MAX_COMMENTS_THRESHOLD;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return SCORING_WEIGHTS.defaultMaxComments;
}

const CRIMINAL_BLOCK = [
  "criminal defense",
  "charged with",
  "arrested for",
  "dui ",
  " dui",
  "dwi",
  "felony",
  "misdemeanor",
  "prosecutor",
  "public defender",
  "search warrant",
  "plea deal",
  "jail time",
  "bail ",
];

const FAMILY_BLOCK = [
  "divorce",
  "custody",
  "child support",
  "alimony",
  "family court",
];

const IMMIGRATION_BLOCK = ["green card", "visa ", " h1b", "deportation", "uscis", "ice ", "immigration attorney"];

const BUSINESS_BLOCK = ["llc formation", "incorporate", "shareholder", "non-compete", "business contract", "vendor dispute"];

const EMPLOYMENT_SOFT = [
  "wrongful termination",
  "hostile work environment",
  "discrimination at work",
  "fmla",
  "wage theft",
];

const MALPRACTICE_BLOCK = ["medical malpractice", "surgical error", "misdiagnosis", "hospital negligence"];

const PI_BOOST = [
  "car accident",
  "auto accident",
  "rear ended",
  "rear-ended",
  "hit and run",
  "hit by",
  "truck accident",
  "18 wheeler",
  "semi truck",
  "commercial vehicle",
  "company vehicle",
  "company car",
  "uninsured motorist",
  "underinsured",
  "whiplash",
  "injury",
  "injured",
  "hospital bill",
  "medical bills",
  "settlement",
  "insurance claim",
  "denied claim",
  "liability",
  "at fault",
  "fault",
  "bodily injury",
  "personal injury",
  "adjuster",
  "geico",
  "state farm",
  "allstate",
  "progressive",
];

/** High-intent phrases — strong reply opportunities (stacks with PI_BOOST). */
const TARGET_INTENT_BOOST = [
  "insurance won't",
  "insurance will not",
  "insurer won't",
  "won't pay",
  "refuses to pay",
  "lowball",
  "low-balled",
  "do i need a lawyer",
  "do i need an attorney",
  "should i get a lawyer",
  "should i hire a lawyer",
  "who is at fault",
  "who's at fault",
  "whos at fault",
  "determine fault",
  "recorded statement",
  "they said it's my fault",
  "they said it was my fault",
  "said i was at fault",
  "trying to blame me",
];

/** Vulnerability / confusion (one leg of “lawyer moment”). */
const VULNERABILITY_SIGNALS = [
  "confused",
  "not sure",
  "worried",
  "scared",
  "freaking out",
  "don't know what to do",
  "dont know what to do",
  "what should i do",
  "any advice",
  "help me",
  "panicking",
  "pressured",
  "being pressured",
  "am i being screwed",
  "is this normal",
];

/** Financial or legal stakes (other leg of “lawyer moment”). */
const STAKES_SIGNALS = [
  "medical bill",
  "hospital bill",
  "settlement",
  "lost wages",
  "out of pocket",
  "total loss",
  "claim denied",
  "denied claim",
  "recorded statement",
  "lowball",
  "bi claim",
  "bodily injury",
  "injury claim",
  "surgery",
  "mri",
  "at fault",
  "liable",
  "lawsuit",
];

/**
 * Shopping, rate-shopping, umbrella, or academic “explain insurance” threads —
 * penalize only when there is no clear claim/injury/accident context.
 */
const INSURANCE_SHOPPING_ACADEMIC_PENALTY = [
  "umbrella policy",
  "umbrella insurance",
  "umbrella coverage",
  "cheapest car insurance",
  "cheapest auto insurance",
  "best insurance company",
  "best car insurance",
  "shopping for insurance",
  "switching insurance",
  "compare quotes",
  "rate quote",
  "why is my premium so high",
  "premium went up",
  "for a class",
  "school project",
  "homework",
  "exam question",
  "hypothetical only",
  "purely hypothetical",
  "eli5",
  "explain like i'm",
  "explain like im",
  "how does car insurance work",
  "what is comprehensive coverage",
  "what is collision coverage",
  "difference between comprehensive",
  "general insurance question",
  "which insurer should i pick",
];

const CLAIM_CONTEXT_GUARD = [
  "accident",
  "crash",
  "collision",
  "injury",
  "injured",
  "claim",
  "settlement",
  "adjuster",
  "lawyer",
  "attorney",
  "fault",
  "rear ended",
  "hit by",
  "whiplash",
  "medical",
  "hospital",
  "sued",
  "lawsuit",
  "denied",
  "won't pay",
  "lowball",
  "recorded statement",
];

const HELP_SIGNALS = [
  "what should i do",
  "any advice",
  "help me understand",
  "is this normal",
  "confused",
  "not sure",
  "worried",
  "first time",
  "question about",
];

const TROLL_PENALTY = ["shitpost", "troll", "fake story", "validation post"];

const POLITICAL_PENALTY = ["trump", "biden", "congress", "supreme court ruling", "election"];

const TEXAS_BOOST = ["texas", "tx ", " austin", "houston", "dallas", "san antonio", "dfw", "travis county", "hays county"];

function matchesAny(hay: string, needles: readonly string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

export interface HardFilterResult {
  rejected: boolean;
  reason?: string;
}

/**
 * Hard exclusions — do not surface or send to LLM.
 */
export function evaluateHardFilters(post: RedditPost): HardFilterResult {
  const text = combinePostText(post.title, post.selftext);
  if (
    !post.rssIngestion &&
    post.numComments > getMaxCommentsThreshold()
  ) {
    return { rejected: true, reason: "too_many_comments" };
  }
  if (matchesAny(text, CRIMINAL_BLOCK)) {
    return { rejected: true, reason: "criminal_topic" };
  }
  if (matchesAny(text, FAMILY_BLOCK)) {
    return { rejected: true, reason: "family_law" };
  }
  if (matchesAny(text, IMMIGRATION_BLOCK)) {
    return { rejected: true, reason: "immigration" };
  }
  if (matchesAny(text, BUSINESS_BLOCK)) {
    return { rejected: true, reason: "business_law" };
  }
  if (matchesAny(text, MALPRACTICE_BLOCK)) {
    return { rejected: true, reason: "medical_malpractice" };
  }
  if (matchesAny(text, EMPLOYMENT_SOFT) && !matchesAny(text, PI_BOOST)) {
    return { rejected: true, reason: "employment_without_injury_angle" };
  }
  return { rejected: false };
}

/**
 * Rule-based opportunity score (0–100). Exported for unit tests.
 */
export function computeRuleBasedScore(post: RedditPost, nowMs: number = Date.now()): RuleScoredPost {
  const notes: string[] = [];
  let score = 18;
  const text = combinePostText(post.title, post.selftext);

  if (matchesAny(text, PI_BOOST)) {
    score += 28;
    notes.push("pi_insurance_keywords");
  }
  if (matchesAny(text, TARGET_INTENT_BOOST)) {
    score += 18;
    notes.push("target_intent_boost");
  }
  if (matchesAny(text, VULNERABILITY_SIGNALS) && matchesAny(text, STAKES_SIGNALS)) {
    score += 16;
    notes.push("lawyer_moment_combo");
  }
  if (matchesAny(text, HELP_SIGNALS)) {
    score += 12;
    notes.push("help_seeking_tone");
  }
  if (matchesAny(text, TEXAS_BOOST)) {
    score += 14;
    notes.push("texas_geo");
  }

  if (
    matchesAny(text, INSURANCE_SHOPPING_ACADEMIC_PENALTY) &&
    !matchesAny(text, CLAIM_CONTEXT_GUARD)
  ) {
    score -= 16;
    notes.push("insurance_shopping_or_academic_penalty");
  }

  const ageH = hoursSinceUnixUtc(post.createdUtc, nowMs);
  if (ageH <= 3) {
    score += 10;
    notes.push("very_recent");
  } else if (ageH <= 12) {
    score += 6;
    notes.push("recent");
  } else if (ageH <= 24) {
    score += 2;
    notes.push("within_24h");
  }

  if (!post.rssIngestion) {
    const nc = post.numComments;
    if (nc <= 5) {
      score += 12;
      notes.push("low_comment_competition");
    } else if (nc <= 20) {
      score += 6;
      notes.push("moderate_comments");
    } else if (nc > 50) {
      score -= 10;
      notes.push("high_comment_count");
    }
  } else {
    notes.push("rss_comment_count_unknown");
  }

  if (matchesAny(text, TROLL_PENALTY)) {
    score -= 25;
    notes.push("possible_troll");
  }
  if (matchesAny(text, POLITICAL_PENALTY)) {
    score -= 18;
    notes.push("political_news_tone");
  }

  // Link-only posts with no body: slight penalty unless title is strong
  if (!normalizeText(post.selftext) && post.url && !post.url.includes("reddit.com")) {
    score -= 6;
    notes.push("link_post_little_context");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { post, rawScore: score, ruleNotes: notes };
}

function defaultLlmEvaluation(): LlmEvaluation {
  return {
    isGoodCandidate: false,
    llmScore: 0,
    rationale: "Skipped LLM (below rule threshold).",
    passesGuardrails: true,
  };
}

async function evaluateWithLlm(
  client: OpenAiClient,
  rs: RuleScoredPost,
  nowMs: number
): Promise<LlmEvaluation> {
  const ageH = hoursSinceUnixUtc(rs.post.createdUtc, nowMs);
  const user = buildCandidateEvaluationUserPrompt({
    subreddit: rs.post.subreddit,
    title: rs.post.title,
    selftext: rs.post.selftext,
    author: rs.post.author,
    numComments: rs.post.numComments,
    rssIngestion: rs.post.rssIngestion,
    postAgeHours: ageH,
    ruleScore: rs.rawScore,
    ruleNotes: rs.ruleNotes,
  });
  type Row = {
    isGoodCandidate: boolean;
    llmScore: number;
    rationale: string;
    passesGuardrails: boolean;
    guardrailReason: string | null;
  };
  const row = await client.completeJson<Row>(candidateEvaluationSystem, user);
  return {
    isGoodCandidate: Boolean(row.isGoodCandidate),
    llmScore: Math.max(0, Math.min(100, Number(row.llmScore) || 0)),
    rationale: String(row.rationale || ""),
    passesGuardrails: row.passesGuardrails !== false,
    guardrailReason: row.guardrailReason ?? undefined,
  };
}

export interface ScorePostsOptions {
  llmThreshold?: number;
  nowMs?: number;
}

/**
 * Score a batch of posts; handles hard rejects without LLM.
 */
export async function scorePosts(
  posts: RedditPost[],
  openai: OpenAiClient,
  options: ScorePostsOptions = {}
): Promise<ScoredPost[]> {
  const nowMs = options.nowMs ?? Date.now();
  const envTh = process.env.RULE_SCORE_LLM_THRESHOLD;
  const parsedTh =
    envTh !== undefined && envTh !== "" ? Number(envTh) : undefined;
  const llmThreshold =
    options.llmThreshold ??
    (Number.isFinite(parsedTh) ? (parsedTh as number) : SCORING_WEIGHTS.defaultLlmThreshold);

  const out: ScoredPost[] = [];

  for (const post of posts) {
    const hard = evaluateHardFilters(post);
    if (hard.rejected) {
      out.push({
        post,
        rawScore: 0,
        llmScore: 0,
        finalScore: 0,
        llmRationale: `Hard filter: ${hard.reason}`,
        isGoodCandidate: false,
        passesGuardrails: false,
        ruleNotes: [hard.reason ?? "hard_reject"],
      });
      continue;
    }

    const rs = computeRuleBasedScore(post, nowMs);
    if (rs.rawScore < llmThreshold) {
      const partialFinal = Math.round(rs.rawScore * 0.45);
      out.push({
        post,
        rawScore: rs.rawScore,
        llmScore: 0,
        finalScore: partialFinal,
        llmRationale: defaultLlmEvaluation().rationale,
        isGoodCandidate: false,
        passesGuardrails: true,
        ruleNotes: rs.ruleNotes,
      });
      continue;
    }

    try {
      const ev = await evaluateWithLlm(openai, rs, nowMs);
      const blendRaw = SCORING_WEIGHTS.finalBlendRaw;
      const finalScore = Math.round(
        blendRaw * rs.rawScore + (1 - blendRaw) * ev.llmScore
      );
      const envMin = process.env.FINAL_SCORE_MIN_FOR_SELECTION;
      const parsedMin =
        envMin !== undefined && envMin !== "" ? Number(envMin) : undefined;
      const minSel = Number.isFinite(parsedMin)
        ? (parsedMin as number)
        : SCORING_WEIGHTS.defaultMinForSelection;
      const good =
        ev.isGoodCandidate &&
        ev.passesGuardrails &&
        finalScore >= minSel;

      out.push({
        post,
        rawScore: rs.rawScore,
        llmScore: ev.llmScore,
        finalScore,
        llmRationale: ev.rationale + (ev.guardrailReason ? ` (${ev.guardrailReason})` : ""),
        isGoodCandidate: good,
        passesGuardrails: ev.passesGuardrails,
        ruleNotes: rs.ruleNotes,
      });
    } catch (e) {
      logger.warn("llm_eval_failed", { id: post.redditPostId, err: String(e) });
      out.push({
        post,
        rawScore: rs.rawScore,
        llmScore: 0,
        finalScore: Math.round(rs.rawScore * 0.5),
        llmRationale: "LLM evaluation failed; rule score only.",
        isGoodCandidate: false,
        passesGuardrails: true,
        ruleNotes: rs.ruleNotes,
      });
    }
  }

  return out;
}
