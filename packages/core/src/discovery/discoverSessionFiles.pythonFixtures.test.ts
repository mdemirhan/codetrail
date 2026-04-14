import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverSessionFiles } from "./discoverSessionFiles";

describe("discoverSessionFiles python fixtures", () => {
  it("discovers all provider files from the shared fixture tree", () => {
    const fixturesRoot = join(process.cwd(), "packages", "core", "test-fixtures", "providers");
    const discovered = discoverSessionFiles({
      claudeRoot: join(fixturesRoot, "claude", "projects"),
      codexRoot: join(fixturesRoot, "codex", "sessions"),
      geminiRoot: join(fixturesRoot, "gemini", "tmp"),
      geminiHistoryRoot: join(fixturesRoot, "gemini", "history"),
      geminiProjectsPath: join(fixturesRoot, "gemini", "projects.json"),
      cursorRoot: join(fixturesRoot, "cursor", "projects"),
      copilotRoot: join(fixturesRoot, "copilot", "workspaceStorage"),
      copilotCliRoot: join(fixturesRoot, "copilot-cli", "session-state"),
      opencodeRoot: join(fixturesRoot, "opencode"),
      includeClaudeSubagents: false,
    });

    expect(discovered).toHaveLength(11);
    expect(new Set(discovered.map((file) => file.provider))).toEqual(
      new Set(["claude", "codex", "gemini", "cursor", "copilot", "copilot_cli"]),
    );

    const claude = discovered.find(
      (file) => file.sourceSessionId === "claude-session-redacted-001",
    );
    const claudeInRepoWorktree = discovered.find(
      (file) => file.sourceSessionId === "claude-session-redacted-wt-001",
    );
    const claudeExternalWorktree = discovered.find(
      (file) => file.sourceSessionId === "claude-session-redacted-wt-002",
    );
    const codex = discovered.find((file) => file.sourceSessionId === "codex-session-redacted-001");
    const codexRemoteWorktree = discovered.find(
      (file) => file.sourceSessionId === "codex-worktree-remote-001",
    );
    const codexLocalMain = discovered.find(
      (file) => file.sourceSessionId === "codex-local-main-001",
    );
    const codexLocalWorktree = discovered.find(
      (file) => file.sourceSessionId === "codex-local-worktree-001",
    );
    const gemini = discovered.find((file) => file.provider === "gemini");
    const cursor = discovered.find((file) => file.provider === "cursor");
    const copilot = discovered.find((file) => file.provider === "copilot");

    expect(claude?.sourceSessionId).toBe("claude-session-redacted-001");
    expect(claude?.projectPath).toBe("/Users/redacted/workspace/demo/claude");
    expect(claudeInRepoWorktree?.projectPath).toBe("/Users/redacted/workspace/demo/claude");
    expect(claudeInRepoWorktree?.metadata.worktreeLabel).toBe("funny-haibt");
    expect(claudeInRepoWorktree?.metadata.worktreeSource).toBe("claude_cwd");
    expect(claudeExternalWorktree?.projectPath).toBe("/Users/redacted/workspace/demo/claude");
    expect(claudeExternalWorktree?.metadata.worktreeLabel).toBe("competent-matsumoto");
    expect(claudeExternalWorktree?.metadata.worktreeSource).toBe("claude_env_text");

    expect(codex?.sourceSessionId).toBe("codex-session-redacted-001");
    expect(codex?.projectPath).toBe("/Users/redacted/workspace/demo-codex");
    expect(codex?.sessionIdentity.startsWith("codex:codex-session-redacted-001:")).toBe(true);
    expect(codexRemoteWorktree?.projectPath).toBe(
      "/Users/redacted/.codex/worktrees/64ef/demo-codex",
    );
    expect(codexRemoteWorktree?.metadata.worktreeLabel).toBe("64ef");
    expect(codexRemoteWorktree?.metadata.repositoryUrl).toBe("https://example.com/demo-codex.git");
    expect(codexLocalMain?.projectPath).toBe("/Users/redacted/src/test123");
    expect(codexLocalWorktree?.projectPath).toBe("/Users/redacted/src/test123");
    expect(codexLocalWorktree?.metadata.worktreeLabel).toBe("c5dd");
    expect(codexLocalWorktree?.metadata.worktreeSource).toBe("codex_fork");

    expect(gemini?.sourceSessionId).toBe("gemini-session-redacted-001");
    expect(gemini?.projectPath).toBe("/Users/redacted/workspace/demo-gemini");
    expect(gemini?.sessionIdentity.startsWith("gemini:gemini-session-redacted-001:")).toBe(true);
    expect(gemini?.filePath.includes("/sessions/")).toBe(true);

    expect(cursor?.sourceSessionId).toBe("cursor-session-redacted-001");
    expect(cursor?.projectPath).toBe("/Users/redacted/workspace/demo-cursor");
    expect(cursor?.sessionIdentity.startsWith("cursor:cursor-session-redacted-001:")).toBe(true);
    expect(cursor?.filePath.includes("/agent-transcripts/")).toBe(true);

    expect(copilot?.sourceSessionId).toBe("copilot-session-redacted-001");
    expect(copilot?.projectPath).toBe("/Users/redacted/workspace/demo-copilot");
    expect(copilot?.sessionIdentity.startsWith("copilot:copilot-session-redacted-001:")).toBe(true);
    expect(copilot?.filePath.includes("/chatSessions/")).toBe(true);
  });
});
