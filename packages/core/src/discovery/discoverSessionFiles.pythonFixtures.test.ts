import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverSessionFiles } from "./discoverSessionFiles";

describe("discoverSessionFiles python fixtures", () => {
  it("discovers claude/codex/gemini files from provider fixture tree", () => {
    const fixturesRoot = join(process.cwd(), "packages", "core", "test-fixtures", "providers");
    const discovered = discoverSessionFiles({
      claudeRoot: join(fixturesRoot, "claude", "projects"),
      codexRoot: join(fixturesRoot, "codex", "sessions"),
      geminiRoot: join(fixturesRoot, "gemini", "tmp"),
      geminiHistoryRoot: join(fixturesRoot, "gemini", "history"),
      geminiProjectsPath: join(fixturesRoot, "gemini", "projects.json"),
      cursorRoot: join(fixturesRoot, "cursor", "projects"),
      includeClaudeSubagents: false,
    });

    expect(discovered).toHaveLength(3);
    expect(new Set(discovered.map((file) => file.provider))).toEqual(
      new Set(["claude", "codex", "gemini"]),
    );

    const claude = discovered.find((file) => file.provider === "claude");
    const codex = discovered.find((file) => file.provider === "codex");
    const gemini = discovered.find((file) => file.provider === "gemini");

    expect(claude?.sourceSessionId).toBe("claude-session-redacted-001");
    expect(claude?.projectPath).toBe("/Users/redacted/workspace/demo/claude");

    expect(codex?.sourceSessionId).toBe("codex-session-redacted-001");
    expect(codex?.projectPath).toBe("/Users/redacted/workspace/demo-codex");
    expect(codex?.sessionIdentity.startsWith("codex:codex-session-redacted-001:")).toBe(true);

    expect(gemini?.sourceSessionId).toBe("gemini-session-redacted-001");
    expect(gemini?.projectPath).toBe("/Users/redacted/workspace/demo-gemini");
    expect(gemini?.sessionIdentity.startsWith("gemini:gemini-session-redacted-001:")).toBe(true);
    expect(gemini?.filePath.includes("/sessions/")).toBe(true);
  });
});
