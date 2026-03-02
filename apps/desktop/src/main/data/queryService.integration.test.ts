import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, runIncrementalIndexing } from "@codetrail/core";
import { describe, expect, it } from "vitest";

import {
  getSessionDetail,
  listProjectBookmarks,
  listProjects,
  listSessions,
  runSearchQuery,
  toggleBookmark,
} from "./queryService";

type MessageProjectRow = {
  id: string;
  source_id: string;
  session_id: string;
  project_id: string;
  created_at: string;
};

function setupIndexedDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "codetrail-query-service-"));
  const dbPath = join(dir, "index.db");

  const claudeRoot = join(dir, ".claude", "projects");
  const claudeProject = join(claudeRoot, "-tmp-query-project");
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
          content: [{ type: "text", text: "Please inspect parser behavior quickly." }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "c-a-1",
        timestamp: "2026-02-27T10:00:05Z",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          usage: { input_tokens: 19, output_tokens: 11 },
          content: [
            { type: "thinking", thinking: "I should inspect edge cases first." },
            { type: "text", text: "Parser behavior inspected and fixed." },
            { type: "tool_use", name: "Read", input: { file_path: "src/parser.ts" } },
          ],
        },
      }),
      JSON.stringify({
        type: "summary",
        uuid: "c-s-1",
        timestamp: "2026-02-27T10:00:06Z",
        summary: "Parser behavior fixed and tool call used.",
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
          id: "x-u-1",
          role: "user",
          content: [{ type: "input_text", text: "Check path matching implementation." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-27T11:00:02Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "x-a-1",
          role: "assistant",
          content: [{ type: "output_text", text: "Path matching optimized." }],
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

describe("queryService", () => {
  it("lists projects and sessions with provider/text filters", () => {
    const { dbPath, cleanup } = setupIndexedDb();

    const allProjects = listProjects(dbPath, { providers: undefined, query: "" });
    expect(allProjects.projects.length).toBe(2);
    expect(allProjects.projects.every((project) => project.sessionCount >= 1)).toBe(true);

    const claudeOnly = listProjects(dbPath, { providers: ["claude"], query: "" });
    expect(claudeOnly.projects.length).toBe(1);
    expect(claudeOnly.projects[0]?.provider).toBe("claude");

    const noProvidersSelected = listProjects(dbPath, { providers: [], query: "" });
    expect(noProvidersSelected.projects).toEqual([]);

    const textFiltered = listProjects(dbPath, { providers: undefined, query: "workspace/codex" });
    expect(textFiltered.projects.length).toBe(1);

    const codexProjectId = allProjects.projects.find((project) => project.provider === "codex")?.id;
    if (!codexProjectId) {
      throw new Error("Missing codex project id");
    }

    const codexSessions = listSessions(dbPath, { projectId: codexProjectId });
    expect(codexSessions.sessions.length).toBe(1);
    expect(codexSessions.sessions[0]?.provider).toBe("codex");

    cleanup();
  });

  it("returns session detail with pagination, category/query filters, and focus targeting", () => {
    const { dbPath, cleanup } = setupIndexedDb();

    const db = openDatabase(dbPath);
    const claudeSessionIdRow = db
      .prepare("SELECT id FROM sessions WHERE provider = 'claude'")
      .get() as { id: string } | undefined;
    if (!claudeSessionIdRow) {
      db.close();
      throw new Error("Missing claude session");
    }
    const focusSourceRow = db
      .prepare(
        "SELECT id, source_id FROM messages WHERE session_id = ? AND content LIKE '%fixed%' LIMIT 1",
      )
      .get(claudeSessionIdRow.id) as
      | {
          id: string;
          source_id: string;
        }
      | undefined;
    db.close();

    const page = getSessionDetail(dbPath, {
      sessionId: claudeSessionIdRow.id,
      page: 0,
      pageSize: 2,
      sortDirection: "asc",
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    expect(page.session?.id).toBe(claudeSessionIdRow.id);
    expect(page.totalCount).toBeGreaterThanOrEqual(3);
    expect(page.categoryCounts.user).toBeGreaterThanOrEqual(1);
    expect(page.categoryCounts.assistant).toBeGreaterThanOrEqual(1);
    expect(page.messages.length).toBe(2);
    const timedMessage = page.messages.find(
      (message) =>
        message.operationDurationConfidence === "high" && message.operationDurationMs !== null,
    );
    expect(timedMessage?.operationDurationMs).toBeGreaterThan(0);

    const filtered = getSessionDetail(dbPath, {
      sessionId: claudeSessionIdRow.id,
      page: 0,
      pageSize: 100,
      sortDirection: "asc",
      categories: ["tool_call"],
      query: "Read",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    expect(filtered.totalCount).toBe(1);
    expect(filtered.categoryCounts.tool_use).toBeGreaterThanOrEqual(1);
    expect(filtered.messages[0]?.category).toBe("tool_use");

    const noCategoriesSelected = getSessionDetail(dbPath, {
      sessionId: claudeSessionIdRow.id,
      page: 0,
      pageSize: 100,
      sortDirection: "asc",
      categories: [],
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    expect(noCategoriesSelected.totalCount).toBe(0);
    expect(noCategoriesSelected.messages).toEqual([]);
    expect(noCategoriesSelected.categoryCounts.user).toBeGreaterThanOrEqual(1);

    if (!focusSourceRow) {
      cleanup();
      throw new Error("Missing focus source row");
    }

    const focused = getSessionDetail(dbPath, {
      sessionId: claudeSessionIdRow.id,
      page: 0,
      pageSize: 1,
      sortDirection: "asc",
      categories: undefined,
      query: "",
      focusMessageId: focusSourceRow.id,
      focusSourceId: focusSourceRow.source_id,
    });
    expect(focused.focusIndex).not.toBeNull();
    expect(focused.page).toBeGreaterThanOrEqual(0);
    expect(focused.messages.length).toBe(1);
    expect(focused.messages[0]?.sourceId).toBe(focusSourceRow.source_id);

    cleanup();
  });

  it("runs search queries with filter and facet parity", () => {
    const { dbPath, cleanup } = setupIndexedDb();

    const all = runSearchQuery(dbPath, {
      query: "parser",
      categories: undefined,
      providers: undefined,
      projectIds: undefined,
      projectQuery: "",
      limit: 50,
      offset: 0,
    });
    expect(all.totalCount).toBeGreaterThanOrEqual(1);
    expect(all.results.length).toBeGreaterThanOrEqual(1);
    expect(all.results[0]?.messageSourceId.length).toBeGreaterThan(0);

    const filtered = runSearchQuery(dbPath, {
      query: "parser",
      categories: ["assistant"],
      providers: ["claude"],
      projectIds: undefined,
      projectQuery: "",
      limit: 50,
      offset: 0,
    });
    expect(filtered.totalCount).toBeGreaterThanOrEqual(1);
    expect(filtered.categoryCounts).toEqual(all.categoryCounts);

    cleanup();
  });

  it("toggles and lists project bookmarks with category filtering", () => {
    const { dbPath, cleanup } = setupIndexedDb();

    const db = openDatabase(dbPath);
    const target = db
      .prepare(
        `SELECT m.id, m.source_id, m.session_id, s.project_id
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE m.provider = 'claude' AND m.category = 'assistant'
         LIMIT 1`,
      )
      .get() as
      | {
          id: string;
          source_id: string;
          session_id: string;
          project_id: string;
        }
      | undefined;
    db.close();

    if (!target) {
      cleanup();
      throw new Error("Missing bookmark target message");
    }

    const firstToggle = toggleBookmark(dbPath, {
      projectId: target.project_id,
      sessionId: target.session_id,
      messageId: target.id,
      messageSourceId: target.source_id,
    });
    expect(firstToggle.bookmarked).toBe(true);

    const listed = listProjectBookmarks(dbPath, {
      projectId: target.project_id,
      query: "",
      categories: undefined,
    });
    expect(listed.totalCount).toBe(1);
    expect(listed.filteredCount).toBe(1);
    expect(listed.results[0]?.message.id).toBe(target.id);

    const queried = listProjectBookmarks(dbPath, {
      projectId: target.project_id,
      query: "fixed",
      categories: undefined,
    });
    expect(queried.totalCount).toBe(1);
    expect(queried.filteredCount).toBe(1);
    expect(queried.results[0]?.message.id).toBe(target.id);

    const queryMiss = listProjectBookmarks(dbPath, {
      projectId: target.project_id,
      query: "no-match-token",
      categories: undefined,
    });
    expect(queryMiss.totalCount).toBe(1);
    expect(queryMiss.filteredCount).toBe(0);
    expect(queryMiss.categoryCounts.assistant).toBe(0);
    expect(queryMiss.results).toEqual([]);

    const filteredOut = listProjectBookmarks(dbPath, {
      projectId: target.project_id,
      query: "",
      categories: ["tool_use"],
    });
    expect(filteredOut.totalCount).toBe(1);
    expect(filteredOut.filteredCount).toBe(0);
    expect(filteredOut.results).toEqual([]);

    const secondToggle = toggleBookmark(dbPath, {
      projectId: target.project_id,
      sessionId: target.session_id,
      messageId: target.id,
      messageSourceId: target.source_id,
    });
    expect(secondToggle.bookmarked).toBe(false);

    const afterDelete = listProjectBookmarks(dbPath, {
      projectId: target.project_id,
      query: "",
      categories: undefined,
    });
    expect(afterDelete.totalCount).toBe(0);
    expect(afterDelete.filteredCount).toBe(0);
    expect(afterDelete.results).toEqual([]);

    cleanup();
  });

  it("orders project bookmarks by message created_at descending", () => {
    const { dbPath, cleanup } = setupIndexedDb();

    const db = openDatabase(dbPath);
    const rows = db
      .prepare(
        `SELECT m.id, m.source_id, m.session_id, s.project_id, m.created_at
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.provider = 'claude'
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT 2`,
      )
      .all() as MessageProjectRow[];
    db.close();

    if (rows.length < 2) {
      cleanup();
      throw new Error("Missing bookmark ordering test rows");
    }

    const older = rows[0];
    const newer = rows[1];
    if (!older || !newer) {
      cleanup();
      throw new Error("Missing bookmark ordering rows");
    }

    const first = toggleBookmark(dbPath, {
      projectId: newer.project_id,
      sessionId: newer.session_id,
      messageId: newer.id,
      messageSourceId: newer.source_id,
    });
    expect(first.bookmarked).toBe(true);

    const second = toggleBookmark(dbPath, {
      projectId: older.project_id,
      sessionId: older.session_id,
      messageId: older.id,
      messageSourceId: older.source_id,
    });
    expect(second.bookmarked).toBe(true);

    const listed = listProjectBookmarks(dbPath, {
      projectId: older.project_id,
      query: "",
      categories: undefined,
    });
    expect(listed.totalCount).toBe(2);
    expect(listed.results[0]?.message.id).toBe(newer.id);
    expect(listed.results[1]?.message.id).toBe(older.id);

    cleanup();
  });

  it("refuses bookmark toggle when payload does not match message identity", () => {
    const { dbPath, cleanup } = setupIndexedDb();

    const db = openDatabase(dbPath);
    const target = db
      .prepare(
        `SELECT m.id, m.source_id, m.session_id, s.project_id, m.created_at
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT 1`,
      )
      .get() as MessageProjectRow | undefined;
    const alternateProject = db
      .prepare("SELECT id FROM projects WHERE id != ? LIMIT 1")
      .get(target?.project_id ?? "") as { id: string } | undefined;
    db.close();

    if (!target || !alternateProject) {
      cleanup();
      throw new Error("Missing toggle validation rows");
    }

    const wrongProject = toggleBookmark(dbPath, {
      projectId: alternateProject.id,
      sessionId: target.session_id,
      messageId: target.id,
      messageSourceId: target.source_id,
    });
    expect(wrongProject.bookmarked).toBe(false);

    const wrongSource = toggleBookmark(dbPath, {
      projectId: target.project_id,
      sessionId: target.session_id,
      messageId: target.id,
      messageSourceId: `${target.source_id}-bad`,
    });
    expect(wrongSource.bookmarked).toBe(false);

    const listed = listProjectBookmarks(dbPath, {
      projectId: target.project_id,
      query: "",
      categories: undefined,
    });
    expect(listed.totalCount).toBe(0);

    cleanup();
  });

  it("keeps stale bookmarks and marks them orphaned when backing messages disappear", () => {
    const { dbPath, cleanup } = setupIndexedDb();

    const db = openDatabase(dbPath);
    const target = db
      .prepare(
        `SELECT m.id, m.source_id, m.session_id, s.project_id, m.created_at
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.provider = 'claude'
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 1`,
      )
      .get() as MessageProjectRow | undefined;
    db.close();

    if (!target) {
      cleanup();
      throw new Error("Missing stale bookmark target");
    }

    const toggled = toggleBookmark(dbPath, {
      projectId: target.project_id,
      sessionId: target.session_id,
      messageId: target.id,
      messageSourceId: target.source_id,
    });
    expect(toggled.bookmarked).toBe(true);

    const dbMutate = openDatabase(dbPath);
    dbMutate.pragma("foreign_keys = OFF");
    dbMutate.prepare("DELETE FROM message_fts WHERE message_id = ?").run(target.id);
    dbMutate.prepare("DELETE FROM messages WHERE id = ?").run(target.id);
    dbMutate.close();

    const listed = listProjectBookmarks(dbPath, {
      projectId: target.project_id,
      categories: undefined,
    });
    expect(listed.totalCount).toBe(1);
    expect(listed.filteredCount).toBe(1);
    expect(listed.results[0]?.message.id).toBe(target.id);
    expect(listed.results[0]?.isOrphaned).toBe(true);
    expect(listed.results[0]?.orphanedAt).toBeNull();

    const unbookmarked = toggleBookmark(dbPath, {
      projectId: target.project_id,
      sessionId: target.session_id,
      messageId: target.id,
      messageSourceId: target.source_id,
    });
    expect(unbookmarked.bookmarked).toBe(false);

    const afterDelete = listProjectBookmarks(dbPath, {
      projectId: target.project_id,
      query: "",
      categories: undefined,
    });
    expect(afterDelete.totalCount).toBe(0);
    expect(afterDelete.results).toEqual([]);

    cleanup();
  });
});
