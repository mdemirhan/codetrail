import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverSessionFiles } from "./discoverSessionFiles";

describe("discoverSessionFiles", () => {
  it("discovers provider session files with configured parity rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-discovery-"));

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
      cursorRoot: join(dir, ".cursor", "projects"),
      opencodeDbPath: join(dir, ".local", "share", "opencode", "opencode.db"),
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
      cursorRoot: join(dir, ".cursor", "projects"),
      opencodeDbPath: join(dir, ".local", "share", "opencode", "opencode.db"),
      includeClaudeSubagents: false,
    });

    expect(
      discoveredWithoutSubagents.some(
        (file) => file.provider === "claude" && file.metadata.isSubagent,
      ),
    ).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it("discovers cursor sessions using terminal cwd and marks unresolved project paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-discovery-cursor-"));
    const cursorRoot = join(dir, ".cursor", "projects");

    const actualProjectPath = join(dir, "workspace", "my-hyphen-app");
    mkdirSync(actualProjectPath, { recursive: true });
    const encodedResolvedName = actualProjectPath.slice(1).replaceAll("/", "-");
    const resolvedProjectDir = join(cursorRoot, encodedResolvedName);
    const resolvedSessionUuid = "cursor-session-shared";
    const resolvedTranscriptDir = join(
      resolvedProjectDir,
      "agent-transcripts",
      resolvedSessionUuid,
    );
    mkdirSync(resolvedTranscriptDir, { recursive: true });
    mkdirSync(join(resolvedProjectDir, "terminals"), { recursive: true });
    writeFileSync(
      join(resolvedProjectDir, "terminals", "1.txt"),
      [
        "---",
        `cwd: "${actualProjectPath}"`,
        'command: "ls"',
        "started_at: 2026-03-04T00:00:00.000Z",
        "---",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(resolvedTranscriptDir, `${resolvedSessionUuid}.jsonl`),
      `${JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "Hello" }] } })}\n`,
    );

    const encodedUnresolvedName = "Users-nonexistent-my-hyphen-project";
    const unresolvedProjectDir = join(cursorRoot, encodedUnresolvedName);
    const unresolvedSessionUuid = "cursor-session-shared";
    const unresolvedTranscriptDir = join(
      unresolvedProjectDir,
      "agent-transcripts",
      unresolvedSessionUuid,
    );
    mkdirSync(unresolvedTranscriptDir, { recursive: true });
    writeFileSync(
      join(unresolvedTranscriptDir, `${unresolvedSessionUuid}.jsonl`),
      `${JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "Done" }] } })}\n`,
    );

    const discovered = discoverSessionFiles({
      claudeRoot: join(dir, ".claude", "projects"),
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot,
      opencodeDbPath: join(dir, ".local", "share", "opencode", "opencode.db"),
      includeClaudeSubagents: false,
    });

    const cursorSessions = discovered.filter((file) => file.provider === "cursor");
    expect(cursorSessions).toHaveLength(2);

    const resolved = cursorSessions.find((file) => file.filePath.includes(encodedResolvedName));
    expect(resolved?.projectPath).toBe(actualProjectPath);
    expect(resolved?.metadata.cwd).toBe(actualProjectPath);
    expect(resolved?.metadata.unresolvedProject).toBe(false);
    expect(resolved?.sessionIdentity.startsWith(`cursor:${resolvedSessionUuid}:`)).toBe(true);

    const unresolved = cursorSessions.find((file) => file.filePath.includes(encodedUnresolvedName));
    expect(unresolved?.projectPath).toBe("");
    expect(unresolved?.projectName).toBe(encodedUnresolvedName);
    expect(unresolved?.metadata.cwd).toBeNull();
    expect(unresolved?.metadata.unresolvedProject).toBe(true);
    expect(unresolved?.sessionIdentity.startsWith(`cursor:${unresolvedSessionUuid}:`)).toBe(true);

    expect(resolved?.sessionIdentity).not.toBe(unresolved?.sessionIdentity);

    rmSync(dir, { recursive: true, force: true });
  });
});
