import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverSessionFiles } from "./discoverSessionFiles";

describe("discoverSessionFiles python fixtures", () => {
  it("discovers claude/codex/gemini/cursor files from provider fixture tree", () => {
    const fixturesRoot = join(process.cwd(), "packages", "core", "test-fixtures", "providers");
    const discovered = discoverSessionFiles({
      claudeRoot: join(fixturesRoot, "claude", "projects"),
      codexRoot: join(fixturesRoot, "codex", "sessions"),
      geminiRoot: join(fixturesRoot, "gemini", "tmp"),
      geminiHistoryRoot: join(fixturesRoot, "gemini", "history"),
      geminiProjectsPath: join(fixturesRoot, "gemini", "projects.json"),
      cursorRoot: join(fixturesRoot, "cursor", "projects"),
      copilotRoot: join(fixturesRoot, "copilot", "workspaceStorage"),
      includeClaudeSubagents: false,
    });

    expect(discovered).toHaveLength(4);
    expect(new Set(discovered.map((file) => file.provider))).toEqual(
      new Set(["claude", "codex", "gemini", "cursor"]),
    );

    const claude = discovered.find((file) => file.provider === "claude");
    const codex = discovered.find((file) => file.provider === "codex");
    const gemini = discovered.find((file) => file.provider === "gemini");
    const cursor = discovered.find((file) => file.provider === "cursor");

    expect(claude?.sourceSessionId).toBe("claude-session-redacted-001");
    expect(claude?.projectPath).toBe("/Users/redacted/workspace/demo/claude");

    expect(codex?.sourceSessionId).toBe("codex-session-redacted-001");
    expect(codex?.projectPath).toBe("/Users/redacted/workspace/demo-codex");
    expect(codex?.sessionIdentity.startsWith("codex:codex-session-redacted-001:")).toBe(true);

    expect(gemini?.sourceSessionId).toBe("gemini-session-redacted-001");
    expect(gemini?.projectPath).toBe("/Users/redacted/workspace/demo-gemini");
    expect(gemini?.sessionIdentity.startsWith("gemini:gemini-session-redacted-001:")).toBe(true);
    expect(gemini?.filePath.includes("/sessions/")).toBe(true);

    expect(cursor?.sourceSessionId).toBe("cursor-session-redacted-001");
    expect(cursor?.projectPath).toBe("/Users/redacted/workspace/demo-cursor");
    expect(cursor?.sessionIdentity.startsWith("cursor:cursor-session-redacted-001:")).toBe(true);
    expect(cursor?.filePath.includes("/agent-transcripts/")).toBe(true);
  });
});
