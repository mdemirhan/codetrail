import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverSessionFiles } from "./discoverSessionFiles";

describe("discoverSessionFiles", () => {
  it("discovers provider session files with configured parity rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "cch-ts-discovery-"));

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(join(claudeProject, "s1", "subagents"), { recursive: true });
    writeFileSync(
      join(claudeProject, "s1.jsonl"),
      `${JSON.stringify({
        sessionId: "s1",
        cwd: "/workspace/app",
        gitBranch: "main",
        type: "user",
        message: { role: "user", content: "Hello" },
      })}\n`,
    );
    writeFileSync(
      join(claudeProject, "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [{ sessionId: "s1", projectPath: "/workspace/app" }],
      }),
    );
    writeFileSync(
      join(claudeProject, "s1", "subagents", "agent-a.jsonl"),
      `${JSON.stringify({
        sessionId: "s1",
        cwd: "/workspace/app",
        gitBranch: "main",
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
      })}\n`,
    );

    const codexRoot = join(dir, ".codex", "sessions", "2026", "02", "27");
    mkdirSync(codexRoot, { recursive: true });
    writeFileSync(
      join(codexRoot, "rollout-test.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: "codex-1",
          cwd: "/workspace/codex",
          git: { branch: "dev" },
        },
      })}\n`,
    );

    const geminiRoot = join(dir, ".gemini", "tmp");
    const geminiHistoryRoot = join(dir, ".gemini", "history");
    mkdirSync(join(geminiRoot, "dux", "chats"), { recursive: true });
    mkdirSync(join(geminiRoot, "hash-only", "chats"), { recursive: true });
    mkdirSync(join(geminiRoot, "logs-only"), { recursive: true });
    mkdirSync(join(geminiHistoryRoot, "dux"), { recursive: true });
    writeFileSync(join(geminiRoot, "dux", ".project_root"), "/workspace/dux");
    writeFileSync(join(geminiHistoryRoot, "dux", ".project_root"), "/workspace/dux");

    const knownHash = "ddd29e90e8e0e53b3e06996841fdaf7a26e33cdca62e0678fb37e500d58d2bf8";
    const unknownHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    writeFileSync(
      join(geminiRoot, "dux", "chats", "session-1.json"),
      JSON.stringify({
        sessionId: "gem-1",
        projectHash: knownHash,
        startTime: "2026-02-27T00:00:00Z",
        lastUpdated: "2026-02-27T00:00:10Z",
        messages: [{ id: "m1", type: "user", content: "hello", timestamp: "2026-02-27T00:00:00Z" }],
      }),
    );
    writeFileSync(
      join(geminiRoot, "hash-only", "chats", "session-2.json"),
      JSON.stringify({
        sessionId: "gem-2",
        projectHash: unknownHash,
        startTime: "2026-02-27T00:00:00Z",
        lastUpdated: "2026-02-27T00:00:10Z",
        messages: [{ id: "m1", type: "user", content: "hello", timestamp: "2026-02-27T00:00:00Z" }],
      }),
    );
    writeFileSync(join(geminiRoot, "logs-only", "logs.json"), JSON.stringify([]));

    const discoveredWithSubagents = discoverSessionFiles({
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot,
      geminiHistoryRoot,
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      includeClaudeSubagents: true,
    });

    expect(discoveredWithSubagents).toHaveLength(5);
    expect(
      discoveredWithSubagents.some(
        (file) => file.provider === "claude" && file.metadata.isSubagent,
      ),
    ).toBe(true);
    expect(discoveredWithSubagents.some((file) => file.filePath.endsWith("logs.json"))).toBe(false);

    const resolvedGemini = discoveredWithSubagents.find((file) => file.sourceSessionId === "gem-1");
    expect(resolvedGemini?.projectPath).toBe("/workspace/dux");

    const unresolvedGemini = discoveredWithSubagents.find(
      (file) => file.sourceSessionId === "gem-2",
    );
    expect(unresolvedGemini?.projectPath).toBe("");
    expect(unresolvedGemini?.projectName).toBe("hash-only");
    expect(unresolvedGemini?.metadata.unresolvedProject).toBe(true);

    const discoveredWithoutSubagents = discoverSessionFiles({
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot,
      geminiHistoryRoot,
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      includeClaudeSubagents: false,
    });

    expect(
      discoveredWithoutSubagents.some(
        (file) => file.provider === "claude" && file.metadata.isSubagent,
      ),
    ).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});
