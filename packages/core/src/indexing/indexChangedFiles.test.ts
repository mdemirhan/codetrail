import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/bootstrap";
import { indexChangedFiles } from "./indexSessions";
import { runIncrementalIndexing } from "./indexSessions";

function readIndexedSnapshot(dbPath: string) {
  const db = openDatabase(dbPath);
  try {
    return {
      sessions: db
        .prepare(
          "SELECT provider, file_path, title, cwd, git_branch, session_identity FROM sessions ORDER BY file_path",
        )
        .all(),
      messages: db
        .prepare(
          "SELECT source_id, category, content, created_at FROM messages ORDER BY created_at, id",
        )
        .all(),
      indexedFiles: db
        .prepare("SELECT file_path, file_size, file_mtime_ms FROM indexed_files ORDER BY file_path")
        .all(),
      checkpoints: db
        .prepare(
          "SELECT file_path, last_offset_bytes, last_line_number, last_event_index FROM index_checkpoints ORDER BY file_path",
        )
        .all(),
    };
  } finally {
    db.close();
  }
}

describe("indexChangedFiles", () => {
  it("indexes changed files correctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-changed-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
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
        type: "user",
        cwd: "/workspace/app",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello Claude" }],
        },
      })}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      includeClaudeSubagents: false,
    };

    const result = indexChangedFiles({ dbPath, discoveryConfig }, [
      join(claudeProject, "s1.jsonl"),
    ]);

    expect(result.discoveredFiles).toBe(1);
    expect(result.indexedFiles).toBe(1);
    expect(result.skippedFiles).toBe(0);
    expect(result.removedFiles).toBe(0);

    const db = openDatabase(dbPath);
    const sessionCount = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number })
      .c;
    const messageCount = (db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number })
      .c;
    const indexedCount = (
      db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }
    ).c;
    db.close();

    expect(sessionCount).toBe(1);
    expect(messageCount).toBeGreaterThan(0);
    expect(indexedCount).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("uses the injected single-file discovery dependency", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-changed-injected-"));
    const dbPath = join(dir, "index.db");
    const discoveryConfig = {
      claudeRoot: join(dir, ".claude", "projects"),
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      opencodeRoot: join(dir, ".local", "share", "opencode"),
      includeClaudeSubagents: false,
    };
    const injectedDiscoverChangedFiles = vi.fn(() => {
      throw new Error("injected-discover-changed-files");
    });

    expect(() =>
      indexChangedFiles({ dbPath, discoveryConfig }, [join(dir, "missing.jsonl")], {
        discoverChangedFiles: injectedDiscoverChangedFiles,
      }),
    ).toThrow("injected-discover-changed-files");
    expect(injectedDiscoverChangedFiles).toHaveBeenCalledTimes(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("skips unchanged files with same size and mtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-changed-skip-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });

    const sessionFile = join(claudeProject, "s1.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "s1",
        type: "user",
        cwd: "/workspace/app",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      })}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      opencodeRoot: join(dir, ".local", "share", "opencode"),
      includeClaudeSubagents: false,
    };

    // First index to populate the DB.
    const first = indexChangedFiles({ dbPath, discoveryConfig }, [sessionFile]);
    expect(first.indexedFiles).toBe(1);

    // Re-index the same file — should be skipped since size/mtime hasn't changed.
    const second = indexChangedFiles({ dbPath, discoveryConfig }, [sessionFile]);
    expect(second.indexedFiles).toBe(0);
    expect(second.skippedFiles).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("indexes changed files identically with prefetched bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-changed-prefetch-"));
    const baselineDbPath = join(dir, "baseline.db");
    const prefetchedDbPath = join(dir, "prefetched.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });

    writeFileSync(
      join(claudeProject, "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [{ sessionId: "s1", projectPath: "/workspace/app" }],
      }),
    );
    const sessionFile = join(claudeProject, "s1.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "s1",
        type: "user",
        cwd: "/workspace/app",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello Claude 😀 cafe" }],
        },
      })}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      opencodeRoot: join(dir, ".local", "share", "opencode"),
      includeClaudeSubagents: false,
    };

    indexChangedFiles({ dbPath: baselineDbPath, discoveryConfig }, [sessionFile]);
    const fileStat = statSync(sessionFile);
    indexChangedFiles({ dbPath: prefetchedDbPath, discoveryConfig }, [sessionFile], {
      prefetchedJsonlChunks: [
        {
          filePath: sessionFile,
          fileSize: fileStat.size,
          fileMtimeMs: Math.trunc(fileStat.mtimeMs),
          startOffsetBytes: 0,
          bytes: new Uint8Array(readFileSync(sessionFile)),
        },
      ],
    });

    expect(readIndexedSnapshot(prefetchedDbPath)).toEqual(readIndexedSnapshot(baselineDbPath));

    rmSync(dir, { recursive: true, force: true });
  });

  it("discards mismatched prefetched bytes and falls back to direct file reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-changed-prefetch-mismatch-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });

    writeFileSync(
      join(claudeProject, "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [{ sessionId: "s1", projectPath: "/workspace/app" }],
      }),
    );
    const sessionFile = join(claudeProject, "s1.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "s1",
        type: "user",
        cwd: "/workspace/app",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Real transcript body" }],
        },
      })}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      includeClaudeSubagents: false,
    };

    const fileStat = statSync(sessionFile);
    indexChangedFiles({ dbPath, discoveryConfig }, [sessionFile], {
      prefetchedJsonlChunks: [
        {
          filePath: sessionFile,
          fileSize: fileStat.size + 1,
          fileMtimeMs: Math.trunc(fileStat.mtimeMs),
          startOffsetBytes: 0,
          bytes: new Uint8Array(Buffer.from('{"broken":true}\n', "utf8")),
        },
      ],
    });

    const snapshot = readIndexedSnapshot(dbPath);
    expect(snapshot.messages).toEqual([
      expect.objectContaining({
        content: "Real transcript body",
      }),
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores unknown/invalid paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-changed-unknown-"));
    const dbPath = join(dir, "index.db");

    const discoveryConfig = {
      claudeRoot: join(dir, ".claude", "projects"),
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      opencodeRoot: join(dir, ".local", "share", "opencode"),
      includeClaudeSubagents: false,
    };

    const result = indexChangedFiles({ dbPath, discoveryConfig }, [
      "/nonexistent/random/file.jsonl",
      join(dir, ".claude", "projects", "proj", "missing.jsonl"),
    ]);

    expect(result.discoveredFiles).toBe(0);
    expect(result.indexedFiles).toBe(0);
    expect(result.skippedFiles).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("queries only targeted files from DB, not full table scans", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-changed-targeted-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });

    const file1 = join(claudeProject, "s1.jsonl");
    const file2 = join(claudeProject, "s2.jsonl");
    writeFileSync(
      file1,
      `${JSON.stringify({
        sessionId: "s1",
        type: "user",
        cwd: "/workspace/app",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Session 1" }] },
      })}\n`,
    );
    writeFileSync(
      file2,
      `${JSON.stringify({
        sessionId: "s2",
        type: "user",
        cwd: "/workspace/app",
        gitBranch: "main",
        timestamp: "2026-02-27T11:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Session 2" }] },
      })}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      opencodeRoot: join(dir, ".local", "share", "opencode"),
      includeClaudeSubagents: false,
    };

    // Index both files first using full indexing.
    runIncrementalIndexing({ dbPath, discoveryConfig });

    const db = openDatabase(dbPath);
    const sessionsBefore = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number })
      .c;
    db.close();
    expect(sessionsBefore).toBe(2);

    // Now use indexChangedFiles to re-index only file1 — file2 should not be touched.
    const result = indexChangedFiles({ dbPath, discoveryConfig }, [file1]);

    // file1 is unchanged so it should be skipped; but file2 should not have been removed.
    expect(result.removedFiles).toBe(0);
    expect(result.discoveredFiles).toBe(1);
    expect(result.skippedFiles).toBe(1);

    const dbAfter = openDatabase(dbPath);
    const sessionsAfter = (
      dbAfter.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }
    ).c;
    dbAfter.close();
    // Both sessions still exist — indexChangedFiles doesn't remove other sessions.
    expect(sessionsAfter).toBe(2);

    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps indexed data when a file is deleted by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-changed-delete-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });

    const sessionFile = join(claudeProject, "s1.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "s1",
        type: "user",
        cwd: "/workspace/app",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Hello" }] },
      })}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      includeClaudeSubagents: false,
    };

    // Index the file first
    const first = indexChangedFiles({ dbPath, discoveryConfig }, [sessionFile]);
    expect(first.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c,
    ).toBeGreaterThan(0);
    db.close();

    // Delete the file, then call indexChangedFiles with the same path
    rmSync(sessionFile);
    const second = indexChangedFiles({ dbPath, discoveryConfig }, [sessionFile]);
    expect(second.removedFiles).toBe(0);
    expect(second.indexedFiles).toBe(0);

    // Session and messages are retained until explicit pruning is enabled.
    const dbAfter = openDatabase(dbPath);
    expect((dbAfter.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(
      1,
    );
    expect((dbAfter.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c).toBe(
      1,
    );
    expect(
      (dbAfter.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }).c,
    ).toBe(1);
    dbAfter.close();

    rmSync(dir, { recursive: true, force: true });
  });

  it("cleans up indexed data when file pruning is enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-changed-delete-prune-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });

    const sessionFile = join(claudeProject, "s1.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "s1",
        type: "user",
        cwd: "/workspace/app",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Hello" }] },
      })}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      includeClaudeSubagents: false,
    };

    indexChangedFiles({ dbPath, discoveryConfig }, [sessionFile]);

    rmSync(sessionFile);
    const second = indexChangedFiles(
      {
        dbPath,
        discoveryConfig,
        removeMissingSessionsDuringIncrementalIndexing: true,
      },
      [sessionFile],
    );
    expect(second.removedFiles).toBe(1);

    const dbAfter = openDatabase(dbPath);
    expect((dbAfter.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(
      0,
    );
    expect(
      (dbAfter.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }).c,
    ).toBe(0);
    dbAfter.close();

    rmSync(dir, { recursive: true, force: true });
  });
});
