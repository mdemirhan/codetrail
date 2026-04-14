import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/bootstrap";
import type { DiscoveredSessionFile, DiscoveryConfig } from "../discovery";
import { createOpenCodeFixtureDatabase } from "../testing/opencodeFixture";
import { makeSessionId } from "./ids";
import { runIncrementalIndexing } from "./indexSessions";

function createDiscoveryConfig(dir: string): DiscoveryConfig {
  return {
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
}

function makeDiscoveredSessionFile(
  overrides: Omit<Partial<DiscoveredSessionFile>, "metadata"> &
    Pick<DiscoveredSessionFile, "provider" | "filePath"> & {
      metadata?: Partial<DiscoveredSessionFile["metadata"]>;
    },
): DiscoveredSessionFile {
  const projectPath = overrides.projectPath ?? "";
  const canonicalProjectPath = overrides.canonicalProjectPath ?? projectPath;
  return {
    provider: overrides.provider,
    projectPath,
    canonicalProjectPath,
    projectName: overrides.projectName ?? "project",
    sessionIdentity: overrides.sessionIdentity ?? `${overrides.provider}:session:test`,
    sourceSessionId: overrides.sourceSessionId ?? "session",
    filePath: overrides.filePath,
    fileSize: overrides.fileSize ?? 1,
    fileMtimeMs: overrides.fileMtimeMs ?? Date.now(),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject: false,
      gitBranch: null,
      cwd: null,
      worktreeLabel: null,
      worktreeSource: null,
      repositoryUrl: null,
      forkedFromSessionId: null,
      parentSessionCwd: null,
      providerProjectKey: null,
      providerSessionId: null,
      sessionKind: null,
      gitCommitHash: null,
      providerClient: null,
      providerSource: null,
      providerClientVersion: null,
      lineageParentId: null,
      resolutionSource: null,
      projectMetadata: null,
      sessionMetadata: null,
      ...overrides.metadata,
    },
  };
}

