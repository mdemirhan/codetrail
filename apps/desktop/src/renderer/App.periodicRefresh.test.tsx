// @vitest-environment jsdom

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, setTestStrategyIntervalOverrides } from "./App";
import type { PaneStateSnapshot } from "./app/types";
import { createAppClient } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

const FAST_OVERRIDES = {
  "scan-5s": 100,
  "scan-10s": 200,
  "scan-30s": 300,
  "scan-1min": 400,
  "scan-5min": 500,
} as const;

describe("App periodic refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setTestStrategyIntervalOverrides(FAST_OVERRIDES);
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
