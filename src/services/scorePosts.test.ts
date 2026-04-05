import { describe, expect, it } from "vitest";
import {
  computeRuleBasedScore,
  evaluateHardFilters,
  SCORING_WEIGHTS,
} from "./scorePosts.js";
import type { RedditPost } from "../types/index.js";

function post(overrides: Partial<RedditPost>): RedditPost {
  const now = Date.now() / 1000 - 3600;
  return {
    redditPostId: "abc123",
    subreddit: "legaladvice",
    title: "Test title",
    selftext: "",
    author: "user1",
    permalink: "/r/legaladvice/comments/abc123/test/",
    url: "https://reddit.com/...",
    createdUtc: now,
    numComments: 3,
    score: 2,
    linkFlairText: null,
    over18: false,
    ...overrides,
  };
}

describe("evaluateHardFilters", () => {
  it("rejects criminal topics", () => {
    const r = evaluateHardFilters(
      post({ title: "Charged with DUI after accident", selftext: "What happens next" })
    );
    expect(r.rejected).toBe(true);
  });

  it("rejects high comment counts", () => {
    const r = evaluateHardFilters(post({ numComments: SCORING_WEIGHTS.defaultMaxComments + 1 }));
    expect(r.rejected).toBe(true);
  });

  it("allows PI-flavored employment", () => {
    const r = evaluateHardFilters(
      post({
        title: "Injured at work — insurance denying claim",
        selftext: "Workers comp and third party?",
      })
    );
    expect(r.rejected).toBe(false);
  });
});

describe("computeRuleBasedScore", () => {
  it("boosts PI keywords and Texas", () => {
    const nowMs = Date.now();
    const p = post({
      title: "Rear ended in Austin — insurer denying rental",
      selftext: "Not sure what to document",
      createdUtc: nowMs / 1000 - 2 * 3600,
      numComments: 2,
    });
    const rs = computeRuleBasedScore(p, nowMs);
    expect(rs.rawScore).toBeGreaterThan(55);
  });

  it("boosts target intent phrases (lowball, recorded statement, lawyer question)", () => {
    const nowMs = Date.now();
    const p = post({
      title: "Adjuster wants a recorded statement",
      selftext: "They gave a lowball offer. Do I need a lawyer before I talk to them?",
      createdUtc: nowMs / 1000 - 3600,
      numComments: 2,
    });
    const rs = computeRuleBasedScore(p, nowMs);
    expect(rs.ruleNotes).toContain("target_intent_boost");
    expect(rs.rawScore).toBeGreaterThan(60);
  });

  it("penalizes shopping/academic insurance threads without claim context", () => {
    const nowMs = Date.now();
    const p = post({
      title: "Umbrella policy vs auto limits",
      selftext: "ELI5 how does car insurance work for a class discussion",
      createdUtc: nowMs / 1000 - 3600,
      numComments: 2,
    });
    const rs = computeRuleBasedScore(p, nowMs);
    expect(rs.ruleNotes).toContain("insurance_shopping_or_academic_penalty");
  });

  it("does not apply shopping penalty when claim/injury context is present", () => {
    const nowMs = Date.now();
    const p = post({
      title: "Cheapest car insurance after accident injury claim?",
      selftext: "My claim was denied and I need new coverage",
      createdUtc: nowMs / 1000 - 3600,
      numComments: 2,
    });
    const rs = computeRuleBasedScore(p, nowMs);
    expect(rs.ruleNotes).not.toContain("insurance_shopping_or_academic_penalty");
  });
});
