// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, setTestStrategyIntervalOverrides } from "./App";
import type { PaneStateSnapshot } from "./app/types";
import { SEARCH_PLACEHOLDERS } from "./lib/searchLabels";
import { createAppClient } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

const FAST_OVERRIDES = {
  "scan-5s": 100,
  "scan-10s": 200,
  "scan-30s": 300,
  "scan-1min": 400,
  "scan-5min": 500,
} as const;

function installDialogMock(): void {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
      Object.defineProperty(this, "open", {
        configurable: true,
        writable: true,
        value: true,
      });
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
      Object.defineProperty(this, "open", {
        configurable: true,
        writable: true,
        value: false,
      });
      this.dispatchEvent(new Event("close"));
    },
  });
}

function countChannelCalls(client: ReturnType<typeof createAppClient>, channel: string): number {
  return client.invoke.mock.calls.filter(([name]) => name === channel).length;
}

function getChannelCalls(
  client: ReturnType<typeof createAppClient>,
  channel: string,
): Array<[string, Record<string, unknown>]> {
  return client.invoke.mock.calls.filter(([name]) => name === channel) as Array<
    [string, Record<string, unknown>]
  >;
}

function makeProjectSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "project_1",
    provider: "claude",
    name: "Project One",
    path: "/workspace/project-one",
    sessionCount: 1,
    messageCount: 2,
    bookmarkCount: 0,
    lastActivity: "2026-03-01T10:00:05.000Z",
    ...overrides,
  };
}

function makeSessionSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    bookmarkCount: 0,
    tokenInputTotal: 14,
    tokenOutputTotal: 8,
    ...overrides,
  };
}

function makeOrderedSessions(
  first: { id: string; title: string; endedAt: string; projectId?: string },
  second: { id: string; title: string; endedAt: string; projectId?: string },
) {
  return [
    makeSessionSummary({
      id: first.id,
      projectId: first.projectId ?? "project_1",
      title: first.title,
      startedAt: "2026-03-01T10:00:00.000Z",
      endedAt: first.endedAt,
    }),
    makeSessionSummary({
      id: second.id,
      projectId: second.projectId ?? "project_1",
      title: second.title,
      startedAt: "2026-03-01T10:00:00.000Z",
      endedAt: second.endedAt,
    }),
  ];
}

function getSessionPaneTitles(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".session-item .session-preview"))
    .map((element) => element.textContent?.trim() ?? "")
    .filter((text) => text.length > 0 && text !== "All Sessions" && text !== "Bookmarked Messages");
}

function getTreeSessionTitles(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".project-tree-session-title"))
    .map((element) => element.textContent?.trim() ?? "")
    .filter((text) => text.length > 0);
}

