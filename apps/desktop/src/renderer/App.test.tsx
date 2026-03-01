// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { createMockCodetrailClient } from "./test/mockCodetrailClient";
import { renderWithClient } from "./test/renderWithClient";

function createAppClient() {
  const client = createMockCodetrailClient();

  client.invoke.mockImplementation(async (channel, payload) => {
    const request = payload as Record<string, unknown>;

    if (channel === "ui:getState") {
      return {
        projectPaneWidth: null,
        sessionPaneWidth: null,
        projectProviders: null,
        historyCategories: null,
        expandedByDefaultCategories: null,
        searchProviders: null,
        theme: null,
        monoFontFamily: null,
        regularFontFamily: null,
        monoFontSize: null,
        regularFontSize: null,
        useMonospaceForAllMessages: null,
        selectedProjectId: null,
        selectedSessionId: null,
        historyMode: null,
        projectSortDirection: null,
        sessionSortDirection: null,
        messageSortDirection: null,
        bookmarkSortDirection: null,
        projectAllSortDirection: null,
        sessionPage: null,
        sessionScrollTop: null,
        systemMessageRegexRules: null,
      };
    }

    if (channel === "ui:setState") {
      return { ok: true };
    }

    if (channel === "ui:getZoom") {
      return { percent: 100 };
    }

    if (channel === "projects:list") {
      return {
        projects: [
          {
            id: "project_1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 1,
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
        ],
      };
    }

    if (channel === "sessions:list") {
      return {
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
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
        ],
      };
    }

    if (channel === "projects:getCombinedDetail") {
      return {
        projectId: "project_1",
        totalCount: 2,
        categoryCounts: {
          user: 1,
          assistant: 1,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        page: 0,
        pageSize: 100,
        focusIndex: null,
        messages: [
          {
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
            sessionTitle: "Investigate markdown rendering",
            sessionActivity: "2026-03-01T10:00:05.000Z",
            sessionStartedAt: "2026-03-01T10:00:00.000Z",
            sessionEndedAt: "2026-03-01T10:00:05.000Z",
            sessionGitBranch: "main",
            sessionCwd: "/workspace/project-one",
          },
          {
            id: "m2",
            sourceId: "src2",
            sessionId: "session_1",
            provider: "claude",
            category: "assistant",
            content: "Everything checks out.\n\n| A | B |\n|---|---|\n| 1 | 2 |",
            createdAt: "2026-03-01T10:00:05.000Z",
            tokenInput: 14,
            tokenOutput: 8,
            operationDurationMs: 5000,
            operationDurationSource: "native",
            operationDurationConfidence: "high",
            sessionTitle: "Investigate markdown rendering",
            sessionActivity: "2026-03-01T10:00:05.000Z",
            sessionStartedAt: "2026-03-01T10:00:00.000Z",
            sessionEndedAt: "2026-03-01T10:00:05.000Z",
            sessionGitBranch: "main",
            sessionCwd: "/workspace/project-one",
          },
        ],
      };
    }

    if (channel === "sessions:getDetail") {
      return {
        session: {
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
          tokenInputTotal: 14,
          tokenOutputTotal: 8,
        },
        totalCount: 2,
        categoryCounts: {
          user: 1,
          assistant: 1,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        page: 0,
        pageSize: 100,
        focusIndex: null,
        messages: [
          {
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
          {
            id: "m2",
            sourceId: "src2",
            sessionId: "session_1",
            provider: "claude",
            category: "assistant",
            content: "Everything checks out.\n\n| A | B |\n|---|---|\n| 1 | 2 |",
            createdAt: "2026-03-01T10:00:05.000Z",
            tokenInput: 14,
            tokenOutput: 8,
            operationDurationMs: 5000,
            operationDurationSource: "native",
            operationDurationConfidence: "high",
          },
        ],
      };
    }

    if (channel === "bookmarks:listProject") {
      return {
        projectId: String(request.projectId),
        totalCount: 0,
        filteredCount: 0,
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
      };
    }

    if (channel === "search:query") {
      const query = String(request.query ?? "");
      if (query.trim().length === 0) {
        return {
          query,
          totalCount: 0,
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
        };
      }

      return {
        query,
        totalCount: 1,
        categoryCounts: {
          user: 0,
          assistant: 1,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        results: [
          {
            messageId: "m2",
            messageSourceId: "src2",
            sessionId: "session_1",
            projectId: "project_1",
            provider: "claude",
            category: "assistant",
            createdAt: "2026-03-01T10:00:05.000Z",
            snippet: "markdown table rendering",
            projectName: "Project One",
            projectPath: "/workspace/project-one",
          },
        ],
      };
    }

    if (channel === "ui:setZoom") {
      const action = String(request.action ?? "");
      return { percent: action === "in" ? 110 : action === "out" ? 90 : 100 };
    }

    if (channel === "indexer:refresh") {
      return { jobId: "refresh-1" };
    }

    if (channel === "bookmarks:toggle") {
      return { bookmarked: true };
    }

    if (channel === "app:getSettingsInfo") {
      return {
        storage: {
          settingsFile: "/tmp/ui-state.json",
          cacheDir: "/tmp/cache",
          databaseFile: "/tmp/codetrail.sqlite",
          bookmarksDatabaseFile: "/tmp/codetrail.bookmarks.sqlite",
          userDataDir: "/tmp",
        },
        discovery: {
          claudeRoot: "/Users/test/.claude/projects",
          codexRoot: "/Users/test/.codex/sessions",
          geminiRoot: "/Users/test/.gemini/tmp",
          geminiHistoryRoot: "/Users/test/.gemini/history",
          geminiProjectsPath: "/Users/test/.gemini/projects.json",
        },
      };
    }

    throw new Error(`Unhandled IPC call: ${channel}`);
  });

  return client;
}

function createBookmarksSearchClient() {
  const client = createMockCodetrailClient();
  const invoke = client.invoke as unknown as {
    mockImplementation: (
      implementation: (channel: string, payload: Record<string, unknown>) => Promise<unknown>,
    ) => void;
  };

  invoke.mockImplementation(async (channel, payload) => {
    const request = payload;

    if (channel === "ui:getState") {
      return {
        projectPaneWidth: null,
        sessionPaneWidth: null,
        projectProviders: null,
        historyCategories: null,
        expandedByDefaultCategories: null,
        searchProviders: null,
        theme: null,
        monoFontFamily: null,
        regularFontFamily: null,
        monoFontSize: null,
        regularFontSize: null,
        useMonospaceForAllMessages: null,
        selectedProjectId: null,
        selectedSessionId: null,
        historyMode: null,
        projectSortDirection: null,
        sessionSortDirection: null,
        messageSortDirection: null,
        bookmarkSortDirection: null,
        projectAllSortDirection: null,
        sessionPage: null,
        sessionScrollTop: null,
        systemMessageRegexRules: null,
      };
    }

    if (channel === "ui:setState") {
      return { ok: true };
    }

    if (channel === "ui:getZoom") {
      return { percent: 100 };
    }

    if (channel === "projects:list") {
      return {
        projects: [
          {
            id: "project_1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 1,
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
        ],
      };
    }

    if (channel === "sessions:list") {
      return {
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
            tokenInputTotal: 14,
            tokenOutputTotal: 8,
          },
        ],
      };
    }

    if (channel === "projects:getCombinedDetail") {
      return {
        projectId: "project_1",
        totalCount: 2,
        categoryCounts: {
          user: 0,
          assistant: 1,
          tool_use: 1,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        page: 0,
        pageSize: 100,
        focusIndex: null,
        messages: [
          {
            id: "m_tool",
            sourceId: "src_tool",
            sessionId: "session_1",
            provider: "claude",
            category: "tool_use",
            content: '{"name":"Read","args":{"path":"src/parser.ts"}}',
            createdAt: "2026-03-01T10:00:01.000Z",
            tokenInput: null,
            tokenOutput: null,
            operationDurationMs: null,
            operationDurationSource: null,
            operationDurationConfidence: null,
            sessionTitle: "Investigate markdown rendering",
            sessionActivity: "2026-03-01T10:00:05.000Z",
            sessionStartedAt: "2026-03-01T10:00:00.000Z",
            sessionEndedAt: "2026-03-01T10:00:05.000Z",
            sessionGitBranch: "main",
            sessionCwd: "/workspace/project-one",
          },
          {
            id: "m_assistant",
            sourceId: "src_assistant",
            sessionId: "session_1",
            provider: "claude",
            category: "assistant",
            content: "Parser behavior inspected and fixed.",
            createdAt: "2026-03-01T10:00:05.000Z",
            tokenInput: 10,
            tokenOutput: 8,
            operationDurationMs: 4000,
            operationDurationSource: "native",
            operationDurationConfidence: "high",
            sessionTitle: "Investigate markdown rendering",
            sessionActivity: "2026-03-01T10:00:05.000Z",
            sessionStartedAt: "2026-03-01T10:00:00.000Z",
            sessionEndedAt: "2026-03-01T10:00:05.000Z",
            sessionGitBranch: "main",
            sessionCwd: "/workspace/project-one",
          },
        ],
      };
    }

    if (channel === "sessions:getDetail") {
      return {
        session: {
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
          tokenInputTotal: 14,
          tokenOutputTotal: 8,
        },
        totalCount: 2,
        categoryCounts: {
          user: 1,
          assistant: 1,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        page: 0,
        pageSize: 100,
        focusIndex: null,
        messages: [],
      };
    }

    if (channel === "bookmarks:listProject") {
      const query = String(request.query ?? "").toLowerCase();
      const entry = {
        projectId: "project_1",
        sessionId: "session_1",
        sessionTitle: "Investigate markdown rendering",
        bookmarkedAt: "2026-03-01T10:10:00.000Z",
        isOrphaned: false,
        orphanedAt: null,
        message: {
          id: "bm1",
          sourceId: "bm-src-1",
          sessionId: "session_1",
          provider: "claude",
          category: "assistant",
          content: "Parser behavior inspected and fixed.",
          createdAt: "2026-03-01T10:10:00.000Z",
          tokenInput: null,
          tokenOutput: null,
          operationDurationMs: null,
          operationDurationSource: null,
          operationDurationConfidence: null,
        },
      };
      const matches = query.length === 0 || entry.message.content.toLowerCase().includes(query);

      return {
        projectId: "project_1",
        totalCount: 1,
        filteredCount: matches ? 1 : 0,
        categoryCounts: {
          user: 0,
          assistant: matches ? 1 : 0,
          tool_use: 0,
          tool_edit: 0,
          tool_result: 0,
          thinking: 0,
          system: 0,
        },
        results: matches ? [entry] : [],
      };
    }

    if (channel === "search:query") {
      return {
        query: String(request.query ?? ""),
        totalCount: 0,
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
      };
    }

    if (channel === "ui:setZoom") {
      return { percent: 100 };
    }

    if (channel === "indexer:refresh") {
      return { jobId: "refresh-1" };
    }

    if (channel === "bookmarks:toggle") {
      return { bookmarked: true };
    }

    if (channel === "app:getSettingsInfo") {
      return {
        storage: {
          settingsFile: "/tmp/ui-state.json",
          cacheDir: "/tmp/cache",
          databaseFile: "/tmp/codetrail.sqlite",
          bookmarksDatabaseFile: "/tmp/codetrail.bookmarks.sqlite",
          userDataDir: "/tmp",
        },
        discovery: {
          claudeRoot: "/Users/test/.claude/projects",
          codexRoot: "/Users/test/.codex/sessions",
          geminiRoot: "/Users/test/.gemini/tmp",
          geminiHistoryRoot: "/Users/test/.gemini/history",
          geminiProjectsPath: "/Users/test/.gemini/projects.json",
        },
      };
    }

    throw new Error(`Unhandled IPC call: ${channel}`);
  });

  return client;
}

describe("App", () => {
  it("loads history, supports global search navigation, and opens settings", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: () => undefined,
      configurable: true,
    });

    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Global Search" }));
    expect(screen.getByRole("heading", { name: "Global Search" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search all message text"), "markdown");
    await waitFor(() => {
      expect(screen.getByText("markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByText("markdown table rendering"));
    await waitFor(() => {
      expect(screen.getAllByText("Investigate markdown rendering").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() => {
      expect(screen.getByText("Discovery Roots")).toBeInTheDocument();
    });
  });

  it("passes per-mode message sort direction to detail requests and toggles on click", async () => {
    const user = userEvent.setup();
    const client = createAppClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sort All Sessions messages ascending" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Sort All Sessions messages ascending" }));

    await waitFor(() => {
      const calls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "projects:getCombinedDetail",
      );
      expect(
        calls.some(
          ([, payload]) => (payload as { sortDirection?: string }).sortDirection === "asc",
        ),
      ).toBe(true);
    });
  });

  it("searches bookmarks via bookmarks:listProject query payload", async () => {
    const user = userEvent.setup();
    const client = createBookmarksSearchClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Bookmarked messages")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Bookmarked messages"));
    await waitFor(() => {
      expect(screen.getByText("Parser behavior inspected and fixed.")).toBeInTheDocument();
    });

    const bookmarksSearch = screen.getByPlaceholderText("Search in bookmarks...");
    await user.clear(bookmarksSearch);
    await user.type(bookmarksSearch, "no-match-token");

    await waitFor(() => {
      expect(screen.getByText("No bookmarked messages match current filters.")).toBeInTheDocument();
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

  it("keeps bookmarks mode when Cmd/Ctrl+F focuses history search", async () => {
    const user = userEvent.setup();
    const client = createBookmarksSearchClient();

    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Bookmarked messages")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Bookmarked messages"));
    await waitFor(() => {
      expect(screen.getByText("Parser behavior inspected and fixed.")).toBeInTheDocument();
    });

    const bookmarksSearch = screen.getByPlaceholderText(
      "Search in bookmarks...",
    ) as HTMLInputElement;

    await user.keyboard("{Control>}f{/Control}");

    await waitFor(() => {
      expect(document.activeElement).toBe(bookmarksSearch);
    });
    expect(screen.getByPlaceholderText("Search in bookmarks...")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search in session...")).toBeNull();
  });
});
