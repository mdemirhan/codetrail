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
    mkdirSync(join(geminiHistoryRoot, "dux", "sessions"), { recursive: true });
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
    writeFileSync(
      join(geminiHistoryRoot, "dux", "sessions", "session-3.json"),
      JSON.stringify({
        sessionId: "gem-3",
        projectHash: knownHash,
        startTime: "2026-02-27T00:00:20Z",
        lastUpdated: "2026-02-27T00:00:30Z",
        messages: [
          {
            id: "m1",
            type: "user",
            content: "history hello",
            timestamp: "2026-02-27T00:00:20Z",
          },
        ],
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
      copilotRoot: join(dir, ".copilot-workspace"),
      includeClaudeSubagents: true,
    });

    expect(discoveredWithSubagents).toHaveLength(6);
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
    expect(discoveredWithSubagents.some((file) => file.sourceSessionId === "gem-3")).toBe(true);

    const discoveredWithoutSubagents = discoverSessionFiles({
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot,
      geminiHistoryRoot,
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
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
      copilotRoot: join(dir, ".copilot-workspace"),
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

  it("discovers copilot sessions from workspaceStorage and resolves project paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-discovery-copilot-"));
    const copilotRoot = join(dir, "workspaceStorage");

    const workspaceId = "abc123def456";
    const workspaceDir = join(copilotRoot, workspaceId);
    const chatSessionsDir = join(workspaceDir, "chatSessions");
    mkdirSync(chatSessionsDir, { recursive: true });

    writeFileSync(
      join(workspaceDir, "workspace.json"),
      JSON.stringify({ folder: `file://${join(dir, "my-project")}` }),
    );
    mkdirSync(join(dir, "my-project"), { recursive: true });

    writeFileSync(
      join(chatSessionsDir, "session-a.json"),
      JSON.stringify({
        version: 3,
        sessionId: "session-a",
        requests: [{ requestId: "r1", message: { text: "test" }, response: [] }],
      }),
    );
    writeFileSync(
      join(chatSessionsDir, "session-b.json"),
      JSON.stringify({
        version: 3,
        sessionId: "session-b",
        requests: [],
      }),
    );

    const unresolvedWorkspaceId = "xyz789";
    const unresolvedWorkspaceDir = join(copilotRoot, unresolvedWorkspaceId);
    const unresolvedChatDir = join(unresolvedWorkspaceDir, "chatSessions");
    mkdirSync(unresolvedChatDir, { recursive: true });

    writeFileSync(
      join(unresolvedChatDir, "session-c.json"),
      JSON.stringify({ version: 3, sessionId: "session-c", requests: [] }),
    );

    const discovered = discoverSessionFiles({
      claudeRoot: join(dir, ".claude", "projects"),
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot,
      includeClaudeSubagents: false,
    });

    const copilotSessions = discovered.filter((f) => f.provider === "copilot");
    expect(copilotSessions).toHaveLength(3);

    const resolved = copilotSessions.find((f) => f.sourceSessionId === "session-a");
    expect(resolved?.projectPath).toBe(join(dir, "my-project"));
    expect(resolved?.projectName).toBe("my-project");
    expect(resolved?.metadata.unresolvedProject).toBe(false);
    expect(resolved?.sessionIdentity.startsWith("copilot:session-a:")).toBe(true);

    const unresolved = copilotSessions.find((f) => f.sourceSessionId === "session-c");
    expect(unresolved?.projectPath).toBe("");
    expect(unresolved?.projectName).toBe(unresolvedWorkspaceId);
    expect(unresolved?.metadata.unresolvedProject).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns no copilot sessions when copilotRoot does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-no-copilot-"));

    const discovered = discoverSessionFiles({
      claudeRoot: join(dir, ".claude", "projects"),
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, "nonexistent-copilot-root"),
      includeClaudeSubagents: false,
    });

    expect(discovered.filter((f) => f.provider === "copilot")).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns no copilot sessions when workspaceStorage exists but has no chatSessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-copilot-empty-"));
    const copilotRoot = join(dir, "workspaceStorage");

    const workspaceDir = join(copilotRoot, "some-workspace-id");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      join(workspaceDir, "workspace.json"),
      JSON.stringify({ folder: `file://${join(dir, "some-project")}` }),
    );

    const discovered = discoverSessionFiles({
      claudeRoot: join(dir, ".claude", "projects"),
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot,
      includeClaudeSubagents: false,
    });

    expect(discovered.filter((f) => f.provider === "copilot")).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("discovers mixed-case transcript filenames and provider folders", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-discovery-case-insensitive-"));

    const claudeProject = join(dir, ".claude", "projects", "project-a");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      join(claudeProject, "CLAUDE-1.JSONL"),
      `${JSON.stringify({
        sessionId: "claude-1",
        cwd: "/workspace/claude",
        type: "user",
        message: { role: "user", content: "Hello" },
      })}\n`,
    );

    const codexDir = join(dir, ".codex", "sessions", "2026", "03", "25");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "CODEX-1.JSONL"),
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: "codex-1",
          cwd: "/workspace/codex",
        },
      })}\n`,
    );

    const geminiDir = join(dir, ".gemini", "tmp", "app", "chats");
    mkdirSync(geminiDir, { recursive: true });
    writeFileSync(join(dir, ".gemini", "tmp", "app", ".project_root"), "/workspace/gemini");
    writeFileSync(
      join(geminiDir, "Session-1.JSON"),
      JSON.stringify({
        sessionId: "gemini-1",
        projectHash: "hash",
      }),
    );

    const cursorTranscriptDir = join(
      dir,
      ".cursor",
      "projects",
      "Users-test-project",
      "AGENT-TRANSCRIPTS",
      "cursor-1",
    );
    mkdirSync(cursorTranscriptDir, { recursive: true });
    writeFileSync(
      join(cursorTranscriptDir, "CURSOR-1.JSONL"),
      `${JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "Hi" }] } })}\n`,
    );

    const copilotChatDir = join(dir, "workspaceStorage", "workspace-1", "CHATSessions");
    mkdirSync(copilotChatDir, { recursive: true });
    writeFileSync(
      join(dir, "workspaceStorage", "workspace-1", "workspace.json"),
      JSON.stringify({ folder: "file:///workspace/copilot" }),
    );
    writeFileSync(
      join(copilotChatDir, "COPILOT-1.JSON"),
      JSON.stringify({ version: 3, sessionId: "copilot-1", requests: [] }),
    );

    const discovered = discoverSessionFiles({
      claudeRoot: join(dir, ".claude", "projects"),
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, "workspaceStorage"),
      includeClaudeSubagents: false,
    });

    expect(
      discovered.some(
        (file) => file.provider === "claude" && file.metadata.providerSessionId === "claude-1",
      ),
    ).toBe(true);
    expect(
      discovered.some((file) => file.provider === "codex" && file.sourceSessionId === "codex-1"),
    ).toBe(true);
    expect(
      discovered.some((file) => file.provider === "gemini" && file.sourceSessionId === "gemini-1"),
    ).toBe(true);
    expect(
      discovered.some((file) => file.provider === "cursor" && file.sourceSessionId === "cursor-1"),
    ).toBe(true);
    expect(
      discovered.some(
        (file) => file.provider === "copilot" && file.metadata.providerSessionId === "copilot-1",
      ),
    ).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
