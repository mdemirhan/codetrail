import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/bootstrap";
import { makeSessionId } from "./ids";
import { runIncrementalIndexing } from "./indexSessions";

describe("runIncrementalIndexing", () => {
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
    };
    const claudeSessionId = makeSessionId("claude", "claude-session-1");
    const claudeAggregate = dbAfterFirst
      .prepare(
        `SELECT message_count, token_input_total, token_output_total, model_names, git_branch, cwd
         FROM sessions WHERE id = ?`,
      )
      .get(claudeSessionId) as {
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
    dbAfterThird.close();

    expect(codexMessageCount.message_count).toBeGreaterThanOrEqual(3);

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
});
