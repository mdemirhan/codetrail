import { describe, expect, it, vi } from "vitest";

import { createInMemoryDatabase } from "@codetrail/core";

import type { BookmarkStore } from "./bookmarkStore";
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

  db.prepare(
    `INSERT INTO indexed_files (
      file_path,
      provider,
      project_path,
      session_identity,
      file_size,
      file_mtime_ms,
      indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "/workspace/project-one/session-1.jsonl",
    "claude",
    "/workspace/project-one",
    "claude:session_1",
    512,
    Date.parse("2026-03-01T10:00:05.000Z"),
    now,
  );

  db.prepare(
    `INSERT INTO index_checkpoints (
      file_path,
      provider,
      session_id,
      session_identity,
      file_size,
      file_mtime_ms,
      last_offset_bytes,
      last_line_number,
      last_event_index,
      next_message_sequence,
      processing_state_json,
      source_metadata_json,
      head_hash,
      tail_hash,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "/workspace/project-one/session-1.jsonl",
    "claude",
    "session_1",
    "claude:session_1",
    512,
    Date.parse("2026-03-01T10:00:05.000Z"),
    512,
    1,
    1,
    2,
    JSON.stringify({
      pendingToolCallById: {},
      previousMessageRole: "assistant",
      previousTimestamp: "2026-03-01T10:00:05.000Z",
      aggregate: {
        startedAt: "2026-03-01T10:00:00.000Z",
        endedAt: "2026-03-01T10:00:05.000Z",
        messageCount: 2,
      },
    }),
    JSON.stringify({
      models: ["claude-opus-4-1"],
      cwd: "/workspace/project-one",
      gitBranch: "main",
    }),
    "head-1",
    "tail-1",
    now,
  );

  return db;
}

