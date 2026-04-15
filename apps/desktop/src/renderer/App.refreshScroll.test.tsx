// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, setTestStrategyIntervalOverrides } from "./App";
import { createAppClient } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

const FAST_OVERRIDES = {
  "scan-5s": 100,
  "scan-10s": 200,
  "scan-30s": 300,
  "scan-1min": 400,
  "scan-5min": 500,
} as const;

// Helper: generate a session detail response with N messages on a given page.
function makeSessionDetail({
  totalCount,
  page,
  messages,
}: {
  totalCount: number;
  page: number;
  messages: Array<{ id: string; content: string; category?: "user" | "assistant" }>;
}) {
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
      messageCount: totalCount,
      tokenInputTotal: 14,
      tokenOutputTotal: 8,
    },
    totalCount,
    categoryCounts: {
      user: Math.ceil(totalCount / 2),
      assistant: Math.floor(totalCount / 2),
      tool_use: 0,
      tool_edit: 0,
      tool_result: 0,
      thinking: 0,
      system: 0,
    },
    page,
    pageSize: 100,
    focusIndex: null,
    messages: messages.map((m, i) => ({
      id: m.id,
      sourceId: `src_${m.id}`,
      sessionId: "session_1",
      provider: "claude" as const,
      category: m.category ?? (i % 2 === 0 ? ("user" as const) : ("assistant" as const)),
      content: m.content,
      createdAt: "2026-03-01T10:00:00.000Z",
      tokenInput: null,
      tokenOutput: null,
      operationDurationMs: null,
      operationDurationSource: null,
      operationDurationConfidence: null,
    })),
  };
}

function makeSessionSummary({
  id = "session_1",
  projectId = "project_1",
  title = "Investigate markdown rendering",
  messageCount,
  bookmarkCount = 0,
  tokenInputTotal = 14,
  tokenOutputTotal = 8,
}: {
  id?: string;
  projectId?: string;
  title?: string;
  messageCount: number;
  bookmarkCount?: number;
  tokenInputTotal?: number;
  tokenOutputTotal?: number;
}) {
  return {
    id,
    projectId,
    provider: "claude" as const,
    filePath: `/workspace/${projectId}/${id}.jsonl`,
    title,
    modelNames: "claude-opus-4-1",
    startedAt: "2026-03-01T10:00:00.000Z",
    endedAt: "2026-03-01T10:00:05.000Z",
    durationMs: 5000,
    gitBranch: "main",
    cwd: `/workspace/${projectId}`,
    messageCount,
    bookmarkCount,
    tokenInputTotal,
    tokenOutputTotal,
  };
}

function makeProjectSummary({
  id = "project_1",
  name = "Project One",
  messageCount,
  bookmarkCount = 0,
  lastActivity = "2026-03-01T10:00:05.000Z",
}: {
  id?: string;
  name?: string;
  messageCount: number;
  bookmarkCount?: number;
  lastActivity?: string;
}) {
  return {
    id,
    provider: "claude" as const,
    name,
    path: `/workspace/${id}`,
    sessionCount: 1,
    messageCount,
    bookmarkCount,
    lastActivity,
  };
}

function expectDefined<T>(value: T | null | undefined, message: string): NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
  return value as NonNullable<T>;
}

function getLastInvokePayload(
  client: ReturnType<typeof createAppClient>,
  channel: "projects:getCombinedDetail" | "sessions:getDetail",
): Record<string, unknown> {
  const calls = client.invoke.mock.calls.filter(([candidate]) => candidate === channel);
  const lastCall = calls[calls.length - 1];
  return expectDefined(lastCall, `Expected ${channel} to be invoked`)[1] as Record<string, unknown>;
}

async function advanceRefreshTimers(ms = 110): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Waits for the initial project_all view to load, then clicks into the session.
async function enterSessionView(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
  });
  await user.click(await screen.findByText("Investigate markdown rendering"));
}

// Simulate the message list being scrolled away from the newest-messages edge
// so edge-detection returns false (not pinned → scroll preservation mode).
function mockScrolledAway(container: HTMLElement) {
  Object.defineProperty(container, "scrollTop", { value: 200, configurable: true, writable: true });
  Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
}

