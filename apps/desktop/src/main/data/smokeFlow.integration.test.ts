import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runIncrementalIndexing } from "@codetrail/core";
import { describe, expect, it } from "vitest";

import { getSessionDetail, listProjects, listSessions, runSearchQuery } from "./queryService";

describe("desktop smoke flow", () => {
  it("supports discovery to index to search to open session detail at focus message", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-smoke-flow-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "-tmp-smoke-project");
    mkdirSync(claudeProject, { recursive: true });

    writeFileSync(
      join(claudeProject, "smoke-session-1.jsonl"),
      `${[
        JSON.stringify({
          type: "user",
          uuid: "u-1",
          timestamp: "2026-02-27T10:00:00Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "Please run smoke flow checks." }],
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "a-1",
          timestamp: "2026-02-27T10:00:05Z",
          message: {
            role: "assistant",
            model: "claude-opus-4-6",
            usage: { input_tokens: 10, output_tokens: 8 },
            content: [{ type: "text", text: "Smoke flow marker: open-session-target." }],
          },
        }),
      ].join("\n")}\n`,
    );

    const indexing = runIncrementalIndexing({
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

    expect(indexing.discoveredFiles).toBe(1);
    expect(indexing.indexedFiles).toBe(1);

    const projectsResponse = listProjects(dbPath, {
      query: "",
      providers: undefined,
    });
    expect(projectsResponse.projects.length).toBe(1);
    const project = projectsResponse.projects[0];
    if (!project) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error("Missing indexed project");
    }

    const sessionsResponse = listSessions(dbPath, { projectId: project.id });
    expect(sessionsResponse.sessions.length).toBe(1);
    const session = sessionsResponse.sessions[0];
    if (!session) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error("Missing indexed session");
    }

    const searchResponse = runSearchQuery(dbPath, {
      query: "open-session-target",
      categories: undefined,
      providers: undefined,
      projectIds: undefined,
      projectQuery: "",
      limit: 20,
      offset: 0,
    });

    expect(searchResponse.totalCount).toBe(1);
    const result = searchResponse.results[0];
    if (!result) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error("Missing search result");
    }

    expect(result.sessionId).toBe(session.id);

    const detailResponse = getSessionDetail(dbPath, {
      sessionId: result.sessionId,
      page: 0,
      pageSize: 1,
      sortDirection: "asc",
      categories: undefined,
      query: "",
      focusSourceId: result.messageSourceId,
    });

    expect(detailResponse.session?.id).toBe(result.sessionId);
    expect(detailResponse.focusIndex).not.toBeNull();
    expect(detailResponse.messages.length).toBe(1);
    expect(detailResponse.messages[0]?.sourceId).toBe(result.messageSourceId);

    rmSync(dir, { recursive: true, force: true });
  });
});
