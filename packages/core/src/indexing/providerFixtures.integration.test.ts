import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/bootstrap";
import { runIncrementalIndexing } from "./indexSessions";

describe("provider fixture indexing", () => {
  it("indexes every provider from the shared fixture tree", () => {
    const fixturesRoot = join(process.cwd(), "packages", "core", "test-fixtures", "providers");
    const dir = mkdtempSync(join(tmpdir(), "codetrail-provider-fixtures-"));
    const dbPath = join(dir, "fixtures.sqlite");

    try {
      const result = runIncrementalIndexing({
        dbPath,
        discoveryConfig: {
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
        },
      });

      expect(result.discoveredFiles).toBe(11);
      expect(result.indexedFiles).toBe(11);
      expect(result.skippedFiles).toBe(0);

      const db = openDatabase(dbPath);
      try {
        const sessionCounts = db
          .prepare(
            `SELECT provider, COUNT(*) as count
           FROM sessions
           GROUP BY provider
           ORDER BY provider`,
          )
          .all() as Array<{ provider: string; count: number }>;

        expect(sessionCounts).toEqual([
          { provider: "claude", count: 3 },
          { provider: "codex", count: 4 },
          { provider: "copilot", count: 1 },
          { provider: "copilot_cli", count: 1 },
          { provider: "cursor", count: 1 },
          { provider: "gemini", count: 1 },
        ]);

        const projectCounts = db
          .prepare(
            `SELECT provider, COUNT(*) as count
             FROM projects
             GROUP BY provider
             ORDER BY provider`,
          )
          .all() as Array<{ provider: string; count: number }>;

        expect(projectCounts).toEqual([
          { provider: "claude", count: 1 },
          { provider: "codex", count: 2 },
          { provider: "copilot", count: 1 },
          { provider: "copilot_cli", count: 1 },
          { provider: "cursor", count: 1 },
          { provider: "gemini", count: 1 },
        ]);

        const worktreeSessions = db
          .prepare(
            `SELECT provider, cwd, worktree_label
             FROM sessions
             WHERE worktree_label IS NOT NULL
             ORDER BY provider, cwd`,
          )
          .all() as Array<{ provider: string; cwd: string; worktree_label: string }>;

        expect(worktreeSessions).toEqual([
          {
            provider: "claude",
            cwd: "/Users/redacted/tmp/codetrail/competent-matsumoto",
            worktree_label: "competent-matsumoto",
          },
          {
            provider: "claude",
            cwd: "/Users/redacted/workspace/demo/claude/.claude/worktrees/funny-haibt",
            worktree_label: "funny-haibt",
          },
          {
            provider: "codex",
            cwd: "/Users/redacted/.codex/worktrees/64ef/demo-codex",
            worktree_label: "64ef",
          },
          {
            provider: "codex",
            cwd: "/Users/redacted/.codex/worktrees/c5dd/test123",
            worktree_label: "c5dd",
          },
        ]);

        const copilotSystemMessage = db
          .prepare(
            `SELECT provider, category
           FROM messages
           WHERE content LIKE '%Confirm changes%'
           LIMIT 1`,
          )
          .get() as { provider: string; category: string } | undefined;

        expect(copilotSystemMessage).toEqual({
          provider: "copilot",
          category: "system",
        });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
