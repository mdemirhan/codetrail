import { describe, expect, it } from "vitest";

import {
  clamp,
  compactPath,
  compareRecent,
  countProviders,
  deriveSessionTitle,
  formatDate,
  prettyCategory,
  prettyProvider,
  sessionActivityOf,
  toErrorMessage,
  toggleValue,
} from "./viewUtils";

describe("viewUtils", () => {
  it("toggles values and counts providers", () => {
    expect(toggleValue(["claude", "codex"], "claude")).toEqual(["codex"]);
    expect(toggleValue(["codex"], "claude")).toEqual(["codex", "claude"]);

    expect(countProviders(["claude", "claude", "gemini"]).claude).toBe(2);
    expect(countProviders(["claude", "claude", "gemini"]).gemini).toBe(1);
  });

  it("formats dates and compares recency", () => {
    const nowIso = new Date().toISOString();
    expect(formatDate(nowIso)).toContain("Today");
    expect(formatDate(null)).toBe("-");
    expect(formatDate("not-a-date")).toBe("not-a-date");

    expect(compareRecent("2026-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z")).toBeGreaterThan(
      0,
    );
  });

  it("builds human labels and normalizes errors", () => {
    expect(prettyProvider("claude")).toBe("Claude");
    expect(prettyCategory("tool_edit")).toBe("Write");
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
    expect(toErrorMessage(42)).toBe("42");
  });

  it("derives session activity, title and compact paths", () => {
    const session = {
      id: "session_1",
      title:
        "  This is a long title that should be compacted into at most twelve words for display ",
      modelNames: "claude-opus",
      startedAt: "2026-03-01T10:00:00.000Z",
      endedAt: "2026-03-01T10:00:05.000Z",
    };

    expect(sessionActivityOf(session)).toBe("2026-03-01T10:00:05.000Z");
    expect(deriveSessionTitle(session)).toContain("This is a long title");
    expect(deriveSessionTitle({ ...session, title: "  " })).toBe("claude-opus");

    expect(compactPath("/Users/test/work/project")).toBe("~/work/project");
    expect(compactPath("C:\\Users\\test\\work\\project")).toBe("~\\work\\project");
    expect(compactPath("")).toBe("(no path)");
  });

  it("clamps numeric ranges", () => {
    expect(clamp(10, 1, 8)).toBe(8);
    expect(clamp(-2, 1, 8)).toBe(1);
    expect(clamp(4, 1, 8)).toBe(4);
  });
});
