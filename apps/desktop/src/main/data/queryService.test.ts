import { describe, expect, it, vi } from "vitest";

import { createInMemoryDatabase } from "@codetrail/core";

import { createQueryServiceFromDb, listProjects } from "./queryService";

function seedQueryDb() {
  const db = createInMemoryDatabase();
  const now = "2026-03-01T10:00:00.000Z";

  db.prepare(
    `INSERT INTO projects (id, provider, name, path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("project_1", "claude", "Project One", "/workspace/project-one", now, now);

  db.prepare(
    `INSERT INTO sessions (
      id,
      project_id,
      provider,
      file_path,
      model_names,
      started_at,
      ended_at,
      duration_ms,
      git_branch,
      cwd,
      message_count,
      token_input_total,
      token_output_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "session_1",
    "project_1",
    "claude",
    "/workspace/project-one/session-1.jsonl",
    "claude-opus-4-1",
    "2026-03-01T10:00:00.000Z",
    "2026-03-01T10:00:05.000Z",
    5000,
    "main",
    "/workspace/project-one",
    2,
    19,
    11,
  );

  db.prepare(
    `INSERT INTO messages (
      id,
      source_id,
      session_id,
      provider,
      category,
      content,
      created_at,
      token_input,
      token_output,
      operation_duration_ms,
      operation_duration_source,
      operation_duration_confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "message_1",
    "source_1",
    "session_1",
    "claude",
    "user",
    "Please inspect query behavior",
    "2026-03-01T10:00:00.000Z",
    null,
    null,
    null,
    null,
    null,
  );

  db.prepare(
    `INSERT INTO messages (
      id,
      source_id,
      session_id,
      provider,
      category,
      content,
      created_at,
      token_input,
      token_output,
      operation_duration_ms,
      operation_duration_source,
      operation_duration_confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "message_2",
    "source_2",
    "session_1",
    "claude",
    "assistant",
    "Query behavior looks stable",
    "2026-03-01T10:00:05.000Z",
    19,
    11,
    5000,
    "native",
    "high",
  );

  db.prepare(
    `INSERT INTO message_fts (message_id, session_id, provider, category, content)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("message_1", "session_1", "claude", "user", "Please inspect query behavior");
  db.prepare(
    `INSERT INTO message_fts (message_id, session_id, provider, category, content)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("message_2", "session_1", "claude", "assistant", "Query behavior looks stable");

  return db;
}

describe("queryService in-memory", () => {
  it("serves list/detail/bookmark flows using createQueryServiceFromDb", () => {
    const db = seedQueryDb();
    const service = createQueryServiceFromDb(db);

    const projects = service.listProjects({ providers: undefined, query: "" });
    expect(projects.projects).toHaveLength(1);
    expect(projects.projects[0]?.id).toBe("project_1");

    const sessions = service.listSessions({ projectId: "project_1" });
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0]?.id).toBe("session_1");

    const detail = service.getSessionDetail({
      sessionId: "session_1",
      page: 0,
      pageSize: 100,
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    expect(detail.totalCount).toBe(2);
    expect(detail.categoryCounts.user).toBe(1);
    expect(detail.categoryCounts.assistant).toBe(1);

    const bookmarked = service.toggleBookmark({
      projectId: "project_1",
      sessionId: "session_1",
      messageId: "message_2",
      messageSourceId: "source_2",
    });
    expect(bookmarked.bookmarked).toBe(true);

    const bookmarks = service.listProjectBookmarks({
      projectId: "project_1",
      query: "stable",
      categories: ["assistant"],
    });
    expect(bookmarks.totalCount).toBe(1);
    expect(bookmarks.filteredCount).toBe(1);
    expect(bookmarks.results[0]?.message.id).toBe("message_2");

    const queryMiss = service.listProjectBookmarks({
      projectId: "project_1",
      query: "not-present",
      categories: undefined,
    });
    expect(queryMiss.totalCount).toBe(1);
    expect(queryMiss.filteredCount).toBe(0);
    expect(queryMiss.results).toEqual([]);

    const unbookmarked = service.toggleBookmark({
      projectId: "project_1",
      sessionId: "session_1",
      messageId: "message_2",
      messageSourceId: "source_2",
    });
    expect(unbookmarked.bookmarked).toBe(false);

    expect(() => service.close()).not.toThrow();
    expect(() => service.close()).not.toThrow();
  });

  it("returns project combined detail sorted by message timestamp", () => {
    const db = createInMemoryDatabase();
    const now = "2026-03-01T10:00:00.000Z";

    db.prepare(
      `INSERT INTO projects (id, provider, name, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("project_1", "claude", "Project One", "/workspace/project-one", now, now);

    db.prepare(
      `INSERT INTO sessions (
        id,
        project_id,
        provider,
        file_path,
        model_names,
        started_at,
        ended_at,
        duration_ms,
        git_branch,
        cwd,
        message_count,
        token_input_total,
        token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "session_new",
      "project_1",
      "claude",
      "/workspace/project-one/session-new.jsonl",
      "claude-opus-4-1",
      "2026-03-01T10:00:00.000Z",
      "2026-03-01T10:15:00.000Z",
      1000,
      "main",
      "/workspace/project-one",
      2,
      0,
      0,
    );
    db.prepare(
      `INSERT INTO sessions (
        id,
        project_id,
        provider,
        file_path,
        model_names,
        started_at,
        ended_at,
        duration_ms,
        git_branch,
        cwd,
        message_count,
        token_input_total,
        token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "session_old",
      "project_1",
      "claude",
      "/workspace/project-one/session-old.jsonl",
      "claude-opus-4-1",
      "2026-03-01T09:00:00.000Z",
      "2026-03-01T09:05:00.000Z",
      1000,
      "main",
      "/workspace/project-one",
      2,
      0,
      0,
    );

    db.prepare(
      `INSERT INTO messages (
        id,
        source_id,
        session_id,
        provider,
        category,
        content,
        created_at,
        token_input,
        token_output,
        operation_duration_ms,
        operation_duration_source,
        operation_duration_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "message_new_1",
      "source_new_1",
      "session_new",
      "claude",
      "user",
      "new session user",
      "2026-03-01T10:00:00.000Z",
      null,
      null,
      null,
      null,
      null,
    );
    db.prepare(
      `INSERT INTO messages (
        id,
        source_id,
        session_id,
        provider,
        category,
        content,
        created_at,
        token_input,
        token_output,
        operation_duration_ms,
        operation_duration_source,
        operation_duration_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "message_new_2",
      "source_new_2",
      "session_new",
      "claude",
      "assistant",
      "new session assistant",
      "2026-03-01T10:01:00.000Z",
      null,
      null,
      null,
      null,
      null,
    );
    db.prepare(
      `INSERT INTO messages (
        id,
        source_id,
        session_id,
        provider,
        category,
        content,
        created_at,
        token_input,
        token_output,
        operation_duration_ms,
        operation_duration_source,
        operation_duration_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "message_old_1",
      "source_old_1",
      "session_old",
      "claude",
      "user",
      "old session user",
      "2026-03-01T09:00:00.000Z",
      null,
      null,
      null,
      null,
      null,
    );
    db.prepare(
      `INSERT INTO messages (
        id,
        source_id,
        session_id,
        provider,
        category,
        content,
        created_at,
        token_input,
        token_output,
        operation_duration_ms,
        operation_duration_source,
        operation_duration_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "message_old_2",
      "source_old_2",
      "session_old",
      "claude",
      "assistant",
      "old session assistant",
      "2026-03-01T09:01:00.000Z",
      null,
      null,
      null,
      null,
      null,
    );

    const service = createQueryServiceFromDb(db);
    const combined = service.getProjectCombinedDetail({
      projectId: "project_1",
      page: 0,
      pageSize: 100,
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });

    expect(combined.totalCount).toBe(4);
    expect(combined.messages.map((message) => message.id)).toEqual([
      "message_old_1",
      "message_old_2",
      "message_new_1",
      "message_new_2",
    ]);
    expect(combined.messages[0]?.sessionTitle).toBe("old session user");
    expect(combined.messages[2]?.sessionTitle).toBe("new session user");
  });

  it("supports injected openDatabase dependency in path-based helpers", () => {
    const db = seedQueryDb();
    const closeSpy = vi.spyOn(db, "close");
    const openDatabase = vi.fn(() => db);

    const result = listProjects(
      "/tmp/ignored.db",
      {
        providers: ["claude"],
        query: "project",
      },
      { openDatabase },
    );

    expect(openDatabase).toHaveBeenCalledWith("/tmp/ignored.db");
    expect(result.projects).toHaveLength(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("selects session titles from user first, assistant second, then first message", () => {
    const db = createInMemoryDatabase();
    const now = "2026-03-01T10:00:00.000Z";

    db.prepare(
      `INSERT INTO projects (id, provider, name, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("project_1", "claude", "Project One", "/workspace/project-one", now, now);

    const insertSession = db.prepare(
      `INSERT INTO sessions (
        id,
        project_id,
        provider,
        file_path,
        model_names,
        started_at,
        ended_at,
        duration_ms,
        git_branch,
        cwd,
        message_count,
        token_input_total,
        token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insertSession.run(
      "session_user_title",
      "project_1",
      "claude",
      "/workspace/project-one/session-user-title.jsonl",
      "claude-opus-4-1",
      now,
      now,
      1,
      "main",
      "/workspace/project-one",
      2,
      0,
      0,
    );
    insertSession.run(
      "session_assistant_title",
      "project_1",
      "claude",
      "/workspace/project-one/session-assistant-title.jsonl",
      "claude-opus-4-1",
      now,
      now,
      1,
      "main",
      "/workspace/project-one",
      2,
      0,
      0,
    );
    insertSession.run(
      "session_first_message_title",
      "project_1",
      "claude",
      "/workspace/project-one/session-first-message-title.jsonl",
      "claude-opus-4-1",
      now,
      now,
      1,
      "main",
      "/workspace/project-one",
      2,
      0,
      0,
    );

    const insertMessage = db.prepare(
      `INSERT INTO messages (
        id,
        source_id,
        session_id,
        provider,
        category,
        content,
        created_at,
        token_input,
        token_output,
        operation_duration_ms,
        operation_duration_source,
        operation_duration_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insertMessage.run(
      "m_u_1",
      "src_u_1",
      "session_user_title",
      "claude",
      "assistant",
      "Assistant message should not win when user exists",
      "2026-03-01T10:00:00.000Z",
      null,
      null,
      null,
      null,
      null,
    );
    insertMessage.run(
      "m_u_2",
      "src_u_2",
      "session_user_title",
      "claude",
      "user",
      "User title wins",
      "2026-03-01T10:00:01.000Z",
      null,
      null,
      null,
      null,
      null,
    );
    insertMessage.run(
      "m_a_1",
      "src_a_1",
      "session_assistant_title",
      "claude",
      "system",
      "System message should not win when assistant exists",
      "2026-03-01T10:00:00.000Z",
      null,
      null,
      null,
      null,
      null,
    );
    insertMessage.run(
      "m_a_2",
      "src_a_2",
      "session_assistant_title",
      "claude",
      "assistant",
      "Assistant title wins",
      "2026-03-01T10:00:01.000Z",
      null,
      null,
      null,
      null,
      null,
    );
    insertMessage.run(
      "m_f_1",
      "src_f_1",
      "session_first_message_title",
      "claude",
      "system",
      "First message title wins",
      "2026-03-01T10:00:00.000Z",
      null,
      null,
      null,
      null,
      null,
    );
    insertMessage.run(
      "m_f_2",
      "src_f_2",
      "session_first_message_title",
      "claude",
      "tool_result",
      "Second message should not win",
      "2026-03-01T10:00:01.000Z",
      null,
      null,
      null,
      null,
      null,
    );

    const service = createQueryServiceFromDb(db);
    const sessions = service.listSessions({ projectId: "project_1" });
    const byId = new Map(sessions.sessions.map((session) => [session.id, session.title]));

    expect(byId.get("session_user_title")).toBe("User title wins");
    expect(byId.get("session_assistant_title")).toBe("Assistant title wins");
    expect(byId.get("session_first_message_title")).toBe("First message title wins");
  });
});