// Simulate the message list being at the bottom edge (ASC pinned).
function mockScrolledToBottom(container: HTMLElement) {
  Object.defineProperty(container, "scrollTop", {
    value: 1600,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
}

// Simulate scrolled to within threshold of bottom edge (should be considered pinned).
function mockScrolledNearBottom(container: HTMLElement) {
  // scrollTop(1595) + clientHeight(400) = 1995 >= scrollHeight(2000) - 10 = 1990 → pinned
  Object.defineProperty(container, "scrollTop", {
    value: 1595,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
}

// Simulate scrolled just outside threshold of bottom edge (should NOT be pinned).
function mockScrolledJustOutsideBottom(container: HTMLElement) {
  // scrollTop(1580) + clientHeight(400) = 1980 < scrollHeight(2000) - 10 = 1990 → NOT pinned
  Object.defineProperty(container, "scrollTop", {
    value: 1580,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
}

// Simulate scrolled to top edge (DESC pinned, scrollTop within threshold).
function mockScrolledToTop(container: HTMLElement) {
  Object.defineProperty(container, "scrollTop", { value: 3, configurable: true, writable: true });
  Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
}

// Simulate scrolled away from top in DESC (NOT pinned).
function mockScrolledAwayFromTop(container: HTMLElement) {
  Object.defineProperty(container, "scrollTop", { value: 50, configurable: true, writable: true });
  Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
}

describe("App refresh scroll preservation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setTestStrategyIntervalOverrides(FAST_OVERRIDES);
  });

  afterEach(() => {
    setTestStrategyIntervalOverrides(null);
    vi.useRealTimers();
  });

  it("re-fetches the same page when scrolled away from edge (no focusMessageId sent)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionListCallCount = 0;
    const client = createAppClient({
      "sessions:list": () => {
        sessionListCallCount++;
        const messageCount = sessionListCallCount <= 1 ? 2 : 4;
        return {
          sessions: [makeSessionSummary({ messageCount })],
        };
      },
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: sessionListCallCount <= 1 ? 2 : 4,
          page: Number(request.page ?? 0),
          messages: [
            { id: "m1", content: "Session one message" },
            { id: "m2", content: "Session one response" },
          ],
        }),
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("Session one message")).toBeInTheDocument();
    });

    // Mock the message list as scrolled away from the bottom (not edge-pinned).
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledAway(messageList);

    // Enable periodic refresh (3s).
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    const callsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    ).length;

    await advanceRefreshTimers();
    await waitFor(() => {
      const callsAfter = client.invoke.mock.calls.filter(
        ([channel]) => channel === "sessions:getDetail",
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    // Verify no focusMessageId was sent in the refresh call.
    const payload = getLastInvokePayload(client, "sessions:getDetail");
    expect(payload.focusMessageId).toBeUndefined();
    expect(payload.page).toBe(0);
  });

  it("auto-scrolls to latest page when pinned to bottom edge (ASC sort)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionListCallCount = 0;
    const client = createAppClient({
      "sessions:list": () => {
        sessionListCallCount++;
        const messageCount = sessionListCallCount <= 1 ? 2 : 250;
        return {
          sessions: [makeSessionSummary({ messageCount })],
        };
      },
      "sessions:getDetail": (request) => {
        const totalCount = sessionListCallCount <= 1 ? 2 : 250;
        return makeSessionDetail({
          totalCount,
          page: Number(request.page ?? 0),
          messages: [
            { id: `m_${totalCount}_1`, content: `Message ${totalCount} A` },
            { id: `m_${totalCount}_2`, content: `Message ${totalCount} B` },
          ],
        });
      },
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText(/Message \d+ A/)).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: "Newest first (session). Switch to oldest first",
      }),
    );

    // Mock the message list as scrolled to the bottom (edge-pinned for ASC).
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledToBottom(messageList);

    // Enable periodic refresh.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await advanceRefreshTimers();

    // Auto-scroll should navigate to the new last page for the current message page size.
    await waitFor(() => {
      const detailCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "sessions:getDetail",
      );
      const pages = detailCalls.map(([, p]) => (p as Record<string, unknown>).page);
      expect(pages).toContain(4);
    });
  });

  it("does not auto-scroll from an older DESC page when pinned to the top of that page", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionListCallCount = 0;
    const client = createAppClient({
      "sessions:list": () => {
        sessionListCallCount++;
        const messageCount = sessionListCallCount <= 1 ? 250 : 350;
        return {
          sessions: [makeSessionSummary({ messageCount })],
        };
      },
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: sessionListCallCount <= 1 ? 250 : 350,
          page: Number(request.page ?? 0),
          messages: [
            { id: "m1", content: "DESC message A" },
            { id: "m2", content: "DESC message B" },
          ],
        }),
    });
    renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("DESC message A")).toBeInTheDocument();
    });

    // Navigate to page 2 (away from newest in DESC).
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("3");
    });

    // In jsdom, scrollTop defaults to 0 which is the top edge — pinned for DESC.
    // Enable periodic refresh.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await advanceRefreshTimers();

    // Top of page 3 is not the live edge for DESC; stay on page 3.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("3");
    });
  });

  it("does not navigate when edge-pinned but no new messages arrive", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 2,
          page: Number(request.page ?? 0),
          messages: [
            { id: "m1", content: "Stable message A" },
            { id: "m2", content: "Stable message B" },
          ],
        }),
    });
    // jsdom defaults: scrollTop=0, scrollHeight=0, clientHeight=0 → edge-pinned.
    renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("Stable message A")).toBeInTheDocument();
    });

    // Enable periodic refresh.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    const detailCallsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    ).length;

    await advanceRefreshTimers();

    await waitFor(() => {
      expect(screen.getByText("Stable message A")).toBeInTheDocument();
    });

    const detailCallsAfter = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    );
    expect(detailCallsAfter.length).toBeGreaterThanOrEqual(detailCallsBefore);
    for (const call of detailCallsAfter) {
      expect((call[1] as Record<string, unknown>).page).toBe(0);
    }

    expect(screen.getByText("Stable message A")).toBeInTheDocument();
    expect(screen.getByText("Stable message B")).toBeInTheDocument();
  });

  it("user page navigation during active periodic refresh is not overridden", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 250,
          page: Number(request.page ?? 0),
          messages: [
            { id: "m1", content: "Page content" },
            { id: "m2", content: "More content" },
          ],
        }),
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("Page content")).toBeInTheDocument();
    });

    // Enable periodic refresh.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    // Navigate to page 2, then mock as scrolled away.
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledAway(messageList);

    await advanceRefreshTimers();

    // Should still be on page 2.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
  });

  it("refresh context is invalidated when sort direction changes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 2,
          page: Number(request.page ?? 0),
          messages: [
            { id: "m1", content: "Sort test message" },
            { id: "m2", content: "Sort test response" },
          ],
        }),
    });
    renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("Sort test message")).toBeInTheDocument();
    });

    // Enable periodic refresh.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    // Toggle sort direction — this should invalidate any pending refresh context.
    await user.click(
      screen.getByRole("button", {
        name: "Newest first (session). Switch to oldest first",
      }),
    );

    await advanceRefreshTimers();

    await waitFor(() => {
      expect(screen.getByText("Sort test message")).toBeInTheDocument();
    });

    // No focusMessageId should be sent.
    expect(getLastInvokePayload(client, "sessions:getDetail").focusMessageId).toBeUndefined();
  });

  it("treats scroll within threshold as visually pinned but does not follow from a non-live ASC page", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionListCallCount = 0;
    const client = createAppClient({
      "sessions:list": () => {
        sessionListCallCount++;
        const messageCount = sessionListCallCount <= 1 ? 250 : 350;
        return {
          sessions: [makeSessionSummary({ messageCount })],
        };
      },
      "sessions:getDetail": (request) => {
        const totalCount = sessionListCallCount <= 1 ? 250 : 350;
        return makeSessionDetail({
          totalCount,
          page: Number(request.page ?? 0),
          messages: [{ id: `m_${totalCount}_1`, content: `Threshold msg ${totalCount}` }],
        });
      },
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText(/Threshold msg/)).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: "Newest first (session). Switch to oldest first",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledNearBottom(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await advanceRefreshTimers();

    // Bottom of page 2 is visually pinned but not the live edge for ASC after growth.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
  });

  it("treats scroll outside threshold as NOT edge-pinned (ASC, 20px from bottom)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionListCallCount = 0;
    const client = createAppClient({
      "sessions:list": () => {
        sessionListCallCount++;
        const messageCount = sessionListCallCount <= 1 ? 250 : 350;
        return {
          sessions: [makeSessionSummary({ messageCount })],
        };
      },
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: sessionListCallCount <= 1 ? 250 : 350,
          page: Number(request.page ?? 0),
          messages: [{ id: "m1", content: "Not pinned message" }],
        }),
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("Not pinned message")).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: "Newest first (session). Switch to oldest first",
      }),
    );

    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledJustOutsideBottom(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    const callsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    ).length;

    await advanceRefreshTimers();

    await waitFor(() => {
      const callsAfter = client.invoke.mock.calls.filter(
        ([channel]) => channel === "sessions:getDetail",
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    // Should stay on page 0, not auto-scroll to page 2.
    const allDetailCalls = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    );
    const pagesAfterRefresh = allDetailCalls.map(([, p]) => (p as Record<string, unknown>).page);
    expect(pagesAfterRefresh).not.toContain(2);
  });

  it("DESC sort scrolled away from top preserves same page", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionListCallCount = 0;
    const client = createAppClient({
      "sessions:list": () => {
        sessionListCallCount++;
        const messageCount = sessionListCallCount <= 1 ? 250 : 350;
        return {
          sessions: [makeSessionSummary({ messageCount })],
        };
      },
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: sessionListCallCount <= 1 ? 250 : 350,
          page: Number(request.page ?? 0),
          messages: [
            { id: "m1", content: "DESC away msg A" },
            { id: "m2", content: "DESC away msg B" },
          ],
        }),
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("DESC away msg A")).toBeInTheDocument();
    });

    // Navigate to page 2.
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    // Mock scrolled away from top (NOT pinned for DESC).
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledAwayFromTop(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await advanceRefreshTimers();

    // Should stay on page 2, not navigate to page 0.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
  });

  it("DESC sort pinned to top edge on page 0 keeps following the newest messages", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionListCallCount = 0;
    const client = createAppClient({
      "sessions:list": () => {
        sessionListCallCount++;
        const messageCount = sessionListCallCount <= 1 ? 250 : 350;
        return {
          sessions: [makeSessionSummary({ messageCount })],
        };
      },
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: sessionListCallCount <= 1 ? 250 : 350,
          page: Number(request.page ?? 0),
          messages: [
            { id: "m1", content: "DESC pinned msg" },
            { id: "m2", content: "DESC pinned msg 2" },
          ],
        }),
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("DESC pinned msg")).toBeInTheDocument();
    });

    // Mock scrolled to top (pinned for DESC, within threshold).
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledToTop(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await advanceRefreshTimers();

    // Page 0 is the live edge for DESC, so the view stays on page 0.
    await waitFor(() => {
      expect(getLastInvokePayload(client, "sessions:getDetail").page).toBe(0);
    });
  });

  it("project_all mode does not auto-scroll from an older DESC page just because the page top is pinned", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let projectListCallCount = 0;
    const client = createAppClient({
      "projects:list": () => {
        projectListCallCount++;
        const messageCount = projectListCallCount <= 1 ? 250 : 350;
        return {
          projects: [makeProjectSummary({ messageCount })],
        };
      },
      "projects:getCombinedDetail": (request) => {
        const totalCount = projectListCallCount <= 1 ? 250 : 350;
        const requestedPage = Number(request.page ?? 0);
        const page = Number.isFinite(requestedPage) && requestedPage >= 0 ? requestedPage : 0;
        return {
          projectId: "project_1",
          totalCount,
          categoryCounts: {
            user: 125,
            assistant: 125,
            tool_use: 0,
            tool_edit: 0,
            tool_result: 0,
            thinking: 0,
            system: 0,
          },
          page,
          pageSize: 100,
          focusIndex: null,
          messages: [
            {
              id: `pm_${totalCount}`,
              sourceId: `psrc_${totalCount}`,
              sessionId: "session_1",
              provider: "claude" as const,
              category: "user" as const,
              content: `Project all msg ${totalCount}`,
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
          ],
        };
      },
    });
    renderWithClient(<App />, client);

    // project_all mode loads on initial render (default view).
    await waitFor(() => {
      expect(screen.getByText("Project all msg 250")).toBeInTheDocument();
    });

    // The default projectAllSortDirection is "desc", so newest is at top.
    // jsdom scrollTop=0 → pinned for DESC → auto-scroll mode.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    // Navigate to page 2 (away from page 0).
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    const messageList = document.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledToTop(messageList);

    await advanceRefreshTimers();

    // Top of page 2 is not the live edge for DESC project-all.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
  });

  it("ignores unrelated project updates while viewing a session page", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let projectListCallCount = 0;
    const client = createAppClient({
      "projects:list": () => {
        projectListCallCount++;
        return {
          projects: [
            makeProjectSummary({ id: "project_1", name: "Project One", messageCount: 250 }),
            makeProjectSummary({
              id: "project_2",
              name: "Project Two",
              messageCount: projectListCallCount <= 1 ? 10 : 25,
              lastActivity: "2026-03-01T10:01:05.000Z",
            }),
          ],
        };
      },
      "sessions:list": () => ({
        sessions: [makeSessionSummary({ messageCount: 250 })],
      }),
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 250,
          page: Number(request.page ?? 0),
          messages: [
            { id: "m1", content: "Selected project msg" },
            { id: "m2", content: "Selected project msg 2" },
          ],
        }),
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("Selected project msg")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledToTop(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await advanceRefreshTimers();

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
  });

  it("ignores unrelated project updates while viewing project_all", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let projectListCallCount = 0;
    const client = createAppClient({
      "projects:list": () => {
        projectListCallCount++;
        return {
          projects: [
            makeProjectSummary({ id: "project_1", name: "Project One", messageCount: 250 }),
            makeProjectSummary({
              id: "project_2",
              name: "Project Two",
              messageCount: projectListCallCount <= 1 ? 10 : 25,
              lastActivity: "2026-03-01T10:01:05.000Z",
            }),
          ],
        };
      },
      "projects:getCombinedDetail": (request) => ({
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
        page: Number(request.page ?? 0),
        pageSize: 100,
        focusIndex: null,
        messages: [
          {
            id: "pm1",
            sourceId: "psrc1",
            sessionId: "session_1",
            provider: "claude" as const,
            category: "user" as const,
            content: "Project all selected scope",
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
        ],
      }),
    });
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project all selected scope")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    const messageList = document.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledToTop(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await advanceRefreshTimers();

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
  });

  it("handles page clamping when totalCount drops and current page is out of range", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let sessionListCallCount = 0;
    let detailCallCount = 0;
    const client = createAppClient({
      "sessions:list": () => {
        sessionListCallCount++;
        const messageCount = sessionListCallCount <= 1 ? 250 : 50;
        return {
          sessions: [makeSessionSummary({ messageCount })],
        };
      },
      "sessions:getDetail": (request) => {
        detailCallCount++;
        const requestedPage = Number(request.page ?? 0);
        // Initially 250 messages (3 pages). After refresh, only 50 messages (1 page).
        const totalCount = sessionListCallCount <= 1 ? 250 : 50;
        const maxPage = Math.max(0, Math.ceil(totalCount / 100) - 1);
        const clampedPage = Math.min(requestedPage, maxPage);
        return makeSessionDetail({
          totalCount,
          page: clampedPage,
          messages: [{ id: `m_${detailCallCount}`, content: `Clamped msg ${detailCallCount}` }],
        });
      },
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText(/Clamped msg/)).toBeInTheDocument();
    });

    // Navigate to page 3 (index 2).
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("3");
    });

    // Mock scrolled away so we don't trigger auto-scroll.
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledAway(messageList);

    const detailCallsBeforeAutoRefresh = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    ).length;

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await advanceRefreshTimers();

    // Server clamps page 2 → page 0 (only 1 page exists now).
    // The response.page !== sessionPage guard should update the page.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("1");
    });
  });

  it("multiple refresh ticks with stable data do not accumulate page drift", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 250,
          page: Number(request.page ?? 0),
          messages: [
            { id: "m1", content: "Stable tick msg" },
            { id: "m2", content: "Stable tick msg 2" },
          ],
        }),
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("Stable tick msg")).toBeInTheDocument();
    });

    // Navigate to page 2.
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    // Mock scrolled away so auto-scroll doesn't engage.
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledAway(messageList);

    const detailCallsBeforeAutoRefresh = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    ).length;

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    // Fire 3 refresh ticks.
    for (let tick = 0; tick < 3; tick++) {
      await advanceRefreshTimers();
    }

    // Should still be on page 2 after 3 ticks.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Page number" })).toHaveValue("2");
    });

    const detailCallsAfterAutoRefresh = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    );
    expect(detailCallsAfterAutoRefresh).toHaveLength(detailCallsBeforeAutoRefresh);
    const lastDetailCall = detailCallsAfterAutoRefresh.at(-1);
    expect(lastDetailCall).toBeDefined();
    expect((lastDetailCall?.[1] as Record<string, unknown>).page).toBe(1);
  });

  it("switching sessions during refresh does not apply stale refresh data", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "sessions:list": () => ({
        sessions: [
          {
            id: "session_1",
            projectId: "project_1",
            provider: "claude",
            filePath: "/workspace/project-one/session-1.jsonl",
            title: "Session Alpha",
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
          {
            id: "session_2",
            projectId: "project_1",
            provider: "claude",
            filePath: "/workspace/project-one/session-2.jsonl",
            title: "Session Beta",
            modelNames: "claude-opus-4-1",
            startedAt: "2026-03-01T09:00:00.000Z",
            endedAt: "2026-03-01T09:00:05.000Z",
            durationMs: 5000,
            gitBranch: "main",
            cwd: "/workspace/project-one",
            messageCount: 1,
            tokenInputTotal: 4,
            tokenOutputTotal: 5,
          },
        ],
      }),
      "sessions:getDetail": (request) => {
        const sessionId = String(request.sessionId);
        if (sessionId === "session_2") {
          return makeSessionDetail({
            totalCount: 1,
            page: 0,
            messages: [{ id: "beta_m1", content: "Beta session message" }],
          });
        }
        return makeSessionDetail({
          totalCount: 2,
          page: Number(request.page ?? 0),
          messages: [
            { id: "alpha_m1", content: "Alpha session message" },
            { id: "alpha_m2", content: "Alpha response" },
          ],
        });
      },
    });
    renderWithClient(<App />, client);

    // Wait for project_all view to load, then click Session Alpha.
    await waitFor(() => {
      expect(screen.getByText("Please review markdown table rendering")).toBeInTheDocument();
      expect(screen.getByText("Session Alpha")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Session Alpha"));
    await waitFor(() => {
      expect(screen.getByText("Alpha session message")).toBeInTheDocument();
    });

    // Enable periodic refresh.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    // Switch to Session Beta before the refresh tick fires.
    await waitFor(() => {
      expect(screen.getByText("Session Beta")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Session Beta"));
    await waitFor(() => {
      expect(screen.getByText("Beta session message")).toBeInTheDocument();
    });

    // Let the refresh tick fire.
    await advanceRefreshTimers();

    // Should still show Beta session, not Alpha.
    await waitFor(() => {
      expect(screen.getByText("Beta session message")).toBeInTheDocument();
    });
    expect(screen.queryByText("Alpha session message")).toBeNull();
  });
});