function createBookmarkStoreMock(overrides: Partial<BookmarkStore> = {}): BookmarkStore {
  return {
    listProjectBookmarks: vi.fn((_projectId: string, _options?: unknown) => []),
    getProjectBookmarkFocusIndex: vi.fn(
      (
        _projectId: string,
        _target: { messageId?: string; messageSourceId?: string },
        _options?: unknown,
      ) => null,
    ),
    countProjectBookmarks: vi.fn((_projectId: string, _options?: unknown) => 0),
    listProjectBookmarkMessageIds: vi.fn((_projectId: string, _messageIds: string[]) => []),
    countProjectBookmarkCategories: vi.fn(() => ({
      user: 0,
      assistant: 0,
      tool_use: 0,
      tool_edit: 0,
      tool_result: 0,
      thinking: 0,
      system: 0,
    })),
    countSessionBookmarks: vi.fn(() => 0),
    getBookmark: vi.fn(() => null),
    upsertBookmark: vi.fn(),
    removeBookmark: vi.fn(() => false),
    removeProjectBookmarks: vi.fn(() => 0),
    removeSessionBookmarks: vi.fn(() => 0),
    reconcileWithIndexedData: vi.fn(() => ({
      deletedMissingProjects: 0,
      markedOrphaned: 0,
      restored: 0,
    })),
    close: vi.fn(),
    ...overrides,
  };
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
      sortDirection: "asc",
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    expect(detail.totalCount).toBe(2);
    expect(detail.categoryCounts.user).toBe(1);
    expect(detail.categoryCounts.assistant).toBe(1);
    expect(detail.messages.map((message) => message.id)).toEqual(["message_1", "message_2"]);

    const detailDesc = service.getSessionDetail({
      sessionId: "session_1",
      page: 0,
      pageSize: 100,
      sortDirection: "desc",
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    expect(detailDesc.messages.map((message) => message.id)).toEqual(["message_2", "message_1"]);

    const detailWildcard = service.getSessionDetail({
      sessionId: "session_1",
      page: 0,
      pageSize: 100,
      sortDirection: "asc",
      categories: undefined,
      query: "stab*",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    expect(detailWildcard.totalCount).toBe(1);
    expect(detailWildcard.messages.map((message) => message.id)).toEqual(["message_2"]);

    const bookmarked = service.toggleBookmark({
      projectId: "project_1",
      sessionId: "session_1",
      messageId: "message_2",
      messageSourceId: "source_2",
    });
    expect(bookmarked.bookmarked).toBe(true);

    const bookmarks = service.listProjectBookmarks({
      projectId: "project_1",
      page: 0,
      pageSize: 100,
      query: "stable",
      categories: ["assistant"],
    });
    expect(bookmarks.totalCount).toBe(1);
    expect(bookmarks.filteredCount).toBe(1);
    expect(bookmarks.results[0]?.message.id).toBe("message_2");

    const queryMiss = service.listProjectBookmarks({
      projectId: "project_1",
      page: 0,
      pageSize: 100,
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
        title,
        model_names,
        started_at,
        ended_at,
        duration_ms,
        git_branch,
        cwd,
        message_count,
        token_input_total,
        token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "session_new",
      "project_1",
      "claude",
      "/workspace/project-one/session-new.jsonl",
      "new session user",
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
        title,
        model_names,
        started_at,
        ended_at,
        duration_ms,
        git_branch,
        cwd,
        message_count,
        token_input_total,
        token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "session_old",
      "project_1",
      "claude",
      "/workspace/project-one/session-old.jsonl",
      "old session user",
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
      sortDirection: "asc",
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

    const combinedDesc = service.getProjectCombinedDetail({
      projectId: "project_1",
      page: 0,
      pageSize: 100,
      sortDirection: "desc",
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    expect(combinedDesc.messages.map((message) => message.id)).toEqual([
      "message_new_2",
      "message_new_1",
      "message_old_2",
      "message_old_1",
    ]);
  });

  it("returns cursor provider entries from project listings", () => {
    const db = createInMemoryDatabase();
    const now = "2026-03-01T10:00:00.000Z";

    db.prepare(
      `INSERT INTO projects (id, provider, name, path, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "project_cursor",
      "cursor",
      "Cursor Project",
      "/workspace/cursor-project",
      '{"workspaceId":"cursor-workspace"}',
      now,
      now,
    );
    db.prepare(
      `INSERT INTO sessions (
        id,
        project_id,
        provider,
        file_path,
        model_names,
        metadata_json,
        message_count,
        token_input_total,
        token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "session_cursor",
      "project_cursor",
      "cursor",
      "/workspace/cursor-project/session-1.jsonl",
      "",
      '{"composerId":"composer-1"}',
      0,
      0,
      0,
    );

    const service = createQueryServiceFromDb(db);
    const projects = service.listProjects({ providers: undefined, query: "" });
    const sessions = service.listSessions({ projectId: "project_cursor" });
    expect(projects.projects).toEqual([
      {
        id: "project_cursor",
        provider: "cursor",
        name: "Cursor Project",
        path: "/workspace/cursor-project",
        providerProjectKey: null,
        repositoryUrl: null,
        resolutionState: null,
        resolutionSource: null,
        metadataJson: '{"workspaceId":"cursor-workspace"}',
        sessionCount: 1,
        messageCount: 0,
        bookmarkCount: 0,
        lastActivity: null,
      },
    ]);
    expect(sessions.sessions[0]?.metadataJson).toBe('{"composerId":"composer-1"}');
  });

  it("includes bookmark counts in project and session listings", () => {
    const db = seedQueryDb();
    const bookmarkStore = createBookmarkStoreMock({
      countProjectBookmarks: vi.fn((projectId: string) => (projectId === "project_1" ? 4 : 0)),
      countSessionBookmarks: vi.fn((projectId: string, sessionId: string) =>
        projectId === "project_1" && sessionId === "session_1" ? 2 : 0,
      ),
    });
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    const projects = service.listProjects({ providers: undefined, query: "" });
    const sessions = service.listSessions({ projectId: "project_1" });

    expect(projects.projects[0]?.bookmarkCount).toBe(4);
    expect(sessions.sessions[0]?.bookmarkCount).toBe(2);
    expect(bookmarkStore.countProjectBookmarks).toHaveBeenCalledWith("project_1");
    expect(bookmarkStore.countSessionBookmarks).toHaveBeenCalledWith("project_1", "session_1");
  });

  it("pages bookmarks and clamps out-of-range bookmark pages", () => {
    const db = seedQueryDb();
    const bookmarkStore = createBookmarkStoreMock({
      countProjectBookmarks: vi.fn((projectId: string, options?: unknown) => {
        const typedOptions =
          typeof options === "object" && options !== null
            ? (options as { categories?: string[] })
            : {};
        if (projectId !== "project_1") {
          return 0;
        }
        return typedOptions.categories?.includes("assistant") ? 1 : 2;
      }),
      countProjectBookmarkCategories: vi.fn(() => ({
        user: 1,
        assistant: 1,
        tool_use: 0,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      })),
      listProjectBookmarks: vi.fn((projectId: string, options?: unknown) => {
        const typedOptions =
          typeof options === "object" && options !== null ? (options as { offset?: number }) : {};
        if (projectId !== "project_1") {
          return [];
        }
        const rows = [
          {
            project_id: "project_1",
            session_id: "session_1",
            message_id: "message_2",
            message_source_id: "source_2",
            provider: "claude" as const,
            session_title: "Session one",
            message_category: "assistant" as const,
            message_content: "Query behavior looks stable",
            message_created_at: "2026-03-01T10:00:05.000Z",
            bookmarked_at: "2026-03-01T10:01:00.000Z",
            is_orphaned: 0,
            orphaned_at: null,
            snapshot_version: 1,
            snapshot_json: "{}",
          },
          {
            project_id: "project_1",
            session_id: "session_1",
            message_id: "message_1",
            message_source_id: "source_1",
            provider: "claude" as const,
            session_title: "Session one",
            message_category: "user" as const,
            message_content: "Please inspect query behavior",
            message_created_at: "2026-03-01T10:00:00.000Z",
            bookmarked_at: "2026-03-01T10:00:30.000Z",
            is_orphaned: 0,
            orphaned_at: null,
            snapshot_version: 1,
            snapshot_json: "{}",
          },
        ];
        return rows.slice(typedOptions.offset ?? 0, (typedOptions.offset ?? 0) + 1);
      }),
    });
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    const secondPage = service.listProjectBookmarks({
      projectId: "project_1",
      page: 1,
      pageSize: 1,
      query: "",
      categories: undefined,
    });
    expect(secondPage.page).toBe(1);
    expect(secondPage.totalCount).toBe(2);
    expect(secondPage.filteredCount).toBe(2);
    expect(secondPage.results[0]?.message.id).toBe("message_1");

    const clampedPage = service.listProjectBookmarks({
      projectId: "project_1",
      page: 5,
      pageSize: 1,
      query: "",
      categories: ["assistant"],
    });
    expect(clampedPage.page).toBe(0);
    expect(clampedPage.filteredCount).toBe(1);
    expect(clampedPage.categoryCounts.assistant).toBe(1);
  });

  it("supports count-only bookmark requests without loading bookmark rows", () => {
    const db = seedQueryDb();
    const bookmarkStore = createBookmarkStoreMock({
      countProjectBookmarks: vi.fn((projectId: string, options?: unknown) => {
        const typedOptions =
          typeof options === "object" && options !== null ? (options as { query?: string }) : {};
        if (projectId !== "project_1") {
          return 0;
        }
        return typedOptions.query === "stable" ? 1 : 2;
      }),
      countProjectBookmarkCategories: vi.fn(() => ({
        user: 1,
        assistant: 1,
        tool_use: 0,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      })),
      listProjectBookmarks: vi.fn(() => {
        throw new Error("countOnly should not load bookmark rows");
      }),
    });
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    const response = service.listProjectBookmarks({
      projectId: "project_1",
      page: 0,
      pageSize: 1,
      countOnly: true,
      query: "stable",
      categories: undefined,
    });

    expect(response.totalCount).toBe(2);
    expect(response.filteredCount).toBe(1);
    expect(response.results).toEqual([]);
    expect(bookmarkStore.listProjectBookmarks).not.toHaveBeenCalled();
  });

  it("applies bookmark sort direction before bookmark pagination", () => {
    const db = seedQueryDb();
    const bookmarkStore = createBookmarkStoreMock({
      countProjectBookmarks: vi.fn((projectId: string) => (projectId === "project_1" ? 3 : 0)),
      countProjectBookmarkCategories: vi.fn(() => ({
        user: 1,
        assistant: 2,
        tool_use: 0,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      })),
      listProjectBookmarks: vi.fn((projectId: string, options?: unknown) => {
        const typedOptions =
          typeof options === "object" && options !== null
            ? (options as { sortDirection?: "asc" | "desc"; limit?: number; offset?: number })
            : {};
        if (projectId !== "project_1") {
          return [];
        }
        const descRows = [
          {
            project_id: "project_1",
            session_id: "session_1",
            message_id: "message_3",
            message_source_id: "source_3",
            provider: "claude" as const,
            session_title: "Session one",
            message_category: "assistant" as const,
            message_content: "Newest bookmark",
            message_created_at: "2026-03-01T10:00:10.000Z",
            bookmarked_at: "2026-03-01T10:01:10.000Z",
            is_orphaned: 0,
            orphaned_at: null,
            snapshot_version: 1,
            snapshot_json: "{}",
          },
          {
            project_id: "project_1",
            session_id: "session_1",
            message_id: "message_2",
            message_source_id: "source_2",
            provider: "claude" as const,
            session_title: "Session one",
            message_category: "assistant" as const,
            message_content: "Middle bookmark",
            message_created_at: "2026-03-01T10:00:05.000Z",
            bookmarked_at: "2026-03-01T10:01:05.000Z",
            is_orphaned: 0,
            orphaned_at: null,
            snapshot_version: 1,
            snapshot_json: "{}",
          },
          {
            project_id: "project_1",
            session_id: "session_1",
            message_id: "message_1",
            message_source_id: "source_1",
            provider: "claude" as const,
            session_title: "Session one",
            message_category: "user" as const,
            message_content: "Oldest bookmark",
            message_created_at: "2026-03-01T10:00:00.000Z",
            bookmarked_at: "2026-03-01T10:01:00.000Z",
            is_orphaned: 0,
            orphaned_at: null,
            snapshot_version: 1,
            snapshot_json: "{}",
          },
        ];
        const rows = typedOptions.sortDirection === "asc" ? [...descRows].reverse() : descRows;
        const offset = typedOptions.offset ?? 0;
        const limit = typedOptions.limit ?? rows.length;
        return rows.slice(offset, offset + limit);
      }),
    });
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    const firstAscPage = service.listProjectBookmarks({
      projectId: "project_1",
      page: 0,
      pageSize: 1,
      sortDirection: "asc",
      query: "",
      categories: undefined,
    });
    const firstDescPage = service.listProjectBookmarks({
      projectId: "project_1",
      page: 0,
      pageSize: 1,
      sortDirection: "desc",
      query: "",
      categories: undefined,
    });

    expect(firstAscPage.results[0]?.message.id).toBe("message_1");
    expect(firstDescPage.results[0]?.message.id).toBe("message_3");
    expect(bookmarkStore.listProjectBookmarks).toHaveBeenCalledWith(
      "project_1",
      expect.objectContaining({
        sortDirection: "asc",
        limit: 1,
        offset: 0,
      }),
    );
  });

  it("repositions bookmark pagination to reveal the focused bookmark", () => {
    const db = seedQueryDb();
    const bookmarkStore = createBookmarkStoreMock({
      countProjectBookmarks: vi.fn((projectId: string) => (projectId === "project_1" ? 3 : 0)),
      getProjectBookmarkFocusIndex: vi.fn(() => 1),
      countProjectBookmarkCategories: vi.fn(() => ({
        user: 1,
        assistant: 2,
        tool_use: 0,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      })),
      listProjectBookmarks: vi.fn((projectId: string, options?: unknown) => {
        const typedOptions =
          typeof options === "object" && options !== null
            ? (options as {
                sortDirection?: "asc" | "desc";
                limit?: number;
                offset?: number;
              })
            : {};
        if (projectId !== "project_1") {
          return [];
        }
        const rows = [
          {
            project_id: "project_1",
            session_id: "session_1",
            message_id: "message_1",
            message_source_id: "source_1",
            provider: "claude" as const,
            session_title: "Session one",
            message_category: "user" as const,
            message_content: "Oldest bookmark",
            message_created_at: "2026-03-01T10:00:00.000Z",
            bookmarked_at: "2026-03-01T10:01:00.000Z",
            is_orphaned: 0,
            orphaned_at: null,
            snapshot_version: 1,
            snapshot_json: "{}",
          },
          {
            project_id: "project_1",
            session_id: "session_1",
            message_id: "message_2",
            message_source_id: "source_2",
            provider: "claude" as const,
            session_title: "Session one",
            message_category: "assistant" as const,
            message_content: "Middle bookmark",
            message_created_at: "2026-03-01T10:00:05.000Z",
            bookmarked_at: "2026-03-01T10:01:05.000Z",
            is_orphaned: 0,
            orphaned_at: null,
            snapshot_version: 1,
            snapshot_json: "{}",
          },
          {
            project_id: "project_1",
            session_id: "session_1",
            message_id: "message_3",
            message_source_id: "source_3",
            provider: "claude" as const,
            session_title: "Session one",
            message_category: "assistant" as const,
            message_content: "Newest bookmark",
            message_created_at: "2026-03-01T10:00:10.000Z",
            bookmarked_at: "2026-03-01T10:01:10.000Z",
            is_orphaned: 0,
            orphaned_at: null,
            snapshot_version: 1,
            snapshot_json: "{}",
          },
        ];
        const orderedRows = typedOptions.sortDirection === "desc" ? [...rows].reverse() : rows;
        const offset = typedOptions.offset ?? 0;
        const limit = typedOptions.limit ?? orderedRows.length;
        return orderedRows.slice(offset, offset + limit);
      }),
    });
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    const response = service.listProjectBookmarks({
      projectId: "project_1",
      page: 0,
      pageSize: 1,
      sortDirection: "asc",
      query: "",
      categories: undefined,
      focusMessageId: "message_2",
    });

    expect(response.page).toBe(1);
    expect(response.results[0]?.message.id).toBe("message_2");
    expect(bookmarkStore.getProjectBookmarkFocusIndex).toHaveBeenCalledWith(
      "project_1",
      {
        messageId: "message_2",
        messageSourceId: undefined,
      },
      expect.objectContaining({
        sortDirection: "asc",
      }),
    );
    expect(bookmarkStore.listProjectBookmarks).toHaveBeenNthCalledWith(
      1,
      "project_1",
      expect.objectContaining({
        sortDirection: "asc",
        limit: 1,
        offset: 1,
      }),
    );
  });

  it("lists sessions for multiple projects in grouped activity order with bookmark counts", () => {
    const db = seedQueryDb();
    const now = "2026-03-01T10:00:00.000Z";

    db.prepare(
      `INSERT INTO projects (id, provider, name, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("project_2", "claude", "Project Two", "/workspace/project-two", now, now);

    const insertSession = db.prepare(
      `INSERT INTO sessions (
        id, project_id, provider, file_path, title, model_names, started_at, ended_at,
        duration_ms, git_branch, cwd, message_count, token_input_total, token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insertSession.run(
      "session_older",
      "project_1",
      "claude",
      "/workspace/project-one/session-older.jsonl",
      "Older session",
      "claude-opus-4-1",
      "2026-03-01T09:00:00.000Z",
      "2026-03-01T09:30:00.000Z",
      1800000,
      "main",
      "/workspace/project-one",
      1,
      0,
      0,
    );
    insertSession.run(
      "session_project_2",
      "project_2",
      "claude",
      "/workspace/project-two/session-1.jsonl",
      "Project two session",
      "claude-opus-4-1",
      "2026-03-01T11:00:00.000Z",
      "2026-03-01T11:15:00.000Z",
      900000,
      "main",
      "/workspace/project-two",
      1,
      0,
      0,
    );

    const bookmarkStore = createBookmarkStoreMock({
      countSessionBookmarks: vi.fn(() => 0),
      countSessionBookmarksBySessionIds: vi.fn((projectId: string, sessionIds: string[]) => {
        if (projectId === "project_1") {
          expect(sessionIds).toEqual(["session_1", "session_older"]);
          return {
            session_1: 2,
            session_older: 1,
          };
        }
        if (projectId === "project_2") {
          expect(sessionIds).toEqual(["session_project_2"]);
          return {
            session_project_2: 4,
          };
        }
        return {};
      }),
    });
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    const response = service.listSessionsMany({
      projectIds: ["project_2", "project_1", "", "project_1"],
    });

    expect(service.listSessionsMany({ projectIds: [] })).toEqual({ sessionsByProjectId: {} });
    expect(Object.keys(response.sessionsByProjectId)).toEqual(["project_2", "project_1"]);
    expect(response.sessionsByProjectId.project_1?.map((session) => session.id)).toEqual([
      "session_1",
      "session_older",
    ]);
    expect(response.sessionsByProjectId.project_1?.map((session) => session.bookmarkCount)).toEqual(
      [2, 1],
    );
    expect(response.sessionsByProjectId.project_2?.map((session) => session.id)).toEqual([
      "session_project_2",
    ]);
    expect(response.sessionsByProjectId.project_2?.[0]?.bookmarkCount).toBe(4);
    expect(bookmarkStore.countSessionBookmarks).not.toHaveBeenCalled();
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

  it("sorts project combined messages by actual timestamp across pages", () => {
    const db = createInMemoryDatabase();
    const now = "2026-03-01T10:00:00.000Z";

    db.prepare(
      `INSERT INTO projects (id, provider, name, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("project_1", "codex", "Project One", "/workspace/project-one", now, now);

    db.prepare(
      `INSERT INTO sessions (
        id, project_id, provider, file_path, model_names, started_at, ended_at,
        duration_ms, git_branch, cwd, message_count, token_input_total, token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "session_1",
      "project_1",
      "codex",
      "/workspace/project-one/session-1.jsonl",
      "gpt-5",
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
        id, source_id, session_id, provider, category, content, created_at,
        token_input, token_output, operation_duration_ms, operation_duration_source, operation_duration_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Older absolute time (08:00Z) but lexicographically larger due +02:00 offset.
    insertMessage.run(
      "message_offset",
      "source_offset",
      "session_1",
      "codex",
      "assistant",
      "offset time",
      "2026-03-01T10:00:00+02:00",
      null,
      null,
      null,
      null,
      null,
    );
    // Newer absolute time (08:30Z).
    insertMessage.run(
      "message_utc",
      "source_utc",
      "session_1",
      "codex",
      "assistant",
      "utc time",
      "2026-03-01T08:30:00Z",
      null,
      null,
      null,
      null,
      null,
    );

    const service = createQueryServiceFromDb(db);

    const descPage0 = service.getProjectCombinedDetail({
      projectId: "project_1",
      page: 0,
      pageSize: 1,
      sortDirection: "desc",
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    const descPage1 = service.getProjectCombinedDetail({
      projectId: "project_1",
      page: 1,
      pageSize: 1,
      sortDirection: "desc",
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });

    expect(descPage0.messages[0]?.id).toBe("message_utc");
    expect(descPage1.messages[0]?.id).toBe("message_offset");

    const ascPage0 = service.getProjectCombinedDetail({
      projectId: "project_1",
      page: 0,
      pageSize: 1,
      sortDirection: "asc",
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: undefined,
    });
    expect(ascPage0.messages[0]?.id).toBe("message_offset");
  });

  it("resolves focusSourceId deterministically to the earliest matching session message", () => {
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
        title,
        model_names,
        started_at,
        ended_at,
        duration_ms,
        git_branch,
        cwd,
        message_count,
        token_input_total,
        token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "session_1",
      "project_1",
      "claude",
      "/workspace/project-one/session-1.jsonl",
      "Session",
      "claude-opus-4-1",
      now,
      "2026-03-01T10:00:10.000Z",
      10_000,
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
      "message_early",
      "duplicate_source",
      "session_1",
      "claude",
      "assistant",
      "earliest",
      "2026-03-01T10:00:01.000Z",
      null,
      null,
      null,
      null,
      null,
    );
    insertMessage.run(
      "message_late",
      "duplicate_source",
      "session_1",
      "claude",
      "assistant",
      "latest",
      "2026-03-01T10:00:09.000Z",
      null,
      null,
      null,
      null,
      null,
    );

    const service = createQueryServiceFromDb(db);
    const detail = service.getSessionDetail({
      sessionId: "session_1",
      page: 1,
      pageSize: 1,
      sortDirection: "asc",
      categories: undefined,
      query: "",
      focusMessageId: undefined,
      focusSourceId: "duplicate_source",
    });

    expect(detail.page).toBe(0);
    expect(detail.focusIndex).toBe(0);
    expect(detail.messages[0]?.id).toBe("message_early");
  });

  it("returns persisted session titles from sessions table", () => {
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
        title,
        model_names,
        started_at,
        ended_at,
        duration_ms,
        git_branch,
        cwd,
        message_count,
        token_input_total,
        token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insertSession.run(
      "session_user_title",
      "project_1",
      "claude",
      "/workspace/project-one/session-user-title.jsonl",
      "User title wins",
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
      "Assistant title wins",
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
      "First message title wins",
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

  it("deletes a session, creates a tombstone, and removes indexed rows", () => {
    const db = seedQueryDb();
    const bookmarkStore = createBookmarkStoreMock({
      removeSessionBookmarks: vi.fn(() => 2),
    });
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    const result = service.deleteSession({ sessionId: "session_1" });

    expect(result).toEqual({
      deleted: true,
      projectId: "project_1",
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedMessageCount: 2,
      removedBookmarkCount: 2,
    });
    expect(bookmarkStore.removeSessionBookmarks).toHaveBeenCalledWith("project_1", "session_1");
    expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }).c).toBe(
      0,
    );
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM index_checkpoints").get() as { c: number }).c,
    ).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c).toBe(0);

    const deletedSession = db.prepare("SELECT * FROM deleted_sessions").get() as {
      provider: string;
      project_path: string;
      session_identity: string;
      session_id: string;
      file_path: string;
      head_hash: string;
      tail_hash: string;
      last_offset_bytes: number;
    };
    expect(deletedSession).toMatchObject({
      provider: "claude",
      project_path: "/workspace/project-one",
      session_identity: "claude:session_1",
      session_id: "session_1",
      file_path: "/workspace/project-one/session-1.jsonl",
      head_hash: "head-1",
      tail_hash: "tail-1",
      last_offset_bytes: 512,
    });
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM deleted_projects").get() as { c: number }).c,
    ).toBe(0);
  });

  it("returns deleted false when deleting a session that does not exist", () => {
    const db = seedQueryDb();
    const bookmarkStore = createBookmarkStoreMock();
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    expect(service.deleteSession({ sessionId: "missing" })).toEqual({
      deleted: false,
      projectId: null,
      provider: null,
      sourceFormat: null,
      removedMessageCount: 0,
      removedBookmarkCount: 0,
    });
    expect(bookmarkStore.removeSessionBookmarks).not.toHaveBeenCalled();
  });

  it("fails session deletion loudly when tombstone metadata is incomplete and leaves data untouched", () => {
    const db = seedQueryDb();
    db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(
      "/workspace/project-one/session-1.jsonl",
    );
    db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?").run(
      "/workspace/project-one/session-1.jsonl",
    );

    const bookmarkStore = createBookmarkStoreMock({
      removeSessionBookmarks: vi.fn(() => 2),
    });
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    expect(() => service.deleteSession({ sessionId: "session_1" })).toThrowError(
      'Cannot delete indexed history for session "session_1" because its incremental resume metadata is incomplete.',
    );
    expect(bookmarkStore.removeSessionBookmarks).not.toHaveBeenCalled();
    expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c).toBe(2);
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM deleted_sessions").get() as { c: number }).c,
    ).toBe(0);
  });

  it("deletes a project, creates project and session tombstones, and removes all project data", () => {
    const db = seedQueryDb();
    const now = "2026-03-01T10:10:00.000Z";

    db.prepare(
      `INSERT INTO sessions (
        id,
        project_id,
        provider,
        file_path,
        title,
        model_names,
        started_at,
        ended_at,
        duration_ms,
        git_branch,
        cwd,
        message_count,
        token_input_total,
        token_output_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "session_2",
      "project_1",
      "claude",
      "/workspace/project-one/session-2.jsonl",
      "Follow-up review",
      "claude-opus-4-1",
      now,
      now,
      2000,
      "main",
      "/workspace/project-one",
      1,
      3,
      2,
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
      "message_3",
      "source_3",
      "session_2",
      "claude",
      "assistant",
      "Second session content",
      now,
      3,
      2,
      2000,
      "native",
      "high",
    );
    db.prepare(
      `INSERT INTO message_fts (message_id, session_id, provider, category, content)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("message_3", "session_2", "claude", "assistant", "Second session content");
    db.prepare(
      `INSERT INTO indexed_files (
        file_path,
        provider,
        project_path,
        session_identity,
        file_size,
        file_mtime_ms,
        indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "/workspace/project-one/session-2.jsonl",
      "claude",
      "/workspace/project-one",
      "claude:session_2",
      256,
      Date.parse(now),
      now,
    );
    db.prepare(
      `INSERT INTO index_checkpoints (
        file_path,
        provider,
        session_id,
        session_identity,
        file_size,
        file_mtime_ms,
        last_offset_bytes,
        last_line_number,
        last_event_index,
        next_message_sequence,
        processing_state_json,
        source_metadata_json,
        head_hash,
        tail_hash,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "/workspace/project-one/session-2.jsonl",
      "claude",
      "session_2",
      "claude:session_2",
      256,
      Date.parse(now),
      256,
      0,
      0,
      1,
      JSON.stringify({
        pendingToolCallById: {},
        previousMessageRole: "assistant",
        previousTimestamp: now,
        aggregate: { startedAt: now, endedAt: now, messageCount: 1 },
      }),
      JSON.stringify({
        models: ["claude-opus-4-1"],
        cwd: "/workspace/project-one",
        gitBranch: "main",
      }),
      "head-2",
      "tail-2",
      now,
    );

    const bookmarkStore = createBookmarkStoreMock({
      removeProjectBookmarks: vi.fn(() => 5),
    });
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    const result = service.deleteProject({ projectId: "project_1" });

    expect(result).toEqual({
      deleted: true,
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedSessionCount: 2,
      removedMessageCount: 3,
      removedBookmarkCount: 5,
    });
    expect(bookmarkStore.removeProjectBookmarks).toHaveBeenCalledWith("project_1");
    expect((db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }).c).toBe(
      0,
    );
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM index_checkpoints").get() as { c: number }).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM deleted_projects WHERE provider = ? AND project_path = ?",
          )
          .get("claude", "/workspace/project-one") as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM deleted_sessions WHERE project_path = ?")
          .get("/workspace/project-one") as { c: number }
      ).c,
    ).toBe(2);
  });

  it("returns deleted false when deleting a project that does not exist", () => {
    const db = seedQueryDb();
    const bookmarkStore = createBookmarkStoreMock();
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    expect(service.deleteProject({ projectId: "missing" })).toEqual({
      deleted: false,
      provider: null,
      sourceFormat: null,
      removedSessionCount: 0,
      removedMessageCount: 0,
      removedBookmarkCount: 0,
    });
    expect(bookmarkStore.removeProjectBookmarks).not.toHaveBeenCalled();
  });

  it("allows project deletion when a session resume tombstone is incomplete and skips it", () => {
    const db = seedQueryDb();
    db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(
      "/workspace/project-one/session-1.jsonl",
    );
    db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?").run(
      "/workspace/project-one/session-1.jsonl",
    );

    const bookmarkStore = createBookmarkStoreMock({
      removeProjectBookmarks: vi.fn(() => 2),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    expect(service.deleteProject({ projectId: "project_1" })).toEqual({
      deleted: true,
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedSessionCount: 1,
      removedMessageCount: 2,
      removedBookmarkCount: 2,
    });
    expect(bookmarkStore.removeProjectBookmarks).toHaveBeenCalledWith("project_1");
    expect(warnSpy).toHaveBeenCalledWith(
      '[codetrail] Skipping deleted-session tombstone for "session_1" because incremental resume metadata is incomplete.',
    );
    expect((db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM deleted_projects").get() as { c: number }).c,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM deleted_sessions").get() as { c: number }).c,
    ).toBe(0);

    warnSpy.mockRestore();
  });

  it("allows project deletion when a legacy session row is missing file metadata and skips its tombstone", () => {
    const db = seedQueryDb();
    db.prepare("UPDATE sessions SET file_path = '' WHERE id = ?").run("session_1");
    db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(
      "/workspace/project-one/session-1.jsonl",
    );
    db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?").run(
      "/workspace/project-one/session-1.jsonl",
    );

    const bookmarkStore = createBookmarkStoreMock({
      removeProjectBookmarks: vi.fn(() => 2),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createQueryServiceFromDb(db, {
      bookmarkStore,
      ownsBookmarkStore: false,
    });

    const result = service.deleteProject({ projectId: "project_1" });

    expect(result).toEqual({
      deleted: true,
      provider: "claude",
      sourceFormat: "jsonl_stream",
      removedSessionCount: 1,
      removedMessageCount: 2,
      removedBookmarkCount: 2,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[codetrail] Skipping deleted-session tombstone for "session_1" because required file metadata is missing.',
    );
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM deleted_sessions").get() as { c: number }).c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM deleted_projects").get() as { c: number }).c,
    ).toBe(1);

    warnSpy.mockRestore();
  });
});
