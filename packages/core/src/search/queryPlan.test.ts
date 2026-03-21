import { describe, expect, it } from "vitest";

import {
  SEARCH_TOKEN_MAX_LENGTH,
  buildSearchHighlightRegex,
  buildSearchQueryPlan,
  buildWildcardFilterPatterns,
} from "./queryPlan";

describe("buildSearchQueryPlan", () => {
  it("keeps plain terms in FTS and supports trailing-prefix terms", () => {
    const plan = buildSearchQueryPlan("focus fo*");

    expect(plan.ftsQuery).toBe('"focus" "fo"*');
    expect(plan.hasTerms).toBe(true);
    expect(plan.error).toBeNull();
  });

  it("treats leading and infix wildcards as literal FTS terms", () => {
    const plan = buildSearchQueryPlan("*cus f*us");

    expect(plan.ftsQuery).toBe('"cus" "fus"');
    expect(plan.hasTerms).toBe(true);
  });

  it("keeps trailing single-char wildcard as FTS prefix", () => {
    const shortPlan = buildSearchQueryPlan("f*");
    expect(shortPlan.ftsQuery).toBe('"f"*');
  });

  it("ignores all-wildcard tokens and truncates oversized tokens", () => {
    const token = `prefix${"x".repeat(SEARCH_TOKEN_MAX_LENGTH + 10)}*`;
    const plan = buildSearchQueryPlan(`*** ${token}`);

    expect(plan.hasTerms).toBe(true);
    expect(plan.ftsTokens[0]?.value.length).toBe(SEARCH_TOKEN_MAX_LENGTH);
  });

  it("treats unsupported wildcard positions as literal tokens", () => {
    const plan = buildSearchQueryPlan("*us f*us");
    expect(plan.ftsQuery).toBe('"us" "fus"');
  });

  it("builds advanced FTS queries with boolean operators and phrases", () => {
    const plan = buildSearchQueryPlan('focus OR ("error code" NOT flaky*)', "advanced");

    expect(plan.error).toBeNull();
    expect(plan.ftsQuery).toBe('"focus" OR "error code" NOT "flaky"*');
    expect(plan.highlightPatterns).toEqual(["focus", "error code"]);
  });

  it("supports binary NOT without requiring explicit AND", () => {
    const plan = buildSearchQueryPlan("focus NOT search", "advanced");
    expect(plan.error).toBeNull();
    expect(plan.ftsQuery).toBe('"focus" NOT "search"');
    expect(plan.highlightPatterns).toEqual(["focus"]);
  });

  it("returns advanced parse errors for invalid syntax", () => {
    const plan = buildSearchQueryPlan("focus OR (", "advanced");
    expect(plan.hasTerms).toBe(false);
    expect(plan.ftsQuery).toBeNull();
    expect(plan.error).toContain("Expected a term");
  });

  it("rejects leading NOT in advanced queries", () => {
    const plan = buildSearchQueryPlan("NOT focus", "advanced");
    expect(plan.error).toContain("Unexpected token 'NOT'");
    expect(plan.ftsQuery).toBeNull();
  });
});

describe("buildWildcardFilterPatterns", () => {
  it("uses contains semantics without wildcards and wildcard semantics with stars", () => {
    const patterns = buildWildcardFilterPatterns("repo fo* *bar");
    expect(patterns).toEqual(["%repo%", "fo%", "%bar%"]);
  });

  it("ignores wildcard-only tokens", () => {
    const patterns = buildWildcardFilterPatterns("***");
    expect(patterns).toEqual([]);
  });
});

describe("buildSearchHighlightRegex", () => {
  it("builds a matcher that handles plain and wildcard terms", () => {
    const matcher = buildSearchHighlightRegex("focus fo* *cus f*us");
    expect(matcher).not.toBeNull();
    const value = "focus focuses discuss fzzzus";
    expect(value.match(matcher ?? /$/g)).toEqual(["focus", "focus", "cus"]);
  });

  it("matches phrases across punctuation and whitespace token separators", () => {
    const matcher = buildSearchHighlightRegex("focus+on+some*");
    expect(matcher).not.toBeNull();
    const value = "keep focus on somethingElse concrete";
    expect(value.match(matcher ?? /$/g)).toEqual(["focus on somethingElse"]);
  });

  it("matches phrase highlights across punctuation-delimited tokens", () => {
    const matcher = buildSearchHighlightRegex({
      normalizedQuery: '"history add"',
      mode: "simple",
      ftsTokens: [],
      ftsQuery: null,
      highlightPatterns: ["history add"],
      hasTerms: true,
      error: null,
    });
    expect(matcher).not.toBeNull();
    const value = "feat(history): add collapsible side panes";
    expect(value.match(matcher ?? /$/g)).toEqual(["history): add"]);
  });

  it("returns null for empty/ignored queries", () => {
    expect(buildSearchHighlightRegex("")).toBeNull();
    expect(buildSearchHighlightRegex("***")).toBeNull();
  });
});
