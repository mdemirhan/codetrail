import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
    includeClaudeSubagents: false,
  };
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

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("claude");
    expect(result!.sessionIdentity).toBe("s1");
    expect(result!.sourceSessionId).toBe("s1");
    expect(result!.projectPath).toBe("/workspace/app");
    expect(result!.projectName).toBe("app");
    expect(result!.metadata.cwd).toBe("/workspace/app");
    expect(result!.metadata.gitBranch).toBe("main");
    expect(result!.metadata.isSubagent).toBe(false);
    expect(result!.fileSize).toBeGreaterThan(0);

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

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("claude");
    expect(result!.projectPath).toBe("workspace/myapp");

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

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("codex");
    expect(result!.sourceSessionId).toBe("codex-1");
    expect(result!.metadata.cwd).toBe("/workspace/codex");
    expect(result!.metadata.gitBranch).toBe("dev");

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

    const result = discoverSingleFile(
      join(transcriptDir, `${sessionUuid}.jsonl`),
      config,
    );

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("cursor");
    expect(result!.sourceSessionId).toBe(sessionUuid);
    expect(result!.projectPath).toBe(actualProjectPath);
    expect(result!.sessionIdentity).toContain(`cursor:${sessionUuid}:`);

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

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("gemini");
    expect(result!.sourceSessionId).toBe("gem-1");
    expect(result!.projectPath).toBe("/workspace/dux");
    expect(result!.metadata.unresolvedProject).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});
