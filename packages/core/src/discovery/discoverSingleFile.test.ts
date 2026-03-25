import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { discoverSingleFile } from "./discoverSessionFiles";
import type { DiscoveryConfig } from "./types";

function makeConfig(dir: string): DiscoveryConfig {
  return {
    claudeRoot: join(dir, ".claude", "projects"),
    codexRoot: join(dir, ".codex", "sessions"),
    geminiRoot: join(dir, ".gemini", "tmp"),
    geminiHistoryRoot: join(dir, ".gemini", "history"),
    geminiProjectsPath: join(dir, ".gemini", "projects.json"),
    cursorRoot: join(dir, ".cursor", "projects"),
    copilotRoot: join(dir, "copilot-workspace"),
    includeClaudeSubagents: false,
  };
}

function expectDefined<T>(value: T | null | undefined, message: string): NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
  return value as NonNullable<T>;
}

describe("discoverSingleFile", () => {
  it("correctly identifies and extracts metadata for a Claude session file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-claude-"));
    const config = makeConfig(dir);
    const claudeProject = join(config.claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });

    writeFileSync(
      join(claudeProject, "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [{ sessionId: "s1", projectPath: "/workspace/app" }],
      }),
    );
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

    const result = discoverSingleFile(join(claudeProject, "s1.jsonl"), config);

    const discovered = expectDefined(result, "Expected Claude session result");
    expect(discovered.provider).toBe("claude");
    expect(discovered.sessionIdentity).toBe("s1");
    expect(discovered.sourceSessionId).toBe("s1");
    expect(discovered.projectPath).toBe("/workspace/app");
    expect(discovered.projectName).toBe("app");
    expect(discovered.metadata.cwd).toBe("/workspace/app");
    expect(discovered.metadata.gitBranch).toBe("main");
    expect(discovered.metadata.isSubagent).toBe(false);
    expect(discovered.fileSize).toBeGreaterThan(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts mixed-case Claude transcript extensions in single-file discovery", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-claude-case-"));
    const config = makeConfig(dir);
    const claudeProject = join(config.claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });

    writeFileSync(
      join(claudeProject, "SESSION-1.JSONL"),
      `${JSON.stringify({
        sessionId: "session-1",
        cwd: "/workspace/app",
        type: "user",
        message: { role: "user", content: "Hello" },
      })}\n`,
    );

    const result = discoverSingleFile(join(claudeProject, "SESSION-1.JSONL"), config);

    expectDefined(result, "Expected Claude session result");
    expect(result?.provider).toBe("claude");
    expect(result?.sessionIdentity).toBe("SESSION-1");

    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to decodeClaudeProjectId when sessions-index is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-claude-fallback-"));
    const config = makeConfig(dir);
    const claudeProject = join(config.claudeRoot, "workspace-myapp");
    mkdirSync(claudeProject, { recursive: true });

    writeFileSync(
      join(claudeProject, "s2.jsonl"),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "Hi" } })}\n`,
    );

    const result = discoverSingleFile(join(claudeProject, "s2.jsonl"), config);

    const discovered = expectDefined(result, "Expected fallback Claude session result");
    expect(discovered.provider).toBe("claude");
    expect(discovered.projectPath).toBe("workspace/myapp");

    rmSync(dir, { recursive: true, force: true });
  });

  it("prefers Claude transcript cwd over decoded folder names when sessions-index is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-claude-worktree-cwd-"));
    const config = makeConfig(dir);
    const claudeProject = join(
      config.claudeRoot,
      "-Users-test-workspace-demo--claude-worktrees-funny-haibt",
    );
    mkdirSync(claudeProject, { recursive: true });

    writeFileSync(
      join(claudeProject, "s2.jsonl"),
      `${JSON.stringify({
        sessionId: "s2",
        cwd: "/Users/test/workspace/demo/.claude/worktrees/funny-haibt",
        gitBranch: "claude/funny-haibt",
        type: "user",
        message: { role: "user", content: "Hi" },
      })}\n`,
    );

    const result = discoverSingleFile(join(claudeProject, "s2.jsonl"), config);

    const discovered = expectDefined(result, "Expected Claude worktree session result");
    expect(discovered.projectPath).toBe("/Users/test/workspace/demo");
    expect(discovered.canonicalProjectPath).toBe("/Users/test/workspace/demo");
    expect(discovered.metadata.cwd).toBe(
      "/Users/test/workspace/demo/.claude/worktrees/funny-haibt",
    );
    expect(discovered.metadata.worktreeLabel).toBe("funny-haibt");
    expect(discovered.metadata.worktreeSource).toBe("claude_cwd");

    rmSync(dir, { recursive: true, force: true });
  });

  it("derives external Claude worktree parents from transcript text", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-claude-worktree-env-"));
    const config = makeConfig(dir);
    const claudeProject = join(config.claudeRoot, "-Users-test-tmp-demo-worktree");
    mkdirSync(claudeProject, { recursive: true });

    writeFileSync(
      join(claudeProject, "s3.jsonl"),
      `${[
        JSON.stringify({
          sessionId: "s3",
          cwd: "/Users/test/tmp/demo/worktree-a",
          gitBranch: "claude/worktree-a",
          type: "user",
          message: { role: "user", content: "Hi" },
        }),
        JSON.stringify({
          sessionId: "s3",
          cwd: "/Users/test/tmp/demo/worktree-a",
          gitBranch: "claude/worktree-a",
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking:
                  "Environment\nMain repository: /Users/test/workspace/demo\nWorktree name: worktree-a",
              },
            ],
          },
        }),
      ].join("\n")}\n`,
    );

    const result = discoverSingleFile(join(claudeProject, "s3.jsonl"), config);

    const discovered = expectDefined(result, "Expected Claude external worktree result");
    expect(discovered.projectPath).toBe("/Users/test/workspace/demo");
    expect(discovered.metadata.worktreeLabel).toBe("worktree-a");
    expect(discovered.metadata.worktreeSource).toBe("claude_env_text");

    rmSync(dir, { recursive: true, force: true });
  });

  it("correctly identifies a Codex session file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-codex-"));
    const config = makeConfig(dir);
    const codexDir = join(config.codexRoot, "2026", "02", "27");
    mkdirSync(codexDir, { recursive: true });

    writeFileSync(
      join(codexDir, "rollout-test.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: "codex-1",
          cwd: "/workspace/codex",
          git: { branch: "dev" },
        },
      })}\n`,
    );

    const result = discoverSingleFile(join(codexDir, "rollout-test.jsonl"), config);

    const discovered = expectDefined(result, "Expected Codex session result");
    expect(discovered.provider).toBe("codex");
    expect(discovered.sourceSessionId).toBe("codex-1");
    expect(discovered.metadata.cwd).toBe("/workspace/codex");
    expect(discovered.metadata.gitBranch).toBe("dev");

    rmSync(dir, { recursive: true, force: true });
  });

  it("derives Codex worktree parent cwd from early function call context", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-codex-worktree-"));
    const config = makeConfig(dir);
    const codexDir = join(config.codexRoot, "2026", "03", "24");
    mkdirSync(codexDir, { recursive: true });

    writeFileSync(
      join(codexDir, "rollout-worktree.jsonl"),
      `${[
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "codex-worktree-1",
            forked_from_id: "parent-1",
            cwd: "/Users/test/.codex/worktrees/c5dd/test123",
            git: { branch: "codex/whatever" },
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: "git rev-parse --show-toplevel",
              workdir: "/Users/test/src/test123",
            }),
          },
        }),
      ].join("\n")}\n`,
    );

    const result = discoverSingleFile(join(codexDir, "rollout-worktree.jsonl"), config);

    const discovered = expectDefined(result, "Expected Codex worktree session result");
    expect(discovered.projectPath).toBe("/Users/test/src/test123");
    expect(discovered.canonicalProjectPath).toBe("/Users/test/src/test123");
    expect(discovered.metadata.cwd).toBe("/Users/test/.codex/worktrees/c5dd/test123");
    expect(discovered.metadata.worktreeLabel).toBe("c5dd");
    expect(discovered.metadata.worktreeSource).toBe("codex_fork");
    expect(discovered.metadata.parentSessionCwd).toBe("/Users/test/src/test123");

    rmSync(dir, { recursive: true, force: true });
  });

  it("derives Codex worktree parent cwd from turn_context records", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-codex-turn-context-"));
    const config = makeConfig(dir);
    const codexDir = join(config.codexRoot, "2026", "03", "24");
    mkdirSync(codexDir, { recursive: true });

    writeFileSync(
      join(codexDir, "rollout-turn-context.jsonl"),
      `${[
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "codex-worktree-turn-context",
            cwd: "/Users/test/.codex/worktrees/c5dd/test123",
            git: { branch: "codex/whatever" },
          },
        }),
        JSON.stringify({
          type: "turn_context",
          payload: {
            cwd: "/Users/test/src/test123",
            git: { branch: "main" },
          },
        }),
      ].join("\n")}\n`,
    );

    const result = discoverSingleFile(join(codexDir, "rollout-turn-context.jsonl"), config);

    const discovered = expectDefined(result, "Expected Codex turn_context worktree result");
    expect(discovered.projectPath).toBe("/Users/test/src/test123");
    expect(discovered.canonicalProjectPath).toBe("/Users/test/src/test123");
    expect(discovered.metadata.cwd).toBe("/Users/test/.codex/worktrees/c5dd/test123");
    expect(discovered.metadata.worktreeLabel).toBe("c5dd");
    expect(discovered.metadata.worktreeSource).toBe("codex_fork");
    expect(discovered.metadata.parentSessionCwd).toBe("/Users/test/src/test123");

    rmSync(dir, { recursive: true, force: true });
  });

  it("correctly identifies a Gemini history session file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-gemini-history-"));
    const config = makeConfig(dir);
    const geminiHistoryRoot = config.geminiHistoryRoot ?? join(dir, ".gemini", "history");
    const geminiProjectDir = join(geminiHistoryRoot, "dux");
    const geminiSessionPath = join(geminiProjectDir, "sessions", "session-1.json");
    mkdirSync(join(geminiProjectDir, "sessions"), { recursive: true });
    writeFileSync(join(geminiProjectDir, ".project_root"), "/workspace/dux");
    writeFileSync(
      geminiSessionPath,
      JSON.stringify({
        sessionId: "gemini-history-1",
        projectHash: "ddd29e90e8e0e53b3e06996841fdaf7a26e33cdca62e0678fb37e500d58d2bf8",
      }),
    );

    const result = discoverSingleFile(geminiSessionPath, config);

    const discovered = expectDefined(result, "Expected Gemini session result");
    expect(discovered.provider).toBe("gemini");
    expect(discovered.sourceSessionId).toBe("gemini-history-1");
    expect(discovered.projectPath).toBe("/workspace/dux");
    expect(discovered.projectName).toBe("dux");

    rmSync(dir, { recursive: true, force: true });
  });

  it("correctly identifies a Cursor session file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-cursor-"));
    const config = makeConfig(dir);

    const actualProjectPath = join(dir, "workspace", "my-app");
    mkdirSync(actualProjectPath, { recursive: true });
    const encodedName = actualProjectPath.slice(1).replaceAll("/", "-");
    const projectDir = join(config.cursorRoot, encodedName);
    const sessionUuid = "cursor-session-1";
    const transcriptDir = join(projectDir, "agent-transcripts", sessionUuid);
    mkdirSync(transcriptDir, { recursive: true });
    mkdirSync(join(projectDir, "terminals"), { recursive: true });
    writeFileSync(
      join(projectDir, "terminals", "1.txt"),
      `---\ncwd: "${actualProjectPath}"\n---\n`,
    );
    writeFileSync(
      join(transcriptDir, `${sessionUuid}.jsonl`),
      `${JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "Hello" }] } })}\n`,
    );

    const result = discoverSingleFile(join(transcriptDir, `${sessionUuid}.jsonl`), config);

    const discovered = expectDefined(result, "Expected Cursor session result");
    expect(discovered.provider).toBe("cursor");
    expect(discovered.sourceSessionId).toBe(sessionUuid);
    expect(discovered.projectPath).toBe(actualProjectPath);
    expect(discovered.sessionIdentity).toContain(`cursor:${sessionUuid}:`);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for files outside any provider root", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-unknown-"));
    const config = makeConfig(dir);
    const unknownFile = join(dir, "random", "file.jsonl");
    mkdirSync(join(dir, "random"), { recursive: true });
    writeFileSync(unknownFile, "{}");

    const result = discoverSingleFile(unknownFile, config);

    expect(result).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for files with wrong extensions", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-ext-"));
    const config = makeConfig(dir);
    const claudeProject = join(config.claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(join(claudeProject, "s1.txt"), "not a session file");

    const result = discoverSingleFile(join(claudeProject, "s1.txt"), config);

    expect(result).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when file does not exist (stat fails)", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-nofile-"));
    const config = makeConfig(dir);
    mkdirSync(join(config.claudeRoot, "project-a"), { recursive: true });

    const result = discoverSingleFile(
      join(config.claudeRoot, "project-a", "nonexistent.jsonl"),
      config,
    );

    expect(result).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for Claude subagent paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-subagent-"));
    const config = makeConfig(dir);
    const subagentDir = join(config.claudeRoot, "project-a", "s1", "subagents");
    mkdirSync(subagentDir, { recursive: true });
    writeFileSync(join(subagentDir, "agent.jsonl"), "{}");

    const result = discoverSingleFile(join(subagentDir, "agent.jsonl"), config);

    expect(result).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("correctly identifies a Gemini session file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-gemini-"));
    const config = makeConfig(dir);
    const geminiDir = join(config.geminiRoot, "dux", "chats");
    mkdirSync(geminiDir, { recursive: true });
    writeFileSync(join(config.geminiRoot, "dux", ".project_root"), "/workspace/dux");

    writeFileSync(
      join(geminiDir, "session-1.json"),
      JSON.stringify({
        sessionId: "gem-1",
        projectHash: "",
        messages: [],
      }),
    );

    const result = discoverSingleFile(join(geminiDir, "session-1.json"), config);

    const discovered = expectDefined(result, "Expected Gemini session result");
    expect(discovered.provider).toBe("gemini");
    expect(discovered.sourceSessionId).toBe("gem-1");
    expect(discovered.projectPath).toBe("/workspace/dux");
    expect(discovered.metadata.unresolvedProject).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it("does not build Gemini project resolution for non-Gemini files", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-gemini-lazy-"));
    const config = makeConfig(dir);
    const codexDir = join(config.codexRoot, "2026", "02", "27");
    mkdirSync(codexDir, { recursive: true });

    writeFileSync(
      join(codexDir, "rollout-test.jsonl"),
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: "codex-1",
          cwd: "/workspace/codex",
        },
      })}\n`,
    );

    const fs = {
      existsSync: vi.fn((path: string) => {
        if (path === config.geminiProjectsPath) {
          throw new Error("unexpected gemini project resolution");
        }
        return true;
      }),
      lstatSync: vi.fn((path: string) => {
        if (path === config.geminiProjectsPath) {
          throw new Error("unexpected gemini project resolution");
        }
        return {
          size: 0,
          mtimeMs: 0,
          isDirectory: () => false,
        };
      }),
      statSync: vi.fn((path: string) => {
        const stat = statSync(path);
        return {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          isDirectory: () => stat.isDirectory(),
        };
      }),
      openSync: vi.fn((path: string, flags: "r") => openSync(path, flags)),
      closeSync: vi.fn((fd: number) => closeSync(fd)),
      readSync: vi.fn(
        (fd: number, buffer: Buffer, offset: number, length: number, position: number | null) =>
          readSync(fd, buffer, offset, length, position),
      ),
      readFileSync: vi.fn((path: string, encoding: "utf8") => {
        if (path === config.geminiProjectsPath) {
          throw new Error("unexpected gemini project resolution");
        }
        return readFileSync(path, encoding);
      }),
      readdirSync: vi.fn((path: string, options: { withFileTypes: true }) =>
        readdirSync(path, options),
      ),
    };

    const result = discoverSingleFile(join(codexDir, "rollout-test.jsonl"), config, { fs });

    expect(result?.provider).toBe("codex");

    rmSync(dir, { recursive: true, force: true });
  });

  it("correctly identifies a Copilot session file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-single-copilot-"));
    const config = makeConfig(dir);
    const workspaceId = "test-workspace-id";
    const chatSessionsDir = join(config.copilotRoot, workspaceId, "chatSessions");
    mkdirSync(chatSessionsDir, { recursive: true });

    writeFileSync(
      join(config.copilotRoot, workspaceId, "workspace.json"),
      JSON.stringify({ folder: "file:///workspace/copilot-project" }),
    );

    writeFileSync(
      join(chatSessionsDir, "my-session.json"),
      JSON.stringify({ version: 3, sessionId: "my-session", requests: [] }),
    );

    const result = discoverSingleFile(join(chatSessionsDir, "my-session.json"), config);

    const discovered = expectDefined(result, "Expected Copilot session result");
    expect(discovered.provider).toBe("copilot");
    expect(discovered.sourceSessionId).toBe("my-session");
    expect(discovered.projectPath).toBe("/workspace/copilot-project");
    expect(discovered.projectName).toBe("copilot-project");
    expect(discovered.metadata.unresolvedProject).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});
