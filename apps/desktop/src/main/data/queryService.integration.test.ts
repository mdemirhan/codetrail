import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, runIncrementalIndexing } from "@codetrail/core";
import { describe, expect, it } from "vitest";

import { getSessionDetail, listProjects, listSessions, runSearchQuery } from "./queryService";

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

    const filtered = getSessionDetail(dbPath, {
      sessionId: claudeSessionIdRow.id,
      page: 0,
      pageSize: 100,
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
});
