import { describe, expect, it, vi } from "vitest";

import type { QueryService } from "./data/queryService";
import { buildHistoryExportMarkdown, collectHistoryExportPayload } from "./historyExport";

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp",
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

describe("historyExport", () => {
  it("formats normal messages as readable markdown blockquotes", () => {
    const markdown = buildHistoryExportMarkdown({
      exportedAt: "2026-03-19T10:00:00.000Z",
      viewLabel: "Session",
      scopeLabel: "Current page",
      sortLabel: "Oldest to newest",
      categoryLabel: "All",
      query: "table",
      messageCount: 1,
      messages: [
        {
          id: "message_1",
          category: "assistant",
          label: "Assistant",
          createdAt: "2026-03-19T10:00:05.000Z",
          operationDurationMs: 1400,
          isOrphaned: false,
          sections: [
            {
              title: null,
              style: "prose",
              language: "text",
              text: "# heading\n\n| A | B |\n|---|---|\n| 1 | 2 |\n~~~~",
            },
          ],
        },
      ],
    });

    expect(markdown).toContain("## 1. Assistant");
    expect(markdown).toContain("> # heading");
    expect(markdown).toContain("> | A | B |");
    expect(markdown).toContain("> ~~~~");
  });

  it("formats tool messages into structured markdown sections", () => {
    const payload = collectHistoryExportPayload(
      createQueryServiceFixture({
        getSessionDetail: vi.fn(() => ({
          session: createSessionSummary({
            id: "session_1",
            projectId: "project_1",
            messageCount: 1,
          }),
          totalCount: 1,
          categoryCounts: {
            user: 0,
            assistant: 0,
            tool_use: 1,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          page: 0,
          pageSize: 100,
          focusIndex: null,
          queryError: null,
          highlightPatterns: [],
          messages: [
            createSessionMessage({
              id: "m1",
              sourceId: "src1",
              sessionId: "session_1",
              category: "tool_use",
              content: '{"name":"exec_command","input":{"cmd":"git status","path":"/tmp/project"}}',
              createdAt: "2026-03-19T10:00:00.000Z",
            }),
          ],
        })),
      }),
      {
        exportId: "export_1",
        mode: "session",
        projectId: "project_1",
        sessionId: "session_1",
        page: 0,
        pageSize: 100,
        categories: ["tool_use"],
        query: "",
        searchMode: "simple",
        sortDirection: "asc",
        scope: "current_page",
      },
    );

    const markdown = buildHistoryExportMarkdown(payload);
    expect(markdown).toContain("## 1. Tool Use: Execute Command");
    expect(markdown).toContain("**Path**");
    expect(markdown).toContain("> /tmp/project");
    expect(markdown).toContain("**Command**");
    expect(markdown).toContain("```shell");
    expect(markdown).toContain("git status");
  });

  it("loads all session pages for all-pages exports", () => {
    const firstPageMessages = Array.from({ length: 500 }, (_, index) =>
      createSessionMessage({
        id: `m${index + 1}`,
        sourceId: `src${index + 1}`,
        sessionId: "session_1",
        category: index === 0 ? "user" : "assistant",
        content: `message ${index + 1}`,
        createdAt: `2026-03-19T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
      }),
    );
    const secondPageMessages = [
      createSessionMessage({
        id: "m501",
        sourceId: "src501",
        sessionId: "session_1",
        category: "assistant",
        content: "message 501",
        createdAt: "2026-03-19T11:00:00.000Z",
        operationDurationMs: 2100,
        operationDurationSource: "native",
        operationDurationConfidence: "high",
      }),
    ];

    const getSessionDetail = vi
      .fn<QueryService["getSessionDetail"]>()
      .mockImplementation((request) => ({
        session: createSessionSummary({
          id: request.sessionId,
          projectId: "project_1",
          messageCount: 501,
        }),
        totalCount: 501,
        categoryCounts: {
          user: 1,
          assistant: 500,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        page: request.page,
        pageSize: request.pageSize,
        focusIndex: null,
        queryError: null,
        highlightPatterns: [],
        messages: request.page === 0 ? firstPageMessages : secondPageMessages,
      }));

    const queryService = createQueryServiceFixture({
      getSessionDetail,
    });

    const payload = collectHistoryExportPayload(queryService, {
      exportId: "export_1",
      mode: "session",
      projectId: "project_1",
      sessionId: "session_1",
      page: 0,
      pageSize: 2,
      categories: ["user", "assistant"],
      query: "",
      searchMode: "simple",
      sortDirection: "asc",
      scope: "all_pages",
    });

    expect(getSessionDetail).toHaveBeenCalledTimes(2);
    expect(getSessionDetail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ page: 0, pageSize: 500 }),
    );
    expect(getSessionDetail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: 1, pageSize: 500 }),
    );
    expect(payload.messages).toHaveLength(501);
    expect(payload.messages[0]?.id).toBe("m1");
    expect(payload.messages.at(-1)?.id).toBe("m501");
  });

  it("sorts bookmarked messages with the same order as the messages pane", () => {
    const queryService = createQueryServiceFixture({
      listProjectBookmarks: vi.fn(() => ({
        projectId: "project_1",
        totalCount: 2,
        filteredCount: 2,
        page: 0,
        pageSize: 100,
        categoryCounts: {
          user: 0,
          assistant: 2,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        queryError: null,
        highlightPatterns: [],
        results: [
          {
            projectId: "project_1",
            sessionId: "session_1",
            sessionTitle: "One",
            bookmarkedAt: "2026-03-19T10:03:00.000Z",
            isOrphaned: true,
            orphanedAt: "2026-03-19T10:04:00.000Z",
            message: createSessionMessage({
              id: "m1",
              sourceId: "src1",
              sessionId: "session_1",
              category: "assistant",
              content: "older",
              createdAt: "2026-03-19T10:00:00.000Z",
            }),
          },
          {
            projectId: "project_1",
            sessionId: "session_1",
            sessionTitle: "Two",
            bookmarkedAt: "2026-03-19T10:05:00.000Z",
            isOrphaned: false,
            orphanedAt: null,
            message: createSessionMessage({
              id: "m2",
              sourceId: "src2",
              sessionId: "session_1",
              category: "assistant",
              content: "newer",
              createdAt: "2026-03-19T10:01:00.000Z",
              operationDurationMs: 900,
              operationDurationSource: "native",
              operationDurationConfidence: "high",
            }),
          },
        ],
      })),
    });

    const payload = collectHistoryExportPayload(queryService, {
      exportId: "export_1",
      mode: "bookmarks",
      projectId: "project_1",
      page: 0,
      pageSize: 100,
      categories: ["assistant"],
      query: "",
      searchMode: "simple",
      sortDirection: "desc",
      scope: "all_pages",
    });

    expect(payload.messages.map((message) => message.id)).toEqual(["m2", "m1"]);
    expect(payload.messages[1]?.isOrphaned).toBe(true);
  });
});

function createQueryServiceFixture(overrides: Partial<QueryService> = {}): QueryService {
  return {
    listProjects: vi.fn(),
    getProjectCombinedDetail: vi.fn(),
    listSessions: vi.fn(),
    listSessionsMany: vi.fn(),
    getSessionDetail: vi.fn(),
    listProjectBookmarks: vi.fn(),
    getBookmarkStates: vi.fn(),
    toggleBookmark: vi.fn(),
    runSearchQuery: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as QueryService;
}

function createSessionSummary(
  overrides: Partial<ReturnType<QueryService["getSessionDetail"]>["session"]> & {
    id: string;
    projectId: string;
  },
) {
  const { id, projectId, ...rest } = overrides;
  return {
    id,
    projectId,
    provider: "claude" as const,
    filePath: "/tmp/session.jsonl",
    title: "Session",
    modelNames: "claude-opus",
    startedAt: null,
    endedAt: null,
    durationMs: null,
    gitBranch: null,
    cwd: null,
    sessionIdentity: null,
    providerSessionId: null,
    sessionKind: null,
    canonicalProjectPath: null,
    repositoryUrl: null,
    gitCommitHash: null,
    lineageParentId: null,
    providerClient: null,
    providerSource: null,
    providerClientVersion: null,
    resolutionSource: null,
    worktreeLabel: null,
    worktreeSource: null,
    messageCount: 0,
    bookmarkCount: 0,
    tokenInputTotal: 0,
    tokenOutputTotal: 0,
    ...rest,
  };
}

function createSessionMessage(
  overrides: Partial<ReturnType<QueryService["getSessionDetail"]>["messages"][number]> & {
    id: string;
    sourceId: string;
    sessionId: string;
    category:
      | "user"
      | "assistant"
      | "tool_use"
      | "tool_edit"
      | "tool_result"
      | "thinking"
      | "system";
    content: string;
    createdAt: string;
  },
) {
  const { id, sourceId, sessionId, category, content, createdAt, ...rest } = overrides;
  return {
    id,
    sourceId,
    sessionId,
    provider: "claude" as const,
    category,
    content,
    createdAt,
    tokenInput: null,
    tokenOutput: null,
    operationDurationMs: null,
    operationDurationSource: null,
    operationDurationConfidence: null,
    turnGroupId: null,
    turnGroupingMode: "heuristic" as const,
    turnAnchorKind: null,
    nativeTurnId: null,
    ...rest,
  };
}
