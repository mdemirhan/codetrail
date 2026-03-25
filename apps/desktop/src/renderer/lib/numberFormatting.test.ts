// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { formatCompactInteger, formatInteger } from "./numberFormatting";

describe("numberFormatting", () => {
  it("keeps small integers un-compacted", () => {
    expect(formatCompactInteger(654)).toBe(formatInteger(654));
  });

  it("compacts thousands with one fractional digit when useful", () => {
    expect(formatCompactInteger(6_543)).toBe("6.5K");
    expect(formatCompactInteger(18_457)).toBe("18.5K");
  });
});
