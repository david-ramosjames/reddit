import type { ScoredPost } from "../types/index.js";

const DEFAULT_TOP_N = 5;

/**
 * Pick the best N candidates that passed scoring gates.
 */
export function selectTopPosts(
  scored: ScoredPost[],
  topN: number = DEFAULT_TOP_N
): ScoredPost[] {
  const pool = scored.filter((s) => s.isGoodCandidate);
  pool.sort((a, b) => b.finalScore - a.finalScore || b.rawScore - a.rawScore);
  return pool.slice(0, topN);
}