describe("App periodic refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setTestStrategyIntervalOverrides(FAST_OVERRIDES);
    installDialogMock();
  });

  afterEach(() => {
    setTestStrategyIntervalOverrides(null);
    vi.useRealTimers();
  });

  it("fires incremental refresh repeatedly on each interval tick", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    const refreshCallsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    // Select 5s scan (mapped to 100ms via override)
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });
    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsBefore);
    });

    const refreshCallsAfterFirst = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });
    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsAfterFirst);
    });
  });

  it("stops periodic refresh when set back to Manual", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    const refreshCallsBeforeOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "Manual" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const refreshCallsAfterOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;
    expect(refreshCallsAfterOff).toBe(refreshCallsBeforeOff);
  });

  it("auto-refresh reloads project summaries and only the selected project sessions when history is visible", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          makeProjectSummary(),
          {
            ...makeProjectSummary({
              id: "project_2",
              provider: "codex",
              name: "Project Two",
              path: "/workspace/project-two",
              lastActivity: "2026-03-01T10:01:05.000Z",
            }),
          },
        ],
      }),
      "sessions:list": (request) => ({
        sessions: [
          request.projectId === "project_2"
            ? makeSessionSummary({
                id: "session_2",
                projectId: "project_2",
                provider: "codex",
                filePath: "/workspace/project-two/session-2.jsonl",
                title: "Investigate tree refresh failure",
                cwd: "/workspace/project-two",
              })
            : makeSessionSummary(),
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
            projectViewMode: "list",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Investigate markdown rendering/i }),
      ).toBeInTheDocument();
    });

    const projectsBefore = countChannelCalls(client, "projects:list");
    const sessionsBefore = countChannelCalls(client, "sessions:list");
    const sessionDetailBefore = countChannelCalls(client, "sessions:getDetail");
    const searchBefore = countChannelCalls(client, "search:query");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "projects:list")).toBeGreaterThan(projectsBefore);
      expect(countChannelCalls(client, "sessions:list")).toBeGreaterThan(sessionsBefore);
    });

    const newSessionCalls = getChannelCalls(client, "sessions:list").slice(sessionsBefore);
    expect(newSessionCalls.length).toBeGreaterThan(0);
    expect(
      newSessionCalls.every(([, payload]) => String(payload.projectId ?? "") === "project_1"),
    ).toBe(true);
    expect(countChannelCalls(client, "sessions:getDetail")).toBe(sessionDetailBefore);
    expect(countChannelCalls(client, "search:query")).toBe(searchBefore);
  });

  it("auto-refresh re-fetches session detail when the selected session fingerprint changes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionMessageCount = 2;
    const client = createAppClient({
      "sessions:list": () => ({
        sessions: [makeSessionSummary({ messageCount: sessionMessageCount })],
      }),
      "sessions:getDetail": () => ({
        session: {
          ...makeSessionSummary({ messageCount: sessionMessageCount }),
        },
        totalCount: sessionMessageCount,
        categoryCounts: {
          user: sessionMessageCount,
          assistant: 0,
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
      expect(countChannelCalls(client, "sessions:list")).toBeGreaterThan(0);
      expect(countChannelCalls(client, "sessions:getDetail")).toBeGreaterThan(0);
    });

    const sessionDetailBefore = countChannelCalls(client, "sessions:getDetail");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));
    sessionMessageCount = 3;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "sessions:getDetail")).toBeGreaterThan(sessionDetailBefore);
    });
  });

  it("does not refetch bookmark states when a refreshed session detail keeps the same visible message ids", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionRevision = 0;
    let sessionEndedAt = "2026-03-01T10:00:05.000Z";
    const detailMessages = [
      {
        id: "message_1",
        sourceId: "source_1",
        sessionId: "session_1",
        provider: "claude",
        category: "user",
        content: "Please review markdown table rendering",
        createdAt: "2026-03-01T10:00:00.000Z",
        tokenInput: 0,
        tokenOutput: 0,
      },
      {
        id: "message_2",
        sourceId: "source_2",
        sessionId: "session_1",
        provider: "claude",
        category: "assistant",
        content: "Saved markdown summary",
        createdAt: "2026-03-01T10:00:03.000Z",
        tokenInput: 0,
        tokenOutput: 0,
      },
    ];
    const client = createAppClient({
      "sessions:list": () => ({
        sessions: [makeSessionSummary({ endedAt: sessionEndedAt })],
      }),
      "sessions:getDetail": () => {
        sessionRevision += 1;
        return {
          session: {
            ...makeSessionSummary({
              endedAt: sessionEndedAt,
              messageCount: detailMessages.length,
            }),
          },
          totalCount: detailMessages.length,
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
          messages: detailMessages.map((message) => ({
            ...message,
            content:
              sessionRevision % 2 === 0 ? `${message.content} (refresh)` : `${message.content}`,
          })),
        };
      },
      "bookmarks:getStates": () => ({
        projectId: "project_1",
        bookmarkedMessageIds: [],
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
      expect(screen.getByText("Saved markdown summary")).toBeInTheDocument();
      expect(countChannelCalls(client, "bookmarks:getStates")).toBeGreaterThan(0);
      expect(countChannelCalls(client, "sessions:getDetail")).toBeGreaterThan(0);
    });

    const bookmarkCallsBefore = countChannelCalls(client, "bookmarks:getStates");
    const sessionDetailCallsBefore = countChannelCalls(client, "sessions:getDetail");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));
    sessionEndedAt = "2026-03-01T10:00:06.000Z";

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "sessions:getDetail")).toBeGreaterThan(
        sessionDetailCallsBefore,
      );
    });
    expect(countChannelCalls(client, "bookmarks:getStates")).toBe(bookmarkCallsBefore);
  });

  it("auto-refresh skips project_all detail reload when the selected project fingerprint is unchanged", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "projects:list": () => ({
        projects: [makeProjectSummary({ messageCount: 250 })],
      }),
      "projects:getCombinedDetail": () => ({
        projectId: "project_1",
        totalCount: 250,
        categoryCounts: {
          user: 125,
          assistant: 125,
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
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            historyMode: "project_all",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
      expect(countChannelCalls(client, "projects:getCombinedDetail")).toBeGreaterThan(0);
    });

    const detailBefore = countChannelCalls(client, "projects:getCombinedDetail");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "projects:list")).toBeGreaterThan(1);
    });

    expect(countChannelCalls(client, "projects:getCombinedDetail")).toBe(detailBefore);
  });

  it("auto-refresh re-fetches project_all detail when the selected project fingerprint changes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let projectMessageCount = 250;
    let lastActivity = "2026-03-01T10:00:05.000Z";
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          makeProjectSummary({
            messageCount: projectMessageCount,
            lastActivity,
          }),
        ],
      }),
      "projects:getCombinedDetail": () => ({
        projectId: "project_1",
        totalCount: projectMessageCount,
        categoryCounts: {
          user: projectMessageCount,
          assistant: 0,
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
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            historyMode: "project_all",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
      expect(countChannelCalls(client, "projects:getCombinedDetail")).toBeGreaterThan(0);
    });

    const detailBefore = countChannelCalls(client, "projects:getCombinedDetail");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));
    projectMessageCount = 300;
    lastActivity = "2026-03-01T10:00:06.000Z";

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "projects:getCombinedDetail")).toBeGreaterThan(detailBefore);
    });
  });

  it("updates Turns pagination when a new user message creates a new turn without changing the current turn", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let includeNewTurn = false;
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          makeProjectSummary({
            messageCount: includeNewTurn ? 6 : 4,
            lastActivity: includeNewTurn ? "2026-03-01T10:00:11.000Z" : "2026-03-01T10:00:07.000Z",
          }),
        ],
      }),
      "sessions:list": () => ({
        sessions: [
          makeSessionSummary({
            messageCount: includeNewTurn ? 6 : 4,
            endedAt: includeNewTurn ? "2026-03-01T10:00:11.000Z" : "2026-03-01T10:00:07.000Z",
          }),
        ],
      }),
      "sessions:getTurn": (request) => {
        const latestAnchor = includeNewTurn ? "m5" : "m3";
        const anchorMessageId =
          typeof request.anchorMessageId === "string" && request.anchorMessageId.length > 0
            ? request.anchorMessageId
            : request.latest === true
              ? latestAnchor
              : request.turnNumber === 1
                ? "m1"
                : request.turnNumber === 2
                  ? "m3"
                  : latestAnchor;
        const totalTurns = includeNewTurn ? 3 : 2;
        const turnNumber = anchorMessageId === "m1" ? 1 : anchorMessageId === "m3" ? 2 : totalTurns;
        const messagesByAnchor = {
          m1: [
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
              content: "Everything checks out.",
              createdAt: "2026-03-01T10:00:05.000Z",
              tokenInput: 14,
              tokenOutput: 8,
              operationDurationMs: 5000,
              operationDurationSource: "native",
              operationDurationConfidence: "high",
            },
          ],
          m3: [
            {
              id: "m3",
              sourceId: "src3",
              sessionId: "session_1",
              provider: "claude",
              category: "user",
              content: "Review the latest turn",
              createdAt: "2026-03-01T10:00:06.000Z",
              tokenInput: null,
              tokenOutput: null,
              operationDurationMs: null,
              operationDurationSource: null,
              operationDurationConfidence: null,
            },
            {
              id: "m4",
              sourceId: "src4",
              sessionId: "session_1",
              provider: "claude",
              category: "assistant",
              content: "Latest turn reply",
              createdAt: "2026-03-01T10:00:07.000Z",
              tokenInput: 8,
              tokenOutput: 5,
              operationDurationMs: 1000,
              operationDurationSource: "native",
              operationDurationConfidence: "high",
            },
          ],
          m5: [
            {
              id: "m5",
              sourceId: "src5",
              sessionId: "session_1",
              provider: "claude",
              category: "user",
              content: "Newest turn prompt",
              createdAt: "2026-03-01T10:00:10.000Z",
              tokenInput: null,
              tokenOutput: null,
              operationDurationMs: null,
              operationDurationSource: null,
              operationDurationConfidence: null,
            },
            {
              id: "m6",
              sourceId: "src6",
              sessionId: "session_1",
              provider: "claude",
              category: "assistant",
              content: "Newest turn reply",
              createdAt: "2026-03-01T10:00:11.000Z",
              tokenInput: 8,
              tokenOutput: 5,
              operationDurationMs: 1000,
              operationDurationSource: "native",
              operationDurationConfidence: "high",
            },
          ],
        } as const;
        const messages = messagesByAnchor[anchorMessageId as keyof typeof messagesByAnchor] ?? [];
        return {
          session: makeSessionSummary({
            messageCount: includeNewTurn ? 6 : 4,
            endedAt: includeNewTurn ? "2026-03-01T10:00:11.000Z" : "2026-03-01T10:00:07.000Z",
          }),
          anchorMessageId,
          anchorMessage: messages[0] ?? null,
          turnNumber,
          totalTurns,
          previousTurnAnchorMessageId:
            anchorMessageId === "m1" ? null : anchorMessageId === "m3" ? "m1" : "m3",
          nextTurnAnchorMessageId:
            anchorMessageId === "m1"
              ? "m3"
              : anchorMessageId === "m3" && includeNewTurn
                ? "m5"
                : null,
          firstTurnAnchorMessageId: "m1",
          latestTurnAnchorMessageId: latestAnchor,
          totalCount: messages.length,
          categoryCounts: {
            user: 1,
            assistant: 1,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          queryError: null,
          highlightPatterns: [],
          matchedMessageIds: undefined,
          messages,
        };
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
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: /Turns/i }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("1");
      expect(screen.getByText("Review the latest turn")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("2");
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    includeNewTurn = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Turn number" })).toHaveValue("3");
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
      expect(screen.getByText("of 3")).toBeInTheDocument();
    });
  });

  it("auto-refresh reloads search only when Search is visible with an active query", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "search:query")).toBeGreaterThan(0);
    });

    const searchBefore = countChannelCalls(client, "search:query");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "search:query")).toBeGreaterThan(searchBefore);
    });
  });

  it("refreshes expanded tree sessions during auto-refresh only when tree rows are loaded", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          makeProjectSummary(),
          {
            ...makeProjectSummary({
              id: "project_2",
              provider: "codex",
              name: "Project Two",
              path: "/workspace/project-two",
              lastActivity: "2026-03-01T10:01:05.000Z",
            }),
          },
        ],
      }),
      "sessions:list": (request) => ({
        sessions: [
          request.projectId === "project_2"
            ? makeSessionSummary({
                id: "session_2",
                projectId: "project_2",
                provider: "codex",
                filePath: "/workspace/project-two/session-2.jsonl",
                title: "Investigate tree refresh failure",
                cwd: "/workspace/project-two",
              })
            : makeSessionSummary(),
        ],
      }),
      "sessions:listMany": () => ({
        sessionsByProjectId: {
          project_2: [
            makeSessionSummary({
              id: "session_2",
              projectId: "project_2",
              provider: "codex",
              filePath: "/workspace/project-two/session-2.jsonl",
              title: "Investigate tree refresh failure",
              cwd: "/workspace/project-two",
            }),
          ],
        },
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            projectViewMode: "tree",
            selectedProjectId: "project_1",
            historyMode: "project_all",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    let projectTwoFolderButton: HTMLButtonElement | null = null;
    await waitFor(() => {
      projectTwoFolderButton = document.querySelector<HTMLButtonElement>(
        '[data-folder-id="/workspace/project-two"]',
      );
      expect(projectTwoFolderButton).not.toBeNull();
    });
    if (!projectTwoFolderButton) {
      throw new Error("Expected project-two folder row");
    }

    await user.click(projectTwoFolderButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Project Two/i })).toBeInTheDocument();
    });

    const projectTwoCallsBeforeExpand = getChannelCalls(client, "sessions:list").filter(
      ([, payload]) => String(payload.projectId ?? "") === "project_2",
    ).length;
    expect(projectTwoCallsBeforeExpand).toBe(0);

    const expandProjectTwoButton = document.querySelector<HTMLButtonElement>(
      '[data-project-expand-toggle-for="project_2"]',
    );
    expect(expandProjectTwoButton).not.toBeNull();
    if (!expandProjectTwoButton) {
      throw new Error("Expected project-two expand toggle");
    }

    await user.click(expandProjectTwoButton);

    await waitFor(() => {
      expect(
        document.querySelector('.project-tree-session-row[data-session-id="session_2"]'),
      ).not.toBeNull();
    });

    const treeRefreshCallsBeforeTick = countChannelCalls(client, "sessions:listMany");

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "sessions:listMany")).toBeGreaterThan(
        treeRefreshCallsBeforeTick,
      );
    });
  });

  it("resorts sessions once after startup watch restore, then keeps later auto-refreshes stable in the sessions pane", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let phase = 0;
    const sessionPhases = [
      makeOrderedSessions(
        { id: "session_1", title: "Session One", endedAt: "2026-03-01T10:00:10.000Z" },
        { id: "session_2", title: "Session Two", endedAt: "2026-03-01T10:00:05.000Z" },
      ),
      makeOrderedSessions(
        { id: "session_1", title: "Session One", endedAt: "2026-03-01T10:00:05.000Z" },
        { id: "session_2", title: "Session Two", endedAt: "2026-03-01T10:00:20.000Z" },
      ),
      makeOrderedSessions(
        { id: "session_1", title: "Session One", endedAt: "2026-03-01T10:00:30.000Z" },
        { id: "session_2", title: "Session Two", endedAt: "2026-03-01T10:00:10.000Z" },
      ),
    ] as const;
    const client = createAppClient({
      "sessions:list": () => ({
        sessions: sessionPhases[phase] ?? sessionPhases[sessionPhases.length - 1],
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            sessionPaneCollapsed: false,
            currentAutoRefreshStrategy: "watch-1s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Session One/i })).toBeInTheDocument();
      expect(getSessionPaneTitles()).toEqual(["Session One", "Session Two"]);
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    phase = 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(getSessionPaneTitles()).toEqual(["Session Two", "Session One"]);
    });

    const sessionCallsBeforeSecondTick = countChannelCalls(client, "sessions:list");
    phase = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "sessions:list")).toBeGreaterThan(
        sessionCallsBeforeSecondTick,
      );
    });
    expect(getSessionPaneTitles()).toEqual(["Session Two", "Session One"]);
  });

  it("resorts tree sessions once after startup watch restore, then keeps later auto-refreshes stable", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let phase = 0;
    const treeRefreshPhases = [
      makeOrderedSessions(
        { id: "session_1", title: "Session One", endedAt: "2026-03-01T10:00:05.000Z" },
        { id: "session_2", title: "Session Two", endedAt: "2026-03-01T10:00:20.000Z" },
      ),
      makeOrderedSessions(
        { id: "session_1", title: "Session One", endedAt: "2026-03-01T10:00:30.000Z" },
        { id: "session_2", title: "Session Two", endedAt: "2026-03-01T10:00:10.000Z" },
      ),
    ] as const;
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          makeProjectSummary({
            id: "project_1",
            name: "Project One",
            sessionCount: 2,
          }),
        ],
      }),
      "sessions:list": () => ({
        sessions: makeOrderedSessions(
          { id: "session_1", title: "Session One", endedAt: "2026-03-01T10:00:10.000Z" },
          { id: "session_2", title: "Session Two", endedAt: "2026-03-01T10:00:05.000Z" },
        ),
      }),
      "sessions:listMany": () => ({
        sessionsByProjectId: {
          project_1:
            treeRefreshPhases[Math.max(0, phase - 1)] ??
            treeRefreshPhases[treeRefreshPhases.length - 1]!,
        },
      }),
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            projectViewMode: "tree",
            selectedProjectId: "project_1",
            historyMode: "project_all",
            currentAutoRefreshStrategy: "watch-1s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Project One/i })).toBeInTheDocument();
    });

    const expandProjectButton = document.querySelector<HTMLButtonElement>(
      '[data-project-expand-toggle-for="project_1"]',
    );
    expect(expandProjectButton).not.toBeNull();
    if (!expandProjectButton) {
      throw new Error("Expected project-one expand toggle");
    }

    await user.click(expandProjectButton);

    await waitFor(() => {
      expect(getTreeSessionTitles()).toEqual(["Session One", "Session Two"]);
    });

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    phase = 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(getTreeSessionTitles()).toEqual(["Session Two", "Session One"]);
    });

    const treeRefreshCallsBeforeSecondTick = countChannelCalls(client, "sessions:listMany");
    phase = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "sessions:listMany")).toBeGreaterThan(
        treeRefreshCallsBeforeSecondTick,
      );
    });
    expect(getTreeSessionTitles()).toEqual(["Session Two", "Session One"]);
  });

  it("manual refresh keeps the broad reload path", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(
      <App
        initialPaneState={
          {
            selectedProjectId: "project_1",
            selectedSessionId: "session_1",
            historyMode: "session",
            liveWatchEnabled: true,
            currentAutoRefreshStrategy: "watch-1s",
            preferredAutoRefreshStrategy: "watch-1s",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    await waitFor(() => {
      expect(screen.getByText("2 of 2 messages")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDERS.globalMessages), "markdown");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(countChannelCalls(client, "search:query")).toBeGreaterThan(0);
    });

    const indexerBefore = countChannelCalls(client, "indexer:refresh");
    const projectsBefore = countChannelCalls(client, "projects:list");
    const sessionsBefore = countChannelCalls(client, "sessions:list");
    const sessionDetailBefore = countChannelCalls(client, "sessions:getDetail");
    const searchBefore = countChannelCalls(client, "search:query");
    const liveStatusBefore = countChannelCalls(client, "watcher:getLiveStatus");

    await user.click(screen.getByRole("button", { name: "Incremental refresh" }));

    await waitFor(() => {
      expect(countChannelCalls(client, "indexer:refresh")).toBeGreaterThan(indexerBefore);
      expect(countChannelCalls(client, "projects:list")).toBeGreaterThan(projectsBefore);
      expect(countChannelCalls(client, "sessions:list")).toBeGreaterThan(sessionsBefore);
      expect(countChannelCalls(client, "sessions:getDetail")).toBeGreaterThan(sessionDetailBefore);
      expect(countChannelCalls(client, "search:query")).toBeGreaterThan(searchBefore);
      expect(countChannelCalls(client, "watcher:getLiveStatus")).toBeGreaterThan(liveStatusBefore);
    });
  });

  it("keeps auto-refresh running when tree session refresh fails for one project", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let failTreeSessionRefresh = false;
    const client = createAppClient({
      "projects:list": () => ({
        projects: [
          {
            id: "project_1",
            provider: "claude",
            name: "Project One",
            path: "/workspace/project-one",
            sessionCount: 1,
            messageCount: 1,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T10:00:05.000Z",
          },
          {
            id: "project_2",
            provider: "codex",
            name: "Project Two",
            path: "/workspace/project-two",
            sessionCount: 1,
            messageCount: 1,
            bookmarkCount: 0,
            lastActivity: "2026-03-01T10:01:05.000Z",
          },
        ],
      }),
      "sessions:list": (request) => {
        if (request.projectId === "project_2" && failTreeSessionRefresh) {
          throw new Error("tree refresh failed");
        }
        return {
          sessions: [
            {
              id: request.projectId === "project_2" ? "session_2" : "session_1",
              projectId: String(request.projectId ?? "project_1"),
              provider: request.projectId === "project_2" ? "codex" : "claude",
              filePath:
                request.projectId === "project_2"
                  ? "/workspace/project-two/session-2.jsonl"
                  : "/workspace/project-one/session-1.jsonl",
              title:
                request.projectId === "project_2"
                  ? "Investigate tree refresh failure"
                  : "Investigate markdown rendering",
              modelNames: "claude-opus-4-1",
              startedAt: "2026-03-01T10:00:00.000Z",
              endedAt: "2026-03-01T10:00:05.000Z",
              durationMs: 5000,
              gitBranch: "main",
              cwd: "/workspace/project-one",
              messageCount: 2,
              bookmarkCount: 0,
              tokenInputTotal: 14,
              tokenOutputTotal: 8,
            },
          ],
        };
      },
      "sessions:listMany": () => {
        if (failTreeSessionRefresh) {
          throw new Error("tree refresh failed");
        }
        return {
          sessionsByProjectId: {
            project_2: [
              {
                ...makeSessionSummary({
                  id: "session_2",
                  projectId: "project_2",
                  provider: "codex",
                  filePath: "/workspace/project-two/session-2.jsonl",
                  title: "Investigate tree refresh failure",
                  cwd: "/workspace/project-two",
                }),
              },
            ],
          },
        };
      },
    });
    renderWithClient(
      <App
        initialPaneState={
          {
            projectViewMode: "tree",
            selectedProjectId: "project_1",
            historyMode: "project_all",
          } as PaneStateSnapshot
        }
      />,
      client,
    );

    let projectTwoFolderButton: HTMLButtonElement | null = null;
    await waitFor(() => {
      projectTwoFolderButton = document.querySelector<HTMLButtonElement>(
        '[data-folder-id="/workspace/project-two"]',
      );
      expect(projectTwoFolderButton).not.toBeNull();
    });
    if (!projectTwoFolderButton) {
      throw new Error("Expected project-two folder row");
    }

    await user.click(projectTwoFolderButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Project Two/i })).toBeInTheDocument();
    });

    const expandProjectTwoButton = document.querySelector<HTMLButtonElement>(
      '[data-project-expand-toggle-for="project_2"]',
    );
    expect(expandProjectTwoButton).not.toBeNull();
    if (!expandProjectTwoButton) {
      throw new Error("Expected project-two expand toggle");
    }

    await user.click(expandProjectTwoButton);

    await waitFor(() => {
      expect(
        document.querySelector('.project-tree-session-row[data-session-id="session_2"]'),
      ).not.toBeNull();
    });

    failTreeSessionRefresh = true;

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    const refreshCallsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsBefore);
    });

    const refreshCallsAfterFirst = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(110);
    });

    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsAfterFirst);
    });
  });
});
