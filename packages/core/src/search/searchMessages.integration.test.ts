import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/bootstrap";
import { runIncrementalIndexing } from "../indexing";
import { searchMessages } from "./searchMessages";

function setupIndexedDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "codetrail-search-"));
  const dbPath = join(dir, "index.db");

  const claudeRoot = join(dir, ".claude", "projects");
  const claudeProject = join(claudeRoot, "-tmp-search-project");
  mkdirSync(claudeProject, { recursive: true });
  writeFileSync(
    join(claudeProject, "claude-session-1.jsonl"),
    `${[
      JSON.stringify({
        type: "user",
        uuid: "c-u-1",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Can you fix this bug in parser?" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "c-a-1",
        timestamp: "2026-02-27T10:00:05Z",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 10, output_tokens: 7 },
          content: [
            { type: "thinking", thinking: "I should think through parser branches first." },
            { type: "text", text: "I fixed the bug and simplified the parser flow." },
          ],
        },
      }),
      JSON.stringify({
        type: "summary",
        uuid: "c-s-1",
        timestamp: "2026-02-27T10:00:06Z",
        summary: "Fixed parser bug and added tests.",
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
        type: "turn_context",
        payload: { model: "gpt-5-codex" },
      }),
      JSON.stringify({
        timestamp: "2026-02-27T11:00:02Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "x-u-1",
          role: "user",
          content: [{ type: "input_text", text: "Optimize this path matching implementation." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-27T11:00:03Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "x-a-1",
          role: "assistant",
          content: [{ type: "output_text", text: "Performance changes applied." }],
        },
      }),
    ].join("\n")}\n`,
  );

  runIncrementalIndexing({
    dbPath,
    discoveryConfig: {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      includeClaudeSubagents: false,
    },
  });

  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("searchMessages", () => {
  it("supports full-text search with snippets and escaped quote handling", () => {
    const { dbPath, cleanup } = setupIndexedDb();
    const db = openDatabase(dbPath);

    const result = searchMessages(db, { query: "bug" });
    expect(result.totalCount).toBeGreaterThanOrEqual(1);
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.snippet.length).toBeGreaterThan(0);

    const quoted = searchMessages(db, { query: 'bug"' });
    expect(quoted.totalCount).toBeGreaterThanOrEqual(0);

    db.close();
    cleanup();
  });

  it("applies category/provider/project filters and returns stable facet counts", () => {
    const { dbPath, cleanup } = setupIndexedDb();
    const db = openDatabase(dbPath);

    const userResults = searchMessages(db, { query: "bug", categories: ["user"] });
    expect(userResults.totalCount).toBeGreaterThanOrEqual(1);

    const thinkingResults = searchMessages(db, { query: "think", categories: ["thinking"] });
    expect(thinkingResults.totalCount).toBeGreaterThanOrEqual(1);

    const systemResults = searchMessages(db, { query: "Fixed", categories: ["system"] });
    expect(systemResults.totalCount).toBeGreaterThanOrEqual(1);

    const claudeOnly = searchMessages(db, { query: "bug", providers: ["claude"] });
    const codexOnly = searchMessages(db, { query: "bug", providers: ["codex"] });
    expect(claudeOnly.totalCount).toBeGreaterThanOrEqual(1);
    expect(codexOnly.totalCount).toBe(0);

    const projectMatch = searchMessages(db, { query: "bug", projectQuery: "project" });
    const projectMiss = searchMessages(db, {
      query: "bug",
      projectQuery: "definitely-missing-project",
    });
    expect(projectMatch.totalCount).toBeGreaterThanOrEqual(1);
    expect(projectMiss.totalCount).toBe(0);

    const all = searchMessages(db, { query: "bug" });
    const filtered = searchMessages(db, { query: "bug", categories: ["user"] });
    expect(filtered.totalCount).toBeLessThanOrEqual(all.totalCount);
    expect(filtered.categoryCounts).toEqual(all.categoryCounts);

    db.close();
    cleanup();
  });

  it("returns zero results for empty query", () => {
    const { dbPath, cleanup } = setupIndexedDb();
    const db = openDatabase(dbPath);

    const result = searchMessages(db, { query: "" });
    expect(result.totalCount).toBe(0);
    expect(result.results).toEqual([]);
    expect(Object.values(result.categoryCounts).every((count) => count === 0)).toBe(true);

    db.close();
    cleanup();
  });
});
