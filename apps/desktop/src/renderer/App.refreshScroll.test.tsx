// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
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
    const client = createAppClient({
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 2,
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

    await vi.advanceTimersByTimeAsync(110);
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
    let detailCallCount = 0;
    const client = createAppClient({
      "sessions:getDetail": (request) => {
        detailCallCount++;
        // After initial loads, simulate new messages arriving.
        const totalCount = detailCallCount <= 2 ? 150 : 250;
        return makeSessionDetail({
          totalCount,
          page: Number(request.page ?? 0),
          messages: [
            { id: `m_${detailCallCount}_1`, content: `Message ${detailCallCount} A` },
            { id: `m_${detailCallCount}_2`, content: `Message ${detailCallCount} B` },
          ],
        });
      },
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText(/Message \d+ A/)).toBeInTheDocument();
    });

    // Mock the message list as scrolled to the bottom (edge-pinned for ASC).
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledToBottom(messageList);

    // Enable periodic refresh.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await vi.advanceTimersByTimeAsync(110);

    // Auto-scroll should navigate to last page: ceil(250/100) - 1 = 2.
    await waitFor(() => {
      const detailCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "sessions:getDetail",
      );
      const pages = detailCalls.map(([, p]) => (p as Record<string, unknown>).page);
      expect(pages).toContain(2);
    });
  });

  it("auto-scrolls to page 0 when pinned to top edge (DESC sort)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 250,
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

    // Toggle sort direction to DESC.
    await user.click(screen.getByRole("button", { name: /Switch to newest first/i }));

    // Navigate to page 2 (away from newest in DESC).
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText(/Page 3/)).toBeInTheDocument();
    });

    // In jsdom, scrollTop defaults to 0 which is the top edge — pinned for DESC.
    // Enable periodic refresh.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await vi.advanceTimersByTimeAsync(110);

    // For DESC, auto-scroll should navigate to page 0 (newest messages).
    await waitFor(() => {
      expect(getLastInvokePayload(client, "sessions:getDetail").page).toBe(0);
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

    await vi.advanceTimersByTimeAsync(110);

    await waitFor(() => {
      const detailCallsAfter = client.invoke.mock.calls.filter(
        ([channel]) => channel === "sessions:getDetail",
      ).length;
      expect(detailCallsAfter).toBeGreaterThan(detailCallsBefore);
    });

    // All detail calls should be for page 0 — no navigation.
    const allDetailCalls = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    );
    for (const call of allDetailCalls) {
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
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    });
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledAway(messageList);

    await vi.advanceTimersByTimeAsync(110);

    // Should still be on page 2.
    await waitFor(() => {
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /Switch to newest first/i }));

    await vi.advanceTimersByTimeAsync(110);

    await waitFor(() => {
      expect(screen.getByText("Sort test message")).toBeInTheDocument();
    });

    // No focusMessageId should be sent.
    expect(getLastInvokePayload(client, "sessions:getDetail").focusMessageId).toBeUndefined();
  });

  it("treats scroll within threshold as edge-pinned (ASC, 5px from bottom)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let detailCallCount = 0;
    const client = createAppClient({
      "sessions:getDetail": (request) => {
        detailCallCount++;
        const totalCount = detailCallCount <= 2 ? 150 : 250;
        return makeSessionDetail({
          totalCount,
          page: Number(request.page ?? 0),
          messages: [{ id: `m_${detailCallCount}_1`, content: `Threshold msg ${detailCallCount}` }],
        });
      },
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText(/Threshold msg/)).toBeInTheDocument();
    });

    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledNearBottom(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await vi.advanceTimersByTimeAsync(110);

    // Should auto-scroll: navigate to latest page (page 2 for 250 messages).
    await waitFor(() => {
      const detailCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "sessions:getDetail",
      );
      const pages = detailCalls.map(([, p]) => (p as Record<string, unknown>).page);
      expect(pages).toContain(2);
    });
  });

  it("treats scroll outside threshold as NOT edge-pinned (ASC, 20px from bottom)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 250,
          page: Number(request.page ?? 0),
          messages: [{ id: "m1", content: "Not pinned message" }],
        }),
    });
    const { container } = renderWithClient(<App />, client);

    await enterSessionView(user);
    await waitFor(() => {
      expect(screen.getByText("Not pinned message")).toBeInTheDocument();
    });

    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledJustOutsideBottom(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    const callsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    ).length;

    await vi.advanceTimersByTimeAsync(110);

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
    const client = createAppClient({
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 250,
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

    // Switch to DESC sort.
    await user.click(screen.getByRole("button", { name: /Switch to newest first/i }));

    // Navigate to page 2.
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    });

    // Mock scrolled away from top (NOT pinned for DESC).
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledAwayFromTop(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await vi.advanceTimersByTimeAsync(110);

    // Should stay on page 2, not navigate to page 0.
    await waitFor(() => {
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    });
  });

  it("DESC sort pinned to top edge auto-scrolls to page 0", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient({
      "sessions:getDetail": (request) =>
        makeSessionDetail({
          totalCount: 250,
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

    await user.click(screen.getByRole("button", { name: /Switch to newest first/i }));

    // Navigate to page 2.
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    });

    // Mock scrolled to top (pinned for DESC, within threshold).
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledToTop(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await vi.advanceTimersByTimeAsync(110);

    // Should auto-scroll to page 0.
    await waitFor(() => {
      expect(getLastInvokePayload(client, "sessions:getDetail").page).toBe(0);
    });
  });

  it("project_all mode uses projectAllSortDirection for edge detection", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let combinedCallCount = 0;
    const client = createAppClient({
      "projects:getCombinedDetail": (request) => {
        combinedCallCount++;
        const totalCount = combinedCallCount <= 1 ? 250 : 350;
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
              id: `pm_${combinedCallCount}`,
              sourceId: `psrc_${combinedCallCount}`,
              sessionId: "session_1",
              provider: "claude" as const,
              category: "user" as const,
              content: `Project all msg ${combinedCallCount}`,
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
      expect(screen.getByText("Project all msg 1")).toBeInTheDocument();
    });

    // The default projectAllSortDirection is "desc", so newest is at top.
    // jsdom scrollTop=0 → pinned for DESC → auto-scroll mode.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    // Navigate to page 2 (away from page 0).
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    });

    await vi.advanceTimersByTimeAsync(110);

    // DESC auto-scroll should navigate back to page 0.
    await waitFor(() => {
      expect(getLastInvokePayload(client, "projects:getCombinedDetail").page).toBe(0);
    });
  });

  it("handles page clamping when totalCount drops and current page is out of range", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let detailCallCount = 0;
    const client = createAppClient({
      "sessions:getDetail": (request) => {
        detailCallCount++;
        const requestedPage = Number(request.page ?? 0);
        // Initially 250 messages (3 pages). After refresh, only 50 messages (1 page).
        const totalCount = detailCallCount <= 3 ? 250 : 50;
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
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(screen.getByText(/Page 3/)).toBeInTheDocument();
    });

    // Mock scrolled away so we don't trigger auto-scroll.
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledAway(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    await vi.advanceTimersByTimeAsync(110);

    // Server clamps page 2 → page 0 (only 1 page exists now).
    // The response.page !== sessionPage guard should update the page.
    await waitFor(() => {
      expect(screen.getByText(/Page 1 /)).toBeInTheDocument();
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
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    });

    // Mock scrolled away so auto-scroll doesn't engage.
    const messageList = container.querySelector<HTMLElement>(".msg-scroll.message-list");
    if (messageList) mockScrolledAway(messageList);

    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    // Fire 3 refresh ticks.
    for (let tick = 0; tick < 3; tick++) {
      await vi.advanceTimersByTimeAsync(110);
    }

    // Should still be on page 2 after 3 ticks.
    await waitFor(() => {
      expect(screen.getByText(/Page 2/)).toBeInTheDocument();
    });

    // All refresh detail calls for page 1 (index).
    const detailCalls = client.invoke.mock.calls.filter(
      ([channel]) => channel === "sessions:getDetail",
    );
    const refreshCalls = detailCalls.slice(-3);
    for (const call of refreshCalls) {
      expect((call[1] as Record<string, unknown>).page).toBe(1);
    }
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
    });
    await user.click(screen.getByText("Session Alpha"));
    await waitFor(() => {
      expect(screen.getByText("Alpha session message")).toBeInTheDocument();
    });

    // Enable periodic refresh.
    await user.click(screen.getByRole("button", { name: "Auto-refresh strategy" }));
    await user.click(screen.getByRole("button", { name: "5s scan" }));

    // Switch to Session Beta before the refresh tick fires.
    await user.click(screen.getByText("Session Beta"));
    await waitFor(() => {
      expect(screen.getByText("Beta session message")).toBeInTheDocument();
    });

    // Let the refresh tick fire.
    await vi.advanceTimersByTimeAsync(110);

    // Should still show Beta session, not Alpha.
    await waitFor(() => {
      expect(screen.getByText("Beta session message")).toBeInTheDocument();
    });
    expect(screen.queryByText("Alpha session message")).toBeNull();
  });
});
