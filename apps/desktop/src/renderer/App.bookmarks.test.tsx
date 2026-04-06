// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { PaneStateSnapshot } from "./app/types";
import { SEARCH_PLACEHOLDERS } from "./lib/searchLabels";
import {
  createAppClient,
  createBookmarkSearchDelayClient,
  createBookmarksSearchClient,
  installScrollIntoViewMock,
} from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

describe("App bookmarks", () => {
  it("searches bookmarks via bookmarks:listProject query payload", async () => {
    const user = userEvent.setup();
    const client = createBookmarksSearchClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Bookmarked Messages"));
    await waitFor(() => {
      expect(screen.getByText("Parser behavior inspected and fixed.")).toBeInTheDocument();
    });

    const bookmarksSearch = screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages);
    await user.clear(bookmarksSearch);
    await user.type(bookmarksSearch, "no-match-token");

    await waitFor(() => {
      expect(
        screen.getByText(/No (bookmarked )?messages match current filters\./),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "bookmarks:listProject",
      );
      expect(
        calls.some(([, payload]) => (payload as { query?: string }).query === "no-match-token"),
      ).toBe(true);
    });
  });

  it("defaults bookmark sorting to newest first", async () => {
    const user = userEvent.setup();
    const client = createBookmarksSearchClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Bookmarked Messages"));
    await waitFor(() => {
      expect(screen.getByText("Parser behavior inspected and fixed.")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", {
        name: "Newest first (bookmarks). Switch to oldest first",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the session list stable while a bookmark search is in flight", async () => {
    const { client, delayedBookmarks } = createBookmarkSearchDelayClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
      expect(screen.getByText("Investigate markdown rendering")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Bookmarked Messages"));
    await waitFor(() => {
      expect(screen.getByText("Parser behavior inspected and fixed.")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), {
      target: { value: "delayed-search" },
    });

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "bookmarks:listProject",
      );
      expect(
        calls.some(([, payload]) => (payload as { query?: string }).query === "delayed-search"),
      ).toBe(true);
    });

    expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    expect(screen.getByText("Investigate markdown rendering")).toBeInTheDocument();

    delayedBookmarks.resolve({
      projectId: "project_1",
      totalCount: 1,
      filteredCount: 0,
      page: 0,
      pageSize: 100,
      categoryCounts: {
        user: 0,
        assistant: 0,
        tool_use: 0,
        tool_edit: 0,
        tool_result: 0,
        thinking: 0,
        system: 0,
      },
      results: [],
    });

    await waitFor(() => {
      expect(
        screen.getByText(/No (bookmarked )?messages match current filters\./),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    expect(screen.getByText("Investigate markdown rendering")).toBeInTheDocument();
  });

  it("keeps bookmarks mode when Cmd+F searches messages", async () => {
    const user = userEvent.setup();
    const client = createBookmarksSearchClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Bookmarked Messages")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Bookmarked Messages"));
    await waitFor(() => {
      expect(screen.getByText("Parser behavior inspected and fixed.")).toBeInTheDocument();
    });

    const bookmarksSearch = screen.getByPlaceholderText(
      SEARCH_PLACEHOLDERS.globalMessages,
    ) as HTMLInputElement;

    await user.keyboard("{Meta>}f{/Meta}");

    await waitFor(() => {
      expect(document.activeElement).toBe(bookmarksSearch);
    });
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDERS.historySession)).toBeNull();
  });

  it("updates bookmark counts in the tree and header immediately after toggling", async () => {
    const user = userEvent.setup();
    let isBookmarked = false;
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          {
            id: "project_1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 1,
            messageCount: 2,
            bookmarkCount: isBookmarked ? 1 : 0,
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
        ],
      }),
      "sessions:list": () => ({
        sessions: [
          {
            id: "session_1",
            projectId: "project_1",
            provider: "claude",
            filePath: "/workspace/project-one/session-1.jsonl",
            title: "Investigate markdown rendering",
            modelNames: "claude-opus-4-1",
            startedAt: "2026-03-01T10:00:00.000Z",
            endedAt: "2026-03-01T10:00:05.000Z",
            durationMs: 5000,
            gitBranch: "main",
            cwd: "/workspace/project-one",
            messageCount: 2,
            bookmarkCount: isBookmarked ? 1 : 0,
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
        ],
      }),
      "bookmarks:listProject": () => ({
        projectId: "project_1",
        totalCount: isBookmarked ? 1 : 0,
        filteredCount: isBookmarked ? 1 : 0,
        page: 0,
        pageSize: 100,
        categoryCounts: {
          user: isBookmarked ? 1 : 0,
          assistant: 0,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        results: isBookmarked
          ? [
              {
                projectId: "project_1",
                sessionId: "session_1",
                sessionTitle: "Investigate markdown rendering",
                bookmarkedAt: "2026-03-01T10:01:00.000Z",
                isOrphaned: false,
                orphanedAt: null,
                message: {
                  id: "m1",
                  sourceId: "src1",
                  sessionId: "session_1",
                  provider: "claude",
                  category: "user",
                  content: "Please review markdown table rendering",
                  createdAt: "2026-03-01T10:00:00.000Z",
                  tokenInput: null,
                  tokenOutput: null,
                  operationDurationMs: null,
                  operationDurationSource: null,
                  operationDurationConfidence: null,
                },
              },
            ]
          : [],
      }),
      "bookmarks:toggle": () => {
        isBookmarked = !isBookmarked;
        return { bookmarked: isBookmarked };
      },
    });

    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "1 bookmark" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open 1 bookmarked messages" })).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "Bookmark this message" })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1 bookmark" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Open 1 bookmarked messages" }),
      ).toBeInTheDocument();
    });
  });

  it("only shows reveal in bookmarks for bookmarked messages", async () => {
    const client = createAppClient({
      "bookmarks:getStates": () => ({
        projectId: "project_1",
        bookmarkedMessageIds: ["m1"],
      }),
      "bookmarks:listProject": () => ({
        projectId: "project_1",
        totalCount: 1,
        filteredCount: 1,
        page: 0,
        pageSize: 100,
        categoryCounts: {
          user: 1,
          assistant: 0,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        results: [
          {
            projectId: "project_1",
            sessionId: "session_1",
            sessionTitle: "Investigate markdown rendering",
            bookmarkedAt: "2026-03-01T10:01:00.000Z",
            isOrphaned: false,
            orphanedAt: null,
            message: {
              id: "m1",
              sourceId: "src1",
              sessionId: "session_1",
              provider: "claude",
              category: "user",
              content: "Please review markdown table rendering",
              createdAt: "2026-03-01T10:00:00.000Z",
              tokenInput: null,
              tokenOutput: null,
              operationDurationMs: null,
              operationDurationSource: null,
              operationDurationConfidence: null,
            },
          },
        ],
      }),
    });

    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
      expect(screen.getByText(/Everything checks out\./)).toBeInTheDocument();
    });

    expect(screen.getAllByRole("button", { name: "Reveal this message in bookmarks" })).toHaveLength(
      1,
    );
  });

  it("reveals a session message in bookmarks and hides the action once bookmarks are open", async () => {
    const user = userEvent.setup();
    installScrollIntoViewMock();
    const sessionMessages = [
      {
        id: "m1",
        sourceId: "src1",
        sessionId: "session_1",
        provider: "claude" as const,
        category: "user" as const,
        content: "Please review markdown table rendering",
        createdAt: "2026-03-01T10:00:00.000Z",
        tokenInput: null,
        tokenOutput: null,
        operationDurationMs: null,
        operationDurationSource: null,
        operationDurationConfidence: null,
      },
      {
        id: "m2",
        sourceId: "src2",
        sessionId: "session_1",
        provider: "claude" as const,
        category: "assistant" as const,
        content: "Everything checks out.\n\n| A | B |\n|---|---|\n| 1 | 2 |",
        createdAt: "2026-03-01T10:00:05.000Z",
        tokenInput: 14,
        tokenOutput: 8,
        operationDurationMs: 5000,
        operationDurationSource: "native" as const,
        operationDurationConfidence: "high" as const,
      },
    ];
    const bookmarkEntries = [
      {
        projectId: "project_1",
        sessionId: "session_1",
        sessionTitle: "Investigate markdown rendering",
        bookmarkedAt: "2026-03-01T10:01:00.000Z",
        isOrphaned: false,
        orphanedAt: null,
        message: {
          id: "bookmark_1",
          sourceId: "bookmark_source_1",
          sessionId: "session_1",
          provider: "claude" as const,
          category: "assistant" as const,
          content: "Saved first summary",
          createdAt: "2026-03-01T10:00:01.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
      },
      {
        projectId: "project_1",
        sessionId: "session_1",
        sessionTitle: "Investigate markdown rendering",
        bookmarkedAt: "2026-03-01T10:02:00.000Z",
        isOrphaned: false,
        orphanedAt: null,
        message: {
          id: "m2",
          sourceId: "src2",
          sessionId: "session_1",
          provider: "claude" as const,
          category: "assistant" as const,
          content: "Everything checks out.\n\n| A | B |\n|---|---|\n| 1 | 2 |",
          createdAt: "2026-03-01T10:00:05.000Z",
          tokenInput: 14,
          tokenOutput: 8,
          operationDurationMs: 5000,
          operationDurationSource: "native" as const,
          operationDurationConfidence: "high" as const,
        },
      },
      {
        projectId: "project_1",
        sessionId: "session_1",
        sessionTitle: "Investigate markdown rendering",
        bookmarkedAt: "2026-03-01T10:03:00.000Z",
        isOrphaned: false,
        orphanedAt: null,
        message: {
          id: "bookmark_3",
          sourceId: "bookmark_source_3",
          sessionId: "session_1",
          provider: "claude" as const,
          category: "assistant" as const,
          content: "Saved third summary",
          createdAt: "2026-03-01T10:00:08.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
      },
    ];
    const bookmarksListProject = vi.fn((request: { [key: string]: unknown }) => {
      const requestedPageSize = Number(request.pageSize ?? 100);
      const focusMessageId =
        typeof request.focusMessageId === "string" ? request.focusMessageId : undefined;
      const focusSourceId =
        typeof request.focusSourceId === "string" ? request.focusSourceId : undefined;
      const focusIndex = bookmarkEntries.findIndex((entry) =>
        focusMessageId ? entry.message.id === focusMessageId : entry.message.sourceId === focusSourceId,
      );
      const page =
        focusIndex >= 0
          ? Math.floor(focusIndex / requestedPageSize)
          : Number(request.page ?? 0);
      const offset = page * requestedPageSize;

      return {
        projectId: "project_1",
        totalCount: bookmarkEntries.length,
        filteredCount: bookmarkEntries.length,
        page,
        pageSize: requestedPageSize,
        categoryCounts: {
          user: 0,
          assistant: bookmarkEntries.length,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        results:
          request.countOnly === true
            ? []
            : bookmarkEntries.slice(offset, offset + requestedPageSize),
      };
    });
    const client = createAppClient({
      "bookmarks:getStates": () => ({
        projectId: "project_1",
        bookmarkedMessageIds: ["m2"],
      }),
      "sessions:getDetail": (request) => {
        const requestedPageSize = Number(request.pageSize ?? 100);
        const page = Number(request.page ?? 0);
        const offset = page * requestedPageSize;

        return {
          session: {
            id: "session_1",
            projectId: "project_1",
            provider: "claude" as const,
            filePath: "/workspace/project-one/session-1.jsonl",
            title: "Investigate markdown rendering",
            modelNames: "claude-opus-4-1",
            startedAt: "2026-03-01T10:00:00.000Z",
            endedAt: "2026-03-01T10:00:05.000Z",
            durationMs: 5000,
            gitBranch: "main",
            cwd: "/workspace/project-one",
            messageCount: sessionMessages.length,
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
          totalCount: sessionMessages.length,
          categoryCounts: {
            user: 1,
            assistant: 1,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          page,
          pageSize: requestedPageSize,
          focusIndex: null,
          messages: sessionMessages.slice(offset, offset + requestedPageSize),
        };
      },
      "bookmarks:listProject": bookmarksListProject,
    });

    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            sessionPage: 1,
            messagePageSize: 1,
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText(/Everything checks out\./)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Reveal this message in bookmarks" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reveal this message in bookmarks" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close bookmarks" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
    expect(
      screen.queryByRole("button", { name: "Reveal this message in bookmarks" }),
    ).toBeNull();

    await waitFor(() => {
      expect(
        bookmarksListProject.mock.calls.some(([payload]) =>
          (payload as { focusMessageId?: string }).focusMessageId === "m2",
        ),
      ).toBe(true);
    });
  });
});