function tombstoneSession(dbPath: string, filePath: string): void {
  const db = openDatabase(dbPath);
  // These indexing tests live below the query-service layer, so they build the tombstone row
  // directly instead of reaching across package boundaries into the desktop delete plumbing.
  const indexed = db
    .prepare(
      `SELECT file_path, provider, project_path, session_identity, file_size, file_mtime_ms
       FROM indexed_files
       WHERE file_path = ?`,
    )
    .get(filePath) as {
    file_path: string;
    provider: string;
    project_path: string;
    session_identity: string;
    file_size: number;
    file_mtime_ms: number;
  };
  const checkpoint = db
    .prepare(
      `SELECT session_id, last_offset_bytes, last_line_number, last_event_index,
              next_message_sequence, processing_state_json, source_metadata_json,
              head_hash, tail_hash
       FROM index_checkpoints
       WHERE file_path = ?`,
    )
    .get(filePath) as
    | {
        session_id: string;
        last_offset_bytes: number | null;
        last_line_number: number | null;
        last_event_index: number | null;
        next_message_sequence: number | null;
        processing_state_json: string | null;
        source_metadata_json: string | null;
        head_hash: string | null;
        tail_hash: string | null;
      }
    | undefined;
  const session = db.prepare("SELECT id FROM sessions WHERE file_path = ?").get(filePath) as {
    id: string;
  };

  db.prepare(
    `INSERT INTO deleted_sessions (
      file_path,
      provider,
      project_path,
      session_identity,
      session_id,
      deleted_at_ms,
      file_size,
      file_mtime_ms,
      last_offset_bytes,
      last_line_number,
      last_event_index,
      next_message_sequence,
      processing_state_json,
      source_metadata_json,
      head_hash,
      tail_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    indexed.file_path,
    indexed.provider,
    indexed.project_path,
    indexed.session_identity,
    checkpoint?.session_id ?? session.id,
    Date.now(),
    indexed.file_size,
    indexed.file_mtime_ms,
    checkpoint?.last_offset_bytes ?? null,
    checkpoint?.last_line_number ?? null,
    checkpoint?.last_event_index ?? null,
    checkpoint?.next_message_sequence ?? null,
    checkpoint?.processing_state_json ?? null,
    checkpoint?.source_metadata_json ?? null,
    checkpoint?.head_hash ?? null,
    checkpoint?.tail_hash ?? null,
  );

  db.prepare(
    "DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
  ).run(session.id);
  db.prepare(
    "DELETE FROM message_tool_edit_files WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
  ).run(session.id);
  db.prepare("DELETE FROM message_fts WHERE session_id = ?").run(session.id);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(session.id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
  db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?").run(filePath);
  db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(filePath);
  db.close();
}

describe("runIncrementalIndexing", () => {
  it("purges disabled providers during incremental indexing", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-enabled-providers-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      join(claudeProject, "claude-session-1.jsonl"),
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello Claude" }],
        },
      })}\n`,
    );

    const codexRoot = join(dir, ".codex", "sessions", "2026", "02", "27");
    mkdirSync(codexRoot, { recursive: true });
    writeFileSync(
      join(codexRoot, "rollout-codex-1.jsonl"),
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T11:00:00Z",
          type: "session_meta",
          payload: { id: "codex-session-1", cwd: "/workspace/codex", git: { branch: "dev" } },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done Codex" }],
          },
        }),
      ].join("\n")}\n`,
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

    runIncrementalIndexing({ dbPath, discoveryConfig });
    const filtered = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
      enabledProviders: ["claude"],
    });

    expect(filtered.discoveredFiles).toBe(1);
    expect(filtered.removedFiles).toBe(1);

    const db = openDatabase(dbPath);
    try {
      expect(
        (
          db.prepare("SELECT COUNT(*) as c FROM sessions WHERE provider = 'claude'").get() as {
            c: number;
          }
        ).c,
      ).toBe(1);
      expect(
        (
          db.prepare("SELECT COUNT(*) as c FROM sessions WHERE provider = 'codex'").get() as {
            c: number;
          }
        ).c,
      ).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retains missing session files during incremental indexing by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-missing-retain-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });
    const sessionFile = join(claudeProject, "claude-session-1.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
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
      opencodeRoot: join(dir, ".local", "share", "opencode"),
      includeClaudeSubagents: false,
    };

    runIncrementalIndexing({ dbPath, discoveryConfig });
    rmSync(sessionFile);

    const second = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(second.removedFiles).toBe(0);

    const db = openDatabase(dbPath);
    try {
      expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(1);
      expect((db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }).c).toBe(
        1,
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes missing session files during incremental indexing when enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-missing-prune-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });
    const sessionFile = join(claudeProject, "claude-session-1.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
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
      opencodeRoot: join(dir, ".local", "share", "opencode"),
      includeClaudeSubagents: false,
    };

    runIncrementalIndexing({ dbPath, discoveryConfig });
    rmSync(sessionFile);

    const second = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
      removeMissingSessionsDuringIncrementalIndexing: true,
    });
    expect(second.removedFiles).toBe(1);

    const db = openDatabase(dbPath);
    try {
      expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(0);
      expect((db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }).c).toBe(
        0,
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("indexes incrementally, supports force rebuild, and rebuilds on schema-version mismatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      join(claudeProject, "claude-session-1.jsonl"),
      `${[
        JSON.stringify({
          sessionId: "claude-session-1",
          type: "user",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-02-27T10:00:00Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "Hello Claude" }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-session-1",
          type: "assistant",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-02-27T10:00:05Z",
          message: {
            model: "claude-opus-4-6",
            role: "assistant",
            content: [
              { type: "thinking", text: "Thinking" },
              { type: "text", text: "Done" },
              { type: "tool_use", name: "Read", input: { file_path: "a.ts" } },
            ],
            usage: { input_tokens: 10, output_tokens: 7 },
          },
        }),
      ].join("\n")}\n`,
    );

    const codexRoot = join(dir, ".codex", "sessions", "2026", "02", "27");
    mkdirSync(codexRoot, { recursive: true });
    const codexFile = join(codexRoot, "rollout-codex-1.jsonl");
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T11:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            cwd: "/workspace/codex",
            git: { branch: "dev" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:01Z",
          type: "turn_context",
          payload: {
            model: "gpt-5-codex",
            cwd: "/workspace/codex",
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:02Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hello Codex" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:03Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done Codex" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const geminiRoot = join(dir, ".gemini", "tmp");
    const geminiHistoryRoot = join(dir, ".gemini", "history");
    mkdirSync(join(geminiRoot, "dux", "chats"), { recursive: true });
    mkdirSync(join(geminiHistoryRoot, "dux"), { recursive: true });
    writeFileSync(join(geminiRoot, "dux", ".project_root"), "/workspace/dux");
    writeFileSync(join(geminiHistoryRoot, "dux", ".project_root"), "/workspace/dux");
    writeFileSync(
      join(geminiRoot, "dux", "chats", "session-1.json"),
      JSON.stringify({
        sessionId: "gemini-session-1",
        projectHash: "ddd29e90e8e0e53b3e06996841fdaf7a26e33cdca62e0678fb37e500d58d2bf8",
        startTime: "2026-02-27T12:00:00Z",
        lastUpdated: "2026-02-27T12:00:10Z",
        messages: [
          {
            id: "g-user-1",
            type: "user",
            timestamp: "2026-02-27T12:00:00Z",
            content: "Hello Gemini",
          },
          {
            id: "g-assistant-1",
            type: "gemini",
            model: "gemini-2.5-pro",
            timestamp: "2026-02-27T12:00:01Z",
            content: "Done Gemini",
          },
        ],
      }),
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot,
      geminiHistoryRoot,
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      copilotCliRoot: join(dir, ".copilot-cli-sessions"),
      opencodeRoot: join(dir, ".local", "share", "opencode"),
      includeClaudeSubagents: false,
    };

    const first = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(first.discoveredFiles).toBe(3);
    expect(first.indexedFiles).toBe(3);
    expect(first.skippedFiles).toBe(0);
    expect(first.removedFiles).toBe(0);

    const dbAfterFirst = openDatabase(dbPath);
    const countsAfterFirst = {
      projects: (dbAfterFirst.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number })
        .c,
      sessions: (dbAfterFirst.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number })
        .c,
      messages: (dbAfterFirst.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number })
        .c,
      indexed: (
        dbAfterFirst.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }
      ).c,
      checkpoints: (
        dbAfterFirst.prepare("SELECT COUNT(*) as c FROM index_checkpoints").get() as { c: number }
      ).c,
    };
    const claudeSessionId = makeSessionId("claude", "claude-session-1");
    const claudeAggregate = dbAfterFirst
      .prepare(
        `SELECT title, message_count, token_input_total, token_output_total, model_names, git_branch, cwd
         FROM sessions WHERE id = ?`,
      )
      .get(claudeSessionId) as {
      title: string;
      message_count: number;
      token_input_total: number;
      token_output_total: number;
      model_names: string;
      git_branch: string;
      cwd: string;
    };
    const derivedDurationCount = (
      dbAfterFirst
        .prepare(
          `SELECT COUNT(*) as c
           FROM messages
           WHERE operation_duration_source = 'derived'
             AND operation_duration_confidence = 'high'
             AND operation_duration_ms IS NOT NULL`,
        )
        .get() as { c: number }
    ).c;
    dbAfterFirst.close();

    expect(countsAfterFirst.projects).toBe(3);
    expect(countsAfterFirst.sessions).toBe(3);
    expect(countsAfterFirst.messages).toBeGreaterThan(0);
    expect(countsAfterFirst.indexed).toBe(3);
    expect(countsAfterFirst.checkpoints).toBe(2);
    expect(claudeAggregate.title).toBe("Hello Claude");
    expect(claudeAggregate.message_count).toBeGreaterThanOrEqual(3);
    expect(claudeAggregate.token_input_total).toBe(10);
    expect(claudeAggregate.token_output_total).toBe(7);
    expect(claudeAggregate.model_names).toContain("claude-opus-4-6");
    expect(claudeAggregate.git_branch).toBe("main");
    expect(claudeAggregate.cwd).toBe("/workspace/claude");
    expect(derivedDurationCount).toBeGreaterThan(0);

    const second = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(second.indexedFiles).toBe(0);
    expect(second.skippedFiles).toBe(3);

    const dbBeforeHeal = openDatabase(dbPath);
    const codexSessionRow = dbBeforeHeal
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string } | undefined;
    if (codexSessionRow) {
      dbBeforeHeal
        .prepare(
          "DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
        )
        .run(codexSessionRow.id);
      dbBeforeHeal
        .prepare(
          "DELETE FROM message_tool_edit_files WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
        )
        .run(codexSessionRow.id);
      dbBeforeHeal.prepare("DELETE FROM message_fts WHERE session_id = ?").run(codexSessionRow.id);
      dbBeforeHeal.prepare("DELETE FROM messages WHERE session_id = ?").run(codexSessionRow.id);
      dbBeforeHeal.prepare("DELETE FROM sessions WHERE id = ?").run(codexSessionRow.id);
    }
    dbBeforeHeal.close();

    const healed = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(healed.indexedFiles).toBe(1);
    expect(healed.skippedFiles).toBe(2);

    appendFileSync(
      codexFile,
      `${JSON.stringify({
        timestamp: "2026-02-27T11:00:04Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Extra line" }],
        },
      })}\n`,
    );
    const now = new Date();
    utimesSync(codexFile, now, now);

    const third = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(third.indexedFiles).toBe(1);
    expect(third.skippedFiles).toBe(2);

    const dbAfterThird = openDatabase(dbPath);
    const codexMessageCount = dbAfterThird
      .prepare("SELECT message_count FROM sessions WHERE provider = 'codex' AND file_path = ?")
      .get(codexFile) as { message_count: number };
    const codexCheckpoint = dbAfterThird
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    dbAfterThird.close();

    expect(codexMessageCount.message_count).toBeGreaterThanOrEqual(3);
    expect(codexCheckpoint.last_offset_bytes).toBe(codexCheckpoint.file_size);

    const force = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
      forceReindex: true,
    });

    expect(force.indexedFiles).toBe(3);
    expect(force.skippedFiles).toBe(0);

    const dbBeforeRebuild = openDatabase(dbPath);
    dbBeforeRebuild.exec(`UPDATE meta SET value = '999' WHERE key = 'schema_version'`);
    dbBeforeRebuild.close();

    const rebuilt = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(rebuilt.schemaRebuilt).toBe(true);
    expect(rebuilt.indexedFiles).toBe(3);

    rmSync(dir, { recursive: true, force: true });
  });

  it("streams large codex session files without routing them through readFileText", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-oversized-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "08", "oversized.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-08T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-oversized",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-08T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Indexed before it grew too large" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const oversizedRead = vi.fn(() => {
      throw new Error("streamed codex file should not use readFileText");
    });
    const sessionIdentity = "codex:codex-session-oversized:test";
    const result = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles: () => [
          {
            provider: "codex",
            projectPath: "/workspace/codex",
            canonicalProjectPath: "/workspace/codex",
            projectName: "codex",
            sessionIdentity,
            sourceSessionId: "codex-session-oversized",
            filePath: codexFile,
            fileSize: 256 * 1024 * 1024,
            fileMtimeMs: Date.parse("2026-03-08T10:05:00Z"),
            metadata: {
              includeInHistory: true,
              isSubagent: false,
              unresolvedProject: false,
              gitBranch: "main",
              cwd: "/workspace/codex",
              worktreeLabel: null,
              worktreeSource: null,
              repositoryUrl: null,
              forkedFromSessionId: null,
              parentSessionCwd: null,
            },
          },
        ],
        readFileText: oversizedRead,
      },
    );

    expect(result.discoveredFiles).toBe(1);
    expect(result.indexedFiles).toBe(1);
    expect(result.skippedFiles).toBe(0);
    expect(oversizedRead).not.toHaveBeenCalled();

    const db = openDatabase(dbPath);
    const sessionCount = db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number };
    const messageCount = db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number };
    db.close();

    expect(sessionCount.c).toBe(1);
    expect(messageCount.c).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("does not checkpoint past an unterminated trailing codex JSONL line", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-codex-partial-line-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "19", "partial.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-19T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-partial",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-19T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            id: "before-append",
            role: "user",
            content: [{ type: "input_text", text: "Before append" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const discoveryConfig: Partial<DiscoveryConfig> = {
      codexRoot: join(dir, ".codex", "sessions"),
      enabledProviders: ["codex"],
    };

    const first = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(first.indexedFiles).toBe(1);

    appendFileSync(
      codexFile,
      JSON.stringify({
        timestamp: "2026-03-19T10:00:02Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "after-append",
          role: "assistant",
          content: [{ type: "output_text", text: "After append" }],
        },
      }).slice(0, -12),
    );
    const partialNow = new Date();
    utimesSync(codexFile, partialNow, partialNow);

    const second = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(second.indexedFiles).toBe(1);

    const dbAfterPartial = openDatabase(dbPath);
    const partialCheckpoint = dbAfterPartial
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    const partialSession = dbAfterPartial
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string };
    const partialMessages = dbAfterPartial
      .prepare("SELECT content FROM messages WHERE session_id = ? ORDER BY created_at, id")
      .all(partialSession.id) as Array<{
      content: string;
    }>;
    dbAfterPartial.close();

    expect(partialCheckpoint.last_offset_bytes).toBeLessThan(partialCheckpoint.file_size);
    expect(partialMessages.map((message) => message.content)).toEqual(["Before append"]);

    appendFileSync(codexFile, ' append"}]}}\n');
    const completedNow = new Date();
    utimesSync(codexFile, completedNow, completedNow);

    const third = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(third.indexedFiles).toBe(1);

    const dbAfterCompletion = openDatabase(dbPath);
    const completedCheckpoint = dbAfterCompletion
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    const completedSession = dbAfterCompletion
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string };
    const completedMessages = dbAfterCompletion
      .prepare("SELECT content FROM messages WHERE session_id = ? ORDER BY created_at, id")
      .all(completedSession.id) as Array<{
      content: string;
    }>;
    dbAfterCompletion.close();

    expect(completedCheckpoint.last_offset_bytes).toBe(completedCheckpoint.file_size);
    expect(completedMessages.map((message) => message.content)).toEqual([
      "Before append",
      "After append",
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("does not checkpoint past an unterminated trailing oversized codex JSONL line", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-codex-partial-oversized-line-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(
      dir,
      ".codex",
      "sessions",
      "2026",
      "03",
      "19",
      "partial-oversized.jsonl",
    );
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-19T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-partial-oversized",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-19T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            id: "before-append",
            role: "user",
            content: [{ type: "input_text", text: "Before append" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const discoveryConfig: Partial<DiscoveryConfig> = {
      codexRoot: join(dir, ".codex", "sessions"),
      enabledProviders: ["codex"],
    };

    const first = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(first.indexedFiles).toBe(1);

    appendFileSync(
      codexFile,
      JSON.stringify({
        timestamp: "2026-03-19T10:00:02Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          output: "x".repeat(33 * 1024 * 1024),
        },
      }).slice(0, -32),
    );
    const partialNow = new Date();
    utimesSync(codexFile, partialNow, partialNow);

    const second = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(second.indexedFiles).toBe(1);

    const dbAfterPartial = openDatabase(dbPath);
    const partialCheckpoint = dbAfterPartial
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    const partialSession = dbAfterPartial
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string };
    const partialMessages = dbAfterPartial
      .prepare("SELECT content FROM messages WHERE session_id = ? ORDER BY created_at, id")
      .all(partialSession.id) as Array<{
      content: string;
    }>;
    dbAfterPartial.close();

    expect(partialCheckpoint.last_offset_bytes).toBeLessThan(partialCheckpoint.file_size);
    expect(partialMessages.map((message) => message.content)).toEqual(["Before append"]);

    appendFileSync(
      codexFile,
      `${"x".repeat(32)}"}\n${JSON.stringify({
        timestamp: "2026-03-19T10:00:03Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "after-append",
          role: "assistant",
          content: [{ type: "output_text", text: "After append" }],
        },
      })}\n`,
    );
    const completedNow = new Date();
    utimesSync(codexFile, completedNow, completedNow);

    const third = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(third.indexedFiles).toBe(1);

    const dbAfterCompletion = openDatabase(dbPath);
    const completedCheckpoint = dbAfterCompletion
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    const completedSession = dbAfterCompletion
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string };
    const completedMessages = dbAfterCompletion
      .prepare("SELECT content FROM messages WHERE session_id = ? ORDER BY created_at, id")
      .all(completedSession.id) as Array<{
      content: string;
    }>;
    dbAfterCompletion.close();

    expect(completedCheckpoint.last_offset_bytes).toBe(completedCheckpoint.file_size);
    expect(completedMessages.map((message) => message.content)).toEqual([
      "Before append",
      expect.stringContaining("Oversized JSONL line omitted."),
      "After append",
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("resumes append-only indexing and rescues oversized JSONL lines within the hard ceiling", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-resume-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "08", "resume.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-08T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-resume",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-08T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Before append" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const discoverSessionFiles = () => [
      {
        provider: "codex" as const,
        projectPath: "/workspace/codex",
        canonicalProjectPath: "/workspace/codex",
        projectName: "codex",
        sessionIdentity: "codex:codex-session-resume:test",
        sourceSessionId: "codex-session-resume",
        filePath: codexFile,
        fileSize: Buffer.byteLength(readFileSync(codexFile)),
        fileMtimeMs: Date.now(),
        metadata: {
          includeInHistory: true,
          isSubagent: false,
          unresolvedProject: false,
          gitBranch: "main",
          cwd: "/workspace/codex",
          worktreeLabel: null,
          worktreeSource: null,
          repositoryUrl: null,
          forkedFromSessionId: null,
          parentSessionCwd: null,
        },
      },
    ];

    const notices: Array<{ code: string; message: string }> = [];
    const first = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles,
        onNotice: (notice) => {
          notices.push({ code: notice.code, message: notice.message });
        },
      },
    );
    expect(first.indexedFiles).toBe(1);

    const oversizedOutput = "x".repeat(9 * 1024 * 1024);
    appendFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-08T10:00:02Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            output: oversizedOutput,
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-08T10:00:03Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "After append" }],
          },
        }),
      ].join("\n")}\n`,
    );
    const appendedNow = new Date();
    utimesSync(codexFile, appendedNow, appendedNow);

    const second = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles,
        onNotice: (notice) => {
          notices.push({ code: notice.code, message: notice.message });
        },
      },
    );

    expect(second.indexedFiles).toBe(1);
    expect(second.diagnostics.warnings).toBeGreaterThan(0);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare(
        "SELECT category, content FROM messages WHERE session_id = ? ORDER BY created_at, id",
      )
      .all(makeSessionId("codex", "codex:codex-session-resume:test")) as Array<{
      category: string;
      content: string;
    }>;
    const checkpoint = db
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    db.close();

    expect(messages.map((message) => message.content)).toEqual(
      expect.arrayContaining(["Before append", "After append"]),
    );
    expect(
      messages.some(
        (message) =>
          message.category === "tool_result" && message.content.includes("[truncated from"),
      ),
    ).toBe(true);
    expect(checkpoint.last_offset_bytes).toBe(checkpoint.file_size);
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "parser.oversized_jsonl_line_rescued" }),
      ]),
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("rescues oversized Claude JSONL lines by replacing inline image payloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-claude-oversized-"));
    const dbPath = join(dir, "index.db");
    const claudeFile = join(dir, ".claude", "projects", "oversized", "session.jsonl");
    mkdirSync(dirname(claudeFile), { recursive: true });

    const inlineImageBase64 = "a".repeat(9 * 1024 * 1024);
    writeFileSync(
      claudeFile,
      `${JSON.stringify({
        sessionId: "claude-session-oversized-inline-image",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-03-22T10:00:00Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "Before image" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: inlineImageBase64,
              },
            },
            { type: "text", text: "After image text survives" },
          ],
        },
      })}\n`,
    );

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          ...createDiscoveryConfig(dir),
          enabledProviders: ["claude"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT content FROM messages ORDER BY created_at, id")
      .all() as Array<{
      content: string;
    }>;
    db.close();

    expect(messages.map((message) => message.content)).toEqual(
      expect.arrayContaining([
        "Before image",
        "After image text survives",
        expect.stringContaining("[image omitted mime=image/png"),
      ]),
    );
    expect(notices).toContain("parser.oversized_jsonl_line_rescued");

    rmSync(dir, { recursive: true, force: true });
  });

  it("rescues oversized Codex compacted lines into searchable snapshot messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-codex-compacted-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "22", "compacted.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });

    const inlineImageBase64 = "a".repeat(9 * 1024 * 1024);
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-22T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-compacted",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-22T10:00:01Z",
          type: "compacted",
          payload: {
            replacement_history: [
              {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text: "Before compacted image" },
                  { type: "input_image", image_url: `data:image/png;base64,${inlineImageBase64}` },
                  { type: "input_text", text: "After compacted image" },
                ],
              },
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Looks good" }],
              },
            ],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          ...createDiscoveryConfig(dir),
          enabledProviders: ["codex"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT category, content, created_at FROM messages ORDER BY created_at, id")
      .all() as Array<{
      category: string;
      content: string;
      created_at: string;
    }>;
    db.close();

    expect(messages).toEqual([
      expect.objectContaining({
        category: "system",
        content: expect.stringContaining("[Codex compacted history snapshot]"),
      }),
    ]);
    expect(messages[0]?.content).toContain("Before compacted image");
    expect(messages[0]?.content).toContain("After compacted image");
    expect(messages[0]?.content).toContain("[image omitted mime=image/png");
    expect(messages[0]?.content).toContain("Assistant:\nLooks good");
    expect(notices).toContain("parser.oversized_jsonl_line_rescued");

    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts tombstone messages for JSONL lines above the hard ceiling", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-jsonl-hard-omit-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "22", "hard-omit.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-22T11:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-hard-omit",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-22T11:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Before hard omit" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-22T11:00:02Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            output: "x".repeat(33 * 1024 * 1024),
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-22T11:00:03Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "After hard omit" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          ...createDiscoveryConfig(dir),
          enabledProviders: ["codex"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT category, content FROM messages ORDER BY created_at, id")
      .all() as Array<{
      category: string;
      content: string;
    }>;
    db.close();

    expect(messages.map((message) => message.content)).toEqual([
      "Before hard omit",
      expect.stringContaining("Oversized JSONL line omitted."),
      "After hard omit",
    ]);
    expect(messages[1]?.category).toBe("system");
    expect(notices).toContain("parser.oversized_jsonl_line_omitted");

    rmSync(dir, { recursive: true, force: true });
  });

  it("stores hybrid Codex turn metadata for steering prompts inside the same native run", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-codex-turn-groups-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(
      dir,
      ".codex",
      "sessions",
      "2026",
      "04",
      "11",
      "hybrid-turn-groups.jsonl",
    );
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-04-11T09:52:39.000Z",
          type: "session_meta",
          payload: {
            id: "codex-session-turn-groups",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:40.000Z",
          type: "turn_context",
          payload: { turn_id: "native-turn-1" },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:41.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Initial request" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:41.001Z",
          type: "event_msg",
          payload: { type: "user_message", message: "Initial request" },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:42.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Working on it" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:43.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Steer the implementation" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:43.001Z",
          type: "event_msg",
          payload: { type: "user_message", message: "Steer the implementation" },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:44.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Adjusted" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:45.000Z",
          type: "event_msg",
          payload: { type: "task_complete", turn_id: "native-turn-1" },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:46.000Z",
          type: "turn_context",
          payload: { turn_id: "native-turn-2" },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:47.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "nice thanks" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:47.001Z",
          type: "event_msg",
          payload: { type: "user_message", message: "nice thanks" },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:48.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Any time." }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-11T09:52:49.000Z",
          type: "event_msg",
          payload: { type: "task_complete", turn_id: "native-turn-2" },
        }),
      ].join("\n")}\n`,
    );

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: {
        ...createDiscoveryConfig(dir),
        enabledProviders: ["codex"],
      },
    });

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const rows = db
      .prepare(
        `SELECT
           source_id,
           category,
           turn_group_id,
           turn_grouping_mode,
           turn_anchor_kind,
           native_turn_id
         FROM messages
         ORDER BY created_at, id`,
      )
      .all() as Array<{
      source_id: string;
      category: string;
      turn_group_id: string | null;
      turn_grouping_mode: string;
      turn_anchor_kind: string | null;
      native_turn_id: string | null;
    }>;
    db.close();

    expect(rows).toEqual([
      {
        source_id: "codex-session-turn-groups:msg:0",
        category: "user",
        turn_group_id: "codex-session-turn-groups:msg:0",
        turn_grouping_mode: "hybrid",
        turn_anchor_kind: "user_prompt",
        native_turn_id: "native-turn-1",
      },
      {
        source_id: "codex-session-turn-groups:msg:1",
        category: "assistant",
        turn_group_id: "codex-session-turn-groups:msg:0",
        turn_grouping_mode: "hybrid",
        turn_anchor_kind: null,
        native_turn_id: "native-turn-1",
      },
      {
        source_id: "codex-session-turn-groups:msg:2",
        category: "user",
        turn_group_id: "codex-session-turn-groups:msg:0",
        turn_grouping_mode: "hybrid",
        turn_anchor_kind: "user_prompt",
        native_turn_id: "native-turn-1",
      },
      {
        source_id: "codex-session-turn-groups:msg:3",
        category: "assistant",
        turn_group_id: "codex-session-turn-groups:msg:0",
        turn_grouping_mode: "hybrid",
        turn_anchor_kind: null,
        native_turn_id: "native-turn-1",
      },
      {
        source_id: "codex-session-turn-groups:msg:4",
        category: "user",
        turn_group_id: "codex-session-turn-groups:msg:4",
        turn_grouping_mode: "hybrid",
        turn_anchor_kind: "user_prompt",
        native_turn_id: "native-turn-2",
      },
      {
        source_id: "codex-session-turn-groups:msg:5",
        category: "assistant",
        turn_group_id: "codex-session-turn-groups:msg:4",
        turn_grouping_mode: "hybrid",
        turn_anchor_kind: null,
        native_turn_id: "native-turn-2",
      },
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("stores native Claude turn metadata across parent-linked child events", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-claude-turn-groups-"));
    const dbPath = join(dir, "index.db");
    const claudeProject = join(dir, ".claude", "projects", "native-turn-groups");
    const claudeFile = join(claudeProject, "session.jsonl");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      claudeFile,
      `${[
        JSON.stringify({
          sessionId: "claude-native-turn-groups",
          uuid: "u1",
          type: "user",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-04-11T09:52:39.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "Initial Claude request" }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-native-turn-groups",
          uuid: "a1",
          parentUuid: "u1",
          type: "assistant",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-04-11T09:52:40.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Working on it" }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-native-turn-groups",
          uuid: "a2",
          parentUuid: "a1",
          type: "assistant",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-04-11T09:52:41.000Z",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-native-turn-groups",
          uuid: "u2",
          type: "user",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-04-11T09:52:42.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "Second Claude request" }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-native-turn-groups",
          uuid: "a3",
          parentUuid: "u2",
          type: "assistant",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-04-11T09:52:43.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Done" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: {
        ...createDiscoveryConfig(dir),
        enabledProviders: ["claude"],
      },
    });

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const rows = db
      .prepare(
        `SELECT
           source_id,
           category,
           turn_group_id,
           turn_grouping_mode,
           turn_anchor_kind,
           native_turn_id
         FROM messages
         ORDER BY created_at, id`,
      )
      .all() as Array<{
      source_id: string;
      category: string;
      turn_group_id: string | null;
      turn_grouping_mode: string;
      turn_anchor_kind: string | null;
      native_turn_id: string | null;
    }>;
    db.close();

    expect(rows).toEqual([
      {
        source_id: "u1",
        category: "user",
        turn_group_id: "u1",
        turn_grouping_mode: "native",
        turn_anchor_kind: "user_prompt",
        native_turn_id: "u1",
      },
      {
        source_id: "a1",
        category: "assistant",
        turn_group_id: "u1",
        turn_grouping_mode: "native",
        turn_anchor_kind: null,
        native_turn_id: "u1",
      },
      {
        source_id: "a2",
        category: "tool_use",
        turn_group_id: "u1",
        turn_grouping_mode: "native",
        turn_anchor_kind: null,
        native_turn_id: "u1",
      },
      {
        source_id: "u2",
        category: "user",
        turn_group_id: "u2",
        turn_grouping_mode: "native",
        turn_anchor_kind: "user_prompt",
        native_turn_id: "u2",
      },
      {
        source_id: "a3",
        category: "assistant",
        turn_group_id: "u2",
        turn_grouping_mode: "native",
        turn_anchor_kind: null,
        native_turn_id: "u2",
      },
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts tombstone sessions for oversized materialized JSON files", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-materialized-hard-omit-"));
    const dbPath = join(dir, "index.db");
    const geminiFile = join(dir, ".gemini", "tmp", "project", "chats", "session-large.json");
    mkdirSync(dirname(geminiFile), { recursive: true });
    writeFileSync(geminiFile, "x".repeat(33 * 1024 * 1024));

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles: () => [
          {
            provider: "gemini" as const,
            projectPath: "/workspace/gemini",
            canonicalProjectPath: "/workspace/gemini",
            projectName: "gemini",
            sessionIdentity: "gemini:materialized-hard-omit:test",
            sourceSessionId: "gemini-materialized-hard-omit",
            filePath: geminiFile,
            fileSize: Buffer.byteLength(readFileSync(geminiFile)),
            fileMtimeMs: Date.now(),
            metadata: {
              includeInHistory: true,
              isSubagent: false,
              unresolvedProject: false,
              gitBranch: null,
              cwd: "/workspace/gemini",
              worktreeLabel: null,
              worktreeSource: null,
              repositoryUrl: null,
              forkedFromSessionId: null,
              parentSessionCwd: null,
            },
          },
        ],
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT category, content FROM messages ORDER BY created_at, id")
      .all() as Array<{
      category: string;
      content: string;
    }>;
    db.close();

    expect(messages).toEqual([
      expect.objectContaining({
        category: "system",
        content: expect.stringContaining("Oversized transcript file omitted."),
      }),
    ]);
    expect(notices).toContain("parser.oversized_source_file_omitted");

    rmSync(dir, { recursive: true, force: true });
  });

  it("truncates oversized stored message and tool payload content", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-truncate-"));
    const dbPath = join(dir, "index.db");
    const claudeFile = join(dir, ".claude", "projects", "truncate", "session.jsonl");
    mkdirSync(dirname(claudeFile), { recursive: true });
    const hugeInput = "a".repeat(400 * 1024);
    writeFileSync(
      claudeFile,
      `${[
        JSON.stringify({
          sessionId: "claude-session-truncate",
          type: "assistant",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-08T10:00:00Z",
          message: {
            model: "claude-opus-4-6",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Read",
                input: { payload: hugeInput },
              },
            ],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
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
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messageRow = db.prepare("SELECT content FROM messages LIMIT 1").get() as {
      content: string;
    };
    const ftsRow = db.prepare("SELECT content FROM message_fts LIMIT 1").get() as {
      content: string;
    };
    const toolCallRow = db.prepare("SELECT args_json FROM tool_calls LIMIT 1").get() as {
      args_json: string;
    };
    db.close();

    expect(Buffer.byteLength(messageRow.content, "utf8")).toBeLessThan(300 * 1024);
    expect(messageRow.content).toContain("[truncated from");
    expect(Buffer.byteLength(ftsRow.content, "utf8")).toBeLessThan(64 * 1024);
    expect(Buffer.byteLength(toolCallRow.args_json, "utf8")).toBeLessThan(80 * 1024);
    expect(notices).toEqual(
      expect.arrayContaining(["index.message_fts_truncated", "index.tool_call_raw_truncated"]),
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("skips identical streamed duplicate message ids instead of failing the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-streamed-duplicate-skip-"));
    const dbPath = join(dir, "index.db");
    const claudeFile = join(dir, ".claude", "projects", "duplicate-skip", "session.jsonl");
    mkdirSync(dirname(claudeFile), { recursive: true });
    writeFileSync(
      claudeFile,
      `${[
        JSON.stringify({
          sessionId: "claude-session-duplicate-skip",
          type: "assistant",
          id: "duplicate-message",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:00Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "First version" }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-session-duplicate-skip",
          type: "assistant",
          id: "duplicate-message",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:00Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "First version" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const issues: Array<{ stage: string; error: unknown }> = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          claudeRoot: join(dir, ".claude", "projects"),
          enabledProviders: ["claude"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
        onFileIssue: (issue) => {
          issues.push({ stage: issue.stage, error: issue.error });
        },
      },
    );

    expect(result.indexedFiles).toBe(1);
    expect(result.diagnostics.errors).toBe(0);
    expect(notices).not.toContain("parser.invalid_jsonl_line");
    expect(notices).toContain("index.duplicate_message_skipped");
    expect(issues).toHaveLength(0);

    const db = openDatabase(dbPath);
    const rows = db
      .prepare("SELECT source_id, content FROM messages ORDER BY created_at, source_id")
      .all() as Array<{
      source_id: string;
      content: string;
    }>;
    expect(rows).toEqual([{ source_id: "duplicate-message", content: "First version" }]);
    db.close();

    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites conflicting streamed duplicate message ids instead of failing the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-streamed-duplicate-rewrite-"));
    const dbPath = join(dir, "index.db");
    const claudeFile = join(dir, ".claude", "projects", "duplicate-rewrite", "session.jsonl");
    mkdirSync(dirname(claudeFile), { recursive: true });
    writeFileSync(
      claudeFile,
      `${[
        JSON.stringify({
          sessionId: "claude-session-duplicate-rewrite",
          type: "assistant",
          id: "duplicate-message",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:00Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "First version" }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-session-duplicate-rewrite",
          type: "assistant",
          id: "duplicate-message",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:01Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Second version" }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-session-duplicate-rewrite",
          type: "assistant",
          id: "duplicate-message",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:01Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Second version" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const issues: Array<{ stage: string; error: unknown }> = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          claudeRoot: join(dir, ".claude", "projects"),
          enabledProviders: ["claude"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
        onFileIssue: (issue) => {
          issues.push({ stage: issue.stage, error: issue.error });
        },
      },
    );

    expect(result.indexedFiles).toBe(1);
    expect(result.diagnostics.errors).toBe(0);
    expect(notices).toContain("index.duplicate_message_rewritten");
    expect(notices).toContain("index.duplicate_message_skipped");
    expect(issues).toHaveLength(0);

    const db = openDatabase(dbPath);
    const rows = db
      .prepare("SELECT source_id, content FROM messages ORDER BY created_at, source_id")
      .all() as Array<{
      source_id: string;
      content: string;
    }>;
    expect(rows).toEqual([
      { source_id: "duplicate-message", content: "First version" },
      { source_id: "duplicate-message~dup2", content: "Second version" },
    ]);
    db.close();

    rmSync(dir, { recursive: true, force: true });
  });

  it("skips repeated Claude compact boundary events with the same uuid", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-claude-compact-boundary-"));
    const dbPath = join(dir, "index.db");
    const claudeFile = join(dir, ".claude", "projects", "compact-boundary", "session.jsonl");
    mkdirSync(dirname(claudeFile), { recursive: true });
    writeFileSync(
      claudeFile,
      `${[
        JSON.stringify({
          sessionId: "claude-session-compact-boundary",
          type: "system",
          subtype: "compact_boundary",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:00Z",
          uuid: "compact-boundary-1",
          content: "Conversation compacted",
        }),
        JSON.stringify({
          sessionId: "claude-session-compact-boundary",
          type: "system",
          subtype: "compact_boundary",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:00Z",
          uuid: "compact-boundary-1",
          content: "Conversation compacted",
        }),
        JSON.stringify({
          sessionId: "claude-session-compact-boundary",
          type: "assistant",
          id: "assistant-1",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:01Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Still indexing" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const issues: Array<{ stage: string; error: unknown }> = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          claudeRoot: join(dir, ".claude", "projects"),
          enabledProviders: ["claude"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
        onFileIssue: (issue) => {
          issues.push({ stage: issue.stage, error: issue.error });
        },
      },
    );

    expect(result.indexedFiles).toBe(1);
    expect(result.diagnostics.errors).toBe(0);
    expect(notices).toContain("index.claude_compact_boundary_duplicate_skipped");
    expect(issues).toHaveLength(0);

    const db = openDatabase(dbPath);
    const rows = db
      .prepare("SELECT source_id, category, content FROM messages ORDER BY created_at")
      .all() as Array<{
      source_id: string;
      category: string;
      content: string;
    }>;
    expect(rows).toEqual([
      {
        source_id: "compact-boundary-1",
        category: "system",
        content: "Conversation compacted",
      },
      {
        source_id: "assistant-1",
        category: "assistant",
        content: "Still indexing",
      },
    ]);
    db.close();

    rmSync(dir, { recursive: true, force: true });
  });

  it("continues indexing other files when one file cannot be read and reports the failing path", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-file-issue-"));
    const dbPath = join(dir, "index.db");
    const goodFile = join(dir, ".codex", "sessions", "2026", "03", "08", "good.jsonl");
    const missingFile = join(dir, ".codex", "sessions", "2026", "03", "08", "missing.jsonl");
    mkdirSync(dirname(goodFile), { recursive: true });
    writeFileSync(
      goodFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-08T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-good",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-08T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Good file indexed" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const onFileIssue = vi.fn();
    const result = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles: () => [
          {
            provider: "codex",
            projectPath: "/workspace/codex",
            canonicalProjectPath: "/workspace/codex",
            projectName: "codex",
            sessionIdentity: "codex:codex-session-good:test",
            sourceSessionId: "codex-session-good",
            filePath: goodFile,
            fileSize: 1024,
            fileMtimeMs: Date.parse("2026-03-08T10:05:00Z"),
            metadata: {
              includeInHistory: true,
              isSubagent: false,
              unresolvedProject: false,
              gitBranch: "main",
              cwd: "/workspace/codex",
              worktreeLabel: null,
              worktreeSource: null,
              repositoryUrl: null,
              forkedFromSessionId: null,
              parentSessionCwd: null,
            },
          },
          {
            provider: "codex",
            projectPath: "/workspace/codex",
            canonicalProjectPath: "/workspace/codex",
            projectName: "codex",
            sessionIdentity: "codex:codex-session-missing:test",
            sourceSessionId: "codex-session-missing",
            filePath: missingFile,
            fileSize: 1024,
            fileMtimeMs: Date.parse("2026-03-08T10:06:00Z"),
            metadata: {
              includeInHistory: true,
              isSubagent: false,
              unresolvedProject: false,
              gitBranch: "main",
              cwd: "/workspace/codex",
              worktreeLabel: null,
              worktreeSource: null,
              repositoryUrl: null,
              forkedFromSessionId: null,
              parentSessionCwd: null,
            },
          },
        ],
        onFileIssue,
      },
    );

    expect(result.discoveredFiles).toBe(2);
    expect(result.indexedFiles).toBe(1);
    expect(result.skippedFiles).toBe(0);
    expect(result.diagnostics.errors).toBe(1);
    expect(onFileIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        sessionId: "codex-session-missing",
        filePath: missingFile,
        stage: "read",
      }),
    );

    const db = openDatabase(dbPath);
    const sessionCount = db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number };
    const indexedFileCount = db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as {
      c: number;
    };
    db.close();

    expect(sessionCount.c).toBe(1);
    expect(indexedFileCount.c).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps copied codex sessions with identical source ids as distinct sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-codex-dupe-"));
    const dbPath = join(dir, "index.db");
    const codexRoot = join(dir, ".codex", "sessions");
    const fileA = join(codexRoot, "2026", "02", "27", "one", "same-id.jsonl");
    const fileB = join(codexRoot, "2026", "02", "27", "two", "same-id.jsonl");
    mkdirSync(join(codexRoot, "2026", "02", "27", "one"), { recursive: true });
    mkdirSync(join(codexRoot, "2026", "02", "27", "two"), { recursive: true });

    const content = `${[
      JSON.stringify({
        timestamp: "2026-02-27T11:00:00Z",
        type: "session_meta",
        payload: {
          id: "copied-session-id",
          cwd: "/workspace/codex",
          git: { branch: "dev" },
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-27T11:00:02Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Done" }],
        },
      }),
    ].join("\n")}\n`;
    writeFileSync(fileA, content);
    writeFileSync(fileB, content);

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: {
        claudeRoot: join(dir, ".claude", "projects"),
        codexRoot,
        geminiRoot: join(dir, ".gemini", "tmp"),
        geminiHistoryRoot: join(dir, ".gemini", "history"),
        geminiProjectsPath: join(dir, ".gemini", "projects.json"),
        cursorRoot: join(dir, ".cursor", "projects"),
        copilotRoot: join(dir, ".copilot-workspace"),
        copilotCliRoot: join(dir, ".copilot-cli-sessions"),
        opencodeRoot: join(dir, ".local", "share", "opencode"),
        includeClaudeSubagents: false,
      },
    });

    expect(result.discoveredFiles).toBe(2);
    expect(result.indexedFiles).toBe(2);

    const db = openDatabase(dbPath);
    const rows = db
      .prepare("SELECT COUNT(*) as c FROM sessions WHERE provider = 'codex'")
      .get() as {
      c: number;
    };
    db.close();

    expect(rows.c).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies default and overridden system message regex rules during ingestion", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-system-rules-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-system-rules");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      join(claudeProject, "claude-session-1.jsonl"),
      `${[
        JSON.stringify({
          type: "user",
          timestamp: "2026-02-27T10:00:00Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "<command-name>/exit</command-name>" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const codexRoot = join(dir, ".codex", "sessions", "2026", "02", "27");
    mkdirSync(codexRoot, { recursive: true });
    writeFileSync(
      join(codexRoot, "codex-session-1.jsonl"),
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T11:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            cwd: "/workspace/codex",
            git: { branch: "dev" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<environment_context>" }],
          },
        }),
      ].join("\n")}\n`,
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

    runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    const dbAfterDefault = openDatabase(dbPath);
    const defaultRows = dbAfterDefault
      .prepare("SELECT provider, category FROM messages WHERE category = 'system'")
      .all() as Array<{ provider: string; category: string }>;
    dbAfterDefault.close();

    expect(defaultRows.some((row) => row.provider === "claude")).toBe(true);
    expect(defaultRows.some((row) => row.provider === "codex")).toBe(true);

    runIncrementalIndexing({
      dbPath,
      forceReindex: true,
      discoveryConfig,
      systemMessageRegexRules: {
        claude: [],
        codex: [],
        gemini: [],
      },
    });

    const dbAfterOverride = openDatabase(dbPath);
    const overriddenRows = dbAfterOverride
      .prepare("SELECT provider, category FROM messages WHERE content = '<environment_context>'")
      .all() as Array<{ provider: string; category: string }>;
    dbAfterOverride.close();

    expect(overriddenRows).toEqual([
      {
        provider: "codex",
        category: "user",
      },
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to file mtime for cursor messages with invalid timestamps", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-cursor-time-"));
    const dbPath = join(dir, "index.db");
    const cursorRoot = join(dir, ".cursor", "projects");
    const actualProjectPath = join(dir, "workspace", "cursor-app");
    const encodedProjectName = actualProjectPath.slice(1).replaceAll("/", "-");
    const sessionUuid = "cursor-session-1";
    const transcriptPath = join(
      cursorRoot,
      encodedProjectName,
      "agent-transcripts",
      sessionUuid,
      `${sessionUuid}.jsonl`,
    );
    mkdirSync(join(cursorRoot, encodedProjectName, "terminals"), { recursive: true });
    mkdirSync(join(actualProjectPath), { recursive: true });
    mkdirSync(dirname(transcriptPath), { recursive: true });

    writeFileSync(
      join(cursorRoot, encodedProjectName, "terminals", "1.txt"),
      `${[
        "---",
        `cwd: "${actualProjectPath}"`,
        'command: "ls"',
        "started_at: 2026-03-04T00:00:00.000Z",
        "---",
        "",
      ].join("\n")}`,
    );
    writeFileSync(
      transcriptPath,
      `${[
        JSON.stringify({
          id: "cur-u-1",
          role: "user",
          timestamp: "not-a-date",
          message: {
            content: [{ type: "text", text: "<user_query>\nCheck timestamps\n</user_query>" }],
          },
        }),
        JSON.stringify({
          id: "cur-a-1",
          message: {
            role: "assistant",
            created_at: "still-not-a-date",
            content: [{ type: "text", text: "Working on it." }],
          },
        }),
        JSON.stringify({
          id: "cur-a-2",
          role: "assistant",
          timestamp: "2026-03-04T10:00:05.000Z",
          message: {
            content: [{ type: "text", text: "Done." }],
          },
        }),
      ].join("\n")}\n`,
    );
    const fileMtime = new Date("2026-03-04T10:00:00.000Z");
    utimesSync(transcriptPath, fileMtime, fileMtime);

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: {
        claudeRoot: join(dir, ".claude", "projects"),
        codexRoot: join(dir, ".codex", "sessions"),
        geminiRoot: join(dir, ".gemini", "tmp"),
        geminiHistoryRoot: join(dir, ".gemini", "history"),
        geminiProjectsPath: join(dir, ".gemini", "projects.json"),
        cursorRoot,
        copilotRoot: join(dir, ".copilot-workspace"),
        copilotCliRoot: join(dir, ".copilot-cli-sessions"),
        opencodeRoot: join(dir, ".local", "share", "opencode"),
        includeClaudeSubagents: false,
      },
    });

    expect(result.discoveredFiles).toBe(1);
    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const session = db
      .prepare(
        "SELECT started_at, ended_at, cwd, title FROM sessions WHERE provider = 'cursor' AND file_path = ?",
      )
      .get(transcriptPath) as {
      started_at: string;
      ended_at: string;
      cwd: string;
      title: string;
    };
    const fallbackMessage = db
      .prepare("SELECT created_at FROM messages WHERE source_id = ?")
      .get("cur-u-1") as { created_at: string };
    const nestedFallbackMessage = db
      .prepare("SELECT created_at FROM messages WHERE source_id = ?")
      .get("cur-a-1") as { created_at: string };
    const validMessage = db
      .prepare("SELECT created_at FROM messages WHERE source_id = ?")
      .get("cur-a-2") as { created_at: string };
    const orderedSourceIds = db
      .prepare("SELECT source_id FROM messages ORDER BY created_at ASC, id ASC")
      .all() as Array<{ source_id: string }>;
    db.close();

    expect(session.cwd).toBe(actualProjectPath);
    expect(session.title).toBe("Check timestamps");
    expect(session.started_at).toBe("2026-03-04T10:00:00.000Z");
    expect(session.ended_at).toBe("2026-03-04T10:00:05.000Z");
    expect(fallbackMessage.created_at).toBe("2026-03-04T10:00:00.000Z");
    expect(nestedFallbackMessage.created_at).toBe("2026-03-04T10:00:00.001Z");
    expect(validMessage.created_at).toBe("2026-03-04T10:00:05.000Z");
    expect(orderedSourceIds.map((row) => row.source_id)).toEqual(["cur-u-1", "cur-a-1", "cur-a-2"]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps cursor sessions with identical source ids in distinct projects", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-cursor-dupe-"));
    const dbPath = join(dir, "index.db");
    const cursorRoot = join(dir, ".cursor", "projects");
    const sessionUuid = "shared-cursor-session";
    const projectAPath = join(dir, "workspace", "cursor-one");
    const projectBPath = join(dir, "workspace", "cursor-two");
    const encodedA = projectAPath.slice(1).replaceAll("/", "-");
    const encodedB = projectBPath.slice(1).replaceAll("/", "-");
    mkdirSync(projectAPath, { recursive: true });
    mkdirSync(projectBPath, { recursive: true });

    const transcriptA = join(
      cursorRoot,
      encodedA,
      "agent-transcripts",
      sessionUuid,
      `${sessionUuid}.jsonl`,
    );
    const transcriptB = join(
      cursorRoot,
      encodedB,
      "agent-transcripts",
      sessionUuid,
      `${sessionUuid}.jsonl`,
    );
    mkdirSync(join(cursorRoot, encodedA, "terminals"), { recursive: true });
    mkdirSync(join(cursorRoot, encodedB, "terminals"), { recursive: true });
    mkdirSync(dirname(transcriptA), { recursive: true });
    mkdirSync(dirname(transcriptB), { recursive: true });
    writeFileSync(
      join(cursorRoot, encodedA, "terminals", "a.txt"),
      `---\ncwd: "${projectAPath}"\n---\n`,
    );
    writeFileSync(
      join(cursorRoot, encodedB, "terminals", "b.txt"),
      `---\ncwd: "${projectBPath}"\n---\n`,
    );

    const content = `${JSON.stringify({
      id: "cur-1",
      role: "assistant",
      timestamp: "2026-03-04T10:00:00.000Z",
      message: { content: [{ type: "text", text: "Done." }] },
    })}\n`;
    writeFileSync(transcriptA, content);
    writeFileSync(transcriptB, content);

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: {
        claudeRoot: join(dir, ".claude", "projects"),
        codexRoot: join(dir, ".codex", "sessions"),
        geminiRoot: join(dir, ".gemini", "tmp"),
        geminiHistoryRoot: join(dir, ".gemini", "history"),
        geminiProjectsPath: join(dir, ".gemini", "projects.json"),
        cursorRoot,
        copilotRoot: join(dir, ".copilot-workspace"),
        copilotCliRoot: join(dir, ".copilot-cli-sessions"),
        opencodeRoot: join(dir, ".local", "share", "opencode"),
        includeClaudeSubagents: false,
      },
    });

    expect(result.discoveredFiles).toBe(2);
    expect(result.indexedFiles).toBe(2);

    const db = openDatabase(dbPath);
    const sessionCount = db
      .prepare("SELECT COUNT(*) as c FROM sessions WHERE provider = 'cursor'")
      .get() as { c: number };
    const identities = db
      .prepare(
        "SELECT id, file_path FROM sessions WHERE provider = 'cursor' ORDER BY file_path ASC",
      )
      .all() as Array<{ id: string; file_path: string }>;
    db.close();

    expect(sessionCount.c).toBe(2);
    expect(identities[0]?.id).not.toBe(identities[1]?.id);

    rmSync(dir, { recursive: true, force: true });
  });

  it("ingests only appended tail content for a tombstoned JSONL session", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-deleted-session-append-"));
    const dbPath = join(dir, "index.db");
    const claudeProject = join(dir, ".claude", "projects", "project-a");
    const sessionFile = join(claudeProject, "claude-session-1.jsonl");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Before delete" }],
        },
      })}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    tombstoneSession(dbPath, sessionFile);

    appendFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "assistant",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:01Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "After append" }],
        },
      })}\n`,
    );
    const appendedAt = new Date("2026-02-27T10:00:02Z");
    utimesSync(sessionFile, appendedAt, appendedAt);

    const result = runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT content FROM messages ORDER BY created_at, id")
      .all() as Array<{ content: string }>;
    const deletedCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM deleted_sessions WHERE file_path = ?")
        .get(sessionFile) as {
        c: number;
      }
    ).c;
    db.close();

    expect(messages).toEqual([{ content: "After append" }]);
    expect(deletedCount).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a tombstoned JSONL session deleted when the file is rewritten in place with the same identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-deleted-session-same-identity-"));
    const dbPath = join(dir, "index.db");
    const claudeProject = join(dir, ".claude", "projects", "project-a");
    const sessionFile = join(claudeProject, "claude-session-1.jsonl");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Original" }],
        },
      })}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    tombstoneSession(dbPath, sessionFile);

    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "assistant",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:05:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Rewritten but same identity" }],
        },
      })}\n`,
    );
    const rewrittenAt = new Date("2026-02-27T10:05:01Z");
    utimesSync(sessionFile, rewrittenAt, rewrittenAt);

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      { dbPath, discoveryConfig: createDiscoveryConfig(dir) },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(0);

    const db = openDatabase(dbPath);
    const sessionCount = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number })
      .c;
    const deletedCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM deleted_sessions WHERE file_path = ?")
        .get(sessionFile) as {
        c: number;
      }
    ).c;
    db.close();

    expect(sessionCount).toBe(0);
    expect(deletedCount).toBe(1);
    expect(notices).toContain("index.deleted_session_rewrite_ignored");

    rmSync(dir, { recursive: true, force: true });
  });

  it("ingests a rewritten tombstoned JSONL file as new when the session identity changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-deleted-codex-new-identity-"));
    const dbPath = join(dir, "index.db");
    const codexDayDir = join(dir, ".codex", "sessions", "2026", "02", "27");
    const sessionFile = join(codexDayDir, "rollout-codex-1.jsonl");
    mkdirSync(codexDayDir, { recursive: true });
    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T10:00:00Z",
          type: "session_meta",
          payload: { id: "codex-session-1", cwd: "/workspace/codex", git: { branch: "main" } },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Original" }],
          },
        }),
      ].join("\n")}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    tombstoneSession(dbPath, sessionFile);

    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T10:06:00Z",
          type: "session_meta",
          payload: { id: "codex-session-2", cwd: "/workspace/codex", git: { branch: "main" } },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T10:06:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Imported as new" }],
          },
        }),
      ].join("\n")}\n`,
    );
    const rewrittenAt = new Date("2026-02-27T10:06:01Z");
    utimesSync(sessionFile, rewrittenAt, rewrittenAt);

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      { dbPath, discoveryConfig: createDiscoveryConfig(dir) },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT content FROM messages ORDER BY created_at, id")
      .all() as Array<{ content: string }>;
    const deletedCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM deleted_sessions WHERE file_path = ?")
        .get(sessionFile) as {
        c: number;
      }
    ).c;
    db.close();

    expect(messages).toEqual([{ content: "Imported as new" }]);
    expect(deletedCount).toBe(0);
    expect(notices).toContain("index.deleted_session_replaced");

    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a tombstoned materialized-json session deleted during normal refresh but restores it on force reindex", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-deleted-gemini-session-"));
    const dbPath = join(dir, "index.db");
    const geminiRoot = join(dir, ".gemini", "tmp");
    const geminiHistoryRoot = join(dir, ".gemini", "history");
    mkdirSync(join(geminiRoot, "dux", "chats"), { recursive: true });
    mkdirSync(join(geminiHistoryRoot, "dux"), { recursive: true });
    writeFileSync(join(geminiRoot, "dux", ".project_root"), "/workspace/dux");
    writeFileSync(join(geminiHistoryRoot, "dux", ".project_root"), "/workspace/dux");
    const sessionFile = join(geminiRoot, "dux", "chats", "session-1.json");
    writeFileSync(
      sessionFile,
      JSON.stringify({
        sessionId: "gemini-session-1",
        projectHash: "ddd29e90e8e0e53b3e06996841fdaf7a26e33cdca62e0678fb37e500d58d2bf8",
        startTime: "2026-02-27T12:00:00Z",
        lastUpdated: "2026-02-27T12:00:10Z",
        messages: [
          {
            id: "g-user-1",
            type: "user",
            timestamp: "2026-02-27T12:00:00Z",
            content: "Hello Gemini",
          },
        ],
      }),
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    tombstoneSession(dbPath, sessionFile);

    writeFileSync(
      sessionFile,
      JSON.stringify({
        sessionId: "gemini-session-1",
        projectHash: "ddd29e90e8e0e53b3e06996841fdaf7a26e33cdca62e0678fb37e500d58d2bf8",
        startTime: "2026-02-27T12:00:00Z",
        lastUpdated: "2026-02-27T12:00:20Z",
        messages: [
          {
            id: "g-user-1",
            type: "user",
            timestamp: "2026-02-27T12:00:00Z",
            content: "Hello Gemini",
          },
          {
            id: "g-assistant-1",
            type: "gemini",
            model: "gemini-2.5-pro",
            timestamp: "2026-02-27T12:00:10Z",
            content: "Rewritten Gemini content",
          },
        ],
      }),
    );
    const rewrittenAt = new Date("2026-02-27T12:00:21Z");
    utimesSync(sessionFile, rewrittenAt, rewrittenAt);

    const notices: string[] = [];
    const normal = runIncrementalIndexing(
      { dbPath, discoveryConfig: createDiscoveryConfig(dir) },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );
    expect(normal.indexedFiles).toBe(0);

    let db = openDatabase(dbPath);
    expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(0);
    db.close();

    const forced = runIncrementalIndexing({
      dbPath,
      discoveryConfig: createDiscoveryConfig(dir),
      forceReindex: true,
    });
    expect(forced.indexedFiles).toBe(1);

    db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT content FROM messages ORDER BY created_at, id")
      .all() as Array<{ content: string }>;
    const deletedCount = (
      db.prepare("SELECT COUNT(*) as c FROM deleted_sessions").get() as { c: number }
    ).c;
    db.close();

    expect(messages.map((message) => message.content)).toEqual([
      "Hello Gemini",
      "Rewritten Gemini content",
    ]);
    expect(deletedCount).toBe(0);
    expect(notices).toContain("index.deleted_session_rewrite_ignored");

    rmSync(dir, { recursive: true, force: true });
  });

  it("force reindexes only the selected project and clears only its tombstones", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-project-force-reindex-"));
    const dbPath = join(dir, "index.db");
    const claudeRoot = join(dir, ".claude", "projects");
    const projectARoot = join(claudeRoot, "project-a");
    const projectBRoot = join(claudeRoot, "project-b");
    const projectAFile = join(projectARoot, "session-a.jsonl");
    const projectBFile = join(projectBRoot, "session-b.jsonl");

    mkdirSync(projectARoot, { recursive: true });
    mkdirSync(projectBRoot, { recursive: true });
    writeFileSync(
      projectAFile,
      `${JSON.stringify({
        sessionId: "session-a",
        type: "user",
        cwd: "/workspace/project-a",
        timestamp: "2026-02-27T10:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Project A original" }] },
      })}\n`,
    );
    writeFileSync(
      projectBFile,
      `${JSON.stringify({
        sessionId: "session-b",
        type: "user",
        cwd: "/workspace/project-b",
        timestamp: "2026-02-27T11:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Project B original" }] },
      })}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    tombstoneSession(dbPath, projectAFile);

    let db = openDatabase(dbPath);
    db.prepare(
      `INSERT INTO deleted_projects (provider, project_path, deleted_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(provider, project_path) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms`,
    ).run("claude", "/workspace/project-a", Date.now());
    db.prepare(
      `INSERT INTO deleted_projects (provider, project_path, deleted_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(provider, project_path) DO UPDATE SET deleted_at_ms = excluded.deleted_at_ms`,
    ).run("claude", "/workspace/project-b", Date.now());
    db.close();

    writeFileSync(
      projectAFile,
      `${JSON.stringify({
        sessionId: "session-a",
        type: "user",
        cwd: "/workspace/project-a",
        timestamp: "2026-02-27T10:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Project A reindexed" }] },
      })}\n`,
    );

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: createDiscoveryConfig(dir),
      forceReindex: true,
      projectScope: {
        provider: "claude",
        projectPath: "/workspace/project-a",
      },
    });

    expect(result.indexedFiles).toBe(1);

    db = openDatabase(dbPath);
    const sessions = db
      .prepare("SELECT file_path FROM sessions ORDER BY file_path")
      .all() as Array<{ file_path: string }>;
    const projectAMessages = db
      .prepare(
        `SELECT m.content
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.file_path = ?`,
      )
      .all(projectAFile) as Array<{ content: string }>;
    const projectBMessages = db
      .prepare(
        `SELECT m.content
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.file_path = ?`,
      )
      .all(projectBFile) as Array<{ content: string }>;
    const deletedProjectRows = db
      .prepare("SELECT project_path FROM deleted_projects ORDER BY project_path")
      .all() as Array<{ project_path: string }>;
    const deletedSessionCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM deleted_sessions WHERE file_path = ?")
        .get(projectAFile) as { c: number }
    ).c;
    db.close();

    expect(sessions.map((session) => session.file_path)).toEqual([projectAFile, projectBFile]);
    expect(projectAMessages.map((message) => message.content)).toEqual(["Project A reindexed"]);
    expect(projectBMessages.map((message) => message.content)).toEqual(["Project B original"]);
    expect(deletedProjectRows.map((row) => row.project_path)).toEqual(["/workspace/project-b"]);
    expect(deletedSessionCount).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("limits missing-session cleanup to the selected project scope", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-project-cleanup-scope-"));
    const dbPath = join(dir, "index.db");
    const claudeRoot = join(dir, ".claude", "projects");
    const projectARoot = join(claudeRoot, "project-a");
    const projectBRoot = join(claudeRoot, "project-b");
    const projectAFile = join(projectARoot, "session-a.jsonl");
    const projectBFile = join(projectBRoot, "session-b.jsonl");

    mkdirSync(projectARoot, { recursive: true });
    mkdirSync(projectBRoot, { recursive: true });
    writeFileSync(
      projectAFile,
      `${JSON.stringify({
        sessionId: "session-a",
        type: "user",
        cwd: "/workspace/project-a",
        timestamp: "2026-02-27T10:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Project A" }] },
      })}\n`,
    );
    writeFileSync(
      projectBFile,
      `${JSON.stringify({
        sessionId: "session-b",
        type: "user",
        cwd: "/workspace/project-b",
        timestamp: "2026-02-27T11:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Project B" }] },
      })}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    rmSync(projectBFile, { force: true });

    runIncrementalIndexing({
      dbPath,
      discoveryConfig: createDiscoveryConfig(dir),
      projectScope: {
        provider: "claude",
        projectPath: "/workspace/project-a",
      },
      removeMissingSessionsDuringIncrementalIndexing: true,
    });

    const db = openDatabase(dbPath);
    const remainingSessions = db
      .prepare("SELECT file_path FROM sessions ORDER BY file_path")
      .all() as Array<{ file_path: string }>;
    db.close();

    expect(remainingSessions.map((session) => session.file_path)).toEqual([
      projectAFile,
      projectBFile,
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("matches scoped existing sessions by project membership even when canonical_project_path is null", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-project-scope-session-membership-"));
    const dbPath = join(dir, "index.db");
    const claudeRoot = join(dir, ".claude", "projects");
    const projectRoot = join(claudeRoot, "project-a");
    const projectFile = join(projectRoot, "session-a.jsonl");

    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(
      projectFile,
      `${JSON.stringify({
        sessionId: "session-a",
        type: "user",
        cwd: "/workspace/project-a",
        timestamp: "2026-02-27T10:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Project A" }] },
      })}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    const db = openDatabase(dbPath);
    db.prepare("UPDATE sessions SET canonical_project_path = NULL WHERE file_path = ?").run(
      projectFile,
    );
    db.close();

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: createDiscoveryConfig(dir),
      projectScope: {
        provider: "claude",
        projectPath: "/workspace/project-a",
      },
    });

    expect(result.indexedFiles).toBe(0);
    expect(result.skippedFiles).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("groups Codex worktree sessions under the canonical project path", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-worktree-grouping-"));
    const dbPath = join(dir, "index.db");
    const mainFile = join(dir, ".codex", "sessions", "2026", "03", "24", "main.jsonl");
    const worktreeFile = join(dir, ".codex", "sessions", "2026", "03", "24", "worktree.jsonl");
    mkdirSync(dirname(mainFile), { recursive: true });
    writeFileSync(
      mainFile,
      `${JSON.stringify({
        timestamp: "2026-03-24T12:00:00Z",
        type: "session_meta",
        payload: {
          id: "main",
          cwd: "/Users/test/workspace/demo-codex",
          git: { branch: "main", repository_url: "https://example.com/demo-codex.git" },
        },
      })}\n`,
    );
    writeFileSync(
      worktreeFile,
      `${JSON.stringify({
        timestamp: "2026-03-24T12:01:00Z",
        type: "session_meta",
        payload: {
          id: "worktree",
          cwd: "/Users/test/.codex/worktrees/64ef/demo-codex",
          git: { branch: "codex/worktree", repository_url: "https://example.com/demo-codex.git" },
        },
      })}\n`,
    );

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: {
        codexRoot: join(dir, ".codex", "sessions"),
        enabledProviders: ["codex"],
      },
    });

    expect(result.indexedFiles).toBe(2);

    const db = openDatabase(dbPath);
    try {
      const projects = db.prepare("SELECT path FROM projects ORDER BY path").all() as Array<{
        path: string;
      }>;
      const sessions = db
        .prepare("SELECT cwd, worktree_label FROM sessions ORDER BY cwd")
        .all() as Array<{ cwd: string; worktree_label: string | null }>;

      expect(projects).toEqual([{ path: "/Users/test/workspace/demo-codex" }]);
      expect(sessions).toEqual([
        { cwd: "/Users/test/.codex/worktrees/64ef/demo-codex", worktree_label: "64ef" },
        { cwd: "/Users/test/workspace/demo-codex", worktree_label: null },
      ]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves ambiguous Codex worktree basename matches as separate projects", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-worktree-ambiguous-"));
    const dbPath = join(dir, "index.db");
    const notices: string[] = [];
    const discovery = () => [
      makeDiscoveredSessionFile({
        provider: "codex",
        projectPath: "/Users/test/workspace-a/shared",
        canonicalProjectPath: "/Users/test/workspace-a/shared",
        projectName: "shared",
        sessionIdentity: "codex:main-a:test",
        sourceSessionId: "main-a",
        filePath: join(dir, "main-a.jsonl"),
        metadata: {
          cwd: "/Users/test/workspace-a/shared",
        },
      }),
      makeDiscoveredSessionFile({
        provider: "codex",
        projectPath: "/Users/test/workspace-b/shared",
        canonicalProjectPath: "/Users/test/workspace-b/shared",
        projectName: "shared",
        sessionIdentity: "codex:main-b:test",
        sourceSessionId: "main-b",
        filePath: join(dir, "main-b.jsonl"),
        metadata: {
          cwd: "/Users/test/workspace-b/shared",
        },
      }),
      makeDiscoveredSessionFile({
        provider: "codex",
        projectPath: "/Users/test/.codex/worktrees/c5dd/shared",
        canonicalProjectPath: "/Users/test/.codex/worktrees/c5dd/shared",
        projectName: "shared",
        sessionIdentity: "codex:worktree:test",
        sourceSessionId: "worktree",
        filePath: join(dir, "worktree.jsonl"),
        metadata: {
          cwd: "/Users/test/.codex/worktrees/c5dd/shared",
          worktreeLabel: "c5dd",
        },
      }),
    ];

    writeFileSync(join(dir, "main-a.jsonl"), "\n");
    writeFileSync(join(dir, "main-b.jsonl"), "\n");
    writeFileSync(join(dir, "worktree.jsonl"), "\n");

    const result = runIncrementalIndexing(
      { dbPath, enabledProviders: ["codex"] },
      {
        discoverSessionFiles: discovery,
        onNotice: (notice) => notices.push(notice.code),
      },
    );

    expect(result.indexedFiles).toBe(3);

    const db = openDatabase(dbPath);
    try {
      const projects = db.prepare("SELECT path FROM projects ORDER BY path").all() as Array<{
        path: string;
      }>;
      const worktreeSession = db
        .prepare("SELECT project_id, cwd, worktree_label FROM sessions WHERE id = ?")
        .get(makeSessionId("codex", "codex:worktree:test")) as {
        project_id: string;
        cwd: string;
        worktree_label: string | null;
      };

      expect(projects.map((project) => project.path)).toEqual([
        "/Users/test/.codex/worktrees/c5dd/shared",
        "/Users/test/workspace-a/shared",
        "/Users/test/workspace-b/shared",
      ]);
      expect(worktreeSession.cwd).toBe("/Users/test/.codex/worktrees/c5dd/shared");
      expect(worktreeSession.worktree_label).toBeNull();
      expect(notices).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats optional project and session metadata as best-effort during indexing", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-best-effort-metadata-"));
    const dbPath = join(dir, "index.db");
    const filePath = join(dir, "session.jsonl");
    writeFileSync(filePath, "\n");

    const circularProjectMetadata: Record<string, unknown> = {};
    circularProjectMetadata.self = circularProjectMetadata;
    const circularSessionMetadata: Record<string, unknown> = {};
    circularSessionMetadata.self = circularSessionMetadata;

    const result = runIncrementalIndexing(
      { dbPath, enabledProviders: ["codex"] },
      {
        discoverSessionFiles: () => [
          makeDiscoveredSessionFile({
            provider: "codex",
            projectPath: "/workspace/demo",
            canonicalProjectPath: "/workspace/demo",
            projectName: "demo",
            sessionIdentity: "codex:metadata:test",
            sourceSessionId: "metadata-session",
            filePath,
            metadata: {
              providerSessionId: "metadata-session",
              sessionKind: "regular",
              projectMetadata: circularProjectMetadata,
              sessionMetadata: circularSessionMetadata,
            },
          }),
        ],
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    try {
      const project = db
        .prepare("SELECT metadata_json FROM projects WHERE path = ?")
        .get("/workspace/demo") as { metadata_json: string | null };
      const session = db
        .prepare("SELECT metadata_json FROM sessions WHERE file_path = ?")
        .get(filePath) as { metadata_json: string | null };

      expect(project.metadata_json).toBeNull();
      expect(session.metadata_json).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizes Claude edit metadata from file-history snapshots without storing snapshot text", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-claude-tool-edits-"));
    const dbPath = join(dir, "index.db");
    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    const sessionId = "claude-session-edit";
    const sessionFile = join(claudeProject, `${sessionId}.jsonl`);
    const fileHistoryDir = join(dir, ".claude", "file-history", sessionId);
    mkdirSync(claudeProject, { recursive: true });
    mkdirSync(fileHistoryDir, { recursive: true });
    writeFileSync(
      join(fileHistoryDir, "edit-file@v1"),
      ["export type LiveSessionStoreOptions = {", "  instrumentationEnabled?: boolean;", "};"].join(
        "\n",
      ),
    );
    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          type: "user",
          cwd: "/workspace/repo",
          sessionId,
          timestamp: "2026-04-02T18:13:20.000Z",
          message: { role: "user", content: [{ type: "text", text: "Patch the file" }] },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-edit-1",
          cwd: "/workspace/repo",
          sessionId,
          timestamp: "2026-04-02T18:13:26.703Z",
          message: {
            id: "msg-edit-1",
            role: "assistant",
            type: "message",
            content: [
              {
                type: "tool_use",
                id: "tool-edit-1",
                name: "Edit",
                input: {
                  replace_all: false,
                  file_path: "/workspace/repo/src/liveSessionStore.ts",
                  old_string: "  instrumentationEnabled?: boolean;",
                  new_string:
                    "  instrumentationEnabled?: boolean;\n  onSnapshotInvalidated?: () => void;",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "file-history-snapshot",
          messageId: "assistant-edit-1",
          snapshot: {
            trackedFileBackups: {
              "src/liveSessionStore.ts": {
                backupFileName: "edit-file@v1",
                version: 1,
                backupTime: "2026-04-02T18:13:26.731Z",
              },
            },
          },
        }),
      ].join("\n")}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    const db = openDatabase(dbPath);
    try {
      const row = db
        .prepare(
          `SELECT file_path, change_type, unified_diff, added_line_count, removed_line_count, exactness, before_hash, after_hash
           FROM message_tool_edit_files`,
        )
        .get() as {
        file_path: string;
        change_type: string;
        unified_diff: string | null;
        added_line_count: number;
        removed_line_count: number;
        exactness: string;
        before_hash: string | null;
        after_hash: string | null;
      };

      expect(row.file_path).toBe("/workspace/repo/src/liveSessionStore.ts");
      expect(row.change_type).toBe("update");
      expect(row.unified_diff).toContain("onSnapshotInvalidated?: () => void;");
      expect(row.added_line_count).toBeGreaterThan(0);
      expect(row.removed_line_count).toBeGreaterThanOrEqual(0);
      expect(row.exactness).toBe("exact");
      expect(row.before_hash).toBeTruthy();
      expect(row.after_hash).toBeTruthy();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores best-effort Claude edit metadata when file-history is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-claude-tool-edits-fallback-"));
    const dbPath = join(dir, "index.db");
    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    const sessionId = "claude-session-edit-fallback";
    const sessionFile = join(claudeProject, `${sessionId}.jsonl`);
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-edit-fallback",
          cwd: "/workspace/repo",
          sessionId,
          timestamp: "2026-04-02T18:13:26.703Z",
          message: {
            id: "msg-edit-fallback",
            role: "assistant",
            type: "message",
            content: [
              {
                type: "tool_use",
                id: "tool-edit-fallback",
                name: "Edit",
                input: {
                  replace_all: false,
                  file_path: "/workspace/repo/src/liveSessionStore.ts",
                  old_string: "instrumentationEnabled",
                  new_string: "onSnapshotInvalidated",
                },
              },
            ],
          },
        }),
      ].join("\n")}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    const db = openDatabase(dbPath);
    try {
      const row = db
        .prepare(
          `SELECT file_path, unified_diff, exactness, before_hash, after_hash
           FROM message_tool_edit_files`,
        )
        .get() as {
        file_path: string;
        unified_diff: string | null;
        exactness: string;
        before_hash: string | null;
        after_hash: string | null;
      };

      expect(row.file_path).toBe("/workspace/repo/src/liveSessionStore.ts");
      expect(row.unified_diff).toContain("onSnapshotInvalidated");
      expect(row.exactness).toBe("best_effort");
      expect(row.before_hash).toBeNull();
      expect(row.after_hash).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not invent a full-file Claude Write diff when no prior snapshot is known", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-claude-tool-write-fallback-"));
    const dbPath = join(dir, "index.db");
    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    const sessionId = "claude-session-write-fallback";
    const sessionFile = join(claudeProject, `${sessionId}.jsonl`);
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-write-fallback",
          cwd: "/workspace/repo",
          sessionId,
          timestamp: "2026-04-02T18:13:26.703Z",
          message: {
            id: "msg-write-fallback",
            role: "assistant",
            type: "message",
            content: [
              {
                type: "tool_use",
                id: "tool-write-fallback",
                name: "Write",
                input: {
                  file_path: "/workspace/repo/src/liveSessionStore.ts",
                  content: ["export const enabled = true;", "export const retries = 2;"].join("\n"),
                },
              },
            ],
          },
        }),
      ].join("\n")}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    const db = openDatabase(dbPath);
    try {
      const row = db
        .prepare(
          `SELECT change_type, unified_diff, exactness, before_hash, after_hash
           FROM message_tool_edit_files`,
        )
        .get() as {
        change_type: string;
        unified_diff: string | null;
        exactness: string;
        before_hash: string | null;
        after_hash: string | null;
      };

      expect(row.change_type).toBe("update");
      expect(row.unified_diff).toBeNull();
      expect(row.exactness).toBe("best_effort");
      expect(row.before_hash).toBeNull();
      expect(row.after_hash).toBeTruthy();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recovers Claude tool-edit normalization after resuming before a later snapshot event", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-claude-tool-edits-resume-"));
    const dbPath = join(dir, "index.db");
    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    const sessionId = "claude-session-edit-resume";
    const sessionFile = join(claudeProject, `${sessionId}.jsonl`);
    const fileHistoryDir = join(dir, ".claude", "file-history", sessionId);
    mkdirSync(claudeProject, { recursive: true });
    mkdirSync(fileHistoryDir, { recursive: true });
    writeFileSync(
      join(fileHistoryDir, "resume-file@v1"),
      ["export const enabled = false;", "export const retries = 1;"].join("\n"),
    );
    const toolUseEvent = JSON.stringify({
      type: "assistant",
      uuid: "assistant-edit-resume",
      cwd: "/workspace/repo",
      sessionId,
      timestamp: "2026-04-02T18:13:26.703Z",
      message: {
        id: "msg-edit-resume",
        role: "assistant",
        type: "message",
        content: [
          {
            type: "tool_use",
            id: "tool-edit-resume",
            name: "Edit",
            input: {
              replace_all: false,
              file_path: "/workspace/repo/src/liveSessionStore.ts",
              old_string: "export const enabled = false;",
              new_string: "export const enabled = true;",
            },
          },
        ],
      },
    });
    writeFileSync(sessionFile, `${toolUseEvent}\n`);

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    writeFileSync(
      sessionFile,
      `${toolUseEvent}\n${JSON.stringify({
        type: "file-history-snapshot",
        messageId: "assistant-edit-resume",
        snapshot: {
          trackedFileBackups: {
            "src/liveSessionStore.ts": {
              backupFileName: "resume-file@v1",
              version: 1,
              backupTime: "2026-04-02T18:13:26.731Z",
            },
          },
        },
      })}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    const db = openDatabase(dbPath);
    try {
      const row = db
        .prepare(
          `SELECT unified_diff, exactness, before_hash, after_hash
           FROM message_tool_edit_files`,
        )
        .get() as {
        unified_diff: string | null;
        exactness: string;
        before_hash: string | null;
        after_hash: string | null;
      };

      expect(row.unified_diff).toContain("export const enabled = true;");
      expect(row.exactness).toBe("exact");
      expect(row.before_hash).toBeTruthy();
      expect(row.after_hash).toBeTruthy();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the latest known Claude snapshot text to build provisional Write diffs", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-claude-tool-write-provisional-"));
    const dbPath = join(dir, "index.db");
    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    const sessionId = "claude-session-write-provisional";
    const sessionFile = join(claudeProject, `${sessionId}.jsonl`);
    const fileHistoryDir = join(dir, ".claude", "file-history", sessionId);
    mkdirSync(claudeProject, { recursive: true });
    mkdirSync(fileHistoryDir, { recursive: true });
    writeFileSync(
      join(fileHistoryDir, "write-file@v1"),
      ["export const enabled = false;", "export const retries = 1;"].join("\n"),
    );
    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          type: "file-history-snapshot",
          messageId: "assistant-write-provisional",
          snapshot: {
            trackedFileBackups: {
              "src/liveSessionStore.ts": {
                backupFileName: "write-file@v1",
                version: 1,
                backupTime: "2026-04-02T18:13:26.731Z",
              },
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-write-provisional",
          cwd: "/workspace/repo",
          sessionId,
          timestamp: "2026-04-02T18:13:26.900Z",
          message: {
            id: "msg-write-provisional",
            role: "assistant",
            type: "message",
            content: [
              {
                type: "tool_use",
                id: "tool-write-provisional",
                name: "Write",
                input: {
                  file_path: "/workspace/repo/src/liveSessionStore.ts",
                  content: ["export const enabled = true;", "export const retries = 2;"].join("\n"),
                },
              },
            ],
          },
        }),
      ].join("\n")}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    const db = openDatabase(dbPath);
    try {
      const row = db
        .prepare(
          `SELECT change_type, unified_diff, exactness, before_hash, after_hash
           FROM message_tool_edit_files`,
        )
        .get() as {
        change_type: string;
        unified_diff: string | null;
        exactness: string;
        before_hash: string | null;
        after_hash: string | null;
      };

      expect(row.change_type).toBe("update");
      expect(row.unified_diff).toContain("-export const enabled = false;");
      expect(row.unified_diff).toContain("+export const enabled = true;");
      expect(row.exactness).toBe("best_effort");
      expect(row.before_hash).toBeTruthy();
      expect(row.after_hash).toBeTruthy();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the latest provisional Claude file text for subsequent edits on the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-claude-tool-edit-sequence-"));
    const dbPath = join(dir, "index.db");
    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    const sessionId = "claude-session-edit-sequence";
    const sessionFile = join(claudeProject, `${sessionId}.jsonl`);
    const fileHistoryDir = join(dir, ".claude", "file-history", sessionId);
    mkdirSync(claudeProject, { recursive: true });
    mkdirSync(fileHistoryDir, { recursive: true });

    const originalLines = Array.from({ length: 260 }, (_, index) => {
      const lineNumber = index + 1;
      if (lineNumber === 245) {
        return 'export const targetValue = "before";';
      }
      return `export const line${String(lineNumber).padStart(3, "0")} = ${lineNumber};`;
    });
    writeFileSync(join(fileHistoryDir, "sequence-file@v1"), originalLines.join("\n"));

    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          type: "file-history-snapshot",
          messageId: "snapshot-sequence-initial",
          snapshot: {
            trackedFileBackups: {
              "src/liveSessionStore.ts": {
                backupFileName: "sequence-file@v1",
                version: 1,
                backupTime: "2026-04-02T18:13:26.731Z",
              },
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-edit-sequence-1",
          cwd: "/workspace/repo",
          sessionId,
          timestamp: "2026-04-02T18:13:26.900Z",
          message: {
            id: "msg-edit-sequence-1",
            role: "assistant",
            type: "message",
            content: [
              {
                type: "tool_use",
                id: "tool-edit-sequence-1",
                name: "Edit",
                input: {
                  replace_all: false,
                  file_path: "/workspace/repo/src/liveSessionStore.ts",
                  old_string: 'export const targetValue = "before";',
                  new_string: 'export const targetValue = "mid";',
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-edit-sequence-2",
          cwd: "/workspace/repo",
          sessionId,
          timestamp: "2026-04-02T18:13:27.000Z",
          message: {
            id: "msg-edit-sequence-2",
            role: "assistant",
            type: "message",
            content: [
              {
                type: "tool_use",
                id: "tool-edit-sequence-2",
                name: "Edit",
                input: {
                  replace_all: false,
                  file_path: "/workspace/repo/src/liveSessionStore.ts",
                  old_string: 'export const targetValue = "mid";',
                  new_string: 'export const targetValue = "after";',
                },
              },
            ],
          },
        }),
      ].join("\n")}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    const db = openDatabase(dbPath);
    try {
      const rows = db
        .prepare(
          `SELECT f.unified_diff, f.exactness
           FROM message_tool_edit_files f
           JOIN messages m ON m.id = f.message_id
           ORDER BY m.created_at ASC, m.id ASC`,
        )
        .all() as Array<{
        unified_diff: string | null;
        exactness: string;
      }>;

      expect(rows).toHaveLength(2);
      expect(rows[0]?.unified_diff).toContain("@@ -243,5 +243,5 @@");
      expect(rows[0]?.unified_diff).toContain('-export const targetValue = "before";');
      expect(rows[0]?.unified_diff).toContain('+export const targetValue = "mid";');
      expect(rows[1]?.unified_diff).toContain("@@ -243,5 +243,5 @@");
      expect(rows[1]?.unified_diff).toContain('-export const targetValue = "mid";');
      expect(rows[1]?.unified_diff).toContain('+export const targetValue = "after";');
      expect(rows[1]?.unified_diff).not.toContain("@@ -1,1 +1,1 @@");
      expect(rows[0]?.exactness).toBe("best_effort");
      expect(rows[1]?.exactness).toBe("best_effort");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("indexes OpenCode sessions and best-effort tool edit files", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-opencode-"));
    const dbPath = join(dir, "index.db");

    createOpenCodeFixtureDatabase({
      rootDir: join(dir, ".local", "share", "opencode"),
      sessions: [
        {
          id: "opencode-1",
          directory: "/workspace/opencode-app",
          title: "OpenCode Session",
          timeCreated: 1_711_000_000_000,
          timeUpdated: 1_711_000_001_000,
          messages: [
            {
              id: "msg-1",
              timeCreated: 1_711_000_000_000,
              data: {
                role: "assistant",
                modelID: "gpt-4.1",
                time: { created: 1_711_000_000, completed: 1_711_000_001 },
              },
              parts: [
                {
                  type: "tool",
                  tool: "edit",
                  callID: "call-edit-1",
                  state: {
                    input: {
                      filePath: "/workspace/opencode-app/src/index.ts",
                      oldString: "const before = 1;\n",
                      newString: "const after = 2;\n",
                    },
                    output: "updated",
                    time: { start: 1_711_000_000, end: 1_711_000_001 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: createDiscoveryConfig(dir),
    });

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    try {
      const sessionRow = db
        .prepare("SELECT provider, file_path, cwd, provider_client FROM sessions")
        .get() as {
        provider: string;
        file_path: string;
        cwd: string | null;
        provider_client: string | null;
      };
      const toolCallRow = db.prepare("SELECT tool_name, args_json FROM tool_calls").get() as {
        tool_name: string;
        args_json: string;
      };
      const editRow = db
        .prepare(
          `SELECT file_path, change_type, exactness, added_line_count, removed_line_count
           FROM message_tool_edit_files`,
        )
        .get() as {
        file_path: string;
        change_type: string;
        exactness: string;
        added_line_count: number;
        removed_line_count: number;
      };

      expect(sessionRow.provider).toBe("opencode");
      expect(sessionRow.file_path).toContain("opencode:");
      expect(sessionRow.cwd).toBe("/workspace/opencode-app");
      expect(sessionRow.provider_client).toBe("OpenCode");
      expect(toolCallRow.tool_name).toBe("edit");
      expect(toolCallRow.args_json).toContain('"filePath":"/workspace/opencode-app/src/index.ts"');
      expect(editRow).toEqual({
        file_path: "/workspace/opencode-app/src/index.ts",
        change_type: "update",
        exactness: "best_effort",
        added_line_count: 1,
        removed_line_count: 1,
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
